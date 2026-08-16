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
  assert.equal(pkg.scripts.dev, "next dev");
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
