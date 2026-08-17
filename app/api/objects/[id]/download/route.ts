import { apiUser, tenantContext, unauthorized } from "@/lib/api";
import { getStoredObjectForDownload } from "@/lib/ingestion";
import { signedDownloadUrl } from "@/lib/storage";
import { recordSecurityEvent } from "@/lib/security";

export const runtime = "nodejs";
type Context = { params: Promise<{ id: string }> };

export async function GET(request: Request, { params }: Context) {
  const user = await apiUser();
  if (!user) return unauthorized();
  const { id } = await params;
  const object = await getStoredObjectForDownload(tenantContext(user), id);
  if (!object) return Response.json({ error: "Objeto no encontrado" }, { status: 404 });
  const url = await signedDownloadUrl(object.bucket, object.objectKey, object.originalName);
  await recordSecurityEvent({
    request, eventType: "object.download", outcome: "success", userId: user.id,
    workspaceId: user.workspaceId, metadata: { objectId: id },
  });
  return Response.redirect(url, 307);
}
