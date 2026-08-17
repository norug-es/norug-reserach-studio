"use client";

import Link from "next/link";
import { FormEvent, useState } from "react";
import type { SecurityAuditEvent, SessionUser, UserSessionInfo } from "@/lib/types";

export function AccountSecurity({ user, initialSessions, events }: {
  user: SessionUser; initialSessions: UserSessionInfo[]; events: SecurityAuditEvent[];
}) {
  const [sessions, setSessions] = useState(initialSessions);
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);

  async function request(url: string, options: RequestInit) {
    const response = await fetch(url, options);
    const payload = await response.json() as { error?: string; revoked?: number | boolean };
    if (!response.ok) throw new Error(payload.error ?? "Operación rechazada");
    return payload;
  }

  async function changePassword(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); setBusy(true); setMessage("");
    try {
      const data = new FormData(event.currentTarget);
      await request("/api/account/password", {
        method: "POST", headers: { "content-type": "application/json" },
        body: JSON.stringify({ currentPassword: data.get("currentPassword"), newPassword: data.get("newPassword") }),
      });
      window.location.assign("/login?password=changed");
    } catch (error) { setMessage(error instanceof Error ? error.message : "Error inesperado"); setBusy(false); }
  }

  async function revoke(id: string, current: boolean) {
    if (current && !window.confirm("Esta acción cerrará la sesión actual. ¿Continuar?")) return;
    setBusy(true); setMessage("");
    try {
      await request(`/api/account/sessions/${id}`, { method: "DELETE" });
      if (current) { window.location.assign("/login"); return; }
      setSessions((items) => items.map((item) => item.id === id ? { ...item, revokedAt: new Date().toISOString() } : item));
      setMessage("Sesión revocada");
    } catch (error) { setMessage(error instanceof Error ? error.message : "Error inesperado"); }
    finally { setBusy(false); }
  }

  async function revokeOthers() {
    setBusy(true); setMessage("");
    try {
      const payload = await request("/api/account/sessions", { method: "DELETE" });
      setSessions((items) => items.map((item) => item.current || item.revokedAt ? item : { ...item, revokedAt: new Date().toISOString() }));
      setMessage(`${payload.revoked ?? 0} sesiones revocadas`);
    } catch (error) { setMessage(error instanceof Error ? error.message : "Error inesperado"); }
    finally { setBusy(false); }
  }

  return <main className="team-page security-page">
    <header><Link href="/">← Centro de mando</Link><b>{user.email} · seguridad</b></header>
    <section className="team-hero"><em>ACCOUNT SECURITY</em><h1>Sesiones y credenciales</h1><p>Controla el acceso a tu cuenta y consulta los eventos de seguridad recientes.</p></section>
    <section className="security-grid">
      <article className="panel team-panel"><div className="security-title"><h2>Sesiones</h2><button disabled={busy} onClick={revokeOthers}>Cerrar las demás</button></div>{sessions.map((session) => <div className="session-row" key={session.id}><div><b>{session.current ? "Esta sesión" : "Sesión de navegador"}</b><small>{session.userAgent || "Dispositivo no identificado"}<br/>Última actividad: {new Date(session.lastSeenAt).toLocaleString("es")}</small></div><em className={session.revokedAt ? "revoked" : ""}>{session.revokedAt ? "revocada" : "activa"}</em>{!session.revokedAt && <button disabled={busy} onClick={() => revoke(session.id, session.current)}>Cerrar</button>}</div>)}</article>
      <article className="panel team-panel"><h2>Cambiar contraseña</h2><form className="password-form" onSubmit={changePassword}><label>Contraseña actual<input name="currentPassword" type="password" autoComplete="current-password" required/></label><label>Nueva contraseña<input name="newPassword" type="password" autoComplete="new-password" minLength={12} required/></label><button className="primary" disabled={busy}>Cambiar y cerrar sesiones</button></form>{message && <p className="team-message">{message}</p>}</article>
      <article className="panel team-panel security-events"><h2>Actividad reciente</h2>{events.length === 0 && <p>Sin eventos registrados.</p>}{events.map((event) => <div className="event-row" key={event.id}><div><b>{event.eventType}</b><small>{event.userAgent || "Cliente no identificado"}</small></div><em className={event.outcome}>{event.outcome}</em><time>{new Date(event.createdAt).toLocaleString("es")}</time></div>)}</article>
    </section>
  </main>;
}
