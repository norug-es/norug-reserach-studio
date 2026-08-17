import { apiUser, badRequest, serverError, unauthorized } from "@/lib/api";
import { createWorkspace, listUserWorkspaces } from "@/lib/workspaces";

export async function GET() {
  const user = await apiUser();
  if (!user) return unauthorized();
  return Response.json({ workspaces: await listUserWorkspaces(user.id) });
}

export async function POST(request: Request) {
  const user = await apiUser();
  if (!user) return unauthorized();
  try {
    const body = await request.json() as { name?: string };
    if (!body.name?.trim()) return badRequest("El nombre del workspace es obligatorio");
    const workspace = await createWorkspace(user.id, body.name.trim());
    return Response.json({ workspace }, { status: 201 });
  } catch (error) {
    return serverError(error);
  }
}
