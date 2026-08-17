import assert from "node:assert/strict";
import test from "node:test";

test("PostgreSQL aplica migraciones y conserva el proyecto inicial", async () => {
  assert.ok(process.env.DATABASE_URL, "DATABASE_URL es obligatorio para test:db");
  const database = await import("../lib/db.ts");
  try {
    await database.ensureDatabase();
    const health = await database.databaseHealth();
    assert.equal(health.migrationVersion, 2);
    assert.ok(health.database);
    const result = await database.query(
      "SELECT COUNT(*)::integer AS count FROM projects WHERE id = $1",
      ["demo-aerospace"],
    );
    assert.equal(result.rows[0].count, 1);
  } finally {
    await database.closeDb();
  }
});
