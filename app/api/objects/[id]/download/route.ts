import { apiUser, tenantContext, unauthorized } from "@/lib/api";
import { getStoredObjectForDownload } from "@/lib/ingestion";
import { signedDownloadUrl, streamStoredObject } from "@/lib/storage";
import { recordSecurityEvent } from "@/lib/security";

export const runtime = "nodejs";
type Context = { params: Promise<{ id: string }> };

export async function GET(request: Request, { params }: Context) {
  const user = await apiUser();
  if (!user) return unauthorized();
  const { id } = await params;
  const object = await getStoredObjectForDownload(tenantContext(user), id);
  if (!object) return Response.json({ error: "Objeto no encontrado" }, { status: 404 });
  const inline = new URL(request.url).searchParams.get("inline") === "1";
  if (inline) {
    const range = request.headers.get("range") ?? undefined;
    if (range && !/^bytes=\d*-\d*$/.test(range)) {
      return new Response(null, {
        status: 416,
        headers: { "Content-Range": `bytes */${object.sizeBytes}` },
      });
    }
    const streamed = await streamStoredObject({
      bucket: object.bucket,
      key: object.objectKey,
      range,
      fallbackContentType: object.contentType,
    });
    const safeName = object.originalName.replace(/["\r\n]/g, "_");
    const headers = new Headers({
      "Accept-Ranges": "bytes",
      "Cache-Control": "private, no-store",
      "Content-Type": streamed.contentType,
      "Content-Disposition": `inline; filename="${safeName}"`,
      "X-Content-Type-Options": "nosniff",
    });
    if (streamed.contentLength !== undefined) headers.set("Content-Length", String(streamed.contentLength));
    if (streamed.contentRange) headers.set("Content-Range", streamed.contentRange);
    if (streamed.etag) headers.set("ETag", streamed.etag);
    if (streamed.lastModified) headers.set("Last-Modified", streamed.lastModified.toUTCString());
    return new Response(streamed.body, {
      status: streamed.contentRange ? 206 : 200,
      headers,
    });
  }
  const url = await signedDownloadUrl(object.bucket, object.objectKey, object.originalName);
  await recordSecurityEvent({
    request, eventType: "object.download", outcome: "success", userId: user.id,
    workspaceId: user.workspaceId, metadata: { objectId: id },
  });
  return Response.redirect(url, 307);
}
