import { createHmac, randomUUID } from "node:crypto";
import { query, withTransaction } from "./db.ts";
import type { SecurityAuditEvent } from "./types.ts";

function securitySecret() {
  return process.env.AUTH_SECRET ?? "local-development-secret-change-before-production";
}

function privateHash(value: string) {
  return createHmac("sha256", securitySecret()).update(value).digest("hex");
}

export function clientAddress(request: Request) {
  return request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ||
    request.headers.get("x-real-ip")?.trim() || "unknown";
}

export function clientIpHash(request: Request) {
  return privateHash(clientAddress(request));
}

export function rateLimitKey(request: Request, subject = "anonymous") {
  return privateHash(`${clientAddress(request)}|${subject.trim().toLowerCase()}`);
}

export function mutationOriginError(request: Request) {
  if (["GET", "HEAD", "OPTIONS"].includes(request.method)) return null;
  const origin = request.headers.get("origin");
  if (!origin) {
    return process.env.NODE_ENV === "production"
      ? Response.json({ error: "Origin obligatorio" }, { status: 403 })
      : null;
  }
  const expected = new URL(process.env.APP_URL?.trim() || request.url).origin;
  try {
    if (new URL(origin).origin === expected) return null;
  } catch {
    // El origen no es una URL válida.
  }
  return Response.json({ error: "Origen no permitido" }, { status: 403 });
}

export async function consumeRateLimit(input: {
  action: string;
  keyHash: string;
  limit: number;
  windowSeconds: number;
  blockSeconds: number;
}) {
  return withTransaction(async (client) => {
    await client.query(`INSERT INTO security_rate_limits (action, key_hash)
      VALUES ($1, $2) ON CONFLICT (action, key_hash) DO NOTHING`, [input.action, input.keyHash]);
    const result = await client.query<{
      attempts: number; windowStartedAt: string; blockedUntil: string | null;
    }>(`SELECT attempts, window_started_at::text AS "windowStartedAt",
      blocked_until::text AS "blockedUntil"
      FROM security_rate_limits WHERE action = $1 AND key_hash = $2 FOR UPDATE`,
    [input.action, input.keyHash]);
    const row = result.rows[0];
    const now = Date.now();
    const activeBlock = row.blockedUntil ? new Date(row.blockedUntil).getTime() : 0;
    if (activeBlock > now) {
      return { allowed: false, retryAfterSeconds: Math.max(1, Math.ceil((activeBlock - now) / 1000)) };
    }
    const windowExpired = new Date(row.windowStartedAt).getTime() + input.windowSeconds * 1000 <= now;
    const attempts = windowExpired ? 1 : row.attempts + 1;
    const blockedUntil = attempts > input.limit
      ? new Date(now + input.blockSeconds * 1000)
      : null;
    await client.query(`UPDATE security_rate_limits SET attempts = $3,
      window_started_at = CASE WHEN $4 THEN CURRENT_TIMESTAMP ELSE window_started_at END,
      blocked_until = $5, updated_at = CURRENT_TIMESTAMP
      WHERE action = $1 AND key_hash = $2`,
    [input.action, input.keyHash, attempts, windowExpired, blockedUntil]);
    return {
      allowed: !blockedUntil,
      retryAfterSeconds: blockedUntil ? input.blockSeconds : 0,
    };
  });
}

export async function recordSecurityEvent(input: {
  request: Request;
  eventType: string;
  outcome: "success" | "failure" | "blocked";
  userId?: string | null;
  workspaceId?: string | null;
  metadata?: Record<string, string | number | boolean | null>;
}) {
  try {
    await query(`INSERT INTO security_audit_events
      (id, user_id, workspace_id, event_type, outcome, ip_hash, user_agent, metadata)
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8::jsonb)`, [
      randomUUID(), input.userId ?? null, input.workspaceId ?? null,
      input.eventType, input.outcome, clientIpHash(input.request),
      (input.request.headers.get("user-agent") ?? "").slice(0, 512),
      JSON.stringify(input.metadata ?? {}),
    ]);
  } catch (error) {
    console.error("No se pudo registrar el evento de seguridad", error);
  }
}

export async function listUserSecurityEvents(userId: string): Promise<SecurityAuditEvent[]> {
  const result = await query<SecurityAuditEvent>(`SELECT id, event_type AS "eventType", outcome,
    user_agent AS "userAgent", created_at::text AS "createdAt"
    FROM security_audit_events WHERE user_id = $1
    ORDER BY created_at DESC LIMIT 30`, [userId]);
  return result.rows;
}
