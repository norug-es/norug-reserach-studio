import { badRequest, serverError } from "@/lib/api";
import { applicationUrl, createPasswordReset, deliverIdentityEvent } from "@/lib/identity";
import { consumeRateLimit, mutationOriginError, rateLimitKey, recordSecurityEvent } from "@/lib/security";

export async function POST(request: Request) {
  try {
    const originError = mutationOriginError(request);
    if (originError) return originError;
    const body = await request.json() as { email?: string };
    if (!body.email?.trim()) return badRequest("El email es obligatorio");
    const rate = await consumeRateLimit({
      action: "auth.password.forgot", keyHash: rateLimitKey(request, body.email),
      limit: 3, windowSeconds: 15 * 60, blockSeconds: 30 * 60,
    });
    if (!rate.allowed) {
      await recordSecurityEvent({ request, eventType: "auth.password.forgot", outcome: "blocked" });
      return Response.json({ ok: true, message: "Si el usuario existe, recibirá instrucciones de recuperación" });
    }
    const reset = await createPasswordReset(body.email);
    let devResetUrl: string | undefined;
    if (reset) {
      const resetUrl = new URL(`/reset-password?token=${encodeURIComponent(reset.token)}`, applicationUrl(request.url)).toString();
      let delivered = false;
      try {
        delivered = await deliverIdentityEvent({
          type: "password.reset.requested", email: reset.email, url: resetUrl,
        });
      } catch (error) {
        console.error("No se pudo entregar el evento de recuperación", error);
      }
      if (!delivered && process.env.NODE_ENV !== "production") devResetUrl = resetUrl;
    }
    await recordSecurityEvent({ request, eventType: "auth.password.forgot", outcome: "success" });
    return Response.json({
      ok: true,
      message: "Si el usuario existe, recibirá instrucciones de recuperación",
      devResetUrl,
    });
  } catch (error) {
    return serverError(error);
  }
}
