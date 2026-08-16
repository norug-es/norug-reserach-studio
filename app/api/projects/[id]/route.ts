import { apiUser, badRequest, serverError, unauthorized } from "@/lib/api";
import { getProjectSnapshot, updateProject } from "@/lib/repository";
import type { ProjectStatus } from "@/lib/types";

type Context = { params: Promise<{ id: string }> };

export async function GET(_request: Request, { params }: Context) {
  if (!await apiUser()) return unauthorized();
  const { id } = await params;
  const snapshot = getProjectSnapshot(id);
  return snapshot ? Response.json(snapshot) : Response.json({ error: "No encontrado" }, { status: 404 });
}

export async function PATCH(request: Request, { params }: Context) {
  const user = await apiUser();
  if (!user) return unauthorized();
  try {
    const { id } = await params;
    const body = await request.json() as { status?: ProjectStatus; progress?: number };
    const allowed = ["draft", "running", "paused", "review", "completed"];
    if (body.status && !allowed.includes(body.status)) return badRequest("Estado inválido");
    const project = updateProject(id, body, user.email);
    return project ? Response.json({ project }) : Response.json({ error: "No encontrado" }, { status: 404 });
  } catch (error) {
    return serverError(error);
  }
}
