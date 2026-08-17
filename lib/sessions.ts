import { createHash, randomBytes, randomUUID } from "node:crypto";
import type { PoolClient } from "pg";
import { query } from "@/lib/db";
import { clientIpHash } from "@/lib/security";
import type { SessionUser, UserSessionInfo, WorkspaceRole } from "@/lib/types";

export const SESSION_MAX_AGE_SECONDS = 60 * 60 * 12;

function tokenHash(token: string) {
  return createHash("sha256").update(token).digest("hex");
}

export async function createPersistentSession(user: SessionUser, request: Request) {
  const token = randomBytes(32).toString("base64url");
  await query(`INSERT INTO user_sessions
    (id, user_id, token_hash, active_workspace_id, user_agent, ip_hash, expires_at)
    VALUES ($1, $2, $3, $4, $5, $6, CURRENT_TIMESTAMP + $7 * INTERVAL '1 second')`, [
    randomUUID(), user.id, tokenHash(token), user.workspaceId,
    (request.headers.get("user-agent") ?? "").slice(0, 512), clientIpHash(request),
    SESSION_MAX_AGE_SECONDS,
  ]);
  return token;
}

export async function resolvePersistentSession(token?: string): Promise<SessionUser | null> {
  if (!token) return null;
  const result = await query<SessionUser>(`SELECT u.id, u.email, u.name,
    w.id AS "workspaceId", w.name AS "workspaceName", membership.role
    FROM user_sessions session
    JOIN users u ON u.id = session.user_id AND u.status = 'active'
    JOIN workspaces w ON w.id = session.active_workspace_id
    JOIN workspace_members membership
      ON membership.workspace_id = w.id AND membership.user_id = u.id
    WHERE session.token_hash = $1 AND session.revoked_at IS NULL
      AND session.expires_at > CURRENT_TIMESTAMP LIMIT 1`, [tokenHash(token)]);
  const user = result.rows[0];
  if (!user) return null;
  await query(`UPDATE user_sessions SET last_seen_at = CURRENT_TIMESTAMP
    WHERE token_hash = $1 AND last_seen_at < CURRENT_TIMESTAMP - INTERVAL '5 minutes'`,
  [tokenHash(token)]);
  return user;
}

export async function revokeSessionToken(token: string | undefined, reason: string) {
  if (!token) return false;
  const result = await query(`UPDATE user_sessions
    SET revoked_at = COALESCE(revoked_at, CURRENT_TIMESTAMP), revoked_reason = $2
    WHERE token_hash = $1 AND revoked_at IS NULL`, [tokenHash(token), reason]);
  return (result.rowCount ?? 0) > 0;
}

export async function switchPersistentSessionWorkspace(
  token: string,
  userId: string,
  workspaceId: string,
) {
  const result = await query<{
    id: string; email: string; name: string; workspaceId: string; workspaceName: string; role: WorkspaceRole;
  }>(`UPDATE user_sessions session SET active_workspace_id = workspace.id,
      last_seen_at = CURRENT_TIMESTAMP
    FROM users user_account
    JOIN workspace_members membership ON membership.user_id = user_account.id
    JOIN workspaces workspace ON workspace.id = membership.workspace_id
    WHERE session.token_hash = $1 AND session.user_id = $2
      AND session.revoked_at IS NULL AND session.expires_at > CURRENT_TIMESTAMP
      AND user_account.id = $2 AND user_account.status = 'active' AND workspace.id = $3
    RETURNING user_account.id, user_account.email, user_account.name,
      workspace.id AS "workspaceId", workspace.name AS "workspaceName", membership.role`,
  [tokenHash(token), userId, workspaceId]);
  return result.rows[0] ?? null;
}

export async function listUserSessions(userId: string, currentToken?: string): Promise<UserSessionInfo[]> {
  const currentHash = currentToken ? tokenHash(currentToken) : "";
  const result = await query<UserSessionInfo>(`SELECT id, user_agent AS "userAgent",
    created_at::text AS "createdAt", last_seen_at::text AS "lastSeenAt",
    expires_at::text AS "expiresAt", revoked_at::text AS "revokedAt",
    token_hash = $2 AS "current"
    FROM user_sessions WHERE user_id = $1
    ORDER BY created_at DESC LIMIT 20`, [userId, currentHash]);
  return result.rows;
}

export async function revokeUserSession(userId: string, sessionId: string) {
  const result = await query(`UPDATE user_sessions SET revoked_at = CURRENT_TIMESTAMP,
    revoked_reason = 'user_revoked' WHERE id = $1 AND user_id = $2 AND revoked_at IS NULL`,
  [sessionId, userId]);
  return (result.rowCount ?? 0) > 0;
}

export async function revokeOtherUserSessions(userId: string, currentToken: string) {
  const result = await query(`UPDATE user_sessions SET revoked_at = CURRENT_TIMESTAMP,
    revoked_reason = 'user_revoked_others'
    WHERE user_id = $1 AND token_hash <> $2 AND revoked_at IS NULL`,
  [userId, tokenHash(currentToken)]);
  return result.rowCount ?? 0;
}

export async function revokeAllUserSessions(client: PoolClient, userId: string, reason: string) {
  await client.query(`UPDATE user_sessions SET revoked_at = CURRENT_TIMESTAMP,
    revoked_reason = $2 WHERE user_id = $1 AND revoked_at IS NULL`, [userId, reason]);
}
