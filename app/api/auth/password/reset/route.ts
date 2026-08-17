import { badRequest, serverError } from "@/lib/api";
import { consumePasswordReset } from "@/lib/identity";
import { consumeRateLimit, mutationOriginError, rateLimitKey, recordSecurityEvent } from "@/lib/security";

export async function POST(request: Request) {
  try {
    const originError = mutationOriginError(request);
    if (originError) return originError;
    const body = await request.json() as { token?: string; password?: string };
    if (!body.token || !body.password) return badRequest("Token y nueva contraseña son obligatorios");
    const rate = await consumeRateLimit({
      action: "auth.password.reset", keyHash: rateLimitKey(request, body.token.slice(0, 12)),
      limit: 5, windowSeconds: 15 * 60, blockSeconds: 30 * 60,
    });
    if (!rate.allowed) {
      await recordSecurityEvent({ request, eventType: "auth.password.reset", outcome: "blocked" });
      return Response.json({ error: "Demasiados intentos. Inténtalo más tarde" }, {
        status: 429, headers: { "Retry-After": String(rate.retryAfterSeconds) },
      });
    }
    await consumePasswordReset(body.token, body.password);
    await recordSecurityEvent({ request, eventType: "auth.password.reset", outcome: "success" });
    return Response.json({ ok: true });
  } catch (error) {
    await recordSecurityEvent({ request, eventType: "auth.password.reset", outcome: "failure" });
    return serverError(error, 400);
  }
}
