import { cookies } from "next/headers";
import { createSessionToken, SESSION_COOKIE, sessionCookieOptions } from "@/lib/auth";
import { badRequest, serverError } from "@/lib/api";
import { acceptWorkspaceInvitation } from "@/lib/workspaces";

export async function POST(request: Request) {
  try {
    const body = await request.json() as { token?: string; name?: string; password?: string };
    if (!body.token || !body.password) return badRequest("Token y contraseña son obligatorios");
    const user = await acceptWorkspaceInvitation({ token: body.token, name: body.name, password: body.password });
    const store = await cookies();
    store.set(SESSION_COOKIE, createSessionToken(user), sessionCookieOptions);
    return Response.json({ user });
  } catch (error) {
    return serverError(error, 400);
  }
}
