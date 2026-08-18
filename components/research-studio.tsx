"use client";

import { FormEvent, useState } from "react";
import type { ExtractedDocumentSummary, ProcessingJob, ProjectSnapshot, ResearchProject, SecurityScan, SessionUser, StoredObject, Workspace } from "@/lib/types";

const phases = [
  ["01", "Descubrimiento", "Monitoriza, filtra y selecciona", 0, 14],
  ["02", "Evidencia", "Ingiere, transcribe y verifica", 15, 39],
  ["03", "Investigación", "Cruza, deduplica y redacta", 40, 64],
  ["04", "Producción", "Voz, visuales y montaje", 65, 89],
  ["05", "Publicación", "QA, SEO y exportación", 90, 100],
] as const;

type Props = {
  user: SessionUser;
  workspaces: Workspace[];
  projects: ResearchProject[];
  initialSnapshot: ProjectSnapshot | null;
};

export function ResearchStudio({ user, workspaces, projects: initialProjects, initialSnapshot }: Props) {
  const [tab, setTab] = useState("Pipeline");
  const [projects, setProjects] = useState(initialProjects);
  const [snapshot, setSnapshot] = useState(initialSnapshot);
  const [modal, setModal] = useState<"project" | "source" | "evidence" | "workspace" | "upload" | null>(null);
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);

  const flash = (text: string) => {
    setMessage(text);
    window.setTimeout(() => setMessage(""), 2400);
  };

  async function api<T>(url: string, options?: RequestInit): Promise<T> {
    const response = await fetch(url, options);
    const payload = await response.json() as T & { error?: string };
    if (!response.ok) throw new Error(payload.error ?? "La operación no se pudo completar");
    return payload;
  }

  async function refresh(projectId = snapshot?.project.id) {
    if (!projectId) return;
    const data = await api<ProjectSnapshot>(`/api/projects/${projectId}`);
    setSnapshot(data);
  }

  async function switchWorkspace(workspaceId: string) {
    setBusy(true);
    try {
      await api("/api/workspaces/switch", {
        method: "POST", headers: { "content-type": "application/json" },
        body: JSON.stringify({ workspaceId }),
      });
      window.location.href = "/";
    } catch (error) {
      flash(error instanceof Error ? error.message : "No se pudo cambiar el workspace");
      setBusy(false);
    }
  }

  async function createWorkspace(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    try {
      const data = new FormData(event.currentTarget);
      const payload = await api<{ workspace: Workspace }>("/api/workspaces", {
        method: "POST", headers: { "content-type": "application/json" },
        body: JSON.stringify({ name: data.get("name") }),
      });
      await switchWorkspace(payload.workspace.id);
    } catch (error) {
      flash(error instanceof Error ? error.message : "No se pudo crear el workspace");
      setBusy(false);
    }
  }

  async function createProject(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    try {
      const data = new FormData(event.currentTarget);
      const payload = await api<{ project: ResearchProject }>("/api/projects", {
        method: "POST", headers: { "content-type": "application/json" },
        body: JSON.stringify({
          name: data.get("name"), area: data.get("area"), language: data.get("language"),
          output: data.get("output"), humanApproval: data.get("humanApproval") === "on",
        }),
      });
      setProjects((current) => [payload.project, ...current]);
      setModal(null);
      window.location.href = `/?project=${payload.project.id}`;
    } catch (error) {
      flash(error instanceof Error ? error.message : "Error inesperado");
    } finally { setBusy(false); }
  }

  async function createSource(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!snapshot) return;
    setBusy(true);
    try {
      const data = new FormData(event.currentTarget);
      await api(`/api/projects/${snapshot.project.id}/sources`, {
        method: "POST", headers: { "content-type": "application/json" },
        body: JSON.stringify({ type: data.get("type"), title: data.get("title"), url: data.get("url") }),
      });
      await refresh(); setModal(null); setTab("Fuentes"); flash("Fuente añadida y puesta en cola");
    } catch (error) { flash(error instanceof Error ? error.message : "Error inesperado"); }
    finally { setBusy(false); }
  }

  async function createEvidence(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!snapshot) return;
    setBusy(true);
    try {
      const data = new FormData(event.currentTarget);
      await api(`/api/projects/${snapshot.project.id}/evidence`, {
        method: "POST", headers: { "content-type": "application/json" },
        body: JSON.stringify({ sourceId: data.get("sourceId") || undefined, claim: data.get("claim"), confidence: Number(data.get("confidence")) }),
      });
      await refresh(); setModal(null); setTab("Evidencias"); flash("Evidencia registrada con hash SHA-256");
    } catch (error) { flash(error instanceof Error ? error.message : "Error inesperado"); }
    finally { setBusy(false); }
  }

  async function uploadFile(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!snapshot) return;
    setBusy(true);
    try {
      const data = new FormData(event.currentTarget);
      const payload = await api<{ duplicate?: boolean }>(`/api/projects/${snapshot.project.id}/uploads`, {
        method: "POST", body: data,
      });
      await refresh(); setModal(null); setTab("Ingesta");
      flash(payload.duplicate ? "El archivo ya estaba registrado; no se duplicó" : "Archivo almacenado; worker de ingesta en cola");
    } catch (error) { flash(error instanceof Error ? error.message : "Error inesperado"); }
    finally { setBusy(false); }
  }

  async function retryJob(jobId: string) {
    setBusy(true);
    try {
      await api(`/api/jobs/${jobId}/retry`, { method: "POST" });
      await refresh(); flash("Trabajo reenviado al outbox");
    } catch (error) { flash(error instanceof Error ? error.message : "Error inesperado"); }
    finally { setBusy(false); }
  }

  async function togglePipeline() {
    if (!snapshot) return;
    const status = snapshot.project.status === "running" ? "paused" : "running";
    try {
      const payload = await api<{ project: ResearchProject }>(`/api/projects/${snapshot.project.id}`, {
        method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify({ status }),
      });
      setSnapshot({ ...snapshot, project: payload.project });
      flash(status === "paused" ? "Pipeline pausado de forma segura" : "Pipeline reanudado");
    } catch (error) { flash(error instanceof Error ? error.message : "Error inesperado"); }
  }

  async function approveStage(status: "approved" | "rejected") {
    if (!snapshot) return;
    try {
      await api(`/api/projects/${snapshot.project.id}/approvals`, {
        method: "POST", headers: { "content-type": "application/json" },
        body: JSON.stringify({ stage: "Revisión de evidencias", status, note: status === "approved" ? "Aprobado desde el centro de mando" : "Devuelto para corrección" }),
      });
      await refresh(); flash(status === "approved" ? "Punto de control aprobado" : "Revisión rechazada");
    } catch (error) { flash(error instanceof Error ? error.message : "Error inesperado"); }
  }

  async function logout() {
    await fetch("/api/auth/logout", { method: "POST" });
    window.location.href = "/login";
  }

  if (!snapshot) return <><main className="state-page"><strong>NR</strong><h1>No hay investigaciones en {user.workspaceName}</h1><p>Este workspace está aislado y listo para su primer proyecto.</p><button onClick={() => setModal("project")}>Crear la primera</button></main>{modal === "project" && <Modal onClose={() => setModal(null)}><form onSubmit={createProject}><em>NUEVA INVESTIGACIÓN</em><h2>Configura el primer proyecto</h2><label>Nombre<input name="name" defaultValue="Radar semanal" required/></label><label>Área de investigación<input name="area" placeholder="Tecnología, energía, salud…" required/></label><div><label>Idioma<select name="language"><option>Español</option><option>English</option></select></label><label>Salida<select name="output"><option>Informe técnico</option><option>Vídeo documental</option><option>Podcast</option></select></label></div><label className="check"><input name="humanApproval" type="checkbox" defaultChecked/> Exigir aprobación humana</label><button className="primary submit" disabled={busy}>Crear investigación</button></form></Modal>}{message && <div className="toast">{message}</div>}</>;
  const { project, sources, evidence, approvals, activity, objects, jobs, scans, documents } = snapshot;
  const verified = evidence.filter((item) => item.classification === "VERIFICADO").length;
  const averageConfidence = evidence.length ? Math.round(evidence.reduce((sum, item) => sum + item.confidence, 0) / evidence.length) : 0;
  const canEdit = ["owner", "admin", "editor"].includes(user.role);
  const canApprove = ["owner", "admin", "reviewer"].includes(user.role);

  return <div className="shell">
    <aside>
      <div className="brand"><strong>N<span>R</span></strong><b>Research Studio<small>by norug.es · v0.6.1</small></b></div>
      <label className="workspace-switch">Workspace<select value={user.workspaceId} disabled={busy} onChange={(event) => switchWorkspace(event.target.value)}>{workspaces.map((workspace) => <option value={workspace.id} key={workspace.id}>{workspace.name} · {workspace.role}</option>)}</select></label>
      <nav>{["⌂  Centro de mando", `◇  Investigaciones  · ${projects.length}`, "⌁  Fuentes", "▱  Biblioteca", "—  PRODUCCIÓN", "◎  Guiones", "▷  Media Studio", "↗  Publicaciones", "—  SISTEMA", "⬡  Proveedores IA", "⚙  Configuración"].map((item, index) => <button className={index === 0 ? "active" : ""} key={item}>{item}</button>)}</nav>
      {["owner", "admin"].includes(user.role) && <button className="team-link" onClick={() => { window.location.href = "/team"; }}>👥 Gestionar equipo</button>}
      <button className="team-link" onClick={() => { window.location.href = "/account"; }}>🔐 Seguridad de cuenta</button>
      <div className="plan"><em>MULTI-TENANT CORE</em><b>PostgreSQL RLS · {user.role}</b><i/><small>{user.workspaceName} · datos aislados</small><button onClick={() => setModal("workspace")}>＋ Workspace</button></div>
      <button className="user user-button" onClick={logout}><i>{user.name.split(" ").map((part) => part[0]).slice(0, 2).join("")}</i><b>{user.name}<small>{user.email} · {user.role} · Salir</small></b></button>
    </aside>
    <main>
      <header><label className="project-switch">Investigación <select value={project.id} onChange={(event) => { window.location.href = `/?project=${event.target.value}`; }}>{projects.map((item) => <option value={item.id} key={item.id}>{item.name}</option>)}</select></label><div>API v1　 <b>● PostgreSQL operativo</b></div></header>
      <section className="hero"><div><em>{project.status.toUpperCase()}　· {project.output.toUpperCase()}</em><h1>{project.name}</h1><p>Investigación multi-fuente · {project.area} · {project.language}</p></div><div>{canEdit && <button onClick={togglePipeline}>{project.status === "running" ? "Ⅱ Pausar" : "▷ Reanudar"}</button>}{canEdit && <button className="primary" onClick={() => setModal("project")}>＋ Nueva investigación</button>}</div></section>
      <section className="metrics">
        <article><small>PROGRESO GLOBAL</small><b>{project.progress}% <em>{project.status}</em></b><i><u style={{ width: `${project.progress}%` }}/></i></article>
        <article><small>FUENTES REGISTRADAS</small><b>{sources.length}</b><p>{sources.filter((item) => item.status === "processed").length} procesadas · {sources.filter((item) => item.status !== "processed").length} pendientes</p></article>
        <article><small>EVIDENCIAS VERIFICADAS</small><b>{verified} <span>/ {evidence.length}</span> <em>{averageConfidence}% confianza</em></b><p>{evidence.filter((item) => item.confidence < 50).length} afirmaciones requieren revisión</p></article>
        <article><small>APROBACIONES HUMANAS</small><b>{approvals.filter((item) => item.status === "approved").length} <span>/ {approvals.length}</span></b><p>{project.humanApproval ? "Control humano obligatorio" : "Control humano opcional"}</p></article>
      </section>
      <div className="tabs">{["Pipeline", "Ingesta", "Evidencias", "Fuentes", "Actividad"].map((item) => <button className={tab === item ? "active" : ""} onClick={() => setTab(item)} key={item}>{item}{item === "Ingesta" && `　${objects.length}`}{item === "Evidencias" && `　${evidence.length}`}</button>)}</div>
      {tab === "Pipeline" && <Pipeline project={project} approvals={approvals.length} canApprove={canApprove} onReview={() => setTab("Evidencias")} onApprove={approveStage}/>} 
      {tab === "Ingesta" && <IngestionPanel objects={objects} jobs={jobs} scans={scans} documents={documents} canEdit={canEdit} busy={busy} onUpload={() => setModal("upload")} onRetry={retryJob}/>} 
      {tab === "Evidencias" && <section className="panel evidence"><div className="title"><div><h2>Centro de evidencias</h2><p>Fuente, afirmación, hash SHA-256, custodia y confianza.</p></div><div>{canEdit && <button onClick={() => setModal("evidence")}>＋ Registrar</button>}<a className="link-button" href={`/api/export/evidence?projectId=${project.id}`}>Exportar manifiesto</a></div></div><div className="table"><div className="tr head"><span>Fuente</span><span>Afirmación</span><span>Confianza</span><span>Clasificación</span></div>{evidence.map((item) => <div className="tr" key={item.id}><b>{item.sourceTitle}<small>{item.sha256.slice(0, 18)}…</small></b><span>{item.claim}</span><b>{item.confidence}%</b><em className={item.confidence < 50 ? "bad" : item.confidence < 90 ? "prob" : ""}>{item.classification}</em></div>)}</div></section>}
      {tab === "Fuentes" && <section className="panel evidence"><div className="title"><div><h2>Fuentes de investigación</h2><p>Conectores preparados para vídeo, web, RSS, documentos y APIs.</p></div>{canEdit && <button onClick={() => setModal("source")}>＋ Añadir fuente</button>}</div><div className="source-list">{sources.map((source) => <article key={source.id}><i>{source.type.slice(0, 2).toUpperCase()}</i><div><h3>{source.title}</h3><p>{source.url || "Sin URL · fuente manual"}</p></div><em>{source.status}</em><b>{source.confidence}%</b></article>)}</div></section>}
      {tab === "Actividad" && <section className="panel evidence"><div className="title"><div><h2>Registro de auditoría</h2><p>Decisiones, cambios de estado, aprobaciones y altas.</p></div><span className="counter">{activity.length} eventos</span></div><div className="activity-list">{activity.map((item) => <article key={item.id}><i/><div><b>{item.action}</b><p>{item.detail}</p></div><small>{item.actor}<br/>{item.createdAt}</small></article>)}</div></section>}
    </main>
    {modal === "project" && <Modal onClose={() => setModal(null)}><form onSubmit={createProject}><em>NUEVA INVESTIGACIÓN</em><h2>Define el campo, no el proveedor</h2><p>El pipeline adapta fuentes, criterios y salida al área elegida.</p><label>Nombre<input name="name" defaultValue="Radar semanal" required/></label><label>Área de investigación<input name="area" defaultValue={project.area} required/></label><div><label>Idioma<select name="language"><option>Español</option><option>English</option></select></label><label>Salida<select name="output"><option>Informe técnico</option><option>Vídeo documental</option><option>Podcast</option></select></label></div><label className="check"><input name="humanApproval" type="checkbox" defaultChecked/> Exigir aprobación humana</label><button className="primary submit" disabled={busy}>Crear investigación</button></form></Modal>}
    {modal === "source" && <Modal onClose={() => setModal(null)}><form onSubmit={createSource}><em>NUEVA FUENTE</em><h2>Registra una fuente trazable</h2><label>Tipo<select name="type"><option>Web</option><option>YouTube</option><option>Twitch</option><option>RSS</option><option>Documento</option><option>API</option><option>Social</option></select></label><label>Título<input name="title" required/></label><label>URL<input name="url" type="url" placeholder="https://…"/></label><button className="primary submit" disabled={busy}>Añadir a la cola</button></form></Modal>}
    {modal === "upload" && <Modal onClose={() => setModal(null)}><form onSubmit={uploadFile}><em>INGESTA SEGURA</em><h2>Sube material de investigación</h2><p>El archivo se deduplica, verifica por firma binaria, analiza con ClamAV y solo después se extrae o queda listo.</p><label>Archivo<input name="file" type="file" accept=".pdf,.docx,.txt,.md,.csv,.mp3,.wav,.m4a,.mp4,.webm,.mov" required/></label><small className="upload-help">PDF, DOCX, TXT, MD y CSV generan texto y fragmentos. Audio y vídeo quedan preparados para Whisper. Los archivos infectados se bloquean en cuarentena.</small><button className="primary submit" disabled={busy}>{busy ? "Subiendo…" : "Escanear y procesar"}</button></form></Modal>}
    {modal === "evidence" && <Modal onClose={() => setModal(null)}><form onSubmit={createEvidence}><em>NUEVA EVIDENCIA</em><h2>Registra una afirmación verificable</h2><label>Fuente<select name="sourceId"><option value="">Fuente manual</option>{sources.map((source) => <option value={source.id} key={source.id}>{source.title}</option>)}</select></label><label>Afirmación<textarea name="claim" required rows={4}/></label><label>Confianza (0–100)<input name="confidence" type="number" min="0" max="100" defaultValue="75" required/></label><button className="primary submit" disabled={busy}>Capturar y generar hash</button></form></Modal>}
    {modal === "workspace" && <Modal onClose={() => setModal(null)}><form onSubmit={createWorkspace}><em>NUEVO WORKSPACE</em><h2>Crea un entorno de investigación aislado</h2><p>Los proyectos y evidencias quedarán protegidos mediante PostgreSQL RLS.</p><label>Nombre<input name="name" placeholder="Equipo de investigación" required/></label><button className="primary submit" disabled={busy}>Crear workspace</button></form></Modal>}
    {message && <div className="toast">✓ {message}</div>}
  </div>;
}

function IngestionPanel({ objects, jobs, scans, documents, canEdit, busy, onUpload, onRetry }: {
  objects: StoredObject[]; jobs: ProcessingJob[]; scans: SecurityScan[];
  documents: ExtractedDocumentSummary[]; canEdit: boolean; busy: boolean;
  onUpload: () => void; onRetry: (jobId: string) => void;
}) {
  const jobByObject = new Map<string, ProcessingJob>();
  for (const job of jobs) if (!jobByObject.has(job.objectId)) jobByObject.set(job.objectId, job);
  const scanByObject = new Map(scans.map((scan) => [scan.objectId, scan]));
  const documentByObject = new Map(documents.map((document) => [document.objectId, document]));
  return <section className="panel evidence ingestion-panel"><div className="title"><div><h2>Ingesta segura y extracción</h2><p>SHA-256 · firma binaria · ClamAV · cuarentena · texto normalizado y fragmentos trazables.</p></div>{canEdit && <button onClick={onUpload}>＋ Subir archivo</button>}</div>{objects.length === 0 ? <div className="ingestion-empty"><b>Sin objetos almacenados</b><p>Sube un documento, audio o vídeo para iniciar el pipeline.</p></div> : <div className="object-list">{objects.map((object) => { const job = jobByObject.get(object.id); const scan = scanByObject.get(object.id); const document = documentByObject.get(object.id); return <article key={object.id}><i>{object.contentType.startsWith("video/") ? "VID" : object.contentType.startsWith("audio/") ? "AUD" : "DOC"}</i><div><h3>{object.originalName}</h3><p>{formatBytes(object.sizeBytes)} · SHA-256 {object.sha256.slice(0, 16)}…</p>{scan && <p className={`scan-result ${scan.status}`}>ClamAV: {scan.status === "clean" ? "limpio" : scan.status === "infected" ? `amenaza ${scan.threatName ?? "detectada"}` : "error de análisis"} · {scan.detectedMime ?? "tipo sin determinar"}</p>}{document && <details className="extract-preview"><summary>{document.wordCount} palabras · {document.chunkCount} fragmentos · {document.pageCount ?? "—"} páginas</summary><p>{document.textPreview || "Sin texto; puede requerir OCR"}</p><small>Texto SHA-256 {document.textSha256.slice(0, 20)}… · {document.extractor}</small></details>}<u><b style={{ width: `${job?.progress ?? (["ready", "quarantined"].includes(object.status) ? 100 : 0)}%` }}/></u></div><div className="object-state"><em className={object.status}>{object.status}</em><small>{job ? `${job.jobType} · ${job.status} · intento ${job.attempts}/${job.maxAttempts}` : "sin trabajo"}</small></div>{object.status === "ready" && <a href={`/api/objects/${object.id}/download`}>Descargar</a>}{object.status === "quarantined" && <b className="quarantine-lock">Bloqueado</b>}{job && ["failed", "dead_letter"].includes(job.status) && canEdit && <button disabled={busy} onClick={() => onRetry(job.id)}>Reintentar</button>}</article>; })}</div>}</section>;
}

function formatBytes(bytes: number) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

function Pipeline({ project, approvals, canApprove, onReview, onApprove }: { project: ResearchProject; approvals: number; canApprove: boolean; onReview: () => void; onApprove: (status: "approved" | "rejected") => void }) {
  return <section className="grid"><div className="panel"><div className="title"><div><h2>Pipeline de investigación</h2><p>17 pasos auditables · controles humanos persistentes</p></div><span className="counter">{project.progress}%</span></div><div className="phases">{phases.map(([number, title, detail, start, end]) => { const done = project.progress > end; const running = project.progress >= start && project.progress <= end; const phaseProgress = done ? 100 : running ? Math.round(((project.progress - start) / Math.max(1, end - start)) * 100) : 0; return <article className={done ? "done" : running ? "run" : ""} key={number}><i>{done ? "✓" : number}</i><div><small>FASE {number}</small><h3>{title}</h3><p>{detail}</p></div><u><b style={{ width: `${phaseProgress}%` }}/></u><div><b>{done ? "100%" : running ? `${phaseProgress}%` : "En cola"}</b><small>{done ? "Completada" : running ? "En ejecución" : "Pendiente"}</small></div>{running && <button onClick={onReview}>Revisar</button>}</article>; })}</div></div><div className="side"><div className="panel live"><div className="title"><div><h2>Punto de control</h2><p>● Revisión humana activa</p></div></div><div className="approval-box"><b>Revisión de evidencias</b><p>Comprueba fuentes, afirmaciones y niveles de confianza antes de avanzar.</p>{canApprove && <div><button onClick={() => onApprove("rejected")}>Rechazar</button><button className="primary" onClick={() => onApprove("approved")}>Aprobar</button></div>}<small>{approvals} decisiones registradas</small></div></div><div className="panel quality"><h2>Controles de calidad</h2><p>Fuentes primarias <b>78%</b></p><i><u style={{ width: "78%" }}/></i><p>Cobertura de citas <b>92%</b></p><i><u style={{ width: "92%" }}/></i><p>Riesgo de redundancia <b>Bajo</b></p><button onClick={onReview}>Abrir centro de evidencias</button></div></div></section>;
}

function Modal({ children, onClose }: { children: React.ReactNode; onClose: () => void }) {
  return <div className="back" onMouseDown={onClose}><div className="modal-card" onMouseDown={(event) => event.stopPropagation()}><button type="button" className="close" onClick={onClose}>×</button>{children}</div></div>;
}
