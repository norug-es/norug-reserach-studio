import { apiUser, authorized, badRequest, forbidden, serverError, unauthorized } from "@/lib/api";
import { applicationUrl, deliverIdentityEvent } from "@/lib/identity";
import { createWorkspaceInvitation, listWorkspaceInvitations, listWorkspaceMembers } from "@/lib/workspaces";
import type { WorkspaceRole } from "@/lib/types";
import { mutationOriginError, recordSecurityEvent } from "@/lib/security";

export async function GET() {
  const user = await apiUser();
  if (!user) return unauthorized();
  if (!authorized(user, "workspace:manage")) return forbidden();
  const [members, invitations] = await Promise.all([
    listWorkspaceMembers(user.id, user.workspaceId),
    listWorkspaceInvitations(user.id, user.workspaceId),
  ]);
  return Response.json({ members, invitations });
}

export async function POST(request: Request) {
  const originError = mutationOriginError(request);
  if (originError) return originError;
  const user = await apiUser();
  if (!user) return unauthorized();
  if (!authorized(user, "workspace:manage")) return forbidden();
  try {
    const body = await request.json() as { email?: string; role?: Exclude<WorkspaceRole, "owner"> };
    const roles = ["admin", "editor", "reviewer", "viewer"];
    if (!body.email?.trim() || !body.role || !roles.includes(body.role)) {
      return badRequest("Email y rol válidos son obligatorios");
    }
    if (process.env.NODE_ENV === "production" && !process.env.IDENTITY_WEBHOOK_URL) {
      return serverError(new Error("La entrega de invitaciones no está configurada"), 503);
    }
    const invitation = await createWorkspaceInvitation({
      workspaceId: user.workspaceId,
      email: body.email,
      role: body.role,
      invitedBy: user.id,
    });
    const inviteUrl = new URL(`/invitations/accept?token=${encodeURIComponent(invitation.token)}`, applicationUrl(request.url)).toString();
    let delivered = false;
    try {
      delivered = await deliverIdentityEvent({
        type: "workspace.invitation.created",
        email: invitation.email,
        url: inviteUrl,
        workspace: user.workspaceName,
      });
    } catch (error) {
      console.error("No se pudo entregar la invitación", error);
    }
    await recordSecurityEvent({
      request, eventType: "workspace.invitation.created", outcome: delivered ? "success" : "failure",
      userId: user.id, workspaceId: user.workspaceId,
      metadata: { invitationId: invitation.id, role: invitation.role },
    });
    return Response.json({
      invitation: {
        ...invitation,
        inviteUrl: !delivered && process.env.NODE_ENV !== "production" ? inviteUrl : undefined,
        deliveryStatus: delivered ? "delivered" : process.env.NODE_ENV === "production" ? "failed" : "development_link",
        token: undefined,
      },
    }, { status: 201 });
  } catch (error) {
    return serverError(error);
  }
}
