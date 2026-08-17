"use client";

import { FormEvent, useState } from "react";

export function LoginForm() {
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setError("");
    try {
      const data = new FormData(event.currentTarget);
      const response = await fetch("/api/auth/login", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ email: data.get("email"), password: data.get("password") }),
      });

      let payload: { error?: string };
      try {
        payload = await response.json() as { error?: string };
      } catch {
        setError("El servidor devolvió una respuesta no válida. Inténtalo de nuevo más tarde.");
        return;
      }

      if (!response.ok) {
        setError(payload.error ?? "No fue posible iniciar sesión");
        return;
      }
      window.location.href = "/";
    } catch {
      setError("No se pudo conectar con el servidor. Comprueba tu conexión e inténtalo de nuevo.");
    } finally {
      setBusy(false);
    }
  }

  return <form className="login-card" onSubmit={submit}>
    <div className="brand login-brand"><strong>N<span>R</span></strong><b>Research Studio<small>by norug.es · v0.4</small></b></div>
    <em>ACCESO AL WORKSPACE</em>
    <h1>Investigación trazable, de la fuente a la publicación.</h1>
    <p>Sesión local protegida mediante cookie firmada. Cambia las credenciales del archivo <code>.env.local</code>.</p>
    <label>Email<input name="email" type="email" defaultValue="admin@norug.es" required autoComplete="username" /></label>
    <label>Contraseña<input name="password" type="password" defaultValue="norug-demo" required autoComplete="current-password" /></label>
    {error && <div className="form-error">{error}</div>}
    <button className="primary" disabled={busy}>{busy ? "Accediendo…" : "Entrar en Research Studio"}</button>
    <small>Credenciales de demostración. No utilizar en producción.</small>
  </form>;
}
