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
  {
    version: 3,
    name: "multi_tenant_foundation",
    sql: `
      CREATE TABLE IF NOT EXISTS users (
        id TEXT PRIMARY KEY,
        email TEXT NOT NULL,
        name TEXT NOT NULL,
        password_hash TEXT NOT NULL,
        status TEXT NOT NULL DEFAULT 'active'
          CHECK (status IN ('active', 'disabled')),
        created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
      );

      CREATE UNIQUE INDEX IF NOT EXISTS uq_users_email_lower ON users (LOWER(email));

      CREATE TABLE IF NOT EXISTS workspaces (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        slug TEXT NOT NULL UNIQUE,
        created_by TEXT NOT NULL REFERENCES users(id),
        created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
      );

      CREATE TABLE IF NOT EXISTS workspace_members (
        workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
        user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        role TEXT NOT NULL
          CHECK (role IN ('owner', 'admin', 'editor', 'reviewer', 'viewer')),
        created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
        PRIMARY KEY (workspace_id, user_id)
      );

      CREATE TABLE IF NOT EXISTS workspace_invitations (
        id TEXT PRIMARY KEY,
        workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
        email TEXT NOT NULL,
        role TEXT NOT NULL
          CHECK (role IN ('admin', 'editor', 'reviewer', 'viewer')),
        token_hash CHAR(64) NOT NULL UNIQUE,
        invited_by TEXT NOT NULL REFERENCES users(id),
        status TEXT NOT NULL DEFAULT 'pending'
          CHECK (status IN ('pending', 'accepted', 'revoked', 'expired')),
        expires_at TIMESTAMPTZ NOT NULL,
        created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
      );

      CREATE INDEX IF NOT EXISTS idx_workspace_members_user
        ON workspace_members(user_id, workspace_id);
      CREATE INDEX IF NOT EXISTS idx_workspace_invitations_workspace
        ON workspace_invitations(workspace_id, status, created_at DESC);

      INSERT INTO users (id, email, name, password_hash)
      VALUES (
        'user-admin',
        'admin@norug.es',
        'Moisés Ramos',
        'scrypt$norug-research-demo-v1$ZwZjL25jcOPee6piNVawJLdkOTvCN0Jc1qQc4i6TYiUnLgkhv9VcJnMyj50O_sXv81qHg_H4bsoM8f2OyH7NUA'
      )
      ON CONFLICT (id) DO NOTHING;

      INSERT INTO workspaces (id, name, slug, created_by)
      VALUES ('workspace-norug-lab', 'NoRug Lab', 'norug-lab', 'user-admin')
      ON CONFLICT (id) DO NOTHING;

      INSERT INTO workspace_members (workspace_id, user_id, role)
      VALUES ('workspace-norug-lab', 'user-admin', 'owner')
      ON CONFLICT (workspace_id, user_id) DO NOTHING;

      ALTER TABLE projects ADD COLUMN IF NOT EXISTS tenant_id TEXT;
      ALTER TABLE sources ADD COLUMN IF NOT EXISTS tenant_id TEXT;
      ALTER TABLE evidence ADD COLUMN IF NOT EXISTS tenant_id TEXT;
      ALTER TABLE approvals ADD COLUMN IF NOT EXISTS tenant_id TEXT;
      ALTER TABLE activity ADD COLUMN IF NOT EXISTS tenant_id TEXT;

      UPDATE projects SET tenant_id = 'workspace-norug-lab' WHERE tenant_id IS NULL;
      UPDATE sources s SET tenant_id = p.tenant_id
        FROM projects p WHERE s.project_id = p.id AND s.tenant_id IS NULL;
      UPDATE evidence e SET tenant_id = p.tenant_id
        FROM projects p WHERE e.project_id = p.id AND e.tenant_id IS NULL;
      UPDATE approvals a SET tenant_id = p.tenant_id
        FROM projects p WHERE a.project_id = p.id AND a.tenant_id IS NULL;
      UPDATE activity a SET tenant_id = p.tenant_id
        FROM projects p WHERE a.project_id = p.id AND a.tenant_id IS NULL;

      ALTER TABLE projects ALTER COLUMN tenant_id SET NOT NULL;
      ALTER TABLE sources ALTER COLUMN tenant_id SET NOT NULL;
      ALTER TABLE evidence ALTER COLUMN tenant_id SET NOT NULL;
      ALTER TABLE approvals ALTER COLUMN tenant_id SET NOT NULL;
      ALTER TABLE activity ALTER COLUMN tenant_id SET NOT NULL;

      DO $$
      BEGIN
        IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'fk_projects_tenant') THEN
          ALTER TABLE projects ADD CONSTRAINT fk_projects_tenant
            FOREIGN KEY (tenant_id) REFERENCES workspaces(id) ON DELETE CASCADE;
        END IF;
        IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'fk_sources_tenant') THEN
          ALTER TABLE sources ADD CONSTRAINT fk_sources_tenant
            FOREIGN KEY (tenant_id) REFERENCES workspaces(id) ON DELETE CASCADE;
        END IF;
        IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'fk_evidence_tenant') THEN
          ALTER TABLE evidence ADD CONSTRAINT fk_evidence_tenant
            FOREIGN KEY (tenant_id) REFERENCES workspaces(id) ON DELETE CASCADE;
        END IF;
        IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'fk_approvals_tenant') THEN
          ALTER TABLE approvals ADD CONSTRAINT fk_approvals_tenant
            FOREIGN KEY (tenant_id) REFERENCES workspaces(id) ON DELETE CASCADE;
        END IF;
        IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'fk_activity_tenant') THEN
          ALTER TABLE activity ADD CONSTRAINT fk_activity_tenant
            FOREIGN KEY (tenant_id) REFERENCES workspaces(id) ON DELETE CASCADE;
        END IF;
      END $$;

      CREATE INDEX IF NOT EXISTS idx_projects_tenant_updated
        ON projects(tenant_id, updated_at DESC);
      CREATE INDEX IF NOT EXISTS idx_sources_tenant_project
        ON sources(tenant_id, project_id, created_at DESC);
      CREATE INDEX IF NOT EXISTS idx_evidence_tenant_project
        ON evidence(tenant_id, project_id, created_at DESC);
      CREATE INDEX IF NOT EXISTS idx_approvals_tenant_project
        ON approvals(tenant_id, project_id, created_at DESC);
      CREATE INDEX IF NOT EXISTS idx_activity_tenant_project
        ON activity(tenant_id, project_id, created_at DESC);

      ALTER TABLE projects ENABLE ROW LEVEL SECURITY;
      ALTER TABLE projects FORCE ROW LEVEL SECURITY;
      ALTER TABLE sources ENABLE ROW LEVEL SECURITY;
      ALTER TABLE sources FORCE ROW LEVEL SECURITY;
      ALTER TABLE evidence ENABLE ROW LEVEL SECURITY;
      ALTER TABLE evidence FORCE ROW LEVEL SECURITY;
      ALTER TABLE approvals ENABLE ROW LEVEL SECURITY;
      ALTER TABLE approvals FORCE ROW LEVEL SECURITY;
      ALTER TABLE activity ENABLE ROW LEVEL SECURITY;
      ALTER TABLE activity FORCE ROW LEVEL SECURITY;

      DROP POLICY IF EXISTS tenant_isolation ON projects;
      CREATE POLICY tenant_isolation ON projects
        USING (tenant_id = NULLIF(current_setting('app.tenant_id', TRUE), ''))
        WITH CHECK (tenant_id = NULLIF(current_setting('app.tenant_id', TRUE), ''));

      DROP POLICY IF EXISTS tenant_isolation ON sources;
      CREATE POLICY tenant_isolation ON sources
        USING (tenant_id = NULLIF(current_setting('app.tenant_id', TRUE), ''))
        WITH CHECK (tenant_id = NULLIF(current_setting('app.tenant_id', TRUE), ''));

      DROP POLICY IF EXISTS tenant_isolation ON evidence;
      CREATE POLICY tenant_isolation ON evidence
        USING (tenant_id = NULLIF(current_setting('app.tenant_id', TRUE), ''))
        WITH CHECK (tenant_id = NULLIF(current_setting('app.tenant_id', TRUE), ''));

      DROP POLICY IF EXISTS tenant_isolation ON approvals;
      CREATE POLICY tenant_isolation ON approvals
        USING (tenant_id = NULLIF(current_setting('app.tenant_id', TRUE), ''))
        WITH CHECK (tenant_id = NULLIF(current_setting('app.tenant_id', TRUE), ''));

      DROP POLICY IF EXISTS tenant_isolation ON activity;
      CREATE POLICY tenant_isolation ON activity
        USING (tenant_id = NULLIF(current_setting('app.tenant_id', TRUE), ''))
        WITH CHECK (tenant_id = NULLIF(current_setting('app.tenant_id', TRUE), ''));
    `,
  },
  {
    version: 4,
    name: "identity_and_team_lifecycle",
    sql: `
      ALTER TABLE users ADD COLUMN IF NOT EXISTS email_verified_at TIMESTAMPTZ;
      ALTER TABLE users ADD COLUMN IF NOT EXISTS last_login_at TIMESTAMPTZ;

      ALTER TABLE workspace_invitations
        ADD COLUMN IF NOT EXISTS accepted_by TEXT REFERENCES users(id);
      ALTER TABLE workspace_invitations
        ADD COLUMN IF NOT EXISTS accepted_at TIMESTAMPTZ;
      ALTER TABLE workspace_invitations
        ADD COLUMN IF NOT EXISTS revoked_at TIMESTAMPTZ;

      WITH ranked_pending AS (
        SELECT id, ROW_NUMBER() OVER (
          PARTITION BY workspace_id, LOWER(email)
          ORDER BY created_at DESC, id DESC
        ) AS position
        FROM workspace_invitations
        WHERE status = 'pending'
      )
      UPDATE workspace_invitations invitation
      SET status = 'revoked', revoked_at = CURRENT_TIMESTAMP
      FROM ranked_pending ranked
      WHERE invitation.id = ranked.id AND ranked.position > 1;

      CREATE UNIQUE INDEX IF NOT EXISTS uq_pending_workspace_invitation
        ON workspace_invitations(workspace_id, LOWER(email))
        WHERE status = 'pending';

      CREATE TABLE IF NOT EXISTS password_reset_tokens (
        id TEXT PRIMARY KEY,
        user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        token_hash CHAR(64) NOT NULL UNIQUE,
        expires_at TIMESTAMPTZ NOT NULL,
        used_at TIMESTAMPTZ,
        created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
      );

      CREATE INDEX IF NOT EXISTS idx_password_reset_user
        ON password_reset_tokens(user_id, created_at DESC);
      CREATE INDEX IF NOT EXISTS idx_password_reset_expiry
        ON password_reset_tokens(expires_at) WHERE used_at IS NULL;
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
