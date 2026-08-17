import { randomUUID } from "node:crypto";
import { Worker } from "bullmq";
import {
  acknowledgeOutbox,
  claimOutboxBatch,
  getWorkerObject,
  markJobActive,
  markJobCompleted,
  markJobFailed,
  markJobProgress,
  rejectOutbox,
} from "../lib/ingestion.ts";
import { createIngestionQueue, createRedisConnection, INGESTION_QUEUE, type IngestionJobData } from "../lib/queue.ts";
import { verifyStoredObject } from "../lib/storage.ts";
import { closeDb, ensureDatabase } from "../lib/db.ts";

const workerId = `worker-${randomUUID()}`;
const queueConnection = createRedisConnection();
const workerConnection = createRedisConnection();
const queue = createIngestionQueue(queueConnection);
let dispatching = false;

await ensureDatabase();

const worker = new Worker<IngestionJobData>(INGESTION_QUEUE, async (job) => {
  const data = job.data;
  await markJobActive(data, job.attemptsMade + 1);
  await job.updateProgress(20);
  await markJobProgress(data, 20);
  const object = await getWorkerObject(data);
  if (!object) throw new Error("El objeto de ingesta no existe o no pertenece al tenant");
  await job.updateProgress(45);
  await markJobProgress(data, 45);
  const verification = await verifyStoredObject({
    bucket: object.bucket, key: object.objectKey, sha256: object.sha256, sizeBytes: object.sizeBytes,
  });
  await job.updateProgress(85);
  await markJobProgress(data, 85);
  const result = {
    ...verification, contentType: object.contentType,
    verifiedAt: new Date().toISOString(), pipeline: "ingest.v1",
  };
  await markJobCompleted(data, result);
  return result;
}, {
  connection: workerConnection,
  concurrency: Math.max(1, Number(process.env.WORKER_CONCURRENCY ?? 3)),
  maxStalledCount: 2,
});

worker.on("failed", (job, error) => {
  if (!job) return;
  const maxAttempts = Number(job.opts.attempts ?? 1);
  const final = job.attemptsMade >= maxAttempts;
  void markJobFailed(job.data, error, job.attemptsMade, final).catch((dbError) =>
    console.error("No se pudo registrar el fallo del trabajo", dbError));
});
worker.on("error", (error) => console.error("Worker BullMQ", error));

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

await dispatchOutbox();
const dispatcher = setInterval(() => void dispatchOutbox(), 2_000);
console.log(`Worker de ingesta listo: ${workerId}`);

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
