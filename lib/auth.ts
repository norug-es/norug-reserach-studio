import { createHmac, timingSafeEqual } from "node:crypto";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import type { SessionUser } from "@/lib/types";
import { verifyPassword } from "@/lib/passwords";
import { findUserByEmail, resolveWorkspaceSession, switchWorkspace } from "@/lib/workspaces";
import { query } from "@/lib/db";

export const SESSION_COOKIE = "norug_research_session";
const MAX_AGE_SECONDS = 60 * 60 * 12;

function secret() {
  return process.env.AUTH_SECRET ?? "local-development-secret-change-before-production";
}

function sign(payload: string) {
  return createHmac("sha256", secret()).update(payload).digest("base64url");
}

export function createSessionToken(user: SessionUser) {
  const payload = Buffer.from(JSON.stringify({ ...user, exp: Date.now() + MAX_AGE_SECONDS * 1000 })).toString("base64url");
  return `${payload}.${sign(payload)}`;
}

export function verifySessionToken(token?: string): SessionUser | null {
  if (!token) return null;
  const [payload, signature] = token.split(".");
  if (!payload || !signature) return null;
  const expected = sign(payload);
  const left = Buffer.from(signature);
  const right = Buffer.from(expected);
  if (left.length !== right.length || !timingSafeEqual(left, right)) return null;
  try {
    const parsed = JSON.parse(Buffer.from(payload, "base64url").toString("utf8")) as SessionUser & { exp: number };
    if (!parsed.id || !parsed.email || !parsed.name || !parsed.workspaceId ||
      !parsed.workspaceName || !parsed.role || parsed.exp < Date.now()) return null;
    return {
      id: parsed.id,
      email: parsed.email,
      name: parsed.name,
      workspaceId: parsed.workspaceId,
      workspaceName: parsed.workspaceName,
      role: parsed.role,
    };
  } catch {
    return null;
  }
}

export async function getSession() {
  const store = await cookies();
  const session = verifySessionToken(store.get(SESSION_COOKIE)?.value);
  if (!session) return null;
  // La cookie prueba la autenticidad de la sesión, pero la membresía y el rol
  // se validan contra PostgreSQL en cada request para que una revocación sea inmediata.
  return switchWorkspace(session.id, session.workspaceId);
}

export async function requireSession() {
  const user = await getSession();
  if (!user) redirect("/login");
  return user;
}

export async function validateCredentials(email: string, password: string): Promise<SessionUser | null> {
  if (!email || typeof email !== "string" || !password || typeof password !== "string") return null;
  const user = await findUserByEmail(email);
  if (!user || user.status !== "active" || !verifyPassword(password, user.passwordHash)) return null;
  const session = await resolveWorkspaceSession(user);
  if (session) await query("UPDATE users SET last_login_at = CURRENT_TIMESTAMP WHERE id = $1", [user.id]);
  return session;
}

function secureCookieEnabled() {
  const configuredValue = process.env.AUTH_COOKIE_SECURE;
  if (configuredValue === undefined || configuredValue === "") return process.env.NODE_ENV === "production";
  if (configuredValue === "true") return true;
  if (configuredValue === "false") return false;
  throw new Error("AUTH_COOKIE_SECURE debe ser 'true' o 'false'");
}

export const sessionCookieOptions = {
  httpOnly: true,
  sameSite: "lax" as const,
  // Las cookies `secure` solo se envían mediante HTTPS. En producción es `true`
  // por defecto; use AUTH_COOKIE_SECURE=false únicamente para una instalación HTTP explícita.
  secure: secureCookieEnabled(),
  path: "/",
  maxAge: MAX_AGE_SECONDS,
};
