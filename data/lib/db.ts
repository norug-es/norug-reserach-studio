import { Pool, type PoolClient, type QueryResultRow } from "pg";
import { latestMigrationVersion, runMigrations } from "./migrations.ts";

declare global {
  // eslint-disable-next-line no-var
  var __norugResearchPool: Pool | undefined;
  // eslint-disable-next-line no-var
  var __norugMigrationPromise: Promise<void> | undefined;
}

function databaseUrl() {
  const value = process.env.DATABASE_URL;
  if (!value) throw new Error("DATABASE_URL es obligatorio para conectar PostgreSQL");
  return value;
}

function createPool() {
  const sslEnabled = process.env.DATABASE_SSL === "true";
  const rejectUnauthorized = process.env.DATABASE_SSL_REJECT_UNAUTHORIZED !== "false";
  const pool = new Pool({
    connectionString: databaseUrl(),
    max: Number(process.env.DATABASE_POOL_MAX ?? 10),
    idleTimeoutMillis: Number(process.env.DATABASE_IDLE_TIMEOUT_MS ?? 30_000),
    connectionTimeoutMillis: Number(process.env.DATABASE_CONNECT_TIMEOUT_MS ?? 5_000),
    ssl: sslEnabled ? { rejectUnauthorized } : undefined,
  });
  pool.on("error", (error) => console.error("PostgreSQL pool error", error));
  return pool;
}

export function getDb() {
  if (!globalThis.__norugResearchPool) globalThis.__norugResearchPool = createPool();
  return globalThis.__norugResearchPool;
}

export async function ensureDatabase() {
  if (!globalThis.__norugMigrationPromise) {
    globalThis.__norugMigrationPromise = (async () => {
      const client = await getDb().connect();
      try {
        await runMigrations(client);
      } finally {
        client.release();
      }
    })().catch((error) => {
      globalThis.__norugMigrationPromise = undefined;
      throw error;
    });
  }
  await globalThis.__norugMigrationPromise;
}

export async function query<T extends QueryResultRow>(text: string, values: unknown[] = []) {
  await ensureDatabase();
  return getDb().query<T>(text, values);
}

export async function withTransaction<T>(work: (client: PoolClient) => Promise<T>) {
  await ensureDatabase();
  const client = await getDb().connect();
  try {
    await client.query("BEGIN");
    const result = await work(client);
    await client.query("COMMIT");
    return result;
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

export async function databaseHealth() {
  const startedAt = performance.now();
  const result = await query<{ database: string; version: string }>(
    "SELECT current_database() AS database, current_setting('server_version') AS version",
  );
  return {
    ...result.rows[0],
    migrationVersion: latestMigrationVersion,
    latencyMs: Math.round(performance.now() - startedAt),
  };
}

export async function closeDb() {
  if (!globalThis.__norugResearchPool) return;
  await globalThis.__norugResearchPool.end();
  globalThis.__norugResearchPool = undefined;
  globalThis.__norugMigrationPromise = undefined;
}
