import { apiUser, badRequest, serverError, unauthorized } from "@/lib/api";
import { createEvidence, getProject, listEvidence } from "@/lib/repository";
import type { EvidenceClassification } from "@/lib/types";

type Context = { params: Promise<{ id: string }> };

export async function GET(_request: Request, { params }: Context) {
  if (!await apiUser()) return unauthorized();
  const { id } = await params;
  if (!await getProject(id)) return Response.json({ error: "No encontrado" }, { status: 404 });
  return Response.json({ evidence: await listEvidence(id) });
}

export async function POST(request: Request, { params }: Context) {
  const user = await apiUser();
  if (!user) return unauthorized();
  try {
    const { id } = await params;
    if (!await getProject(id)) return Response.json({ error: "No encontrado" }, { status: 404 });
    const body = await request.json() as { sourceId?: string; claim?: string; confidence?: number; classification?: EvidenceClassification };
    if (!body.claim?.trim() || typeof body.confidence !== "number") return badRequest("Afirmación y confianza son obligatorias");
    const evidence = await createEvidence(id, { sourceId: body.sourceId, claim: body.claim.trim(), confidence: body.confidence, classification: body.classification }, user.email);
    return Response.json({ evidence }, { status: 201 });
  } catch (error) {
    return serverError(error);
  }
}
