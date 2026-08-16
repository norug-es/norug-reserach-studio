import { createHash, randomUUID } from "node:crypto";
import { getDb } from "@/lib/db";
import type {
  Activity,
  Approval,
  Evidence,
  EvidenceClassification,
  ProjectSnapshot,
  ProjectStatus,
  ResearchProject,
  ResearchSource,
} from "@/lib/types";

type ProjectRow = Omit<ResearchProject, "humanApproval" | "createdAt" | "updatedAt"> & {
  human_approval: number;
  created_at: string;
  updated_at: string;
};

function projectFromRow(row: ProjectRow): ResearchProject {
  const { human_approval, created_at, updated_at, ...project } = row;
  return { ...project, humanApproval: Boolean(human_approval), createdAt: created_at, updatedAt: updated_at };
}

export function listProjects(): ResearchProject[] {
  const rows = getDb().prepare(`SELECT id, name, area, language, output, status, progress,
    human_approval, created_at, updated_at FROM projects ORDER BY updated_at DESC`).all() as unknown as ProjectRow[];
  return rows.map(projectFromRow);
}

export function getProject(id: string): ResearchProject | null {
  const row = getDb().prepare(`SELECT id, name, area, language, output, status, progress,
    human_approval, created_at, updated_at FROM projects WHERE id = ?`).get(id) as ProjectRow | undefined;
  return row ? projectFromRow(row) : null;
}

export function createProject(input: {
  name: string;
  area: string;
  language?: string;
  output?: string;
  humanApproval?: boolean;
}, actor: string): ResearchProject {
  const id = randomUUID();
  getDb().prepare(`INSERT INTO projects
    (id, name, area, language, output, status, progress, human_approval)
    VALUES (?, ?, ?, ?, ?, 'draft', 0, ?)`)
    .run(id, input.name, input.area, input.language ?? "Español", input.output ?? "Informe técnico", input.humanApproval === false ? 0 : 1);
  logActivity(id, "project.created", `Investigación creada para ${input.area}`, actor);
  return getProject(id)!;
}

export function updateProject(id: string, input: { status?: ProjectStatus; progress?: number }, actor: string) {
  const current = getProject(id);
  if (!current) return null;
  const status = input.status ?? current.status;
  const progress = Math.max(0, Math.min(100, Math.round(input.progress ?? current.progress)));
  getDb().prepare("UPDATE projects SET status = ?, progress = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?")
    .run(status, progress, id);
  logActivity(id, "pipeline.updated", `Estado ${status}; progreso ${progress}%`, actor);
  return getProject(id);
}

export function listSources(projectId: string): ResearchSource[] {
  return getDb().prepare(`SELECT id, project_id AS projectId, type, title, url, status, confidence,
    created_at AS createdAt FROM sources WHERE project_id = ? ORDER BY created_at DESC`).all(projectId) as unknown as ResearchSource[];
}

export function createSource(projectId: string, input: { type: string; title: string; url?: string }, actor: string) {
  const id = randomUUID();
  getDb().prepare(`INSERT INTO sources (id, project_id, type, title, url, status, confidence)
    VALUES (?, ?, ?, ?, ?, 'queued', 50)`).run(id, projectId, input.type, input.title, input.url ?? "");
  logActivity(projectId, "source.added", `${input.type}: ${input.title}`, actor);
  return getDb().prepare(`SELECT id, project_id AS projectId, type, title, url, status, confidence,
    created_at AS createdAt FROM sources WHERE id = ?`).get(id) as unknown as ResearchSource;
}

export function listEvidence(projectId: string): Evidence[] {
  return getDb().prepare(`SELECT e.id, e.project_id AS projectId, e.source_id AS sourceId,
    COALESCE(s.title, 'Fuente eliminada') AS sourceTitle, e.claim, e.classification,
    e.confidence, e.sha256, e.created_at AS createdAt
    FROM evidence e LEFT JOIN sources s ON s.id = e.source_id
    WHERE e.project_id = ? ORDER BY e.created_at DESC`).all(projectId) as unknown as Evidence[];
}

export function createEvidence(projectId: string, input: {
  sourceId?: string;
  claim: string;
  confidence: number;
  classification?: EvidenceClassification;
}, actor: string) {
  const id = randomUUID();
  const confidence = Math.max(0, Math.min(100, Math.round(input.confidence)));
  const classification = input.classification ?? classify(confidence);
  const sha256 = createHash("sha256")
    .update(JSON.stringify({ projectId, sourceId: input.sourceId ?? null, claim: input.claim, confidence }))
    .digest("hex");
  getDb().prepare(`INSERT INTO evidence
    (id, project_id, source_id, claim, classification, confidence, sha256)
    VALUES (?, ?, ?, ?, ?, ?, ?)`)
    .run(id, projectId, input.sourceId ?? null, input.claim, classification, confidence, sha256);
  logActivity(projectId, "evidence.created", `${classification}: ${input.claim}`, actor);
  return listEvidence(projectId).find((item) => item.id === id)!;
}

export function createApproval(projectId: string, input: {
  stage: string;
  status: "approved" | "rejected";
  note?: string;
}, reviewer: string): Approval {
  const id = randomUUID();
  getDb().prepare(`INSERT INTO approvals (id, project_id, stage, status, reviewer, note)
    VALUES (?, ?, ?, ?, ?, ?)`).run(id, projectId, input.stage, input.status, reviewer, input.note ?? "");
  logActivity(projectId, `approval.${input.status}`, `${input.stage}: ${input.note ?? "Sin observaciones"}`, reviewer);
  return getDb().prepare(`SELECT id, project_id AS projectId, stage, status, reviewer, note,
    created_at AS createdAt FROM approvals WHERE id = ?`).get(id) as unknown as Approval;
}

export function listApprovals(projectId: string): Approval[] {
  return getDb().prepare(`SELECT id, project_id AS projectId, stage, status, reviewer, note,
    created_at AS createdAt FROM approvals WHERE project_id = ? ORDER BY created_at DESC`).all(projectId) as unknown as Approval[];
}

export function listActivity(projectId: string): Activity[] {
  return getDb().prepare(`SELECT id, project_id AS projectId, action, detail, actor,
    created_at AS createdAt FROM activity WHERE project_id = ? ORDER BY created_at DESC LIMIT 100`).all(projectId) as unknown as Activity[];
}

function logActivity(projectId: string, action: string, detail: string, actor: string) {
  getDb().prepare(`INSERT INTO activity (id, project_id, action, detail, actor) VALUES (?, ?, ?, ?, ?)`)
    .run(randomUUID(), projectId, action, detail, actor);
}

export function getProjectSnapshot(id: string): ProjectSnapshot | null {
  const project = getProject(id);
  if (!project) return null;
  return {
    project,
    sources: listSources(id),
    evidence: listEvidence(id),
    approvals: listApprovals(id),
    activity: listActivity(id),
  };
}

export function evidenceManifest(projectId: string) {
  const snapshot = getProjectSnapshot(projectId);
  if (!snapshot) return null;
  const exportedAt = new Date().toISOString();
  const payload = { schema: "norug.evidence-manifest.v1", exportedAt, ...snapshot };
  const manifestHash = createHash("sha256").update(JSON.stringify(payload)).digest("hex");
  return { ...payload, manifestHash };
}

function classify(confidence: number): EvidenceClassification {
  if (confidence >= 90) return "VERIFICADO";
  if (confidence >= 65) return "PROBABLE";
  if (confidence >= 40) return "HIPOTÉTICO";
  return "NO DEMOSTRADO";
}
