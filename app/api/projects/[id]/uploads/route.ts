import { createHash, randomUUID } from "node:crypto";
import { apiUser, authorized, forbidden, serverError, tenantContext, unauthorized } from "@/lib/api";
import { getProject } from "@/lib/repository";
import { createIngestionRecord, findStoredObjectByHash, listProcessingJobs, listStoredObjects } from "@/lib/ingestion";
import { deleteStoredObject, putStoredObject } from "@/lib/storage";
import { maximumUploadBytes, UploadPolicyError, validateUpload } from "@/lib/upload-policy";
import { consumeRateLimit, mutationOriginError, rateLimitKey, recordSecurityEvent } from "@/lib/security";

export const runtime = "nodejs";
type Context = { params: Promise<{ id: string }> };

export async function GET(_request: Request, { params }: Context) {
  const user = await apiUser();
  if (!user) return unauthorized();
  const { id } = await params;
  const context = tenantContext(user);
  if (!await getProject(context, id)) return Response.json({ error: "No encontrado" }, { status: 404 });
  const [objects, jobs] = await Promise.all([listStoredObjects(context, id), listProcessingJobs(context, id)]);
  return Response.json({ objects, jobs });
}

export async function POST(request: Request, { params }: Context) {
  const originError = mutationOriginError(request);
  if (originError) return originError;
  const user = await apiUser();
  if (!user) return unauthorized();
  if (!authorized(user, "object:upload")) return forbidden();
  const rate = await consumeRateLimit({
    action: "object.upload", keyHash: rateLimitKey(request, user.id),
    limit: 30, windowSeconds: 60 * 60, blockSeconds: 30 * 60,
  });
  if (!rate.allowed) return Response.json({ error: "Límite temporal de cargas alcanzado" }, {
    status: 429, headers: { "Retry-After": String(rate.retryAfterSeconds) },
  });
  const contentLength = Number(request.headers.get("content-length") ?? 0);
  if (contentLength > maximumUploadBytes() + 1024 * 1024) {
    return Response.json({ error: "La solicitud supera el límite permitido" }, { status: 413 });
  }
  let uploaded: { bucket: string; key: string } | undefined;
  try {
    const { id: projectId } = await params;
    const context = tenantContext(user);
    if (!await getProject(context, projectId)) return Response.json({ error: "No encontrado" }, { status: 404 });
    const form = await request.formData();
    const file = form.get("file");
    if (!(file instanceof File)) return Response.json({ error: "Selecciona un archivo" }, { status: 400 });
    const policy = validateUpload(file.name, file.type, file.size);
    const bytes = new Uint8Array(await file.arrayBuffer());
    const sha256 = createHash("sha256").update(bytes).digest("hex");
    const duplicate = await findStoredObjectByHash(context, projectId, sha256);
    if (duplicate) {
      await recordSecurityEvent({
        request, eventType: "object.upload", outcome: "success", userId: user.id,
        workspaceId: user.workspaceId, metadata: { objectId: duplicate.id, projectId, duplicate: true },
      });
      return Response.json({ object: duplicate, duplicate: true }, { status: 200 });
    }
    const objectId = randomUUID();
    const key = `${user.workspaceId}/${projectId}/${objectId}-${policy.originalName}`;
    const bucket = await putStoredObject({
      key, body: bytes, contentType: policy.contentType, sha256,
      tenantId: user.workspaceId, projectId,
    });
    uploaded = { bucket, key };
    const record = await createIngestionRecord(context, {
      objectId, objectKey: key, bucket, originalName: policy.originalName,
      contentType: policy.contentType, sizeBytes: file.size, sha256,
      category: policy.category, projectId, userId: user.id, actor: user.email,
    });
    await recordSecurityEvent({
      request, eventType: "object.upload", outcome: "success", userId: user.id,
      workspaceId: user.workspaceId, metadata: { objectId, projectId, sizeBytes: file.size },
    });
    return Response.json(record, { status: 202 });
  } catch (error) {
    if (uploaded) await deleteStoredObject(uploaded.bucket, uploaded.key).catch((cleanupError) =>
      console.error("No se pudo eliminar un objeto huérfano", cleanupError));
    await recordSecurityEvent({
      request, eventType: "object.upload", outcome: "failure",
      userId: user.id, workspaceId: user.workspaceId,
    });
    return serverError(error, error instanceof UploadPolicyError ? 400 : 500);
  }
}
