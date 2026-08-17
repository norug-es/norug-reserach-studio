import { cookies } from "next/headers";
import { SESSION_COOKIE, sessionCookieOptions, validateCredentials } from "@/lib/auth";
import { badRequest, serverError } from "@/lib/api";
import { createPersistentSession } from "@/lib/sessions";
import { consumeRateLimit, mutationOriginError, rateLimitKey, recordSecurityEvent } from "@/lib/security";

export async function POST(request: Request) {
  try {
    const originError = mutationOriginError(request);
    if (originError) return originError;
    const body = await request.json() as { email?: string; password?: string };
    if (!body.email || !body.password) return badRequest("Email y contraseña son obligatorios");
    const rate = await consumeRateLimit({
      action: "auth.login", keyHash: rateLimitKey(request, body.email),
      limit: 5, windowSeconds: 15 * 60, blockSeconds: 15 * 60,
    });
    if (!rate.allowed) {
      await recordSecurityEvent({ request, eventType: "auth.login", outcome: "blocked" });
      return Response.json({ error: "Demasiados intentos. Inténtalo más tarde" }, {
        status: 429, headers: { "Retry-After": String(rate.retryAfterSeconds) },
      });
    }
    const user = await validateCredentials(body.email, body.password);
    if (!user) {
      await recordSecurityEvent({ request, eventType: "auth.login", outcome: "failure" });
      return Response.json({ error: "Credenciales incorrectas" }, { status: 401 });
    }
    const token = await createPersistentSession(user, request);
    const store = await cookies();
    store.set(SESSION_COOKIE, token, sessionCookieOptions);
    await recordSecurityEvent({
      request, eventType: "auth.login", outcome: "success",
      userId: user.id, workspaceId: user.workspaceId,
    });
    return Response.json({ user });
  } catch (error) {
    return serverError(error);
  }
}
