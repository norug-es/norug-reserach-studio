import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import type { SessionUser } from "@/lib/types";
import { verifyPassword } from "@/lib/passwords";
import { findUserByEmail, resolveWorkspaceSession } from "@/lib/workspaces";
import { query } from "@/lib/db";
import { resolvePersistentSession, SESSION_MAX_AGE_SECONDS } from "@/lib/sessions";

export const SESSION_COOKIE = "norug_research_session";

export async function getSessionToken() {
  const store = await cookies();
  return store.get(SESSION_COOKIE)?.value;
}

export async function getSession() {
  return resolvePersistentSession(await getSessionToken());
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
  maxAge: SESSION_MAX_AGE_SECONDS,
};
