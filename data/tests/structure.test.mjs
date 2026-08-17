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

test("incluye migraciones, transacciones y API funcional", () => {
  for (const path of [
    "lib/db.ts", "lib/migrations.ts", "lib/auth.ts", "lib/repository.ts",
    "app/api/health/route.ts", "app/api/live/route.ts", "app/api/projects/route.ts",
    "app/api/projects/[id]/sources/route.ts", "app/api/projects/[id]/evidence/route.ts",
    "app/api/projects/[id]/approvals/route.ts", "scripts/migrate.ts",
    "scripts/import-sqlite.ts",
  ]) assert.equal(existsSync(new URL(`../${path}`, import.meta.url)), true, path);
  assert.match(text("lib/migrations.ts"), /pg_advisory_xact_lock/);
  assert.match(text("lib/repository.ts"), /withTransaction/);
  assert.match(text("lib/repository.ts"), /sha256/);
  assert.match(text("scripts/import-sqlite.ts"), /ON CONFLICT/);
});

test("mantiene sincronizada la contraseña de demostración", () => {
  const sources = {
    ".env.example": text(".env.example").match(/^ADMIN_PASSWORD=(.+)$/m)?.[1],
    "README.md": text("README.md").match(/^Contraseña:\s*(.+)$/m)?.[1],
    "docker-compose.yml": text("docker-compose.yml").match(/ADMIN_PASSWORD:\s*\$\{ADMIN_PASSWORD:-([^}]+)\}/)?.[1],
    "components/login-form.tsx": text("components/login-form.tsx").match(/name="password"[^>]*defaultValue="([^"]+)"/)?.[1],
  };
  for (const [path, password] of Object.entries(sources)) {
    assert.ok(password, `No se encontró la contraseña de demostración en ${path}`);
  }
  assert.equal(new Set(Object.values(sources)).size, 1, JSON.stringify(sources));
  assert.match(text(".env.example"), /cambie esta contraseña antes de desplegar/i);
});

test("el checklist marca PostgreSQL como implementado", () => {
  assert.match(text("Docs/Topics-Check-list.md"), /\[x\] Persistencia en PostgreSQL/);
});
