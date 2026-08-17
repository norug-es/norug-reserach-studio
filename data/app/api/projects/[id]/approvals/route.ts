import { apiUser, badRequest, serverError, unauthorized } from "@/lib/api";
import { createApproval, getProject, listApprovals } from "@/lib/repository";

type Context = { params: Promise<{ id: string }> };

export async function GET(_request: Request, { params }: Context) {
  if (!await apiUser()) return unauthorized();
  const { id } = await params;
  if (!await getProject(id)) return Response.json({ error: "No encontrado" }, { status: 404 });
  return Response.json({ approvals: await listApprovals(id) });
}

export async function POST(request: Request, { params }: Context) {
  const user = await apiUser();
  if (!user) return unauthorized();
  try {
    const { id } = await params;
    if (!await getProject(id)) return Response.json({ error: "No encontrado" }, { status: 404 });
    const body = await request.json() as { stage?: string; status?: "approved" | "rejected"; note?: string };
    if (!body.stage?.trim() || !body.status || !["approved", "rejected"].includes(body.status)) return badRequest("Etapa y decisión válidas son obligatorias");
    return Response.json({ approval: await createApproval(id, { stage: body.stage.trim(), status: body.status, note: body.note }, user.email) }, { status: 201 });
  } catch (error) {
    return serverError(error);
  }
}
