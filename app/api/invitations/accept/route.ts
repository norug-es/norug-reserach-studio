import { cookies } from "next/headers";
import { SESSION_COOKIE, sessionCookieOptions } from "@/lib/auth";
import { badRequest, serverError } from "@/lib/api";
import { acceptWorkspaceInvitation } from "@/lib/workspaces";
import { createPersistentSession } from "@/lib/sessions";
import { consumeRateLimit, mutationOriginError, rateLimitKey, recordSecurityEvent } from "@/lib/security";

export async function POST(request: Request) {
  try {
    const originError = mutationOriginError(request);
    if (originError) return originError;
    const body = await request.json() as { token?: string; name?: string; password?: string };
    if (!body.token || !body.password) return badRequest("Token y contraseña son obligatorios");
    const rate = await consumeRateLimit({
      action: "invitation.accept", keyHash: rateLimitKey(request, body.token.slice(0, 12)),
      limit: 5, windowSeconds: 15 * 60, blockSeconds: 15 * 60,
    });
    if (!rate.allowed) {
      await recordSecurityEvent({ request, eventType: "workspace.invitation.accepted", outcome: "blocked" });
      return Response.json({ error: "Demasiados intentos" }, {
        status: 429, headers: { "Retry-After": String(rate.retryAfterSeconds) },
      });
    }
    const user = await acceptWorkspaceInvitation({ token: body.token, name: body.name, password: body.password });
    const sessionToken = await createPersistentSession(user, request);
    const store = await cookies();
    store.set(SESSION_COOKIE, sessionToken, sessionCookieOptions);
    await recordSecurityEvent({
      request, eventType: "workspace.invitation.accepted", outcome: "success",
      userId: user.id, workspaceId: user.workspaceId,
    });
    return Response.json({ user });
  } catch (error) {
    await recordSecurityEvent({ request, eventType: "workspace.invitation.accepted", outcome: "failure" });
    return serverError(error, 400);
  }
}
