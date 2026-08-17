import { apiUser, authorized, badRequest, forbidden, serverError, unauthorized } from "@/lib/api";
import { createWorkspaceInvitation, listWorkspaceMembers } from "@/lib/workspaces";
import type { WorkspaceRole } from "@/lib/types";

export async function GET() {
  const user = await apiUser();
  if (!user) return unauthorized();
  if (!authorized(user, "workspace:manage")) return forbidden();
  return Response.json({ members: await listWorkspaceMembers(user.id, user.workspaceId) });
}

export async function POST(request: Request) {
  const user = await apiUser();
  if (!user) return unauthorized();
  if (!authorized(user, "workspace:manage")) return forbidden();
  try {
    const body = await request.json() as { email?: string; role?: Exclude<WorkspaceRole, "owner"> };
    const roles = ["admin", "editor", "reviewer", "viewer"];
    if (!body.email?.trim() || !body.role || !roles.includes(body.role)) {
      return badRequest("Email y rol válidos son obligatorios");
    }
    const invitation = await createWorkspaceInvitation({
      workspaceId: user.workspaceId,
      email: body.email,
      role: body.role,
      invitedBy: user.id,
    });
    return Response.json({ invitation }, { status: 201 });
  } catch (error) {
    return serverError(error);
  }
}
