import { closeDb, databaseHealth, ensureDatabase } from "../lib/db.ts";
import { createRedisConnection } from "../lib/queue.ts";
import { ensureStorageBucket, storageHealth } from "../lib/storage.ts";
import { clamavHealth } from "../lib/clamav.ts";
import { transcriberHealth } from "../lib/transcriber.ts";

const redis = createRedisConnection();
try {
  await ensureDatabase();
  await ensureStorageBucket();
  const [database, storage, redisReply, clamavReply, transcriber] = await Promise.all([
    databaseHealth(), storageHealth(), redis.ping(), clamavHealth(), transcriberHealth(),
  ]);
  if (!database.rlsEnforced) throw new Error("El rol PostgreSQL omite RLS");
  if (database.migrationVersion < 8) throw new Error("La migración 8 no está aplicada");
  if (redisReply !== "PONG") throw new Error("Redis no respondió PONG");
  console.log(`Ingesta preparada: PostgreSQL m${database.migrationVersion}, ` +
    `bucket ${storage.bucket}@${storage.endpoint}, Redis PONG, ClamAV ${clamavReply}, ` +
    `Whisper ${String(transcriber.model)}@${String(transcriber.device)}`);
} finally {
  await Promise.allSettled([redis.quit(), closeDb()]);
}
