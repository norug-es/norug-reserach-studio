import { createHash, randomUUID } from "node:crypto";
import type { PoolClient } from "pg";
import { query, tenantQuery, withTenantTransaction, withTransaction, type TenantContext } from "./db.ts";
import type { ExtractedContent } from "./extraction.ts";
import type { TranscriptionResult } from "./transcriber.ts";
import type { ExtractedDocumentSummary, ProcessingJob, SecurityScan, StoredObject, TranscriptionSummary } from "./types.ts";
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

export async function listSecurityScans(context: TenantContext, projectId: string): Promise<SecurityScan[]> {
  const result = await tenantQuery<SecurityScan>(context, `SELECT DISTINCT ON (object_id)
    id, object_id AS "objectId", status, engine, engine_version AS "engineVersion",
    threat_name AS "threatName", detected_mime AS "detectedMime",
    detected_extension AS "detectedExtension", scanned_at::text AS "scannedAt"
    FROM security_scans WHERE project_id = $1 ORDER BY object_id, scanned_at DESC`, [projectId]);
  return result.rows;
}

export async function listExtractedDocuments(context: TenantContext, projectId: string): Promise<ExtractedDocumentSummary[]> {
  const result = await tenantQuery<ExtractedDocumentSummary>(context, `SELECT d.id,
    d.object_id AS "objectId", d.extractor, d.detected_mime AS "detectedMime",
    d.text_sha256 AS "textSha256", d.character_count AS "characterCount",
    d.word_count AS "wordCount", d.page_count AS "pageCount",
    LEFT(d.text_content, 800) AS "textPreview", d.extracted_at::text AS "extractedAt",
    (SELECT COUNT(*)::integer FROM document_chunks c WHERE c.document_id = d.id) AS "chunkCount"
    FROM extracted_documents d WHERE d.project_id = $1 ORDER BY d.extracted_at DESC`, [projectId]);
  return result.rows;
}

export async function listTranscriptions(context: TenantContext, projectId: string): Promise<TranscriptionSummary[]> {
  const result = await tenantQuery<TranscriptionSummary>(context, `SELECT id,
    object_id AS "objectId", engine, model, device, compute_type AS "computeType",
    detected_language AS "detectedLanguage", language_probability AS "languageProbability",
    duration_seconds AS "durationSeconds", text_sha256 AS "textSha256",
    segment_count AS "segmentCount", word_count AS "wordCount",
    LEFT(text_content, 800) AS "textPreview", transcribed_at::text AS "transcribedAt"
    FROM transcriptions WHERE project_id = $1 ORDER BY transcribed_at DESC`, [projectId]);
  return result.rows;
}

export async function getTranscription(context: TenantContext, objectId: string) {
  return withTenantTransaction(context, async (client) => {
    const transcription = await client.query(`SELECT id, object_id AS "objectId", engine,
      model, device, compute_type AS "computeType", detected_language AS "detectedLanguage",
      language_probability AS "languageProbability", duration_seconds AS "durationSeconds",
      text_content AS text, text_sha256 AS "textSha256", segment_count AS "segmentCount",
      word_count AS "wordCount", metadata, transcribed_at::text AS "transcribedAt"
      FROM transcriptions WHERE object_id = $1`, [objectId]);
    if (!transcription.rows[0]) return null;
    const segments = await client.query(`SELECT segment_index AS "index",
      start_ms::integer AS "startMs", end_ms::integer AS "endMs", content AS text,
      content_sha256 AS "textSha256", avg_logprob AS "avgLogprob",
      no_speech_prob AS "noSpeechProb", words
      FROM transcription_segments WHERE transcription_id = $1 ORDER BY segment_index`,
    [transcription.rows[0].id]);
    return { ...transcription.rows[0], segments: segments.rows };
  });
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
    .update(`${context.tenantId}:${input.projectId}:${input.sha256}:scan`).digest("hex");
  const payload: IngestionJobData = {
    jobId, tenantId: context.tenantId, projectId: input.projectId,
    objectId: input.objectId, userId: input.userId, jobType: "scan", dispatchVersion: 1,
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
      VALUES ($1, $2, $3, $4, 'scan', $5, $7, 'queued', 3, $6)
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
     FROM stored_objects WHERE id = $1 AND status = 'ready'`, [objectId]);
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

export async function recordSecurityScan(data: IngestionJobData, input: {
  engine: "clamav" | "file-signature";
  status: "clean" | "infected" | "error";
  threatName: string | null;
  engineVersion: string | null;
  detectedMime: string | null;
  detectedExtension: string | null;
  result: Record<string, unknown>;
}) {
  await withTenantTransaction({ tenantId: data.tenantId, userId: data.userId }, (client) =>
    client.query(`INSERT INTO security_scans
      (id, tenant_id, project_id, object_id, job_id, engine, engine_version, status,
       threat_name, detected_mime, detected_extension, result)
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12::jsonb)`, [
      randomUUID(), data.tenantId, data.projectId, data.objectId, data.jobId,
      input.engine, input.engineVersion, input.status, input.threatName, input.detectedMime,
      input.detectedExtension, JSON.stringify(input.result),
    ]));
}

export async function markJobStageCompleted(data: IngestionJobData, result: Record<string, unknown>) {
  await tenantQuery({ tenantId: data.tenantId, userId: data.userId },
    `UPDATE processing_jobs SET status = 'completed', progress = 100, result = $2::jsonb,
     error = NULL, completed_at = CURRENT_TIMESTAMP, updated_at = CURRENT_TIMESTAMP WHERE id = $1`,
    [data.jobId, JSON.stringify(result)]);
}

export async function quarantineObject(data: IngestionJobData, result: Record<string, unknown>, threatName: string) {
  await withTenantTransaction({ tenantId: data.tenantId, userId: data.userId }, async (client) => {
    const objectResult = await client.query<{ sourceId: string | null; originalName: string }>(
      `UPDATE stored_objects SET status = 'quarantined', metadata = metadata || $2::jsonb,
       updated_at = CURRENT_TIMESTAMP WHERE id = $1
       RETURNING source_id AS "sourceId", original_name AS "originalName"`,
      [data.objectId, JSON.stringify(result)]);
    await client.query(`UPDATE processing_jobs SET status = 'completed', progress = 100,
      result = $2::jsonb, error = NULL, completed_at = CURRENT_TIMESTAMP,
      updated_at = CURRENT_TIMESTAMP WHERE id = $1`, [data.jobId, JSON.stringify(result)]);
    const object = objectResult.rows[0];
    if (object?.sourceId) await client.query("UPDATE sources SET status = 'quarantined' WHERE id = $1", [object.sourceId]);
    await logActivity(client, data.tenantId, data.projectId, "object.quarantined",
      `${object?.originalName ?? data.objectId}: ${threatName}`, "Worker de seguridad");
  });
}

async function enqueueStage(data: IngestionJobData, result: Record<string, unknown>, jobType: "extract" | "transcribe") {
  return withTenantTransaction({ tenantId: data.tenantId, userId: data.userId }, async (client) => {
    await client.query(`UPDATE processing_jobs SET status = 'completed', progress = 100,
      result = $2::jsonb, error = NULL, completed_at = CURRENT_TIMESTAMP,
      updated_at = CURRENT_TIMESTAMP WHERE id = $1`, [data.jobId, JSON.stringify(result)]);
    const idempotencyKey = createHash("sha256")
      .update(`${data.tenantId}:${data.projectId}:${data.objectId}:${jobType}`).digest("hex");
    const jobId = randomUUID();
    const inserted = await client.query<{ id: string }>(`INSERT INTO processing_jobs
      (id, tenant_id, project_id, object_id, job_type, idempotency_key, queue_job_id,
       status, max_attempts, created_by)
      VALUES ($1, $2, $3, $4, $5, $6, $7, 'queued', 3, $8)
      ON CONFLICT (idempotency_key) DO NOTHING RETURNING id`, [
      jobId, data.tenantId, data.projectId, data.objectId, jobType,
      idempotencyKey, `${jobId}-1`, data.userId,
    ]);
    if (!inserted.rows[0]) return null;
    const payload: IngestionJobData = {
      ...data, jobId, jobType, dispatchVersion: 1,
    };
    await client.query("INSERT INTO job_dispatch_outbox (job_id, payload) VALUES ($1, $2::jsonb)",
      [jobId, JSON.stringify(payload)]);
    return payload;
  });
}

export async function enqueueExtraction(data: IngestionJobData, result: Record<string, unknown>) {
  return enqueueStage(data, result, "extract");
}

export async function enqueueTranscription(data: IngestionJobData, result: Record<string, unknown>) {
  return enqueueStage(data, result, "transcribe");
}

export async function saveExtractedDocument(data: IngestionJobData, input: ExtractedContent & { detectedMime: string }) {
  return withTenantTransaction({ tenantId: data.tenantId, userId: data.userId }, async (client) => {
    const objectResult = await client.query<{ sourceId: string | null; originalName: string }>(
      `SELECT source_id AS "sourceId", original_name AS "originalName"
       FROM stored_objects WHERE id = $1 FOR UPDATE`, [data.objectId]);
    const object = objectResult.rows[0];
    if (!object) throw new Error("Objeto no encontrado durante la extracción");
    const documentId = randomUUID();
    const document = await client.query<{ id: string }>(`INSERT INTO extracted_documents
      (id, tenant_id, project_id, object_id, source_id, extractor, extractor_version,
       detected_mime, text_content, text_sha256, character_count, word_count, page_count, metadata)
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14::jsonb)
      ON CONFLICT (object_id) DO UPDATE SET extractor = EXCLUDED.extractor,
       extractor_version = EXCLUDED.extractor_version, detected_mime = EXCLUDED.detected_mime,
       text_content = EXCLUDED.text_content, text_sha256 = EXCLUDED.text_sha256,
       character_count = EXCLUDED.character_count, word_count = EXCLUDED.word_count,
       page_count = EXCLUDED.page_count, metadata = EXCLUDED.metadata,
       extracted_at = CURRENT_TIMESTAMP, updated_at = CURRENT_TIMESTAMP
      RETURNING id`, [documentId, data.tenantId, data.projectId, data.objectId, object.sourceId,
      input.extractor, input.extractorVersion, input.detectedMime, input.text, input.textSha256,
      input.characterCount, input.wordCount, input.pageCount, JSON.stringify({ warnings: input.warnings })]);
    const persistedDocumentId = document.rows[0].id;
    await client.query("DELETE FROM document_chunks WHERE document_id = $1", [persistedDocumentId]);
    for (const chunk of input.chunks) {
      await client.query(`INSERT INTO document_chunks
        (id, tenant_id, project_id, document_id, object_id, chunk_index, content,
         content_sha256, character_count, token_estimate)
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`, [randomUUID(), data.tenantId,
        data.projectId, persistedDocumentId, data.objectId, chunk.index, chunk.content,
        chunk.sha256, chunk.content.length, chunk.tokenEstimate]);
    }
    const result = { textSha256: input.textSha256, characterCount: input.characterCount,
      wordCount: input.wordCount, pageCount: input.pageCount, chunks: input.chunks.length,
      extractor: input.extractor, warnings: input.warnings };
    await client.query(`UPDATE stored_objects SET status = 'ready', metadata = metadata || $2::jsonb,
      updated_at = CURRENT_TIMESTAMP WHERE id = $1`, [data.objectId, JSON.stringify({ extraction: result })]);
    await client.query(`UPDATE processing_jobs SET status = 'completed', progress = 100,
      result = $2::jsonb, error = NULL, completed_at = CURRENT_TIMESTAMP,
      updated_at = CURRENT_TIMESTAMP WHERE id = $1`, [data.jobId, JSON.stringify(result)]);
    if (object.sourceId) await client.query("UPDATE sources SET status = 'processed' WHERE id = $1", [object.sourceId]);
    await logActivity(client, data.tenantId, data.projectId, "object.extracted",
      `${object.originalName}: ${input.characterCount} caracteres · ${input.chunks.length} fragmentos`,
      "Worker de extracción");
    return result;
  });
}

export async function saveTranscription(data: IngestionJobData, input: TranscriptionResult) {
  return withTenantTransaction({ tenantId: data.tenantId, userId: data.userId }, async (client) => {
    const objectResult = await client.query<{ sourceId: string | null; originalName: string }>(
      `SELECT source_id AS "sourceId", original_name AS "originalName"
       FROM stored_objects WHERE id = $1 FOR UPDATE`, [data.objectId]);
    const object = objectResult.rows[0];
    if (!object) throw new Error("Objeto no encontrado durante la transcripción");
    const text = input.text.normalize("NFC").replace(/\s+/gu, " ").trim();
    const textSha256 = createHash("sha256").update(text).digest("hex");
    const wordCount = text ? text.split(/\s+/u).length : 0;
    const transcriptionId = randomUUID();
    const transcription = await client.query<{ id: string }>(`INSERT INTO transcriptions
      (id, tenant_id, project_id, object_id, source_id, engine, model, device,
       compute_type, detected_language, language_probability, duration_seconds,
       text_content, text_sha256, segment_count, word_count, metadata)
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17::jsonb)
      ON CONFLICT (object_id) DO UPDATE SET engine = EXCLUDED.engine, model = EXCLUDED.model,
       device = EXCLUDED.device, compute_type = EXCLUDED.compute_type,
       detected_language = EXCLUDED.detected_language,
       language_probability = EXCLUDED.language_probability,
       duration_seconds = EXCLUDED.duration_seconds, text_content = EXCLUDED.text_content,
       text_sha256 = EXCLUDED.text_sha256, segment_count = EXCLUDED.segment_count,
       word_count = EXCLUDED.word_count, metadata = EXCLUDED.metadata,
       transcribed_at = CURRENT_TIMESTAMP, updated_at = CURRENT_TIMESTAMP
      RETURNING id`, [transcriptionId, data.tenantId, data.projectId, data.objectId,
      object.sourceId, input.engine, input.model, input.device, input.computeType,
      input.language, input.languageProbability, input.duration, text, textSha256,
      input.segments.length, wordCount, JSON.stringify({ durationAfterVad: input.durationAfterVad })]);
    const persistedId = transcription.rows[0].id;
    await client.query("DELETE FROM transcription_segments WHERE transcription_id = $1", [persistedId]);
    for (const segment of input.segments) {
      const content = segment.text.normalize("NFC").trim();
      await client.query(`INSERT INTO transcription_segments
        (id, tenant_id, project_id, transcription_id, object_id, segment_index,
         start_ms, end_ms, content, content_sha256, avg_logprob, no_speech_prob, words)
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13::jsonb)`, [
        randomUUID(), data.tenantId, data.projectId, persistedId, data.objectId,
        segment.index, Math.round(segment.start * 1_000), Math.round(segment.end * 1_000),
        content, createHash("sha256").update(content).digest("hex"), segment.avgLogprob,
        segment.noSpeechProb, JSON.stringify(segment.words),
      ]);
    }
    const result = { textSha256, wordCount, segments: input.segments.length,
      durationSeconds: input.duration, language: input.language, model: input.model,
      device: input.device, computeType: input.computeType };
    await client.query(`UPDATE stored_objects SET status = 'ready', metadata = metadata || $2::jsonb,
      updated_at = CURRENT_TIMESTAMP WHERE id = $1`, [data.objectId, JSON.stringify({ transcription: result })]);
    await client.query(`UPDATE processing_jobs SET status = 'completed', progress = 100,
      result = $2::jsonb, error = NULL, completed_at = CURRENT_TIMESTAMP,
      updated_at = CURRENT_TIMESTAMP WHERE id = $1`, [data.jobId, JSON.stringify(result)]);
    if (object.sourceId) await client.query("UPDATE sources SET status = 'processed' WHERE id = $1", [object.sourceId]);
    await logActivity(client, data.tenantId, data.projectId, "object.transcribed",
      `${object.originalName}: ${input.segments.length} segmentos · ${input.duration.toFixed(1)} segundos · ${input.language ?? "idioma automático"}`,
      "Worker de transcripción");
    return result;
  });
}

export async function reconcilePendingPipeline() {
  const workspaces = await query<{ id: string }>("SELECT id FROM workspaces ORDER BY id");
  const counts = { scan: 0, extract: 0, transcribe: 0 };
  for (const workspace of workspaces.rows) {
    const context = { tenantId: workspace.id, userId: "pipeline-reconciler" };
    const objects = await tenantQuery<{
      id: string; projectId: string; createdBy: string; contentType: string;
      hasCleanScan: boolean; hasDocument: boolean; hasTranscription: boolean;
      pendingScan: boolean; pendingExtract: boolean; pendingTranscription: boolean;
    }>(context, `SELECT o.id, o.project_id AS "projectId", o.created_by AS "createdBy",
      o.content_type AS "contentType",
      EXISTS (SELECT 1 FROM security_scans s WHERE s.object_id = o.id AND s.status = 'clean') AS "hasCleanScan",
      EXISTS (SELECT 1 FROM extracted_documents d WHERE d.object_id = o.id) AS "hasDocument",
      EXISTS (SELECT 1 FROM transcriptions t WHERE t.object_id = o.id) AS "hasTranscription",
      EXISTS (SELECT 1 FROM processing_jobs j WHERE j.object_id = o.id AND j.job_type = 'scan'
        AND j.status IN ('queued', 'active', 'retrying')) AS "pendingScan",
      EXISTS (SELECT 1 FROM processing_jobs j WHERE j.object_id = o.id AND j.job_type = 'extract'
        AND j.status IN ('queued', 'active', 'retrying')) AS "pendingExtract",
      EXISTS (SELECT 1 FROM processing_jobs j WHERE j.object_id = o.id AND j.job_type = 'transcribe'
        AND j.status IN ('queued', 'active', 'retrying')) AS "pendingTranscription"
      FROM stored_objects o WHERE o.status IN ('uploaded', 'ready') AND o.created_by IS NOT NULL`, []);
    for (const object of objects.rows) {
      let jobType: "scan" | "extract" | "transcribe" | null = null;
      if (!object.hasCleanScan && !object.pendingScan) jobType = "scan";
      else if (object.hasCleanScan && object.contentType.startsWith("audio/") &&
        !object.hasTranscription && !object.pendingTranscription) jobType = "transcribe";
      else if (object.hasCleanScan && object.contentType.startsWith("video/") &&
        !object.hasTranscription && !object.pendingTranscription) jobType = "transcribe";
      else if (object.hasCleanScan && !object.contentType.startsWith("audio/") &&
        !object.contentType.startsWith("video/") && !object.hasDocument && !object.pendingExtract) jobType = "extract";
      if (!jobType) continue;
      const jobId = randomUUID();
      const idempotencyKey = createHash("sha256")
        .update(`${workspace.id}:${object.id}:${jobType}:reconcile-v062`).digest("hex");
      const payload: IngestionJobData = { jobId, tenantId: workspace.id,
        projectId: object.projectId, objectId: object.id, userId: object.createdBy,
        jobType, dispatchVersion: 1 };
      const inserted = await withTenantTransaction({ tenantId: workspace.id, userId: object.createdBy }, async (client) => {
        const result = await client.query<{ id: string }>(`INSERT INTO processing_jobs
          (id, tenant_id, project_id, object_id, job_type, idempotency_key, queue_job_id,
           status, max_attempts, created_by)
          VALUES ($1, $2, $3, $4, $5, $6, $7, 'queued', 3, $8)
          ON CONFLICT (idempotency_key) DO NOTHING RETURNING id`, [jobId, workspace.id,
          object.projectId, object.id, jobType, idempotencyKey, `${jobId}-1`, object.createdBy]);
        if (!result.rows[0]) return false;
        await client.query("INSERT INTO job_dispatch_outbox (job_id, payload) VALUES ($1, $2::jsonb)",
          [jobId, JSON.stringify(payload)]);
        await client.query("UPDATE stored_objects SET status = 'uploaded', updated_at = CURRENT_TIMESTAMP WHERE id = $1", [object.id]);
        return true;
      });
      if (inserted) counts[jobType] += 1;
    }
  }
  return counts;
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
      objectId: job.objectId, userId: job.userId, jobType: job.jobType as IngestionJobData["jobType"], dispatchVersion,
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
