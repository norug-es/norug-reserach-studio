import { createHash, randomBytes, randomUUID } from "node:crypto";
import { query, withTransaction, withUserTransaction } from "@/lib/db";
import { hashPassword, passwordPolicyError, verifyPassword } from "@/lib/passwords";
import type { SessionUser, Workspace, WorkspaceInvitation, WorkspaceMember, WorkspaceRole } from "@/lib/types";

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
  return withTransaction(async (client) => {
    await client.query(`UPDATE workspace_invitations
      SET status = 'expired'
      WHERE workspace_id = $1 AND LOWER(email) = LOWER($2)
        AND status = 'pending' AND expires_at <= CURRENT_TIMESTAMP`,
      [input.workspaceId, input.email.trim()]);
    const result = await client.query<{ id: string; email: string; role: WorkspaceRole; expiresAt: string }>(
      `INSERT INTO workspace_invitations
        (id, workspace_id, email, role, token_hash, invited_by, expires_at)
        VALUES ($1, $2, LOWER($3), $4, $5, $6, CURRENT_TIMESTAMP + INTERVAL '7 days')
        RETURNING id, email, role, expires_at::text AS "expiresAt"`,
      [id, input.workspaceId, input.email.trim(), input.role, tokenHash, input.invitedBy],
    );
    return { ...result.rows[0], token };
  });
}

export async function listWorkspaceInvitations(
  requesterId: string,
  workspaceId: string,
): Promise<WorkspaceInvitation[]> {
  const result = await query<WorkspaceInvitation>(`SELECT i.id, i.email, i.role, i.status,
    i.expires_at::text AS "expiresAt", i.created_at::text AS "createdAt"
    FROM workspace_invitations i
    JOIN workspace_members requester ON requester.workspace_id = i.workspace_id
    WHERE requester.user_id = $1 AND i.workspace_id = $2
    ORDER BY i.created_at DESC`, [requesterId, workspaceId]);
  return result.rows;
}

export async function revokeWorkspaceInvitation(
  requesterId: string,
  workspaceId: string,
  invitationId: string,
) {
  const result = await query<{ id: string }>(`UPDATE workspace_invitations i
    SET status = 'revoked', revoked_at = CURRENT_TIMESTAMP
    FROM workspace_members requester
    WHERE requester.workspace_id = i.workspace_id
      AND requester.user_id = $1
      AND requester.role IN ('owner', 'admin')
      AND i.workspace_id = $2 AND i.id = $3 AND i.status = 'pending'
    RETURNING i.id`, [requesterId, workspaceId, invitationId]);
  return result.rows[0] ?? null;
}

export async function updateWorkspaceMemberRole(input: {
  requesterId: string;
  workspaceId: string;
  memberId: string;
  role: Exclude<WorkspaceRole, "owner">;
}) {
  const result = await query<{ userId: string; role: WorkspaceRole }>(`UPDATE workspace_members target
    SET role = $4
    FROM workspace_members requester
    WHERE requester.workspace_id = target.workspace_id
      AND requester.user_id = $1
      AND requester.role IN ('owner', 'admin')
      AND target.workspace_id = $2 AND target.user_id = $3
      AND target.role <> 'owner'
    RETURNING target.user_id AS "userId", target.role`,
    [input.requesterId, input.workspaceId, input.memberId, input.role]);
  return result.rows[0] ?? null;
}

export async function removeWorkspaceMember(input: {
  requesterId: string;
  workspaceId: string;
  memberId: string;
}) {
  const result = await query<{ userId: string }>(`DELETE FROM workspace_members target
    USING workspace_members requester
    WHERE requester.workspace_id = target.workspace_id
      AND requester.user_id = $1
      AND requester.role IN ('owner', 'admin')
      AND target.workspace_id = $2 AND target.user_id = $3
      AND target.role <> 'owner'
    RETURNING target.user_id AS "userId"`,
    [input.requesterId, input.workspaceId, input.memberId]);
  return result.rows[0] ?? null;
}

export async function acceptWorkspaceInvitation(input: {
  token: string;
  name?: string;
  password: string;
}) {
  const tokenHash = createHash("sha256").update(input.token).digest("hex");
  const policyError = passwordPolicyError(input.password);
  return withTransaction(async (client) => {
    const invitationResult = await client.query<{
      id: string; workspaceId: string; workspaceName: string; email: string; role: Exclude<WorkspaceRole, "owner">;
      status: string; expiresAt: string;
    }>(`SELECT i.id, i.workspace_id AS "workspaceId", w.name AS "workspaceName",
      i.email, i.role, i.status, i.expires_at::text AS "expiresAt"
      FROM workspace_invitations i JOIN workspaces w ON w.id = i.workspace_id
      WHERE i.token_hash = $1 FOR UPDATE`, [tokenHash]);
    const invitation = invitationResult.rows[0];
    if (!invitation || invitation.status !== "pending") throw new Error("Invitación inválida o ya utilizada");
    if (new Date(invitation.expiresAt).getTime() <= Date.now()) {
      await client.query("UPDATE workspace_invitations SET status = 'expired' WHERE id = $1", [invitation.id]);
      throw new Error("La invitación ha expirado");
    }

    const existing = await client.query<UserRecord>(`SELECT id, email, name,
      password_hash AS "passwordHash", status FROM users
      WHERE LOWER(email) = LOWER($1) FOR UPDATE`, [invitation.email]);
    let user = existing.rows[0];
    if (user) {
      if (user.status !== "active" || !verifyPassword(input.password, user.passwordHash)) {
        throw new Error("La contraseña no corresponde al usuario invitado");
      }
    } else {
      if (!input.name?.trim()) throw new Error("El nombre es obligatorio para crear el usuario");
      if (policyError) throw new Error(policyError);
      const userId = randomUUID();
      const created = await client.query<UserRecord>(`INSERT INTO users
        (id, email, name, password_hash, email_verified_at)
        VALUES ($1, LOWER($2), $3, $4, CURRENT_TIMESTAMP)
        RETURNING id, email, name, password_hash AS "passwordHash", status`,
        [userId, invitation.email, input.name.trim(), hashPassword(input.password)]);
      user = created.rows[0];
    }

    await client.query(`INSERT INTO workspace_members (workspace_id, user_id, role)
      VALUES ($1, $2, $3)
      ON CONFLICT (workspace_id, user_id) DO UPDATE SET role = EXCLUDED.role`,
      [invitation.workspaceId, user.id, invitation.role]);
    await client.query(`UPDATE workspace_invitations
      SET status = 'accepted', accepted_by = $2, accepted_at = CURRENT_TIMESTAMP
      WHERE id = $1`, [invitation.id, user.id]);
    return {
      id: user.id,
      email: user.email,
      name: user.name,
      workspaceId: invitation.workspaceId,
      workspaceName: invitation.workspaceName,
      role: invitation.role,
    } satisfies SessionUser;
  });
}
