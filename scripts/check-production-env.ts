const required = (name: string) => {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`${name} es obligatorio en producción`);
  return value;
};

const appUrl = new URL(required("APP_URL"));
if (appUrl.protocol !== "https:") throw new Error("APP_URL debe usar HTTPS en producción");

const authSecret = required("AUTH_SECRET");
if (authSecret.length < 32 || /replace|change|development/i.test(authSecret)) {
  throw new Error("AUTH_SECRET debe ser aleatorio, único y tener al menos 32 caracteres");
}

if (process.env.AUTH_COOKIE_SECURE !== "true") {
  throw new Error("AUTH_COOKIE_SECURE debe ser true en producción");
}

const databaseUrl = new URL(required("DATABASE_URL"));
if (["postgres", "norug"].includes(decodeURIComponent(databaseUrl.username).toLowerCase())) {
  throw new Error("DATABASE_URL debe usar un rol de aplicación sin privilegios administrativos");
}
const localDatabase = ["localhost", "127.0.0.1", "postgres"].includes(databaseUrl.hostname);
if (!localDatabase && process.env.DATABASE_SSL !== "true") {
  throw new Error("DATABASE_SSL debe ser true para PostgreSQL remoto");
}

const webhook = new URL(required("IDENTITY_WEBHOOK_URL"));
if (webhook.protocol !== "https:") throw new Error("IDENTITY_WEBHOOK_URL debe usar HTTPS");
const webhookSecret = required("IDENTITY_WEBHOOK_SECRET");
if (webhookSecret.length < 32 || webhookSecret === authSecret) {
  throw new Error("IDENTITY_WEBHOOK_SECRET debe ser independiente y tener al menos 32 caracteres");
}

const s3Endpoint = new URL(required("S3_ENDPOINT"));
const s3PublicEndpoint = new URL(required("S3_PUBLIC_ENDPOINT"));
const s3Local = ["localhost", "127.0.0.1", "minio"].includes(s3Endpoint.hostname);
if (!s3Local && s3Endpoint.protocol !== "https:") throw new Error("S3_ENDPOINT debe usar HTTPS en producción");
if (s3PublicEndpoint.protocol !== "https:") throw new Error("S3_PUBLIC_ENDPOINT debe usar HTTPS en producción");
required("S3_BUCKET");
required("S3_ACCESS_KEY_ID");
const s3Secret = required("S3_SECRET_ACCESS_KEY");
if (s3Secret.length < 16 || /change|replace/i.test(s3Secret)) throw new Error("S3_SECRET_ACCESS_KEY no es segura");

const redisUrl = new URL(required("REDIS_URL"));
const redisLocal = ["localhost", "127.0.0.1", "redis"].includes(redisUrl.hostname);
if (!redisLocal && redisUrl.protocol !== "rediss:") throw new Error("Redis remoto debe usar rediss://");

const clamavHost = required("CLAMAV_HOST");
if (/^[a-z]+:\/\//i.test(clamavHost) || /\s/.test(clamavHost)) {
  throw new Error("CLAMAV_HOST debe ser un hostname o una IP, sin protocolo");
}

const positiveInteger = (name: string, maximum = Number.MAX_SAFE_INTEGER) => {
  const value = Number(required(name));
  if (!Number.isSafeInteger(value) || value < 1 || value > maximum) {
    throw new Error(`${name} debe ser un entero entre 1 y ${maximum}`);
  }
  return value;
};

positiveInteger("CLAMAV_PORT", 65_535);
positiveInteger("CLAMAV_TIMEOUT_MS");
positiveInteger("EXTRACTED_TEXT_MAX_CHARS");

console.log(
  `Entorno de producción válido para ${appUrl.hostname}, PostgreSQL ${databaseUrl.hostname} y ClamAV ${clamavHost}`,
);
