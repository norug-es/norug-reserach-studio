import assert from "node:assert/strict";
import test from "node:test";
import { hashPassword, passwordPolicyError, verifyPassword } from "../lib/passwords.ts";

test("la política exige longitud, mayúsculas, minúsculas y números", () => {
  assert.match(passwordPolicyError("Corta1") ?? "", /12 caracteres/);
  assert.match(passwordPolicyError("sinmayusculas123") ?? "", /mayúsculas/);
  assert.equal(passwordPolicyError("UnaClaveSegura123"), null);
});

test("scrypt genera sales únicas y verifica sin almacenar texto plano", () => {
  const first = hashPassword("UnaClaveSegura123");
  const second = hashPassword("UnaClaveSegura123");
  assert.notEqual(first, second);
  assert.ok(first.startsWith("scrypt$"));
  assert.equal(first.includes("UnaClaveSegura123"), false);
  assert.equal(verifyPassword("UnaClaveSegura123", first), true);
  assert.equal(verifyPassword("ClaveIncorrecta123", first), false);
  assert.equal(verifyPassword("UnaClaveSegura123", "formato-invalido"), false);
});
