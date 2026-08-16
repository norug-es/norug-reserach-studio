import { apiUser, unauthorized } from "@/lib/api";
import { evidenceManifest } from "@/lib/repository";

export async function GET(request: Request) {
  if (!await apiUser()) return unauthorized();
  const projectId = new URL(request.url).searchParams.get("projectId");
  if (!projectId) return Response.json({ error: "projectId es obligatorio" }, { status: 400 });
  const manifest = evidenceManifest(projectId);
  if (!manifest) return Response.json({ error: "No encontrado" }, { status: 404 });
  return new Response(JSON.stringify(manifest, null, 2), {
    headers: {
      "content-type": "application/json; charset=utf-8",
      "content-disposition": `attachment; filename="evidence-${projectId}.json"`,
    },
  });
}
