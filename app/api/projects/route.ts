import { apiUser, badRequest, serverError, unauthorized } from "@/lib/api";
import { createProject, listProjects } from "@/lib/repository";

export async function GET() {
  if (!await apiUser()) return unauthorized();
  return Response.json({ projects: listProjects() });
}

export async function POST(request: Request) {
  const user = await apiUser();
  if (!user) return unauthorized();
  try {
    const body = await request.json() as {
      name?: string; area?: string; language?: string; output?: string; humanApproval?: boolean;
    };
    if (!body.name?.trim() || !body.area?.trim()) return badRequest("Nombre y área son obligatorios");
    const project = createProject({
      name: body.name.trim(), area: body.area.trim(), language: body.language,
      output: body.output, humanApproval: body.humanApproval,
    }, user.email);
    return Response.json({ project }, { status: 201 });
  } catch (error) {
    return serverError(error);
  }
}
