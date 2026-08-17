import { getSession } from "@/lib/auth";
import type { TenantContext } from "@/lib/db";
import { hasPermission, type Permission } from "@/lib/permissions";
import type { SessionUser } from "@/lib/types";

export async function apiUser() {
  return getSession();
}

export function unauthorized() {
  return Response.json({ error: "No autorizado" }, { status: 401 });
}

export function forbidden(message = "No tienes permisos para realizar esta operación") {
  return Response.json({ error: message }, { status: 403 });
}

export function authorized(user: SessionUser, permission: Permission) {
  return hasPermission(user, permission);
}

export function tenantContext(user: SessionUser): TenantContext {
  return { tenantId: user.workspaceId, userId: user.id };
}

export function badRequest(message: string) {
  return Response.json({ error: message }, { status: 400 });
}

export function serverError(error: unknown) {
  const message = error instanceof Error ? error.message : "Error interno";
  return Response.json({ error: message }, { status: 500 });
}
