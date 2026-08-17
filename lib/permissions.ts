import type { SessionUser, WorkspaceRole } from "@/lib/types";

export type Permission =
  | "project:create"
  | "project:update"
  | "source:create"
  | "evidence:create"
  | "approval:create"
  | "workspace:manage";

const grants: Record<WorkspaceRole, ReadonlySet<Permission>> = {
  owner: new Set([
    "project:create", "project:update", "source:create", "evidence:create",
    "approval:create", "workspace:manage",
  ]),
  admin: new Set([
    "project:create", "project:update", "source:create", "evidence:create",
    "approval:create", "workspace:manage",
  ]),
  editor: new Set([
    "project:create", "project:update", "source:create", "evidence:create",
  ]),
  reviewer: new Set(["approval:create"]),
  viewer: new Set(),
};

export function hasPermission(user: SessionUser, permission: Permission) {
  return grants[user.role].has(permission);
}
