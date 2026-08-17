import { apiUser, badRequest, serverError, unauthorized } from "@/lib/api";
import { createWorkspace, listUserWorkspaces } from "@/lib/workspaces";
import { mutationOriginError, recordSecurityEvent } from "@/lib/security";

export async function GET() {
  const user = await apiUser();
  if (!user) return unauthorized();
  return Response.json({ workspaces: await listUserWorkspaces(user.id) });
}

export async function POST(request: Request) {
  const originError = mutationOriginError(request);
  if (originError) return originError;
  const user = await apiUser();
  if (!user) return unauthorized();
  try {
    const body = await request.json() as { name?: string };
    if (!body.name?.trim()) return badRequest("El nombre del workspace es obligatorio");
    const workspace = await createWorkspace(user.id, body.name.trim());
    await recordSecurityEvent({ request, eventType: "workspace.created", outcome: "success", userId: user.id, workspaceId: workspace.id });
    return Response.json({ workspace }, { status: 201 });
  } catch (error) {
    return serverError(error);
  }
}
