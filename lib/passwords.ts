import { randomBytes, scryptSync, timingSafeEqual } from "node:crypto";

export function passwordPolicyError(password: string) {
  if (password.length < 12) return "La contraseña debe tener al menos 12 caracteres";
  if (!/[a-z]/.test(password) || !/[A-Z]/.test(password) || !/\d/.test(password)) {
    return "La contraseña debe incluir mayúsculas, minúsculas y números";
  }
  return null;
}

export function hashPassword(password: string) {
  const salt = randomBytes(18).toString("base64url");
  const hash = scryptSync(password, salt, 64).toString("base64url");
  return `scrypt$${salt}$${hash}`;
}

export function verifyPassword(password: string, encoded: string) {
  const [algorithm, salt, hash] = encoded.split("$");
  if (algorithm !== "scrypt" || !salt || !hash) return false;
  const expected = Buffer.from(hash, "base64url");
  const actual = scryptSync(password, salt, expected.length);
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}
