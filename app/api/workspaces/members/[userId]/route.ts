import { apiUser, authorized, badRequest, forbidden, serverError, unauthorized } from "@/lib/api";
import { removeWorkspaceMember, updateWorkspaceMemberRole } from "@/lib/workspaces";
import type { WorkspaceRole } from "@/lib/types";

type Context = { params: Promise<{ userId: string }> };

export async function PATCH(request: Request, { params }: Context) {
  const user = await apiUser();
  if (!user) return unauthorized();
  if (!authorized(user, "workspace:manage")) return forbidden();
  try {
    const { userId } = await params;
    const body = await request.json() as { role?: Exclude<WorkspaceRole, "owner"> };
    if (!body.role || !["admin", "editor", "reviewer", "viewer"].includes(body.role)) {
      return badRequest("Rol inválido");
    }
    const member = await updateWorkspaceMemberRole({
      requesterId: user.id, workspaceId: user.workspaceId, memberId: userId, role: body.role,
    });
    return member ? Response.json({ member }) : Response.json({ error: "Miembro no modificable" }, { status: 404 });
  } catch (error) {
    return serverError(error);
  }
}

export async function DELETE(_request: Request, { params }: Context) {
  const user = await apiUser();
  if (!user) return unauthorized();
  if (!authorized(user, "workspace:manage")) return forbidden();
  const { userId } = await params;
  const removed = await removeWorkspaceMember({
    requesterId: user.id, workspaceId: user.workspaceId, memberId: userId,
  });
  return removed ? Response.json({ removed }) : Response.json({ error: "Miembro no eliminable" }, { status: 404 });
}
