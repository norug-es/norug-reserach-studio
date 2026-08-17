import { apiUser, authorized, badRequest, forbidden, serverError, tenantContext, unauthorized } from "@/lib/api";
import { createApproval, getProject, listApprovals } from "@/lib/repository";
import { mutationOriginError } from "@/lib/security";

type Context = { params: Promise<{ id: string }> };

export async function GET(_request: Request, { params }: Context) {
  const user = await apiUser();
  if (!user) return unauthorized();
  const context = tenantContext(user);
  const { id } = await params;
  if (!await getProject(context, id)) return Response.json({ error: "No encontrado" }, { status: 404 });
  return Response.json({ approvals: await listApprovals(context, id) });
}

export async function POST(request: Request, { params }: Context) {
  const originError = mutationOriginError(request);
  if (originError) return originError;
  const user = await apiUser();
  if (!user) return unauthorized();
  if (!authorized(user, "approval:create")) return forbidden();
  try {
    const context = tenantContext(user);
    const { id } = await params;
    if (!await getProject(context, id)) return Response.json({ error: "No encontrado" }, { status: 404 });
    const body = await request.json() as { stage?: string; status?: "approved" | "rejected"; note?: string };
    if (!body.stage?.trim() || !body.status || !["approved", "rejected"].includes(body.status)) return badRequest("Etapa y decisión válidas son obligatorias");
    return Response.json({ approval: await createApproval(context, id, { stage: body.stage.trim(), status: body.status, note: body.note }, user.email) }, { status: 201 });
  } catch (error) {
    return serverError(error);
  }
}
