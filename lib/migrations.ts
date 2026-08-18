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
  {
    version: 5,
    name: "production_security_hardening",
    sql: `
      CREATE TABLE IF NOT EXISTS user_sessions (
        id TEXT PRIMARY KEY,
        user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        token_hash CHAR(64) NOT NULL UNIQUE,
        active_workspace_id TEXT REFERENCES workspaces(id) ON DELETE SET NULL,
        user_agent TEXT NOT NULL DEFAULT '',
        ip_hash CHAR(64),
        expires_at TIMESTAMPTZ NOT NULL,
        last_seen_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
        revoked_at TIMESTAMPTZ,
        revoked_reason TEXT,
        created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
      );

      CREATE INDEX IF NOT EXISTS idx_user_sessions_user_active
        ON user_sessions(user_id, expires_at DESC)
        WHERE revoked_at IS NULL;
      CREATE INDEX IF NOT EXISTS idx_user_sessions_expiry
        ON user_sessions(expires_at) WHERE revoked_at IS NULL;

      CREATE TABLE IF NOT EXISTS security_rate_limits (
        action TEXT NOT NULL,
        key_hash CHAR(64) NOT NULL,
        attempts INTEGER NOT NULL DEFAULT 0 CHECK (attempts >= 0),
        window_started_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
        blocked_until TIMESTAMPTZ,
        updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
        PRIMARY KEY (action, key_hash)
      );

      CREATE INDEX IF NOT EXISTS idx_security_rate_limits_cleanup
        ON security_rate_limits(updated_at);

      CREATE TABLE IF NOT EXISTS security_audit_events (
        id TEXT PRIMARY KEY,
        user_id TEXT REFERENCES users(id) ON DELETE SET NULL,
        workspace_id TEXT REFERENCES workspaces(id) ON DELETE SET NULL,
        event_type TEXT NOT NULL,
        outcome TEXT NOT NULL CHECK (outcome IN ('success', 'failure', 'blocked')),
        ip_hash CHAR(64),
        user_agent TEXT NOT NULL DEFAULT '',
        metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
        created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
      );

      CREATE INDEX IF NOT EXISTS idx_security_audit_user_created
        ON security_audit_events(user_id, created_at DESC);
      CREATE INDEX IF NOT EXISTS idx_security_audit_workspace_created
        ON security_audit_events(workspace_id, created_at DESC);
      CREATE INDEX IF NOT EXISTS idx_security_audit_type_created
        ON security_audit_events(event_type, created_at DESC);
    `,
  },
  {
    version: 6,
    name: "ingestion_storage_and_jobs",
    sql: `
      CREATE TABLE IF NOT EXISTS stored_objects (
        id TEXT PRIMARY KEY,
        tenant_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
        project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
        source_id TEXT REFERENCES sources(id) ON DELETE SET NULL,
        bucket TEXT NOT NULL,
        object_key TEXT NOT NULL UNIQUE,
        original_name TEXT NOT NULL,
        content_type TEXT NOT NULL,
        size_bytes BIGINT NOT NULL CHECK (size_bytes > 0),
        sha256 CHAR(64) NOT NULL,
        status TEXT NOT NULL DEFAULT 'uploaded'
          CHECK (status IN ('uploaded', 'processing', 'ready', 'failed', 'quarantined')),
        metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
        created_by TEXT REFERENCES users(id) ON DELETE SET NULL,
        created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
      );

      CREATE UNIQUE INDEX IF NOT EXISTS uq_stored_object_project_hash
        ON stored_objects(tenant_id, project_id, sha256);
      CREATE INDEX IF NOT EXISTS idx_stored_objects_project_created
        ON stored_objects(tenant_id, project_id, created_at DESC);

      CREATE TABLE IF NOT EXISTS processing_jobs (
        id TEXT PRIMARY KEY,
        tenant_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
        project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
        object_id TEXT NOT NULL REFERENCES stored_objects(id) ON DELETE CASCADE,
        job_type TEXT NOT NULL CHECK (job_type IN ('ingest', 'extract', 'transcribe')),
        idempotency_key CHAR(64) NOT NULL UNIQUE,
        queue_job_id TEXT UNIQUE,
        dispatch_version SMALLINT NOT NULL DEFAULT 1 CHECK (dispatch_version > 0),
        status TEXT NOT NULL DEFAULT 'queued'
          CHECK (status IN ('queued', 'active', 'retrying', 'completed', 'failed', 'dead_letter')),
        progress SMALLINT NOT NULL DEFAULT 0 CHECK (progress BETWEEN 0 AND 100),
        attempts SMALLINT NOT NULL DEFAULT 0 CHECK (attempts >= 0),
        max_attempts SMALLINT NOT NULL DEFAULT 3 CHECK (max_attempts BETWEEN 1 AND 20),
        error TEXT,
        result JSONB NOT NULL DEFAULT '{}'::jsonb,
        created_by TEXT REFERENCES users(id) ON DELETE SET NULL,
        started_at TIMESTAMPTZ,
        completed_at TIMESTAMPTZ,
        created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
      );

      CREATE INDEX IF NOT EXISTS idx_processing_jobs_project_created
        ON processing_jobs(tenant_id, project_id, created_at DESC);
      CREATE INDEX IF NOT EXISTS idx_processing_jobs_status
        ON processing_jobs(status, updated_at);

      CREATE TABLE IF NOT EXISTS job_dispatch_outbox (
        job_id TEXT PRIMARY KEY REFERENCES processing_jobs(id) ON DELETE CASCADE,
        payload JSONB NOT NULL,
        attempts INTEGER NOT NULL DEFAULT 0 CHECK (attempts >= 0),
        next_attempt_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
        locked_until TIMESTAMPTZ,
        locked_by TEXT,
        last_error TEXT,
        created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
      );

      CREATE INDEX IF NOT EXISTS idx_job_outbox_dispatch
        ON job_dispatch_outbox(next_attempt_at, created_at);

      ALTER TABLE stored_objects ENABLE ROW LEVEL SECURITY;
      ALTER TABLE stored_objects FORCE ROW LEVEL SECURITY;
      ALTER TABLE processing_jobs ENABLE ROW LEVEL SECURITY;
      ALTER TABLE processing_jobs FORCE ROW LEVEL SECURITY;

      DROP POLICY IF EXISTS tenant_isolation ON stored_objects;
      CREATE POLICY tenant_isolation ON stored_objects
        USING (tenant_id = NULLIF(current_setting('app.tenant_id', TRUE), ''))
        WITH CHECK (tenant_id = NULLIF(current_setting('app.tenant_id', TRUE), ''));

      DROP POLICY IF EXISTS tenant_isolation ON processing_jobs;
      CREATE POLICY tenant_isolation ON processing_jobs
        USING (tenant_id = NULLIF(current_setting('app.tenant_id', TRUE), ''))
        WITH CHECK (tenant_id = NULLIF(current_setting('app.tenant_id', TRUE), ''));
    `,
  },
  {
    version: 7,
    name: "secure_extraction_pipeline",
    sql: `
      ALTER TABLE processing_jobs DROP CONSTRAINT IF EXISTS processing_jobs_job_type_check;
      ALTER TABLE processing_jobs ADD CONSTRAINT processing_jobs_job_type_check
        CHECK (job_type IN ('ingest', 'scan', 'extract', 'transcribe'));

      CREATE TABLE IF NOT EXISTS security_scans (
        id TEXT PRIMARY KEY,
        tenant_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
        project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
        object_id TEXT NOT NULL REFERENCES stored_objects(id) ON DELETE CASCADE,
        job_id TEXT REFERENCES processing_jobs(id) ON DELETE SET NULL,
        engine TEXT NOT NULL,
        engine_version TEXT,
        signature_version TEXT,
        status TEXT NOT NULL CHECK (status IN ('clean', 'infected', 'error')),
        threat_name TEXT,
        detected_mime TEXT,
        detected_extension TEXT,
        result JSONB NOT NULL DEFAULT '{}'::jsonb,
        scanned_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
        created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
      );

      CREATE INDEX IF NOT EXISTS idx_security_scans_object
        ON security_scans(tenant_id, object_id, scanned_at DESC);

      CREATE TABLE IF NOT EXISTS extracted_documents (
        id TEXT PRIMARY KEY,
        tenant_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
        project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
        object_id TEXT NOT NULL UNIQUE REFERENCES stored_objects(id) ON DELETE CASCADE,
        source_id TEXT REFERENCES sources(id) ON DELETE SET NULL,
        extractor TEXT NOT NULL,
        extractor_version TEXT NOT NULL,
        detected_mime TEXT NOT NULL,
        text_content TEXT NOT NULL,
        text_sha256 CHAR(64) NOT NULL,
        character_count INTEGER NOT NULL CHECK (character_count >= 0),
        word_count INTEGER NOT NULL CHECK (word_count >= 0),
        page_count INTEGER,
        metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
        extracted_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
        created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
      );

      CREATE INDEX IF NOT EXISTS idx_extracted_documents_project
        ON extracted_documents(tenant_id, project_id, extracted_at DESC);

      CREATE TABLE IF NOT EXISTS document_chunks (
        id TEXT PRIMARY KEY,
        tenant_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
        project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
        document_id TEXT NOT NULL REFERENCES extracted_documents(id) ON DELETE CASCADE,
        object_id TEXT NOT NULL REFERENCES stored_objects(id) ON DELETE CASCADE,
        chunk_index INTEGER NOT NULL CHECK (chunk_index >= 0),
        content TEXT NOT NULL,
        content_sha256 CHAR(64) NOT NULL,
        character_count INTEGER NOT NULL CHECK (character_count > 0),
        token_estimate INTEGER NOT NULL CHECK (token_estimate > 0),
        created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
        UNIQUE (document_id, chunk_index)
      );

      CREATE INDEX IF NOT EXISTS idx_document_chunks_project
        ON document_chunks(tenant_id, project_id, document_id, chunk_index);

      ALTER TABLE security_scans ENABLE ROW LEVEL SECURITY;
      ALTER TABLE security_scans FORCE ROW LEVEL SECURITY;
      ALTER TABLE extracted_documents ENABLE ROW LEVEL SECURITY;
      ALTER TABLE extracted_documents FORCE ROW LEVEL SECURITY;
      ALTER TABLE document_chunks ENABLE ROW LEVEL SECURITY;
      ALTER TABLE document_chunks FORCE ROW LEVEL SECURITY;

      DROP POLICY IF EXISTS tenant_isolation ON security_scans;
      CREATE POLICY tenant_isolation ON security_scans
        USING (tenant_id = NULLIF(current_setting('app.tenant_id', TRUE), ''))
        WITH CHECK (tenant_id = NULLIF(current_setting('app.tenant_id', TRUE), ''));

      DROP POLICY IF EXISTS tenant_isolation ON extracted_documents;
      CREATE POLICY tenant_isolation ON extracted_documents
        USING (tenant_id = NULLIF(current_setting('app.tenant_id', TRUE), ''))
        WITH CHECK (tenant_id = NULLIF(current_setting('app.tenant_id', TRUE), ''));

      DROP POLICY IF EXISTS tenant_isolation ON document_chunks;
      CREATE POLICY tenant_isolation ON document_chunks
        USING (tenant_id = NULLIF(current_setting('app.tenant_id', TRUE), ''))
        WITH CHECK (tenant_id = NULLIF(current_setting('app.tenant_id', TRUE), ''));

      -- Los objetos aceptados por v0.6.0 conservan su hash, pero todavía no tienen
      -- dictamen antimalware. Se vuelven a poner en cola de forma idempotente.
      DO $backfill$
      DECLARE
        tenant_record RECORD;
        object_record RECORD;
        scan_job_id TEXT;
        scan_key CHAR(64);
      BEGIN
        FOR tenant_record IN SELECT id FROM workspaces
        LOOP
          PERFORM set_config('app.tenant_id', tenant_record.id, TRUE);
          FOR object_record IN
            SELECT id, tenant_id, project_id, created_by
            FROM stored_objects object
            WHERE tenant_id = tenant_record.id AND status = 'ready' AND created_by IS NOT NULL
              AND NOT EXISTS (
                SELECT 1 FROM processing_jobs job
                WHERE job.object_id = object.id AND job.job_type = 'scan'
              )
          LOOP
            PERFORM set_config('app.user_id', object_record.created_by, TRUE);
            scan_job_id := 'scan-v7-' || md5(object_record.id);
            scan_key := md5(object_record.tenant_id || ':' || object_record.id || ':scan') ||
              md5(object_record.project_id || ':' || object_record.id || ':v7');
            INSERT INTO processing_jobs
              (id, tenant_id, project_id, object_id, job_type, idempotency_key,
               queue_job_id, status, max_attempts, created_by)
            VALUES (scan_job_id, object_record.tenant_id, object_record.project_id,
              object_record.id, 'scan', scan_key, scan_job_id || '-1', 'queued', 3,
              object_record.created_by)
            ON CONFLICT DO NOTHING;
            INSERT INTO job_dispatch_outbox (job_id, payload)
            VALUES (scan_job_id, jsonb_build_object(
              'jobId', scan_job_id,
              'tenantId', object_record.tenant_id,
              'projectId', object_record.project_id,
              'objectId', object_record.id,
              'userId', object_record.created_by,
              'jobType', 'scan',
              'dispatchVersion', 1
            )) ON CONFLICT (job_id) DO NOTHING;
            UPDATE stored_objects SET status = 'uploaded', updated_at = CURRENT_TIMESTAMP
              WHERE id = object_record.id;
            UPDATE sources SET status = 'queued'
              WHERE id = (SELECT source_id FROM stored_objects WHERE id = object_record.id);
          END LOOP;
        END LOOP;
        PERFORM set_config('app.tenant_id', '', TRUE);
        PERFORM set_config('app.user_id', '', TRUE);
      END $backfill$;
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
