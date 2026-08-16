import { mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { DatabaseSync } from "node:sqlite";

declare global {
  // eslint-disable-next-line no-var
  var __norugResearchDb: DatabaseSync | undefined;
}

function databasePath() {
  return resolve(process.cwd(), process.env.DATABASE_PATH ?? "./data/research-studio.db");
}

function openDatabase() {
  const path = databasePath();
  mkdirSync(dirname(path), { recursive: true });
  const database = new DatabaseSync(path);
  database.exec("PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON;");
  migrate(database);
  seed(database);
  return database;
}

function migrate(db: DatabaseSync) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS projects (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      area TEXT NOT NULL,
      language TEXT NOT NULL DEFAULT 'Español',
      output TEXT NOT NULL DEFAULT 'Informe técnico',
      status TEXT NOT NULL DEFAULT 'draft',
      progress INTEGER NOT NULL DEFAULT 0 CHECK(progress BETWEEN 0 AND 100),
      human_approval INTEGER NOT NULL DEFAULT 1,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );
    CREATE TABLE IF NOT EXISTS sources (
      id TEXT PRIMARY KEY,
      project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
      type TEXT NOT NULL,
      title TEXT NOT NULL,
      url TEXT NOT NULL DEFAULT '',
      status TEXT NOT NULL DEFAULT 'queued',
      confidence INTEGER NOT NULL DEFAULT 50 CHECK(confidence BETWEEN 0 AND 100),
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );
    CREATE TABLE IF NOT EXISTS evidence (
      id TEXT PRIMARY KEY,
      project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
      source_id TEXT REFERENCES sources(id) ON DELETE SET NULL,
      claim TEXT NOT NULL,
      classification TEXT NOT NULL,
      confidence INTEGER NOT NULL CHECK(confidence BETWEEN 0 AND 100),
      sha256 TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );
    CREATE TABLE IF NOT EXISTS approvals (
      id TEXT PRIMARY KEY,
      project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
      stage TEXT NOT NULL,
      status TEXT NOT NULL,
      reviewer TEXT NOT NULL,
      note TEXT NOT NULL DEFAULT '',
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );
    CREATE TABLE IF NOT EXISTS activity (
      id TEXT PRIMARY KEY,
      project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
      action TEXT NOT NULL,
      detail TEXT NOT NULL,
      actor TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );
    CREATE INDEX IF NOT EXISTS idx_sources_project ON sources(project_id);
    CREATE INDEX IF NOT EXISTS idx_evidence_project ON evidence(project_id);
    CREATE INDEX IF NOT EXISTS idx_activity_project ON activity(project_id, created_at DESC);
  `);
}

function seed(db: DatabaseSync) {
  const existing = db.prepare("SELECT COUNT(*) AS count FROM projects").get() as { count: number };
  if (existing.count > 0) return;

  db.exec("BEGIN");
  try {
    db.prepare(`INSERT INTO projects
      (id, name, area, language, output, status, progress, human_approval)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)`)
      .run("demo-aerospace", "Briefing semanal aeroespacial", "Ingeniería aeroespacial", "Español", "Vídeo documental", "running", 38, 1);

    const addSource = db.prepare(`INSERT INTO sources
      (id, project_id, type, title, url, status, confidence) VALUES (?, ?, ?, ?, ?, ?, ?)`);
    addSource.run("src-nsf", "demo-aerospace", "YouTube", "NASA Spaceflight", "https://www.youtube.com/@NASASpaceflight", "processed", 96);
    addSource.run("src-faa", "demo-aerospace", "Documento", "FAA / NOTAM", "https://www.faa.gov/", "processed", 100);
    addSource.run("src-mh", "demo-aerospace", "YouTube", "Marcus House", "https://www.youtube.com/@MarcusHouse", "processed", 71);
    addSource.run("src-x", "demo-aerospace", "Social", "X · fuente sin atribuir", "", "review", 28);

    const addEvidence = db.prepare(`INSERT INTO evidence
      (id, project_id, source_id, claim, classification, confidence, sha256)
      VALUES (?, ?, ?, ?, ?, ?, ?)`);
    addEvidence.run("ev-1", "demo-aerospace", "src-nsf", "Prueba estática del vehículo", "VERIFICADO", 96, "4f91c2c14a5d2ab19de1d7134d7a57458299d477d91da24ee24b4dcbb7ac719a");
    addEvidence.run("ev-2", "demo-aerospace", "src-faa", "Ventana operativa publicada", "VERIFICADO", 100, "2d8950b5a038f546c9e8618168605f5ced692a5c661a8f03b2cd3967a78cf93e");
    addEvidence.run("ev-3", "demo-aerospace", "src-mh", "Fecha tentativa de lanzamiento", "PROBABLE", 71, "08f4ba6b017be85bd5c5fc93ca7d28dbe631f12a991a5b4fdde6acde739a3918");
    addEvidence.run("ev-4", "demo-aerospace", "src-x", "Cambio interno de motores", "NO DEMOSTRADO", 28, "8b3877e7606fb229681f4ffb8323f23f6ab440175df08e88aa045affdd2eb7bc");
    db.prepare(`INSERT INTO activity (id, project_id, action, detail, actor) VALUES (?, ?, ?, ?, ?)`)
      .run("act-1", "demo-aerospace", "pipeline.started", "Descubrimiento iniciado con cuatro fuentes", "Sistema");
    db.prepare(`INSERT INTO activity (id, project_id, action, detail, actor) VALUES (?, ?, ?, ?, ?)`)
      .run("act-2", "demo-aerospace", "evidence.review", "Una afirmación requiere revisión humana", "Sistema");
    db.exec("COMMIT");
  } catch (error) {
    db.exec("ROLLBACK");
    throw error;
  }
}

export function getDb() {
  if (!globalThis.__norugResearchDb) globalThis.__norugResearchDb = openDatabase();
  return globalThis.__norugResearchDb;
}
