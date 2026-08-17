import { getSessionToken } from "@/lib/auth";
import { apiUser, badRequest, unauthorized } from "@/lib/api";
import { switchPersistentSessionWorkspace } from "@/lib/sessions";
import { mutationOriginError, recordSecurityEvent } from "@/lib/security";

export async function POST(request: Request) {
  const originError = mutationOriginError(request);
  if (originError) return originError;
  const user = await apiUser();
  if (!user) return unauthorized();
  const body = await request.json() as { workspaceId?: string };
  if (!body.workspaceId) return badRequest("workspaceId es obligatorio");
  const token = await getSessionToken();
  if (!token) return unauthorized();
  const nextSession = await switchPersistentSessionWorkspace(token, user.id, body.workspaceId);
  if (!nextSession) return Response.json({ error: "Workspace no disponible" }, { status: 404 });
  await recordSecurityEvent({ request, eventType: "workspace.switched", outcome: "success", userId: user.id, workspaceId: nextSession.workspaceId });
  return Response.json({ user: nextSession });
}
