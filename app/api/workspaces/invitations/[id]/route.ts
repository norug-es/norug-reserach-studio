import { apiUser, authorized, forbidden, unauthorized } from "@/lib/api";
import { revokeWorkspaceInvitation } from "@/lib/workspaces";
import { mutationOriginError, recordSecurityEvent } from "@/lib/security";

type Context = { params: Promise<{ id: string }> };

export async function DELETE(request: Request, { params }: Context) {
  const originError = mutationOriginError(request);
  if (originError) return originError;
  const user = await apiUser();
  if (!user) return unauthorized();
  if (!authorized(user, "workspace:manage")) return forbidden();
  const { id } = await params;
  const invitation = await revokeWorkspaceInvitation(user.id, user.workspaceId, id);
  if (invitation) await recordSecurityEvent({
    request, eventType: "workspace.invitation.revoked", outcome: "success",
    userId: user.id, workspaceId: user.workspaceId, metadata: { invitationId: id },
  });
  return invitation
    ? Response.json({ invitation })
    : Response.json({ error: "Invitación no encontrada o ya cerrada" }, { status: 404 });
}
