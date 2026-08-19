import { createHash, randomUUID } from "node:crypto";
import { Worker } from "bullmq";
import {
  acknowledgeOutbox,
  applyDetectedMediaType,
  claimOutboxBatch,
  createIngestionRecord,
  enqueueExtraction,
  enqueueArchiveExpansion,
  enqueueTranscription,
  ensureEvidenceBundle,
  finalizeEvidenceBundle,
  findStoredObjectByHash,
  getWorkerObject,
  markJobActive,
  markJobCompleted,
  markJobFailed,
  markJobProgress,
  quarantineObject,
  recordSecurityScan,
  reconcilePendingPipeline,
  rejectOutbox,
  saveExtractedDocument,
  saveTranscription,
} from "../lib/ingestion.ts";
import { createIngestionQueue, createRedisConnection, INGESTION_QUEUE, type IngestionJobData } from "../lib/queue.ts";
import { deleteStoredObject, putStoredObject, readVerifiedStoredObject } from "../lib/storage.ts";
import { closeDb, ensureDatabase } from "../lib/db.ts";
import { clamavHealth, scanWithClamav } from "../lib/clamav.ts";
import { inspectFileSignature, isExtractableDocument } from "../lib/file-inspection.ts";
import { extractDocument } from "../lib/extraction.ts";
import { transcribeMedia, transcriberHealth, transcriptionJobProgress } from "../lib/transcriber.ts";
import { extractSecureZip } from "../lib/archive.ts";
import { assertEvidenceSigningReady, signEvidenceManifest } from "../lib/evidence-signing.ts";
import { validateUpload } from "../lib/upload-policy.ts";

const workerId = `worker-${randomUUID()}`;
const queueConnection = createRedisConnection();
const workerConnection = createRedisConnection();
const queue = createIngestionQueue(queueConnection);
let dispatching = false;

await ensureDatabase();

const worker = new Worker<IngestionJobData>(INGESTION_QUEUE, async (job) => {
  const data = job.data;
  await markJobActive(data, job.attemptsMade + 1);
  const object = await getWorkerObject(data);
  if (!object) throw new Error("El objeto de ingesta no existe o no pertenece al tenant");

  await job.updateProgress(20);
  await markJobProgress(data, 20);
  const verification = await readVerifiedStoredObject({
    bucket: object.bucket, key: object.objectKey, sha256: object.sha256, sizeBytes: object.sizeBytes,
  });

  if (data.jobType === "expand_archive") {
    assertEvidenceSigningReady();
    await job.updateProgress(30);
    await markJobProgress(data, 30, {
      stage: "reading_archive", processedSeconds: null, durationSeconds: null,
      elapsedSeconds: 0, etaSeconds: null, segmentIndex: null,
    });
    const bundleId = await ensureEvidenceBundle(data, verification.sha256);
    const entries = extractSecureZip(verification.bytes);
    const records: Array<{
      index: number; path: string; sizeBytes: number; sha256: string | null;
      objectId: string | null; status: "ingested" | "duplicate" | "rejected";
      rejectionReason: string | null;
    }> = [];
    const manifestEntries: Array<Record<string, unknown>> = [];
    for (let index = 0; index < entries.length; index += 1) {
      const entry = entries[index];
      const sha256 = createHash("sha256").update(entry.bytes).digest("hex");
      let objectId: string | null = null;
      let status: "ingested" | "duplicate" | "rejected" = "rejected";
      let rejectionReason: string | null = null;
      try {
        const policy = validateUpload(entry.originalName, "", entry.sizeBytes);
        if (policy.extension === ".zip") throw new Error("Los ZIP anidados no están permitidos");
        const duplicate = await findStoredObjectByHash(
          { tenantId: data.tenantId, userId: data.userId }, data.projectId, sha256);
        if (duplicate) {
          objectId = duplicate.id;
          status = "duplicate";
        } else {
          objectId = randomUUID();
          const key = `${data.tenantId}/${data.projectId}/${objectId}-${policy.originalName}`;
          let stored: { bucket: string; key: string } | undefined;
          try {
            const bucket = await putStoredObject({
              key, body: entry.bytes, contentType: policy.contentType, sha256,
              tenantId: data.tenantId, projectId: data.projectId,
            });
            stored = { bucket, key };
            await createIngestionRecord({ tenantId: data.tenantId, userId: data.userId }, {
              objectId, objectKey: key, bucket, originalName: policy.originalName,
              contentType: policy.contentType, sizeBytes: entry.sizeBytes, sha256,
              category: policy.category, projectId: data.projectId, userId: data.userId,
              actor: "Worker de paquetes", parentObjectId: data.objectId, bundleId,
              relativePath: entry.path, metadata: {
                bundleId, parentObjectId: data.objectId, archiveEntryPath: entry.path,
                archiveEntryCrc32: entry.crc32,
              },
            });
            status = "ingested";
          } catch (error) {
            if (stored) await deleteStoredObject(stored.bucket, stored.key).catch(() => undefined);
            throw error;
          }
        }
      } catch (error) {
        objectId = null;
        rejectionReason = error instanceof Error ? error.message : "Entrada no permitida";
      }
      records.push({ index, path: entry.path, sizeBytes: entry.sizeBytes, sha256,
        objectId, status, rejectionReason });
      manifestEntries.push({
        index, path: entry.path, sizeBytes: entry.sizeBytes, compressedSize: entry.compressedSize,
        sha256, crc32: entry.crc32, status, rejectionReason,
      });
      const progress = 35 + Math.round(((index + 1) / entries.length) * 45);
      await job.updateProgress(progress);
      await markJobProgress(data, progress, {
        stage: "extracting_archive", processedSeconds: index + 1,
        durationSeconds: entries.length, elapsedSeconds: 0, etaSeconds: null,
        segmentIndex: index,
      });
    }
    const manifest = {
      manifestVersion: "norug.evidence-bundle.v1",
      archive: {
        objectId: data.objectId, originalName: object.originalName,
        sizeBytes: verification.sizeBytes, sha256: verification.sha256,
      },
      policy: {
        encryptedEntries: "rejected", nestedArchives: "rejected",
        unsafePaths: "rejected", unsupportedFormats: "recorded-and-rejected",
      },
      entries: manifestEntries,
    };
    await job.updateProgress(90);
    await markJobProgress(data, 90, {
      stage: "signing_manifest", processedSeconds: entries.length,
      durationSeconds: entries.length, elapsedSeconds: 0, etaSeconds: null,
      segmentIndex: entries.length - 1,
    });
    const signature = signEvidenceManifest(manifest);
    await finalizeEvidenceBundle(data, {
      bundleId, manifest, manifestSha256: signature.manifestSha256,
      signatureBase64: signature.signatureBase64, publicKeyPem: signature.publicKeyPem,
      keyId: signature.keyId, entries: records,
    });
    const result = {
      bundleId, archiveSha256: verification.sha256,
      manifestSha256: signature.manifestSha256, signatureAlgorithm: "Ed25519",
      keyId: signature.keyId, entries: entries.length,
      ingested: records.filter((entry) => entry.status === "ingested").length,
      duplicates: records.filter((entry) => entry.status === "duplicate").length,
      rejected: records.filter((entry) => entry.status === "rejected").length,
    };
    await markJobCompleted(data, result);
    return result;
  }

  if (data.jobType === "extract") {
    await job.updateProgress(45);
    await markJobProgress(data, 45);
    const extracted = await extractDocument(verification.bytes, object.originalName);
    await job.updateProgress(85);
    await markJobProgress(data, 85);
    return saveExtractedDocument(data, { ...extracted, detectedMime: object.contentType });
  }

  if (data.jobType === "transcribe") {
    await job.updateProgress(40);
    await markJobProgress(data, 40, {
      stage: "loading_model", processedSeconds: null, durationSeconds: null,
      elapsedSeconds: 0, etaSeconds: null, segmentIndex: null,
    });
    let lastLoggedBucket = -1;
    const transcription = await transcribeMedia(
      verification.bytes, object.originalName, object.contentType,
      async (update) => {
        const progress = transcriptionJobProgress(update.progress);
        const detail = {
          stage: update.stage,
          processedSeconds: update.processedSeconds,
          durationSeconds: update.durationSeconds,
          elapsedSeconds: update.elapsedSeconds,
          etaSeconds: update.etaSeconds,
          segmentIndex: update.segmentIndex,
        };
        await Promise.all([
          job.updateProgress(progress),
          markJobProgress(data, progress, detail),
        ]);
        const bucket = Math.floor(progress / 10);
        if (bucket > lastLoggedBucket) {
          lastLoggedBucket = bucket;
          const timeline = update.processedSeconds !== null && update.durationSeconds !== null
            ? ` · ${Math.round(update.processedSeconds)}s/${Math.round(update.durationSeconds)}s` : "";
          console.log(`Transcripción en progreso: ${progress}%${timeline} · ${object.originalName}`);
        }
      },
    );
    await job.updateProgress(90);
    await markJobProgress(data, 90);
    return saveTranscription(data, transcription);
  }

  let signature: Awaited<ReturnType<typeof inspectFileSignature>>;
  try {
    signature = await inspectFileSignature(verification.bytes, object.originalName);
  } catch (error) {
    await recordSecurityScan(data, {
      engine: "file-signature",
      status: "error", threatName: null, engineVersion: null,
      detectedMime: null, detectedExtension: null,
      result: { stage: "signature", error: error instanceof Error ? error.message : "Firma no válida" },
    });
    throw error;
  }
  await applyDetectedMediaType(data, signature.detectedMime, signature.detectedExtension);
  await job.updateProgress(45);
  await markJobProgress(data, 45);

  let antivirus: Awaited<ReturnType<typeof scanWithClamav>>;
  try {
    antivirus = await scanWithClamav(verification.bytes);
  } catch (error) {
    await recordSecurityScan(data, {
      engine: "clamav",
      status: "error", threatName: null, engineVersion: null,
      detectedMime: signature.detectedMime, detectedExtension: signature.detectedExtension,
      result: { stage: "antivirus", error: error instanceof Error ? error.message : "ClamAV no disponible" },
    });
    throw error;
  }
  const scanResult = {
    engine: "clamav" as const,
    status: antivirus.status, threatName: antivirus.threatName,
    engineVersion: antivirus.engineVersion,
    detectedMime: signature.detectedMime, detectedExtension: signature.detectedExtension,
    result: { response: antivirus.response, sha256: verification.sha256, sizeBytes: verification.sizeBytes },
  } as const;
  await recordSecurityScan(data, scanResult);
  await job.updateProgress(80);
  await markJobProgress(data, 80);

  const result = {
    integrity: { sizeBytes: verification.sizeBytes, sha256: verification.sha256, etag: verification.etag },
    signature,
    antivirus: { status: antivirus.status, threatName: antivirus.threatName, engineVersion: antivirus.engineVersion },
    verifiedAt: new Date().toISOString(), pipeline: "secure-ingest.v2",
  };
  if (antivirus.status === "infected") {
    await quarantineObject(data, result, antivirus.threatName ?? "Amenaza sin nombre");
    return result;
  }
  if (isExtractableDocument(object.originalName)) {
    await enqueueExtraction(data, result);
    return { ...result, nextStage: "extract" };
  }
  if (signature.detectedMime === "application/zip") {
    await enqueueArchiveExpansion(data, result);
    return { ...result, nextStage: "expand_archive" };
  }
  if (signature.detectedMime.startsWith("audio/") || signature.detectedMime.startsWith("video/")) {
    await enqueueTranscription(data, result);
    return { ...result, nextStage: "transcribe" };
  }
  await markJobCompleted(data, result);
  return result;
}, {
  connection: workerConnection,
  concurrency: Math.max(1, Number(process.env.WORKER_CONCURRENCY ?? 3)),
  maxStalledCount: 2,
});

worker.on("failed", (job, error) => {
  if (!job) return;
  console.error(`Trabajo fallido: ${job.name} · ${job.id} · ${error.message}`);
  const maxAttempts = Number(job.opts.attempts ?? 1);
  const final = job.attemptsMade >= maxAttempts;
  void markJobFailed(job.data, error, job.attemptsMade, final).catch((dbError) =>
    console.error("No se pudo registrar el fallo del trabajo", dbError));
});
worker.on("active", (job) => console.log(`Trabajo activo: ${job.name} · ${job.id}`));
worker.on("completed", (job) => console.log(`Trabajo completado: ${job.name} · ${job.id}`));
worker.on("error", (error) => console.error(`Worker BullMQ ${error.message}`));

async function dispatchOutbox() {
  if (dispatching) return;
  dispatching = true;
  try {
    const items = await claimOutboxBatch(workerId);
    for (const item of items) {
      try {
        await queue.add(item.payload.jobType, item.payload, {
          jobId: `${item.jobId}-${item.payload.dispatchVersion}`,
        });
        await acknowledgeOutbox(item.jobId, workerId);
      } catch (error) {
        await rejectOutbox(item.jobId, workerId, error);
      }
    }
  } catch (error) {
    console.error("No se pudo despachar el outbox", error);
  } finally {
    dispatching = false;
  }
}

await Promise.all([queue.waitUntilReady(), worker.waitUntilReady(), clamavHealth(), transcriberHealth()]);
const reconciled = await reconcilePendingPipeline();
await dispatchOutbox();
const dispatcher = setInterval(() => void dispatchOutbox(), 2_000);
console.log(`Worker de ingesta listo: ${workerId} · reconciliado ${JSON.stringify(reconciled)}`);

async function shutdown(signal: string) {
  console.log(`Cerrando worker por ${signal}`);
  clearInterval(dispatcher);
  await worker.close();
  await queue.close();
  await Promise.allSettled([queueConnection.quit(), workerConnection.quit()]);
  await closeDb();
  process.exit(0);
}

process.once("SIGTERM", () => void shutdown("SIGTERM"));
process.once("SIGINT", () => void shutdown("SIGINT"));
