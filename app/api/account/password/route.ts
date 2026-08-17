import { cookies } from "next/headers";
import { apiUser, badRequest, serverError, unauthorized } from "@/lib/api";
import { SESSION_COOKIE } from "@/lib/auth";
import { changePassword } from "@/lib/identity";
import { consumeRateLimit, mutationOriginError, rateLimitKey, recordSecurityEvent } from "@/lib/security";

export async function POST(request: Request) {
  const originError = mutationOriginError(request);
  if (originError) return originError;
  const user = await apiUser();
  if (!user) return unauthorized();
  try {
    const rate = await consumeRateLimit({
      action: "account.password.change", keyHash: rateLimitKey(request, user.id),
      limit: 5, windowSeconds: 60 * 60, blockSeconds: 60 * 60,
    });
    if (!rate.allowed) {
      await recordSecurityEvent({ request, eventType: "account.password.change", outcome: "blocked", userId: user.id });
      return Response.json({ error: "Demasiados intentos. Inténtalo más tarde" }, {
        status: 429, headers: { "Retry-After": String(rate.retryAfterSeconds) },
      });
    }
    const body = await request.json() as { currentPassword?: string; newPassword?: string };
    if (!body.currentPassword || !body.newPassword) return badRequest("Completa ambas contraseñas");
    await changePassword(user.id, body.currentPassword, body.newPassword);
    const store = await cookies();
    store.delete(SESSION_COOKIE);
    await recordSecurityEvent({ request, eventType: "account.password.change", outcome: "success", userId: user.id });
    return Response.json({ ok: true });
  } catch (error) {
    await recordSecurityEvent({ request, eventType: "account.password.change", outcome: "failure", userId: user.id });
    return serverError(error, 400);
  }
}
