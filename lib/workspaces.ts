import { createHash, randomBytes, randomUUID } from "node:crypto";
import { query, withUserTransaction } from "@/lib/db";
import type { SessionUser, Workspace, WorkspaceMember, WorkspaceRole } from "@/lib/types";

type UserRecord = {
  id: string;
  email: string;
  name: string;
  passwordHash: string;
  status: "active" | "disabled";
};

export async function findUserByEmail(email: string): Promise<UserRecord | null> {
  const result = await query<UserRecord>(`SELECT id, email, name,
    password_hash AS "passwordHash", status
    FROM users WHERE LOWER(email) = LOWER($1) LIMIT 1`, [email.trim()]);
  return result.rows[0] ?? null;
}

export async function listUserWorkspaces(userId: string): Promise<Workspace[]> {
  const result = await query<Workspace>(`SELECT w.id, w.name, w.slug, wm.role,
    w.created_at::text AS "createdAt"
    FROM workspace_members wm
    JOIN workspaces w ON w.id = wm.workspace_id
    WHERE wm.user_id = $1
    ORDER BY w.name`, [userId]);
  return result.rows;
}

export async function resolveWorkspaceSession(
  user: Pick<UserRecord, "id" | "email" | "name">,
  preferredWorkspaceId?: string,
): Promise<SessionUser | null> {
  const workspaces = await listUserWorkspaces(user.id);
  const workspace = workspaces.find((item) => item.id === preferredWorkspaceId) ?? workspaces[0];
  if (!workspace) return null;
  return {
    id: user.id,
    email: user.email,
    name: user.name,
    workspaceId: workspace.id,
    workspaceName: workspace.name,
    role: workspace.role,
  };
}

export async function switchWorkspace(userId: string, workspaceId: string) {
  const result = await query<{
    id: string; email: string; name: string; workspaceId: string; workspaceName: string; role: WorkspaceRole;
  }>(`SELECT u.id, u.email, u.name, w.id AS "workspaceId", w.name AS "workspaceName", wm.role
    FROM users u
    JOIN workspace_members wm ON wm.user_id = u.id
    JOIN workspaces w ON w.id = wm.workspace_id
    WHERE u.id = $1 AND w.id = $2 AND u.status = 'active'`, [userId, workspaceId]);
  return result.rows[0] ?? null;
}

export async function createWorkspace(userId: string, name: string): Promise<Workspace> {
  const id = randomUUID();
  const slugBase = name.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 42) || "workspace";
  const slug = `${slugBase}-${id.slice(0, 6)}`;
  return withUserTransaction(userId, async (client) => {
    const result = await client.query<Workspace>(`INSERT INTO workspaces
      (id, name, slug, created_by) VALUES ($1, $2, $3, $4)
      RETURNING id, name, slug, 'owner'::text AS role, created_at::text AS "createdAt"`,
      [id, name, slug, userId]);
    await client.query(`INSERT INTO workspace_members (workspace_id, user_id, role)
      VALUES ($1, $2, 'owner')`, [id, userId]);
    return result.rows[0];
  });
}

export async function listWorkspaceMembers(
  requesterId: string,
  workspaceId: string,
): Promise<WorkspaceMember[]> {
  const result = await query<WorkspaceMember>(`SELECT u.id AS "userId", u.email, u.name,
    target.role, target.created_at::text AS "createdAt"
    FROM workspace_members requester
    JOIN workspace_members target ON target.workspace_id = requester.workspace_id
    JOIN users u ON u.id = target.user_id
    WHERE requester.user_id = $1 AND requester.workspace_id = $2
    ORDER BY CASE target.role WHEN 'owner' THEN 0 WHEN 'admin' THEN 1 ELSE 2 END, u.name`,
    [requesterId, workspaceId]);
  return result.rows;
}

export async function createWorkspaceInvitation(input: {
  workspaceId: string;
  email: string;
  role: Exclude<WorkspaceRole, "owner">;
  invitedBy: string;
}) {
  const token = randomBytes(32).toString("base64url");
  const tokenHash = createHash("sha256").update(token).digest("hex");
  const id = randomUUID();
  const result = await query<{ id: string; email: string; role: WorkspaceRole; expiresAt: string }>(
    `INSERT INTO workspace_invitations
      (id, workspace_id, email, role, token_hash, invited_by, expires_at)
      VALUES ($1, $2, LOWER($3), $4, $5, $6, CURRENT_TIMESTAMP + INTERVAL '7 days')
      RETURNING id, email, role, expires_at::text AS "expiresAt"`,
    [id, input.workspaceId, input.email.trim(), input.role, tokenHash, input.invitedBy],
  );
  return { ...result.rows[0], token };
}
