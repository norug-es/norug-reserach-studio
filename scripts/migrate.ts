import { closeDb, databaseHealth, ensureDatabase } from "../lib/db.ts";

try {
  await ensureDatabase();
  const health = await databaseHealth();
  console.log(`PostgreSQL preparado: ${health.database}; migración ${health.migrationVersion}`);
} finally {
  await closeDb();
}
