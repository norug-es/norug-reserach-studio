import { closeDb, databaseHealth, ensureDatabase } from "../lib/db.ts";
import { createRedisConnection } from "../lib/queue.ts";
import { ensureStorageBucket, storageHealth } from "../lib/storage.ts";

const redis = createRedisConnection();
try {
  await ensureDatabase();
  await ensureStorageBucket();
  const [database, storage, redisReply] = await Promise.all([
    databaseHealth(), storageHealth(), redis.ping(),
  ]);
  if (!database.rlsEnforced) throw new Error("El rol PostgreSQL omite RLS");
  if (database.migrationVersion < 6) throw new Error("La migración 6 no está aplicada");
  if (redisReply !== "PONG") throw new Error("Redis no respondió PONG");
  console.log(`Ingesta preparada: PostgreSQL m${database.migrationVersion}, ` +
    `bucket ${storage.bucket}@${storage.endpoint}, Redis PONG`);
} finally {
  await Promise.allSettled([redis.quit(), closeDb()]);
}
