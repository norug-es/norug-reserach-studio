"use client";

import { FormEvent, useState } from "react";

export function InvitationAcceptForm({ token }: { token: string }) {
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); setBusy(true); setError("");
    const data = new FormData(event.currentTarget);
    try {
      const response = await fetch("/api/invitations/accept", {
        method: "POST", headers: { "content-type": "application/json" },
        body: JSON.stringify({ token, name: data.get("name"), password: data.get("password") }),
      });
      const payload = await response.json() as { error?: string };
      if (!response.ok) throw new Error(payload.error ?? "No se pudo aceptar la invitación");
      window.location.href = "/";
    } catch (error) { setError(error instanceof Error ? error.message : "Error inesperado"); }
    finally { setBusy(false); }
  }

  return <form className="login-card" onSubmit={submit}>
    <div className="brand login-brand"><strong>N<span>R</span></strong><b>Research Studio<small>Identity & Teams</small></b></div>
    <em>INVITACIÓN A WORKSPACE</em><h1>Únete al equipo de investigación.</h1>
    {!token && <div className="form-error">El enlace no contiene un token de invitación.</div>}
    <label>Nombre<input name="name" autoComplete="name" placeholder="Solo para nuevos usuarios"/></label>
    <label>Contraseña<input name="password" type="password" required autoComplete="current-password"/></label>
    <p>Si ya tienes cuenta, utiliza tu contraseña actual. Los nuevos usuarios deben usar al menos 12 caracteres, mayúsculas, minúsculas y números.</p>
    {error && <div className="form-error">{error}</div>}
    <button className="primary" disabled={busy || !token}>{busy ? "Validando…" : "Aceptar invitación"}</button>
  </form>;
}
