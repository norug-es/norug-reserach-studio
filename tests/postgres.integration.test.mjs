import assert from "node:assert/strict";
import test from "node:test";

test("PostgreSQL aplica migraciones, conserva datos y fuerza aislamiento RLS", async () => {
  assert.ok(process.env.DATABASE_URL, "DATABASE_URL es obligatorio para test:db");
  const database = await import("../lib/db.ts");
  try {
    await database.ensureDatabase();
    const health = await database.databaseHealth();
    assert.equal(health.migrationVersion, 6);
    assert.ok(health.database);
    assert.equal(health.rlsEnforced, true, "DATABASE_URL no debe usar superusuario ni BYPASSRLS");
    const identitySchema = await database.query(`SELECT
      to_regclass('public.password_reset_tokens') IS NOT NULL AS "resetTable",
      EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_schema = 'public' AND table_name = 'workspace_invitations'
          AND column_name = 'accepted_at'
      ) AS "invitationLifecycle",
      to_regclass('public.user_sessions') IS NOT NULL AS "sessionsTable",
      to_regclass('public.security_rate_limits') IS NOT NULL AS "rateLimitsTable",
      to_regclass('public.security_audit_events') IS NOT NULL AS "auditTable",
      to_regclass('public.stored_objects') IS NOT NULL AS "objectsTable",
      to_regclass('public.processing_jobs') IS NOT NULL AS "jobsTable",
      to_regclass('public.job_dispatch_outbox') IS NOT NULL AS "outboxTable",
      (
        SELECT bool_and(relrowsecurity AND relforcerowsecurity)
        FROM pg_class WHERE relname IN ('stored_objects', 'processing_jobs')
      ) AS "ingestionRls"`);
    assert.equal(identitySchema.rows[0].resetTable, true);
    assert.equal(identitySchema.rows[0].invitationLifecycle, true);
    assert.equal(identitySchema.rows[0].sessionsTable, true);
    assert.equal(identitySchema.rows[0].rateLimitsTable, true);
    assert.equal(identitySchema.rows[0].auditTable, true);
    assert.equal(identitySchema.rows[0].objectsTable, true);
    assert.equal(identitySchema.rows[0].jobsTable, true);
    assert.equal(identitySchema.rows[0].outboxTable, true);
    assert.equal(identitySchema.rows[0].ingestionRls, true);

    const tenantA = { tenantId: "workspace-norug-lab", userId: "user-admin" };
    const initial = await database.tenantQuery(
      tenantA,
      "SELECT COUNT(*)::integer AS count FROM projects WHERE id = $1",
      ["demo-aerospace"],
    );
    assert.equal(initial.rows[0].count, 1);

    const suffix = Date.now().toString(36);
    const userId = `test-user-${suffix}`;
    const workspaceId = `test-workspace-${suffix}`;
    const projectId = `test-project-${suffix}`;
    const sourceId = `test-source-${suffix}`;
    const objectId = `test-object-${suffix}`;
    const jobId = `test-job-${suffix}`;
    await database.query(`INSERT INTO users (id, email, name, password_hash)
      VALUES ($1, $2, 'Tenant test', 'scrypt$test$test')`, [userId, `${userId}@example.invalid`]);
    await database.query(`INSERT INTO workspaces (id, name, slug, created_by)
      VALUES ($1, 'Tenant aislado', $2, $3)`, [workspaceId, workspaceId, userId]);
    await database.query(`INSERT INTO workspace_members (workspace_id, user_id, role)
      VALUES ($1, $2, 'owner')`, [workspaceId, userId]);
    try {
      await database.withTenantTransaction({ tenantId: workspaceId, userId }, (client) =>
        client.query(`INSERT INTO projects
          (id, tenant_id, name, area, language, output, status, progress, human_approval)
          VALUES ($1, $2, 'Proyecto B', 'Pruebas', 'Español', 'Informe', 'draft', 0, TRUE)`,
        [projectId, workspaceId]),
      );
      await database.withTenantTransaction({ tenantId: workspaceId, userId }, async (client) => {
        await client.query(`INSERT INTO sources
          (id, tenant_id, project_id, type, title, url, status, confidence)
          VALUES ($1, $2, $3, 'Documento', 'Aislado', '', 'queued', 50)`,
        [sourceId, workspaceId, projectId]);
        await client.query(`INSERT INTO stored_objects
          (id, tenant_id, project_id, source_id, bucket, object_key, original_name,
           content_type, size_bytes, sha256, created_by)
          VALUES ($1, $2, $3, $4, 'test', $5, 'isolated.txt', 'text/plain', 4, $6, $7)`,
        [objectId, workspaceId, projectId, sourceId, `isolated/${suffix}`, "a".repeat(64), userId]);
        await client.query(`INSERT INTO processing_jobs
          (id, tenant_id, project_id, object_id, job_type, idempotency_key, queue_job_id, created_by)
          VALUES ($1, $2, $3, $4, 'ingest', $5, $1, $6)`,
        [jobId, workspaceId, projectId, objectId, "b".repeat(64), userId]);
      });
      const invisible = await database.tenantQuery(
        tenantA,
        "SELECT COUNT(*)::integer AS count FROM projects WHERE id = $1",
        [projectId],
      );
      assert.equal(invisible.rows[0].count, 0);
      const invisibleObject = await database.tenantQuery(
        tenantA, "SELECT COUNT(*)::integer AS count FROM stored_objects WHERE id = $1", [objectId]);
      assert.equal(invisibleObject.rows[0].count, 0);
      await assert.rejects(
        database.withTenantTransaction(tenantA, (client) =>
          client.query(`INSERT INTO projects
            (id, tenant_id, name, area, language, output, status, progress, human_approval)
            VALUES ($1, $2, 'Intrusión', 'Pruebas', 'Español', 'Informe', 'draft', 0, TRUE)`,
          [`forbidden-${suffix}`, workspaceId]),
        ),
      );
    } finally {
      await database.query("DELETE FROM workspaces WHERE id = $1", [workspaceId]);
      await database.query("DELETE FROM users WHERE id = $1", [userId]);
    }
  } finally {
    await database.closeDb();
  }
});
