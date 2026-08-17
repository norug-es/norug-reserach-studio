import { createHash, randomUUID } from "node:crypto";
import type { PoolClient } from "pg";
import { query, tenantQuery, withTenantTransaction, withTransaction, type TenantContext } from "./db.ts";
import type { ProcessingJob, StoredObject } from "./types.ts";
import type { IngestionJobData } from "./queue.ts";

const objectColumns = `id, project_id AS "projectId", source_id AS "sourceId",
  original_name AS "originalName", content_type AS "contentType",
  size_bytes::integer AS "sizeBytes", sha256, status,
  created_at::text AS "createdAt"`;
const jobColumns = `id, project_id AS "projectId", object_id AS "objectId",
  job_type AS "jobType", status, progress, attempts, max_attempts AS "maxAttempts",
  error, created_at::text AS "createdAt", updated_at::text AS "updatedAt"`;

export type WorkerObject = {
  id: string; tenantId: string; projectId: string; sourceId: string | null;
  bucket: string; objectKey: string; originalName: string; contentType: string;
  sizeBytes: number; sha256: string;
};

export async function listStoredObjects(context: TenantContext, projectId: string): Promise<StoredObject[]> {
  const result = await tenantQuery<StoredObject>(context,
    `SELECT ${objectColumns} FROM stored_objects WHERE project_id = $1 ORDER BY created_at DESC`, [projectId]);
  return result.rows;
}

export async function listProcessingJobs(context: TenantContext, projectId: string): Promise<ProcessingJob[]> {
  const result = await tenantQuery<ProcessingJob>(context,
    `SELECT ${jobColumns} FROM processing_jobs WHERE project_id = $1 ORDER BY created_at DESC LIMIT 100`, [projectId]);
  return result.rows;
}

export async function findStoredObjectByHash(context: TenantContext, projectId: string, sha256: string) {
  const result = await tenantQuery<StoredObject>(context,
    `SELECT ${objectColumns} FROM stored_objects WHERE project_id = $1 AND sha256 = $2 LIMIT 1`,
    [projectId, sha256]);
  return result.rows[0] ?? null;
}

export async function createIngestionRecord(context: TenantContext, input: {
  objectId: string;
  objectKey: string;
  bucket: string;
  originalName: string;
  contentType: string;
  sizeBytes: number;
  sha256: string;
  category: "document" | "audio" | "video";
  projectId: string;
  userId: string;
  actor: string;
}) {
  const sourceId = randomUUID();
  const jobId = randomUUID();
  const idempotencyKey = createHash("sha256")
    .update(`${context.tenantId}:${input.projectId}:${input.sha256}:ingest`).digest("hex");
  const payload: IngestionJobData = {
    jobId, tenantId: context.tenantId, projectId: input.projectId,
    objectId: input.objectId, userId: input.userId, jobType: "ingest", dispatchVersion: 1,
  };
  return withTenantTransaction(context, async (client) => {
    const project = await client.query("SELECT id FROM projects WHERE id = $1", [input.projectId]);
    if (!project.rows[0]) throw new Error("Proyecto no encontrado");
    await client.query(`INSERT INTO sources
      (id, tenant_id, project_id, type, title, url, status, confidence)
      VALUES ($1, $2, $3, $4, $5, $6, 'queued', 50)`, [
      sourceId, context.tenantId, input.projectId,
      input.category === "document" ? "Documento" : input.category === "audio" ? "Audio" : "Vídeo",
      input.originalName, `object://${input.objectId}`,
    ]);
    const objectResult = await client.query<StoredObject>(`INSERT INTO stored_objects
      (id, tenant_id, project_id, source_id, bucket, object_key, original_name,
       content_type, size_bytes, sha256, status, created_by)
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, 'uploaded', $11)
      RETURNING ${objectColumns}`, [
      input.objectId, context.tenantId, input.projectId, sourceId, input.bucket, input.objectKey,
      input.originalName, input.contentType, input.sizeBytes, input.sha256, input.userId,
    ]);
    const jobResult = await client.query<ProcessingJob>(`INSERT INTO processing_jobs
      (id, tenant_id, project_id, object_id, job_type, idempotency_key, queue_job_id,
       status, max_attempts, created_by)
      VALUES ($1, $2, $3, $4, 'ingest', $5, $7, 'queued', 3, $6)
      RETURNING ${jobColumns}`, [jobId, context.tenantId, input.projectId, input.objectId,
      idempotencyKey, input.userId, `${jobId}-1`]);
    await client.query(`INSERT INTO job_dispatch_outbox (job_id, payload) VALUES ($1, $2::jsonb)`,
      [jobId, JSON.stringify(payload)]);
    await logActivity(client, context.tenantId, input.projectId, "object.uploaded",
      `${input.originalName} · ${input.sizeBytes} bytes · SHA-256 ${input.sha256.slice(0, 12)}…`, input.actor);
    return { object: objectResult.rows[0], job: jobResult.rows[0] };
  });
}

export async function getStoredObjectForDownload(context: TenantContext, objectId: string) {
  const result = await tenantQuery<{ bucket: string; objectKey: string; originalName: string }>(context,
    `SELECT bucket, object_key AS "objectKey", original_name AS "originalName"
     FROM stored_objects WHERE id = $1`, [objectId]);
  return result.rows[0] ?? null;
}

export async function getWorkerObject(data: IngestionJobData): Promise<WorkerObject | null> {
  const result = await tenantQuery<WorkerObject>({ tenantId: data.tenantId, userId: data.userId },
    `SELECT id, tenant_id AS "tenantId", project_id AS "projectId", source_id AS "sourceId",
      bucket, object_key AS "objectKey", original_name AS "originalName",
      content_type AS "contentType", size_bytes::integer AS "sizeBytes", sha256
     FROM stored_objects WHERE id = $1 AND project_id = $2`, [data.objectId, data.projectId]);
  return result.rows[0] ?? null;
}

export async function claimOutboxBatch(workerId: string, limit = 20) {
  return withTransaction(async (client) => {
    const result = await client.query<{ jobId: string; payload: IngestionJobData }>(`WITH candidates AS (
      SELECT job_id FROM job_dispatch_outbox
      WHERE next_attempt_at <= CURRENT_TIMESTAMP
        AND (locked_until IS NULL OR locked_until < CURRENT_TIMESTAMP)
      ORDER BY created_at FOR UPDATE SKIP LOCKED LIMIT $2
    )
    UPDATE job_dispatch_outbox outbox
    SET locked_until = CURRENT_TIMESTAMP + INTERVAL '30 seconds', locked_by = $1,
      updated_at = CURRENT_TIMESTAMP
    FROM candidates WHERE outbox.job_id = candidates.job_id
    RETURNING outbox.job_id AS "jobId", outbox.payload`, [workerId, limit]);
    return result.rows;
  });
}

export async function acknowledgeOutbox(jobId: string, workerId: string) {
  await query("DELETE FROM job_dispatch_outbox WHERE job_id = $1 AND locked_by = $2", [jobId, workerId]);
}

export async function rejectOutbox(jobId: string, workerId: string, error: unknown) {
  const message = error instanceof Error ? error.message : "Error de despacho";
  await query(`UPDATE job_dispatch_outbox SET attempts = attempts + 1,
    next_attempt_at = CURRENT_TIMESTAMP + LEAST(60, POWER(2, LEAST(attempts + 1, 6))) * INTERVAL '1 second',
    locked_until = NULL, locked_by = NULL, last_error = $3, updated_at = CURRENT_TIMESTAMP
    WHERE job_id = $1 AND locked_by = $2`, [jobId, workerId, message.slice(0, 2_000)]);
}

export async function markJobActive(data: IngestionJobData, attempt: number) {
  await withTenantTransaction({ tenantId: data.tenantId, userId: data.userId }, async (client) => {
    await client.query(`UPDATE processing_jobs SET status = 'active', progress = 10,
      attempts = $2, error = NULL, started_at = COALESCE(started_at, CURRENT_TIMESTAMP),
      updated_at = CURRENT_TIMESTAMP WHERE id = $1`, [data.jobId, attempt]);
    await client.query(`UPDATE stored_objects SET status = 'processing', updated_at = CURRENT_TIMESTAMP
      WHERE id = $1`, [data.objectId]);
  });
}

export async function markJobProgress(data: IngestionJobData, progress: number) {
  await tenantQuery({ tenantId: data.tenantId, userId: data.userId },
    `UPDATE processing_jobs SET progress = $2, updated_at = CURRENT_TIMESTAMP WHERE id = $1`,
    [data.jobId, Math.max(0, Math.min(99, Math.round(progress)))]);
}

export async function markJobCompleted(data: IngestionJobData, result: Record<string, unknown>) {
  await withTenantTransaction({ tenantId: data.tenantId, userId: data.userId }, async (client) => {
    const objectResult = await client.query<{ sourceId: string | null; originalName: string }>(
      `UPDATE stored_objects SET status = 'ready', metadata = metadata || $2::jsonb,
       updated_at = CURRENT_TIMESTAMP WHERE id = $1
       RETURNING source_id AS "sourceId", original_name AS "originalName"`,
      [data.objectId, JSON.stringify(result)]);
    const object = objectResult.rows[0];
    await client.query(`UPDATE processing_jobs SET status = 'completed', progress = 100,
      result = $2::jsonb, error = NULL, completed_at = CURRENT_TIMESTAMP,
      updated_at = CURRENT_TIMESTAMP WHERE id = $1`, [data.jobId, JSON.stringify(result)]);
    if (object?.sourceId) await client.query(
      "UPDATE sources SET status = 'processed' WHERE id = $1", [object.sourceId]);
    await logActivity(client, data.tenantId, data.projectId, "object.verified",
      `${object?.originalName ?? data.objectId} verificado y listo`, "Worker de ingesta");
  });
}

export async function markJobFailed(data: IngestionJobData, error: Error, attempts: number, final: boolean) {
  await withTenantTransaction({ tenantId: data.tenantId, userId: data.userId }, async (client) => {
    await client.query(`UPDATE processing_jobs SET status = $2, attempts = $3, error = $4,
      updated_at = CURRENT_TIMESTAMP, completed_at = CASE WHEN $5 THEN CURRENT_TIMESTAMP ELSE NULL END
      WHERE id = $1`, [data.jobId, final ? "dead_letter" : "retrying", attempts, error.message.slice(0, 2_000), final]);
    if (final) {
      await client.query("UPDATE stored_objects SET status = 'failed', updated_at = CURRENT_TIMESTAMP WHERE id = $1", [data.objectId]);
      await logActivity(client, data.tenantId, data.projectId, "object.failed",
        `${data.objectId}: ${error.message.slice(0, 300)}`, "Worker de ingesta");
    }
  });
}

export async function retryProcessingJob(context: TenantContext, jobId: string, userId: string) {
  return withTenantTransaction(context, async (client) => {
    const result = await client.query<IngestionJobData & { status: string }>(`SELECT id AS "jobId",
      tenant_id AS "tenantId", project_id AS "projectId", object_id AS "objectId",
      COALESCE(created_by, $2) AS "userId", job_type AS "jobType", status,
      dispatch_version AS "dispatchVersion"
      FROM processing_jobs WHERE id = $1 FOR UPDATE`, [jobId, userId]);
    const job = result.rows[0];
    if (!job || !["failed", "dead_letter"].includes(job.status)) return null;
    const dispatchVersion = job.dispatchVersion + 1;
    await client.query(`UPDATE processing_jobs SET status = 'queued', progress = 0, attempts = 0,
      dispatch_version = $2, queue_job_id = $3, error = NULL, started_at = NULL,
      completed_at = NULL, updated_at = CURRENT_TIMESTAMP WHERE id = $1`,
    [jobId, dispatchVersion, `${jobId}-${dispatchVersion}`]);
    await client.query("UPDATE stored_objects SET status = 'uploaded', updated_at = CURRENT_TIMESTAMP WHERE id = $1", [job.objectId]);
    const payload: IngestionJobData = {
      jobId: job.jobId, tenantId: job.tenantId, projectId: job.projectId,
      objectId: job.objectId, userId: job.userId, jobType: "ingest", dispatchVersion,
    };
    await client.query(`INSERT INTO job_dispatch_outbox (job_id, payload) VALUES ($1, $2::jsonb)
      ON CONFLICT (job_id) DO UPDATE SET payload = EXCLUDED.payload, attempts = 0,
      next_attempt_at = CURRENT_TIMESTAMP, locked_until = NULL, locked_by = NULL,
      last_error = NULL, updated_at = CURRENT_TIMESTAMP`, [jobId, JSON.stringify(payload)]);
    return payload;
  });
}

async function logActivity(client: PoolClient, tenantId: string, projectId: string,
  action: string, detail: string, actor: string) {
  await client.query(
    "INSERT INTO activity (id, tenant_id, project_id, action, detail, actor) VALUES ($1, $2, $3, $4, $5, $6)",
    [randomUUID(), tenantId, projectId, action, detail, actor],
  );
}
