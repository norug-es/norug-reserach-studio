import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { closeDb, ensureDatabase, withTransaction } from "../lib/db.ts";

type Row = Record<string, string | number | null>;

const sourcePath = resolve(process.cwd(), process.env.SQLITE_PATH ?? "./data/research-studio.db");
if (!existsSync(sourcePath)) throw new Error(`No existe la base SQLite: ${sourcePath}`);

const sqlite = new DatabaseSync(sourcePath, { readOnly: true });

function rows(table: string) {
  const allowed = new Set(["projects", "sources", "evidence", "approvals", "activity"]);
  if (!allowed.has(table)) throw new Error(`Tabla no permitida: ${table}`);
  return sqlite.prepare(`SELECT * FROM ${table}`).all() as Row[];
}

const projects = rows("projects");
const sources = rows("sources");
const evidence = rows("evidence");
const approvals = rows("approvals");
const activity = rows("activity");

try {
  await ensureDatabase();
  await withTransaction(async (client) => {
    for (const row of projects) {
      await client.query(`INSERT INTO projects
        (id, name, area, language, output, status, progress, human_approval, created_at, updated_at)
        VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)
        ON CONFLICT (id) DO UPDATE SET name=EXCLUDED.name, area=EXCLUDED.area,
          language=EXCLUDED.language, output=EXCLUDED.output, status=EXCLUDED.status,
          progress=EXCLUDED.progress, human_approval=EXCLUDED.human_approval,
          updated_at=EXCLUDED.updated_at`,
        [row.id, row.name, row.area, row.language, row.output, row.status, row.progress,
          Boolean(row.human_approval), row.created_at, row.updated_at],
      );
    }
    for (const row of sources) {
      await client.query(`INSERT INTO sources
        (id, project_id, type, title, url, status, confidence, created_at)
        VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
        ON CONFLICT (id) DO UPDATE SET project_id=EXCLUDED.project_id, type=EXCLUDED.type,
          title=EXCLUDED.title, url=EXCLUDED.url, status=EXCLUDED.status,
          confidence=EXCLUDED.confidence`,
        [row.id, row.project_id, row.type, row.title, row.url, row.status, row.confidence, row.created_at],
      );
    }
    for (const row of evidence) {
      await client.query(`INSERT INTO evidence
        (id, project_id, source_id, claim, classification, confidence, sha256, created_at)
        VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
        ON CONFLICT (id) DO UPDATE SET project_id=EXCLUDED.project_id,
          source_id=EXCLUDED.source_id, claim=EXCLUDED.claim,
          classification=EXCLUDED.classification, confidence=EXCLUDED.confidence,
          sha256=EXCLUDED.sha256`,
        [row.id, row.project_id, row.source_id, row.claim, row.classification,
          row.confidence, row.sha256, row.created_at],
      );
    }
    for (const row of approvals) {
      await client.query(`INSERT INTO approvals
        (id, project_id, stage, status, reviewer, note, created_at)
        VALUES ($1,$2,$3,$4,$5,$6,$7)
        ON CONFLICT (id) DO UPDATE SET project_id=EXCLUDED.project_id,
          stage=EXCLUDED.stage, status=EXCLUDED.status, reviewer=EXCLUDED.reviewer,
          note=EXCLUDED.note`,
        [row.id, row.project_id, row.stage, row.status, row.reviewer, row.note, row.created_at],
      );
    }
    for (const row of activity) {
      await client.query(`INSERT INTO activity
        (id, project_id, action, detail, actor, created_at)
        VALUES ($1,$2,$3,$4,$5,$6) ON CONFLICT (id) DO NOTHING`,
        [row.id, row.project_id, row.action, row.detail, row.actor, row.created_at],
      );
    }
  });
  console.log(JSON.stringify({ imported: {
    projects: projects.length, sources: sources.length, evidence: evidence.length,
    approvals: approvals.length, activity: activity.length,
  } }, null, 2));
} finally {
  sqlite.close();
  await closeDb();
}
