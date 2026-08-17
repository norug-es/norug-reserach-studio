import assert from "node:assert/strict";
import test from "node:test";
import { mutationOriginError, rateLimitKey } from "../lib/security.ts";

test("acepta el mismo origen y rechaza orígenes cruzados", () => {
  process.env.APP_URL = "https://studio.example.com";
  const same = new Request("https://studio.example.com/api/projects", {
    method: "POST", headers: { origin: "https://studio.example.com" },
  });
  const foreign = new Request("https://studio.example.com/api/projects", {
    method: "POST", headers: { origin: "https://attacker.example" },
  });
  assert.equal(mutationOriginError(same), null);
  assert.equal(mutationOriginError(foreign)?.status, 403);
});

test("las claves de rate limit son privadas y deterministas", () => {
  process.env.AUTH_SECRET = "unit-test-secret-with-at-least-32-characters";
  const request = new Request("https://studio.example.com/api/auth/login", {
    headers: { "x-forwarded-for": "203.0.113.15" },
  });
  const first = rateLimitKey(request, "USER@example.com");
  assert.equal(first, rateLimitKey(request, "user@example.com"));
  assert.notEqual(first, rateLimitKey(request, "other@example.com"));
  assert.equal(first.length, 64);
  assert.equal(first.includes("203.0.113.15"), false);
});
