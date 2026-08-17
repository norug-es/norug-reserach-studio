import { apiUser, authorized, badRequest, forbidden, serverError, tenantContext, unauthorized } from "@/lib/api";
import { createProject, listProjects } from "@/lib/repository";

export async function GET() {
  const user = await apiUser();
  if (!user) return unauthorized();
  return Response.json({ projects: await listProjects(tenantContext(user)) });
}

export async function POST(request: Request) {
  const user = await apiUser();
  if (!user) return unauthorized();
  if (!authorized(user, "project:create")) return forbidden();
  try {
    const body = await request.json() as {
      name?: string; area?: string; language?: string; output?: string; humanApproval?: boolean;
    };
    if (!body.name?.trim() || !body.area?.trim()) return badRequest("Nombre y área son obligatorios");
    const project = await createProject(tenantContext(user), {
      name: body.name.trim(), area: body.area.trim(), language: body.language,
      output: body.output, humanApproval: body.humanApproval,
    }, user.email);
    return Response.json({ project }, { status: 201 });
  } catch (error) {
    return serverError(error);
  }
}
