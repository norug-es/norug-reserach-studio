import { badRequest, serverError } from "@/lib/api";
import { consumePasswordReset } from "@/lib/identity";

export async function POST(request: Request) {
  try {
    const body = await request.json() as { token?: string; password?: string };
    if (!body.token || !body.password) return badRequest("Token y nueva contraseña son obligatorios");
    await consumePasswordReset(body.token, body.password);
    return Response.json({ ok: true });
  } catch (error) {
    return serverError(error, 400);
  }
}
