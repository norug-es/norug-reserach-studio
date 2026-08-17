import { getSession } from "@/lib/auth";

export async function apiUser() {
  return getSession();
}

export function unauthorized() {
  return Response.json({ error: "No autorizado" }, { status: 401 });
}

export function badRequest(message: string) {
  return Response.json({ error: message }, { status: 400 });
}

export function serverError(error: unknown) {
  const message = error instanceof Error ? error.message : "Error interno";
  return Response.json({ error: message }, { status: 500 });
}
