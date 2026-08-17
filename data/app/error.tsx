"use client";

export default function ErrorPage({ reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return <main className="state-page"><strong>NR</strong><h1>No se pudo cargar Research Studio</h1><p>Comprueba la base de datos y vuelve a intentarlo.</p><button onClick={reset}>Reintentar</button></main>;
}
