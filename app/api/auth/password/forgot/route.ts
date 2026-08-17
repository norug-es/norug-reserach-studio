import { badRequest, serverError } from "@/lib/api";
import { applicationUrl, createPasswordReset, deliverIdentityEvent } from "@/lib/identity";

export async function POST(request: Request) {
  try {
    const body = await request.json() as { email?: string };
    if (!body.email?.trim()) return badRequest("El email es obligatorio");
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
    return Response.json({
      ok: true,
      message: "Si el usuario existe, recibirá instrucciones de recuperación",
      devResetUrl,
    });
  } catch (error) {
    return serverError(error);
  }
}
