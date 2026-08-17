import assert from "node:assert/strict";
import { readFileSync, existsSync } from "node:fs";
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

test("incluye persistencia, autenticación y API funcional", () => {
  for (const path of [
    "lib/db.ts", "lib/auth.ts", "lib/repository.ts", "app/api/health/route.ts",
    "app/api/projects/route.ts", "app/api/projects/[id]/sources/route.ts",
    "app/api/projects/[id]/evidence/route.ts", "app/api/projects/[id]/approvals/route.ts",
  ]) assert.equal(existsSync(new URL(`../${path}`, import.meta.url)), true, path);
});

test("la base utiliza SQLite nativo y hashes SHA-256", () => {
  assert.match(text("lib/db.ts"), /node:sqlite/);
  assert.match(text("lib/repository.ts"), /sha256/);
});

test("convierte las filas SQLite en objetos planos para React", () => {
  const repository = text("lib/repository.ts");
  assert.match(repository, /function plainRow/);
  assert.match(repository, /return rows\.map\(plainRow\)/);
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
  assert.match(text(".env.example"), /cambia esta contraseña antes de desplegar en producción/i);
});
