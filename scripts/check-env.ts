import { existsSync, readFileSync } from "node:fs";

function fileSetting(path: string, key: string) {
  if (!existsSync(path)) return undefined;
  const match = readFileSync(path, "utf8").match(new RegExp(`^${key}=(.*)$`, "m"));
  if (!match) return undefined;
  const value = match[1].trim();
  if ((value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))) return value.slice(1, -1);
  return value;
}

const envUrl = fileSetting(".env", "DATABASE_URL");
const localUrl = fileSetting(".env.local", "DATABASE_URL");
if (envUrl && localUrl && envUrl !== localUrl) {
  throw new Error("DATABASE_URL es diferente en .env y .env.local. Conserva una sola definición");
}

const fileUrl = localUrl ?? envUrl;
const resolvedUrl = process.env.DATABASE_URL;
if (!resolvedUrl) throw new Error("DATABASE_URL no está configurado");
if (fileUrl && fileUrl !== resolvedUrl) {
  throw new Error(
    "La variable DATABASE_URL de la terminal sobrescribe los archivos. " +
    "En PowerShell ejecuta: Remove-Item Env:DATABASE_URL -ErrorAction SilentlyContinue",
  );
}

const parsed = new URL(resolvedUrl);
const localDatabase = ["localhost", "127.0.0.1", "postgres"].includes(parsed.hostname);
const appUser = fileSetting(".env.local", "POSTGRES_APP_USER") ??
  fileSetting(".env", "POSTGRES_APP_USER") ?? process.env.POSTGRES_APP_USER ?? "norug_app";
const appPassword = fileSetting(".env.local", "POSTGRES_APP_PASSWORD") ??
  fileSetting(".env", "POSTGRES_APP_PASSWORD") ?? process.env.POSTGRES_APP_PASSWORD;

if (localDatabase && parsed.username !== appUser) {
  throw new Error(`DATABASE_URL usa '${parsed.username}', pero debe usar el rol de aplicación '${appUser}'`);
}
if (localDatabase && appPassword && decodeURIComponent(parsed.password) !== appPassword) {
  throw new Error("La contraseña de DATABASE_URL no coincide con POSTGRES_APP_PASSWORD");
}

console.log(`Entorno PostgreSQL coherente: ${parsed.username}@${parsed.hostname}${parsed.pathname}`);
