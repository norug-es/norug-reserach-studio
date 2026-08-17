import type { PoolClient } from "pg";

type Migration = { version: number; name: string; sql: string };

const migrations: Migration[] = [
  {
    version: 1,
    name: "initial_research_schema",
    sql: `
      CREATE TABLE IF NOT EXISTS projects (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        area TEXT NOT NULL,
        language TEXT NOT NULL DEFAULT 'Español',
        output TEXT NOT NULL DEFAULT 'Informe técnico',
        status TEXT NOT NULL DEFAULT 'draft'
          CHECK (status IN ('draft', 'running', 'paused', 'review', 'completed')),
        progress SMALLINT NOT NULL DEFAULT 0 CHECK (progress BETWEEN 0 AND 100),
        human_approval BOOLEAN NOT NULL DEFAULT TRUE,
        created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
      );

      CREATE TABLE IF NOT EXISTS sources (
        id TEXT PRIMARY KEY,
        project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
        type TEXT NOT NULL,
        title TEXT NOT NULL,
        url TEXT NOT NULL DEFAULT '',
        status TEXT NOT NULL DEFAULT 'queued',
        confidence SMALLINT NOT NULL DEFAULT 50 CHECK (confidence BETWEEN 0 AND 100),
        created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
      );

      CREATE TABLE IF NOT EXISTS evidence (
        id TEXT PRIMARY KEY,
        project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
        source_id TEXT REFERENCES sources(id) ON DELETE SET NULL,
        claim TEXT NOT NULL,
        classification TEXT NOT NULL
          CHECK (classification IN ('VERIFICADO', 'PROBABLE', 'HIPOTÉTICO', 'NO DEMOSTRADO')),
        confidence SMALLINT NOT NULL CHECK (confidence BETWEEN 0 AND 100),
        sha256 CHAR(64) NOT NULL,
        created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
      );

      CREATE TABLE IF NOT EXISTS approvals (
        id TEXT PRIMARY KEY,
        project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
        stage TEXT NOT NULL,
        status TEXT NOT NULL CHECK (status IN ('approved', 'rejected')),
        reviewer TEXT NOT NULL,
        note TEXT NOT NULL DEFAULT '',
        created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
      );

      CREATE TABLE IF NOT EXISTS activity (
        id TEXT PRIMARY KEY,
        project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
        action TEXT NOT NULL,
        detail TEXT NOT NULL,
        actor TEXT NOT NULL,
        created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
      );

      CREATE INDEX IF NOT EXISTS idx_sources_project ON sources(project_id);
      CREATE INDEX IF NOT EXISTS idx_evidence_project ON evidence(project_id);
      CREATE INDEX IF NOT EXISTS idx_approvals_project ON approvals(project_id, created_at DESC);
      CREATE INDEX IF NOT EXISTS idx_activity_project ON activity(project_id, created_at DESC);
    `,
  },
  {
    version: 2,
    name: "seed_aerospace_demo",
    sql: `
      INSERT INTO projects
        (id, name, area, language, output, status, progress, human_approval)
      VALUES
        ('demo-aerospace', 'Briefing semanal aeroespacial', 'Ingeniería aeroespacial',
         'Español', 'Vídeo documental', 'running', 38, TRUE)
      ON CONFLICT (id) DO NOTHING;

      INSERT INTO sources (id, project_id, type, title, url, status, confidence) VALUES
        ('src-nsf', 'demo-aerospace', 'YouTube', 'NASA Spaceflight', 'https://www.youtube.com/@NASASpaceflight', 'processed', 96),
        ('src-faa', 'demo-aerospace', 'Documento', 'FAA / NOTAM', 'https://www.faa.gov/', 'processed', 100),
        ('src-mh', 'demo-aerospace', 'YouTube', 'Marcus House', 'https://www.youtube.com/@MarcusHouse', 'processed', 71),
        ('src-x', 'demo-aerospace', 'Social', 'X · fuente sin atribuir', '', 'review', 28)
      ON CONFLICT (id) DO NOTHING;

      INSERT INTO evidence
        (id, project_id, source_id, claim, classification, confidence, sha256) VALUES
        ('ev-1', 'demo-aerospace', 'src-nsf', 'Prueba estática del vehículo', 'VERIFICADO', 96, '4f91c2c14a5d2ab19de1d7134d7a57458299d477d91da24ee24b4dcbb7ac719a'),
        ('ev-2', 'demo-aerospace', 'src-faa', 'Ventana operativa publicada', 'VERIFICADO', 100, '2d8950b5a038f546c9e8618168605f5ced692a5c661a8f03b2cd3967a78cf93e'),
        ('ev-3', 'demo-aerospace', 'src-mh', 'Fecha tentativa de lanzamiento', 'PROBABLE', 71, '08f4ba6b017be85bd5c5fc93ca7d28dbe631f12a991a5b4fdde6acde739a3918'),
        ('ev-4', 'demo-aerospace', 'src-x', 'Cambio interno de motores', 'NO DEMOSTRADO', 28, '8b3877e7606fb229681f4ffb8323f23f6ab440175df08e88aa045affdd2eb7bc')
      ON CONFLICT (id) DO NOTHING;

      INSERT INTO activity (id, project_id, action, detail, actor) VALUES
        ('act-1', 'demo-aerospace', 'pipeline.started', 'Descubrimiento iniciado con cuatro fuentes', 'Sistema'),
        ('act-2', 'demo-aerospace', 'evidence.review', 'Una afirmación requiere revisión humana', 'Sistema')
      ON CONFLICT (id) DO NOTHING;
    `,
  },
];

export async function runMigrations(client: PoolClient) {
  await client.query("BEGIN");
  try {
    await client.query("SELECT pg_advisory_xact_lock(hashtext('norug_research_studio_migrations'))");
    await client.query(`
      CREATE TABLE IF NOT EXISTS schema_migrations (
        version INTEGER PRIMARY KEY,
        name TEXT NOT NULL,
        applied_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
      )
    `);
    const result = await client.query<{ version: number }>("SELECT version FROM schema_migrations");
    const applied = new Set(result.rows.map((row) => row.version));
    for (const migration of migrations) {
      if (applied.has(migration.version)) continue;
      await client.query(migration.sql);
      await client.query(
        "INSERT INTO schema_migrations (version, name) VALUES ($1, $2)",
        [migration.version, migration.name],
      );
    }
    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  }
}

export const latestMigrationVersion = migrations.at(-1)?.version ?? 0;
