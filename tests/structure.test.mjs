import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import test from "node:test";

const text = (path) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");

test("usa Next.js puro sin Vite, Vinext ni Wrangler", () => {
  const pkg = JSON.parse(text("package.json"));
  const allPackages = { ...pkg.dependencies, ...pkg.devDependencies };
  for (const forbidden of ["vite", "vinext", "wrangler", "@cloudflare/vite-plugin"]) {
    assert.equal(allPackages[forbidden], undefined);
  }
  assert.match(pkg.scripts.dev, /^next dev(?:\s|$)/);
  assert.equal(pkg.scripts.build, "next build");
  assert.match(pkg.scripts["test:db"], /\.env\.local/);
  assert.equal(pkg.scripts["pretest:db"], "npm run db:env-check");
  const tsconfig = JSON.parse(text("tsconfig.json"));
  assert.ok(tsconfig.exclude.includes("data"), "data/ no debe entrar en el type-check de Next.js");
});

test("utiliza PostgreSQL y no conserva el runtime SQLite", () => {
  const pkg = JSON.parse(text("package.json"));
  assert.equal(pkg.dependencies.pg, "8.23.0");
  assert.match(text("lib/db.ts"), /from "pg"/);
  assert.match(text("lib/db.ts"), /DATABASE_URL/);
  assert.doesNotMatch(text("lib/db.ts"), /node:sqlite/);
  assert.match(text("docker-compose.yml"), /postgres:18-alpine/);
  assert.match(text(".env.example"), /^DATABASE_URL=/m);
});

test("incluye migraciones, transacciones multi-tenant y API funcional", () => {
  for (const path of [
    "lib/db.ts", "lib/migrations.ts", "lib/auth.ts", "lib/repository.ts",
    "app/api/health/route.ts", "app/api/live/route.ts", "app/api/projects/route.ts",
    "app/api/projects/[id]/sources/route.ts", "app/api/projects/[id]/evidence/route.ts",
    "app/api/projects/[id]/approvals/route.ts", "scripts/migrate.ts",
    "scripts/import-sqlite.ts",
  ]) assert.equal(existsSync(new URL(`../${path}`, import.meta.url)), true, path);
  assert.match(text("lib/migrations.ts"), /pg_advisory_xact_lock/);
  assert.match(text("lib/repository.ts"), /withTenantTransaction/);
  assert.match(text("lib/repository.ts"), /sha256/);
  assert.match(text("scripts/import-sqlite.ts"), /ON CONFLICT/);
});

test("implementa usuarios, workspaces, roles y RLS", () => {
  const migration = text("lib/migrations.ts");
  for (const table of ["users", "workspaces", "workspace_members", "workspace_invitations"]) {
    assert.match(migration, new RegExp(`CREATE TABLE IF NOT EXISTS ${table}`));
  }
  assert.match(migration, /ENABLE ROW LEVEL SECURITY/);
  assert.match(migration, /FORCE ROW LEVEL SECURITY/);
  assert.match(migration, /current_setting\('app\.tenant_id'/);
  assert.match(text("lib/permissions.ts"), /owner/);
  assert.match(text("lib/permissions.ts"), /viewer/);
  assert.doesNotMatch(text("lib/auth.ts"), /ADMIN_PASSWORD/);
  assert.match(text("docker/postgres/init-app-user.sh"), /NOBYPASSRLS/);
  assert.match(text("docker/postgres/init-app-user.sh"), /NOSUPERUSER/);
  assert.match(text("docker/postgres/init-app-user.sh"), /ALTER TABLE %I\.%I OWNER TO %I/);
});

test("completa identidad, recuperación y ciclo de invitaciones", () => {
  for (const path of [
    "lib/passwords.ts", "lib/identity.ts", "app/team/page.tsx",
    "app/forgot-password/page.tsx", "app/reset-password/page.tsx",
    "app/invitations/accept/page.tsx", "app/api/auth/password/forgot/route.ts",
    "app/api/auth/password/reset/route.ts", "app/api/invitations/accept/route.ts",
    "app/api/workspaces/members/[userId]/route.ts",
    "app/api/workspaces/invitations/[id]/route.ts",
  ]) assert.equal(existsSync(new URL(`../${path}`, import.meta.url)), true, path);
  assert.match(text("lib/migrations.ts"), /password_reset_tokens/);
  assert.match(text("lib/migrations.ts"), /uq_pending_workspace_invitation/);
  assert.match(text("lib/passwords.ts"), /scryptSync/);
  assert.match(text("lib/identity.ts"), /createHmac/);
  assert.match(text("lib/identity.ts"), /x-norug-signature/);
  assert.match(text("lib/auth.ts"), /switchWorkspace\(session\.id, session\.workspaceId\)/);
  assert.match(text("lib/auth.ts"), /import \{[^}]*switchWorkspace[^}]*\} from "@\/lib\/workspaces"/s);
  assert.match(text(".env.example"), /^IDENTITY_WEBHOOK_URL=/m);
  assert.match(text("scripts/check-env.ts"), /DATABASE_URL es diferente en \.env y \.env\.local/);
});

test("el checklist marca PostgreSQL como implementado", () => {
  assert.match(text("Docs/Topics-Check-list.md"), /\[x\] Persistencia en PostgreSQL/);
});

test("incluye el roadmap versionado", () => {
  assert.match(text("Docs/ROADMAP.md"), /v0\.5 — Base SaaS segura/);
  assert.match(text("Docs/ROADMAP.md"), /v0\.5\.1 Identity & Teams/);
  assert.match(text("Docs/ROADMAP.md"), /v1\.0 — SaaS operable y comercial/);
});
