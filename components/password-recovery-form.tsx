"use client";

import { FormEvent, useState } from "react";

export function PasswordRecoveryForm({ mode, token = "" }: { mode: "forgot" | "reset"; token?: string }) {
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); setBusy(true); setError(""); setMessage("");
    const data = new FormData(event.currentTarget);
    try {
      const response = await fetch(mode === "forgot" ? "/api/auth/password/forgot" : "/api/auth/password/reset", {
        method: "POST", headers: { "content-type": "application/json" },
        body: JSON.stringify(mode === "forgot"
          ? { email: data.get("email") }
          : { token, password: data.get("password") }),
      });
      const payload = await response.json() as { error?: string; message?: string; devResetUrl?: string };
      if (!response.ok) throw new Error(payload.error ?? "No se pudo completar la operación");
      if (mode === "reset") {
        setMessage("Contraseña actualizada. Ya puedes iniciar sesión.");
      } else {
        setMessage(payload.devResetUrl
          ? `${payload.message}. Entorno local: ${payload.devResetUrl}`
          : payload.message ?? "Solicitud registrada");
      }
    } catch (error) { setError(error instanceof Error ? error.message : "Error inesperado"); }
    finally { setBusy(false); }
  }

  return <form className="login-card" onSubmit={submit}>
    <div className="brand login-brand"><strong>N<span>R</span></strong><b>Research Studio<small>Identity & Teams</small></b></div>
    <em>{mode === "forgot" ? "RECUPERAR ACCESO" : "NUEVA CONTRASEÑA"}</em>
    <h1>{mode === "forgot" ? "Recupera tu cuenta." : "Protege nuevamente tu cuenta."}</h1>
    {mode === "forgot"
      ? <label>Email<input name="email" type="email" required autoComplete="email"/></label>
      : <label>Nueva contraseña<input name="password" type="password" minLength={12} required autoComplete="new-password"/></label>}
    {error && <div className="form-error">{error}</div>}
    {message && <p className="team-message">{message}</p>}
    <button className="primary" disabled={busy || (mode === "reset" && !token)}>{busy ? "Procesando…" : "Continuar"}</button>
    <a href="/login">Volver al inicio de sesión</a>
  </form>;
}
