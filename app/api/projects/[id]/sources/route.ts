import { apiUser, authorized, badRequest, forbidden, serverError, tenantContext, unauthorized } from "@/lib/api";
import { createSource, getProject, listSources } from "@/lib/repository";

type Context = { params: Promise<{ id: string }> };

export async function GET(_request: Request, { params }: Context) {
  const user = await apiUser();
  if (!user) return unauthorized();
  const context = tenantContext(user);
  const { id } = await params;
  if (!await getProject(context, id)) return Response.json({ error: "No encontrado" }, { status: 404 });
  return Response.json({ sources: await listSources(context, id) });
}

export async function POST(request: Request, { params }: Context) {
  const user = await apiUser();
  if (!user) return unauthorized();
  if (!authorized(user, "source:create")) return forbidden();
  try {
    const context = tenantContext(user);
    const { id } = await params;
    if (!await getProject(context, id)) return Response.json({ error: "No encontrado" }, { status: 404 });
    const body = await request.json() as { type?: string; title?: string; url?: string };
    if (!body.type?.trim() || !body.title?.trim()) return badRequest("Tipo y título son obligatorios");
    return Response.json({ source: await createSource(context, id, { type: body.type.trim(), title: body.title.trim(), url: body.url?.trim() }, user.email) }, { status: 201 });
  } catch (error) {
    return serverError(error);
  }
}
