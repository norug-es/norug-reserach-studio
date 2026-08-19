import { apiUser, tenantContext, unauthorized } from "@/lib/api";
import { getTranscription } from "@/lib/ingestion";

export const runtime = "nodejs";
type Context = { params: Promise<{ id: string }> };

export async function GET(_request: Request, { params }: Context) {
  const user = await apiUser();
  if (!user) return unauthorized();
  const { id } = await params;
  const transcription = await getTranscription(tenantContext(user), id);
  if (!transcription) return Response.json({ error: "Transcripción no encontrada" }, { status: 404 });
  return Response.json(transcription, {
    headers: { "Cache-Control": "private, no-store", "X-Content-Type-Options": "nosniff" },
  });
}
