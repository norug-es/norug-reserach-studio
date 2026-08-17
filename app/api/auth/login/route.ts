import { cookies } from "next/headers";
import { createSessionToken, SESSION_COOKIE, sessionCookieOptions, validateCredentials } from "@/lib/auth";
import { badRequest, serverError } from "@/lib/api";

export async function POST(request: Request) {
  try {
    const body = await request.json() as { email?: string; password?: string };
    if (!body.email || !body.password) return badRequest("Email y contraseña son obligatorios");
    const user = await validateCredentials(body.email, body.password);
    if (!user) return Response.json({ error: "Credenciales incorrectas" }, { status: 401 });
    const store = await cookies();
    store.set(SESSION_COOKIE, createSessionToken(user), sessionCookieOptions);
    return Response.json({ user });
  } catch (error) {
    return serverError(error);
  }
}
