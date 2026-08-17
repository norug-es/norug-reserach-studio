"use client";

import { FormEvent, useState } from "react";
import Link from "next/link";
import type { SessionUser, WorkspaceInvitation, WorkspaceMember, WorkspaceRole } from "@/lib/types";

type Props = {
  user: SessionUser;
  initialMembers: WorkspaceMember[];
  initialInvitations: WorkspaceInvitation[];
};

export function TeamManager({ user, initialMembers, initialInvitations }: Props) {
  const [members, setMembers] = useState(initialMembers);
  const [invitations, setInvitations] = useState(initialInvitations);
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);

  async function api<T>(url: string, options?: RequestInit) {
    const response = await fetch(url, options);
    const payload = await response.json() as T & { error?: string };
    if (!response.ok) throw new Error(payload.error ?? "Operación rechazada");
    return payload;
  }

  async function refresh() {
    const payload = await api<{ members: WorkspaceMember[]; invitations: WorkspaceInvitation[] }>("/api/workspaces/members");
    setMembers(payload.members);
    setInvitations(payload.invitations);
  }

  async function invite(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); setBusy(true); setMessage("");
    try {
      const form = event.currentTarget;
      const data = new FormData(form);
      const payload = await api<{ invitation: WorkspaceInvitation & {
        inviteUrl?: string; deliveryStatus: "delivered" | "failed" | "development_link";
      } }>("/api/workspaces/members", {
        method: "POST", headers: { "content-type": "application/json" },
        body: JSON.stringify({ email: data.get("email"), role: data.get("role") }),
      });
      setMessage(payload.invitation.inviteUrl
        ? `Invitación creada. En desarrollo, copia este enlace: ${payload.invitation.inviteUrl}`
        : payload.invitation.deliveryStatus === "delivered"
          ? "Invitación enviada mediante el webhook de identidad"
          : "Invitación creada, pero el webhook no pudo entregarla. Revócala antes de reintentar.");
      form.reset();
      await refresh();
    } catch (error) { setMessage(error instanceof Error ? error.message : "Error inesperado"); }
    finally { setBusy(false); }
  }

  async function changeRole(userId: string, role: Exclude<WorkspaceRole, "owner">) {
    setBusy(true); setMessage("");
    try {
      await api(`/api/workspaces/members/${userId}`, {
        method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify({ role }),
      });
      await refresh();
      setMessage("Rol actualizado");
    } catch (error) { setMessage(error instanceof Error ? error.message : "Error inesperado"); }
    finally { setBusy(false); }
  }

  async function removeMember(userId: string) {
    if (!window.confirm("¿Eliminar este miembro del workspace?")) return;
    setBusy(true); setMessage("");
    try {
      await api(`/api/workspaces/members/${userId}`, { method: "DELETE" });
      await refresh();
      setMessage("Miembro eliminado");
    } catch (error) { setMessage(error instanceof Error ? error.message : "Error inesperado"); }
    finally { setBusy(false); }
  }

  async function revokeInvitation(id: string) {
    setBusy(true); setMessage("");
    try {
      await api(`/api/workspaces/invitations/${id}`, { method: "DELETE" });
      await refresh();
      setMessage("Invitación revocada");
    } catch (error) { setMessage(error instanceof Error ? error.message : "Error inesperado"); }
    finally { setBusy(false); }
  }

  return <main className="team-page">
    <header><Link href="/">← Centro de mando</Link><b>{user.workspaceName} · {user.role}</b></header>
    <section className="team-hero"><em>IDENTITY & TEAMS</em><h1>Miembros del workspace</h1><p>Roles aplicados en API y aislamiento PostgreSQL RLS.</p></section>
    <section className="team-grid">
      <article className="panel team-panel"><h2>Equipo activo</h2>{members.map((member) => <div className="team-row" key={member.userId}><div><b>{member.name}</b><small>{member.email}</small></div>{member.role === "owner" ? <em>owner</em> : <><select disabled={busy} value={member.role} onChange={(event) => changeRole(member.userId, event.target.value as Exclude<WorkspaceRole, "owner">)}><option>admin</option><option>editor</option><option>reviewer</option><option>viewer</option></select><button disabled={busy} onClick={() => removeMember(member.userId)}>Eliminar</button></>}</div>)}</article>
      <article className="panel team-panel"><h2>Invitar miembro</h2><form onSubmit={invite}><label>Email<input name="email" type="email" required/></label><label>Rol<select name="role"><option>editor</option><option>reviewer</option><option>viewer</option><option>admin</option></select></label><button className="primary" disabled={busy}>{busy ? "Procesando…" : "Crear invitación"}</button></form>{message && <p className="team-message">{message}</p>}<h2>Invitaciones</h2>{invitations.map((invitation) => <div className="team-row" key={invitation.id}><div><b>{invitation.email}</b><small>{invitation.role} · {invitation.status}</small></div>{invitation.status === "pending" && <button disabled={busy} onClick={() => revokeInvitation(invitation.id)}>Revocar</button>}</div>)}</article>
    </section>
  </main>;
}
