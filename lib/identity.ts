import { createHash, createHmac, randomBytes, randomUUID } from "node:crypto";
import { query, withTransaction } from "@/lib/db";
import { hashPassword, passwordPolicyError, verifyPassword } from "@/lib/passwords";
import { revokeAllUserSessions } from "@/lib/sessions";

export function applicationUrl(requestUrl: string) {
  const configured = process.env.APP_URL?.trim();
  return configured ? new URL(configured) : new URL(requestUrl).origin;
}

export async function createPasswordReset(email: string) {
  const user = await query<{ id: string; email: string }>(`SELECT id, email FROM users
    WHERE LOWER(email) = LOWER($1) AND status = 'active' LIMIT 1`, [email.trim()]);
  if (!user.rows[0]) return null;
  const token = randomBytes(32).toString("base64url");
  const tokenHash = createHash("sha256").update(token).digest("hex");
  await withTransaction(async (client) => {
    await client.query(`UPDATE password_reset_tokens SET used_at = CURRENT_TIMESTAMP
      WHERE user_id = $1 AND used_at IS NULL`, [user.rows[0].id]);
    await client.query(`INSERT INTO password_reset_tokens
      (id, user_id, token_hash, expires_at)
      VALUES ($1, $2, $3, CURRENT_TIMESTAMP + INTERVAL '30 minutes')`,
      [randomUUID(), user.rows[0].id, tokenHash]);
  });
  return { token, email: user.rows[0].email };
}

export async function consumePasswordReset(token: string, password: string) {
  const policyError = passwordPolicyError(password);
  if (policyError) throw new Error(policyError);
  const tokenHash = createHash("sha256").update(token).digest("hex");
  return withTransaction(async (client) => {
    const result = await client.query<{ id: string; userId: string; expiresAt: string; usedAt: string | null }>(
      `SELECT id, user_id AS "userId", expires_at::text AS "expiresAt", used_at::text AS "usedAt"
       FROM password_reset_tokens WHERE token_hash = $1 FOR UPDATE`, [tokenHash]);
    const reset = result.rows[0];
    if (!reset || reset.usedAt || new Date(reset.expiresAt).getTime() <= Date.now()) {
      throw new Error("El enlace de recuperación es inválido o ha expirado");
    }
    await client.query(`UPDATE users SET password_hash = $2, updated_at = CURRENT_TIMESTAMP
      WHERE id = $1 AND status = 'active'`, [reset.userId, hashPassword(password)]);
    await client.query(`UPDATE password_reset_tokens SET used_at = CURRENT_TIMESTAMP
      WHERE user_id = $1 AND used_at IS NULL`, [reset.userId]);
    await revokeAllUserSessions(client, reset.userId, "password_reset");
    return true;
  });
}

export async function changePassword(userId: string, currentPassword: string, newPassword: string) {
  const policyError = passwordPolicyError(newPassword);
  if (policyError) throw new Error(policyError);
  return withTransaction(async (client) => {
    const result = await client.query<{ passwordHash: string; status: string }>(
      `SELECT password_hash AS "passwordHash", status FROM users WHERE id = $1 FOR UPDATE`,
      [userId],
    );
    const user = result.rows[0];
    if (!user || user.status !== "active" || !verifyPassword(currentPassword, user.passwordHash)) {
      throw new Error("La contraseña actual no es correcta");
    }
    if (verifyPassword(newPassword, user.passwordHash)) {
      throw new Error("La nueva contraseña debe ser diferente");
    }
    await client.query(`UPDATE users SET password_hash = $2, updated_at = CURRENT_TIMESTAMP
      WHERE id = $1`, [userId, hashPassword(newPassword)]);
    await revokeAllUserSessions(client, userId, "password_change");
    return true;
  });
}

export async function deliverIdentityEvent(event: {
  type: "password.reset.requested" | "workspace.invitation.created";
  email: string;
  url: string;
  workspace?: string;
}) {
  const endpoint = process.env.IDENTITY_WEBHOOK_URL;
  if (!endpoint) return false;
  const body = JSON.stringify({ ...event, occurredAt: new Date().toISOString() });
  const secret = process.env.IDENTITY_WEBHOOK_SECRET ?? process.env.AUTH_SECRET;
  if (!secret) throw new Error("IDENTITY_WEBHOOK_SECRET o AUTH_SECRET es obligatorio");
  const signature = createHmac("sha256", secret).update(body).digest("hex");
  const response = await fetch(endpoint, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-norug-signature": `sha256=${signature}`,
    },
    body,
    signal: AbortSignal.timeout(8_000),
  });
  if (!response.ok) throw new Error(`El webhook de identidad respondió ${response.status}`);
  return true;
}
