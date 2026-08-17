import { apiUser, authorized, forbidden, unauthorized } from "@/lib/api";
import { revokeWorkspaceInvitation } from "@/lib/workspaces";

type Context = { params: Promise<{ id: string }> };

export async function DELETE(_request: Request, { params }: Context) {
  const user = await apiUser();
  if (!user) return unauthorized();
  if (!authorized(user, "workspace:manage")) return forbidden();
  const { id } = await params;
  const invitation = await revokeWorkspaceInvitation(user.id, user.workspaceId, id);
  return invitation
    ? Response.json({ invitation })
    : Response.json({ error: "Invitación no encontrada o ya cerrada" }, { status: 404 });
}
