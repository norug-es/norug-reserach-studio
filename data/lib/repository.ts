import { createHash, randomUUID } from "node:crypto";
import type { PoolClient } from "pg";
import { query, withTransaction } from "@/lib/db";
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

const projectColumns = `id, name, area, language, output, status, progress,
  human_approval AS "humanApproval", created_at::text AS "createdAt",
  updated_at::text AS "updatedAt"`;

export async function listProjects(): Promise<ResearchProject[]> {
  const result = await query<ResearchProject>(
    `SELECT ${projectColumns} FROM projects ORDER BY updated_at DESC`,
  );
  return result.rows;
}

export async function getProject(id: string): Promise<ResearchProject | null> {
  const result = await query<ResearchProject>(
    `SELECT ${projectColumns} FROM projects WHERE id = $1`,
    [id],
  );
  return result.rows[0] ?? null;
}

export async function createProject(input: {
  name: string;
  area: string;
  language?: string;
  output?: string;
  humanApproval?: boolean;
}, actor: string): Promise<ResearchProject> {
  const id = randomUUID();
  const project = await withTransaction(async (client) => {
    const result = await client.query<ResearchProject>(`INSERT INTO projects
      (id, name, area, language, output, status, progress, human_approval)
      VALUES ($1, $2, $3, $4, $5, 'draft', 0, $6)
      RETURNING ${projectColumns}`,
      [id, input.name, input.area, input.language ?? "Español",
        input.output ?? "Informe técnico", input.humanApproval !== false],
    );
    await logActivity(client, id, "project.created", `Investigación creada para ${input.area}`, actor);
    return result.rows[0];
  });
  return project;
}

export async function updateProject(
  id: string,
  input: { status?: ProjectStatus; progress?: number },
  actor: string,
) {
  const current = await getProject(id);
  if (!current) return null;
  const status = input.status ?? current.status;
  const progress = Math.max(0, Math.min(100, Math.round(input.progress ?? current.progress)));
  return withTransaction(async (client) => {
    const result = await client.query<ResearchProject>(`UPDATE projects
      SET status = $1, progress = $2, updated_at = CURRENT_TIMESTAMP
      WHERE id = $3 RETURNING ${projectColumns}`,
      [status, progress, id],
    );
    await logActivity(client, id, "pipeline.updated", `Estado ${status}; progreso ${progress}%`, actor);
    return result.rows[0] ?? null;
  });
}

export async function listSources(projectId: string): Promise<ResearchSource[]> {
  const result = await query<ResearchSource>(`SELECT id, project_id AS "projectId", type,
    title, url, status, confidence, created_at::text AS "createdAt"
    FROM sources WHERE project_id = $1 ORDER BY created_at DESC`, [projectId]);
  return result.rows;
}

export async function createSource(
  projectId: string,
  input: { type: string; title: string; url?: string },
  actor: string,
) {
  const id = randomUUID();
  return withTransaction(async (client) => {
    const result = await client.query<ResearchSource>(`INSERT INTO sources
      (id, project_id, type, title, url, status, confidence)
      VALUES ($1, $2, $3, $4, $5, 'queued', 50)
      RETURNING id, project_id AS "projectId", type, title, url, status, confidence,
        created_at::text AS "createdAt"`,
      [id, projectId, input.type, input.title, input.url ?? ""],
    );
    await logActivity(client, projectId, "source.added", `${input.type}: ${input.title}`, actor);
    return result.rows[0];
  });
}

export async function listEvidence(projectId: string): Promise<Evidence[]> {
  const result = await query<Evidence>(`SELECT e.id, e.project_id AS "projectId",
    e.source_id AS "sourceId", COALESCE(s.title, 'Fuente eliminada') AS "sourceTitle",
    e.claim, e.classification, e.confidence, e.sha256, e.created_at::text AS "createdAt"
    FROM evidence e LEFT JOIN sources s ON s.id = e.source_id
    WHERE e.project_id = $1 ORDER BY e.created_at DESC`, [projectId]);
  return result.rows;
}

export async function createEvidence(projectId: string, input: {
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
  return withTransaction(async (client) => {
    await client.query(`INSERT INTO evidence
      (id, project_id, source_id, claim, classification, confidence, sha256)
      VALUES ($1, $2, $3, $4, $5, $6, $7)`,
      [id, projectId, input.sourceId ?? null, input.claim, classification, confidence, sha256],
    );
    await logActivity(client, projectId, "evidence.created", `${classification}: ${input.claim}`, actor);
    const result = await client.query<Evidence>(`SELECT e.id, e.project_id AS "projectId",
      e.source_id AS "sourceId", COALESCE(s.title, 'Fuente manual') AS "sourceTitle",
      e.claim, e.classification, e.confidence, e.sha256, e.created_at::text AS "createdAt"
      FROM evidence e LEFT JOIN sources s ON s.id = e.source_id WHERE e.id = $1`, [id]);
    return result.rows[0];
  });
}

export async function createApproval(projectId: string, input: {
  stage: string;
  status: "approved" | "rejected";
  note?: string;
}, reviewer: string): Promise<Approval> {
  const id = randomUUID();
  return withTransaction(async (client) => {
    const result = await client.query<Approval>(`INSERT INTO approvals
      (id, project_id, stage, status, reviewer, note)
      VALUES ($1, $2, $3, $4, $5, $6)
      RETURNING id, project_id AS "projectId", stage, status, reviewer, note,
        created_at::text AS "createdAt"`,
      [id, projectId, input.stage, input.status, reviewer, input.note ?? ""],
    );
    await logActivity(client, projectId, `approval.${input.status}`,
      `${input.stage}: ${input.note ?? "Sin observaciones"}`, reviewer);
    return result.rows[0];
  });
}

export async function listApprovals(projectId: string): Promise<Approval[]> {
  const result = await query<Approval>(`SELECT id, project_id AS "projectId", stage,
    status, reviewer, note, created_at::text AS "createdAt"
    FROM approvals WHERE project_id = $1 ORDER BY created_at DESC`, [projectId]);
  return result.rows;
}

export async function listActivity(projectId: string): Promise<Activity[]> {
  const result = await query<Activity>(`SELECT id, project_id AS "projectId", action,
    detail, actor, created_at::text AS "createdAt"
    FROM activity WHERE project_id = $1 ORDER BY created_at DESC LIMIT 100`, [projectId]);
  return result.rows;
}

async function logActivity(
  client: PoolClient,
  projectId: string,
  action: string,
  detail: string,
  actor: string,
) {
  await client.query(
    "INSERT INTO activity (id, project_id, action, detail, actor) VALUES ($1, $2, $3, $4, $5)",
    [randomUUID(), projectId, action, detail, actor],
  );
}

export async function getProjectSnapshot(id: string): Promise<ProjectSnapshot | null> {
  const project = await getProject(id);
  if (!project) return null;
  const [sources, evidence, approvals, activity] = await Promise.all([
    listSources(id), listEvidence(id), listApprovals(id), listActivity(id),
  ]);
  return { project, sources, evidence, approvals, activity };
}

export async function evidenceManifest(projectId: string) {
  const snapshot = await getProjectSnapshot(projectId);
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
