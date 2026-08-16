import { apiUser, badRequest, serverError, unauthorized } from "@/lib/api";
import { createSource, getProject, listSources } from "@/lib/repository";

type Context = { params: Promise<{ id: string }> };

export async function GET(_request: Request, { params }: Context) {
  if (!await apiUser()) return unauthorized();
  const { id } = await params;
  if (!getProject(id)) return Response.json({ error: "No encontrado" }, { status: 404 });
  return Response.json({ sources: listSources(id) });
}

export async function POST(request: Request, { params }: Context) {
  const user = await apiUser();
  if (!user) return unauthorized();
  try {
    const { id } = await params;
    if (!getProject(id)) return Response.json({ error: "No encontrado" }, { status: 404 });
    const body = await request.json() as { type?: string; title?: string; url?: string };
    if (!body.type?.trim() || !body.title?.trim()) return badRequest("Tipo y título son obligatorios");
    return Response.json({ source: createSource(id, { type: body.type.trim(), title: body.title.trim(), url: body.url?.trim() }, user.email) }, { status: 201 });
  } catch (error) {
    return serverError(error);
  }
}
