import { cookies } from "next/headers";
import { createSessionToken, SESSION_COOKIE, sessionCookieOptions } from "@/lib/auth";
import { apiUser, badRequest, unauthorized } from "@/lib/api";
import { switchWorkspace } from "@/lib/workspaces";

export async function POST(request: Request) {
  const user = await apiUser();
  if (!user) return unauthorized();
  const body = await request.json() as { workspaceId?: string };
  if (!body.workspaceId) return badRequest("workspaceId es obligatorio");
  const nextSession = await switchWorkspace(user.id, body.workspaceId);
  if (!nextSession) return Response.json({ error: "Workspace no disponible" }, { status: 404 });
  const store = await cookies();
  store.set(SESSION_COOKIE, createSessionToken(nextSession), sessionCookieOptions);
  return Response.json({ user: nextSession });
}
