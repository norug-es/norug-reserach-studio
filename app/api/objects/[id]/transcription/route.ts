import { apiUser, tenantContext, unauthorized } from "@/lib/api";
import { getTranscription } from "@/lib/ingestion";
import { subtitleFileName, toSrt, toVtt } from "@/lib/subtitles";

export const runtime = "nodejs";
type Context = { params: Promise<{ id: string }> };

export async function GET(request: Request, { params }: Context) {
  const user = await apiUser();
  if (!user) return unauthorized();
  const { id } = await params;
  const transcription = await getTranscription(tenantContext(user), id);
  if (!transcription) return Response.json({ error: "Transcripción no encontrada" }, { status: 404 });
  const format = new URL(request.url).searchParams.get("format")?.toLowerCase() ?? "json";
  if (format === "srt" || format === "vtt") {
    const body = format === "srt" ? toSrt(transcription.segments) : toVtt(transcription.segments);
    const fileName = subtitleFileName(transcription.originalName, format);
    return new Response(body, {
      headers: {
        "Cache-Control": "private, no-store",
        "Content-Disposition": `attachment; filename*=UTF-8''${encodeURIComponent(fileName)}`,
        "Content-Type": format === "srt" ? "application/x-subrip; charset=utf-8" : "text/vtt; charset=utf-8",
        "X-Content-Type-Options": "nosniff",
      },
    });
  }
  if (format !== "json") return Response.json({ error: "Formato no permitido" }, { status: 400 });
  return Response.json(transcription, {
    headers: { "Cache-Control": "private, no-store", "X-Content-Type-Options": "nosniff" },
  });
}
