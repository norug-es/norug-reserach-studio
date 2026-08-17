import { Queue } from "bullmq";
import Redis from "ioredis";

export const INGESTION_QUEUE = "norug-ingestion";

export type IngestionJobData = {
  jobId: string;
  tenantId: string;
  projectId: string;
  objectId: string;
  userId: string;
  jobType: "ingest";
  dispatchVersion: number;
};

export function redisUrl() {
  const value = process.env.REDIS_URL?.trim();
  if (!value) throw new Error("REDIS_URL es obligatorio para el worker");
  return value;
}

export function createRedisConnection() {
  return new Redis(redisUrl(), { maxRetriesPerRequest: null, enableReadyCheck: true });
}

export function createIngestionQueue(connection = createRedisConnection()) {
  return new Queue<IngestionJobData>(INGESTION_QUEUE, {
    connection,
    defaultJobOptions: {
      attempts: 3,
      backoff: { type: "exponential", delay: 2_000, jitter: 0.25 },
      removeOnComplete: { age: 24 * 60 * 60, count: 1_000 },
      removeOnFail: { age: 7 * 24 * 60 * 60, count: 5_000 },
    },
  });
}
