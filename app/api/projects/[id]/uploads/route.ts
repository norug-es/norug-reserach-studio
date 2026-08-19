import { createHash, randomUUID } from "node:crypto";
import { apiUser, authorized, forbidden, serverError, tenantContext, unauthorized } from "@/lib/api";
import { getProject } from "@/lib/repository";
import { createIngestionRecord, findStoredObjectByHash, listBundleEntries, listExtractedDocuments, listProcessingJobs, listSecurityScans, listStoredObjects, listTranscriptions } from "@/lib/ingestion";
import { deleteStoredObject, putStoredObject } from "@/lib/storage";
import { maximumBatchBytes, maximumBatchFiles, normalizeRelativePath, UploadPolicyError, validateUpload } from "@/lib/upload-policy";
import { consumeRateLimit, mutationOriginError, rateLimitKey, recordSecurityEvent } from "@/lib/security";

export const runtime = "nodejs";
type Context = { params: Promise<{ id: string }> };

export async function GET(_request: Request, { params }: Context) {
  const user = await apiUser();
  if (!user) return unauthorized();
  const { id } = await params;
  const context = tenantContext(user);
  if (!await getProject(context, id)) return Response.json({ error: "No encontrado" }, { status: 404 });
  const [objects, jobs, scans, documents, transcriptions, bundleEntries] = await Promise.all([
    listStoredObjects(context, id), listProcessingJobs(context, id),
    listSecurityScans(context, id), listExtractedDocuments(context, id), listTranscriptions(context, id),
    listBundleEntries(context, id),
  ]);
  return Response.json({ objects, jobs, scans, documents, transcriptions, bundleEntries });
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
  if (contentLength > maximumBatchBytes() + 10 * 1024 * 1024) {
    return Response.json({ error: "La solicitud supera el límite permitido" }, { status: 413 });
  }
  try {
    const { id: projectId } = await params;
    const context = tenantContext(user);
    if (!await getProject(context, projectId)) return Response.json({ error: "No encontrado" }, { status: 404 });
    const form = await request.formData();
    const currentFiles = form.getAll("files").filter((value): value is File => value instanceof File);
    const legacyFile = form.get("file");
    const files = currentFiles.length ? currentFiles : legacyFile instanceof File ? [legacyFile] : [];
    if (!files.length) return Response.json({ error: "Selecciona uno o varios archivos" }, { status: 400 });
    if (files.length > maximumBatchFiles()) {
      return Response.json({ error: `El lote supera el máximo de ${maximumBatchFiles()} archivos` }, { status: 400 });
    }
    const totalBytes = files.reduce((sum, file) => sum + file.size, 0);
    if (totalBytes > maximumBatchBytes()) {
      return Response.json({ error: `El lote supera ${Math.round(maximumBatchBytes() / 1024 / 1024)} MB` }, { status: 413 });
    }
    const paths = form.getAll("relativePaths").map(String);
    const uploadMode = String(form.get("mode") ?? (files.length > 1 ? "multiple" : "single"));
    const results: Array<Record<string, unknown>> = [];
    for (let index = 0; index < files.length; index += 1) {
      const file = files[index];
      let uploaded: { bucket: string; key: string } | undefined;
      try {
        const policy = validateUpload(file.name, file.type, file.size);
        const relativePath = normalizeRelativePath(paths[index] ?? file.name, file.name);
        const bytes = new Uint8Array(await file.arrayBuffer());
        const sha256 = createHash("sha256").update(bytes).digest("hex");
        const duplicate = await findStoredObjectByHash(context, projectId, sha256);
        if (duplicate) {
          results.push({ name: file.name, relativePath, status: "duplicate", object: duplicate });
          continue;
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
          relativePath, metadata: { uploadMode, relativePath },
        });
        results.push({ name: file.name, relativePath, status: "accepted", ...record });
      } catch (error) {
        if (uploaded) await deleteStoredObject(uploaded.bucket, uploaded.key).catch((cleanupError) =>
          console.error("No se pudo eliminar un objeto huérfano", cleanupError));
        results.push({ name: file.name, relativePath: paths[index] ?? file.name, status: "rejected",
          error: error instanceof Error ? error.message : "Error inesperado" });
      }
    }
    const accepted = results.filter((result) => result.status === "accepted").length;
    const duplicates = results.filter((result) => result.status === "duplicate").length;
    const rejected = results.length - accepted - duplicates;
    await recordSecurityEvent({
      request, eventType: "object.upload", outcome: "success", userId: user.id,
      workspaceId: user.workspaceId, metadata: {
        projectId, uploadMode, files: files.length, totalBytes, accepted, duplicates, rejected,
      },
    });
    return Response.json({ results, summary: { total: files.length, accepted, duplicates, rejected } },
      { status: rejected ? 207 : 202 });
  } catch (error) {
    await recordSecurityEvent({
      request, eventType: "object.upload", outcome: "failure",
      userId: user.id, workspaceId: user.workspaceId,
    });
    return serverError(error, error instanceof UploadPolicyError ? 400 : 500);
  }
}
