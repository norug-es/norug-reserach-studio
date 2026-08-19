import {
  CreateBucketCommand,
  DeleteObjectCommand,
  GetObjectCommand,
  HeadBucketCommand,
  PutObjectCommand,
  S3Client,
} from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { createHash } from "node:crypto";

type StorageConfig = ReturnType<typeof storageConfig>;
let client: S3Client | undefined;
let downloadClient: S3Client | undefined;
let bucketPromise: Promise<void> | undefined;

export function storageConfig() {
  const required = (name: string) => {
    const value = process.env[name]?.trim();
    if (!value) throw new Error(`${name} es obligatorio para la ingesta`);
    return value;
  };
  return {
    endpoint: required("S3_ENDPOINT"),
    publicEndpoint: process.env.S3_PUBLIC_ENDPOINT?.trim() || required("S3_ENDPOINT"),
    region: process.env.S3_REGION?.trim() || "us-east-1",
    bucket: required("S3_BUCKET"),
    accessKeyId: required("S3_ACCESS_KEY_ID"),
    secretAccessKey: required("S3_SECRET_ACCESS_KEY"),
    forcePathStyle: process.env.S3_FORCE_PATH_STYLE !== "false",
    autoCreate: process.env.S3_AUTO_CREATE_BUCKET === "true",
  };
}

function s3(config: StorageConfig = storageConfig()) {
  if (!client) client = new S3Client({
    endpoint: config.endpoint,
    region: config.region,
    forcePathStyle: config.forcePathStyle,
    credentials: { accessKeyId: config.accessKeyId, secretAccessKey: config.secretAccessKey },
  });
  return client;
}

function publicS3(config: StorageConfig = storageConfig()) {
  if (!downloadClient) downloadClient = new S3Client({
    endpoint: config.publicEndpoint,
    region: config.region,
    forcePathStyle: config.forcePathStyle,
    credentials: { accessKeyId: config.accessKeyId, secretAccessKey: config.secretAccessKey },
  });
  return downloadClient;
}

export async function ensureStorageBucket() {
  if (!bucketPromise) bucketPromise = (async () => {
    const config = storageConfig();
    try {
      await s3(config).send(new HeadBucketCommand({ Bucket: config.bucket }));
    } catch (error) {
      if (!config.autoCreate) throw error;
      await s3(config).send(new CreateBucketCommand({ Bucket: config.bucket }));
    }
  })().catch((error) => {
    bucketPromise = undefined;
    throw error;
  });
  await bucketPromise;
}

export async function storageHealth() {
  const config = storageConfig();
  const startedAt = performance.now();
  await s3(config).send(new HeadBucketCommand({ Bucket: config.bucket }));
  return { bucket: config.bucket, endpoint: new URL(config.endpoint).hostname,
    latencyMs: Math.round(performance.now() - startedAt) };
}

export async function putStoredObject(input: {
  key: string; body: Uint8Array; contentType: string; sha256: string;
  tenantId: string; projectId: string;
}) {
  await ensureStorageBucket();
  const config = storageConfig();
  await s3(config).send(new PutObjectCommand({
    Bucket: config.bucket,
    Key: input.key,
    Body: input.body,
    ContentType: input.contentType,
    Metadata: { sha256: input.sha256, tenant: input.tenantId, project: input.projectId },
  }));
  return config.bucket;
}

export async function deleteStoredObject(bucket: string, key: string) {
  await s3().send(new DeleteObjectCommand({ Bucket: bucket, Key: key }));
}

export async function readVerifiedStoredObject(input: { bucket: string; key: string; sha256: string; sizeBytes: number }) {
  const response = await s3().send(new GetObjectCommand({ Bucket: input.bucket, Key: input.key }));
  if (!response.Body) throw new Error("El objeto almacenado no contiene datos");
  const bytes = await response.Body.transformToByteArray();
  const sha256 = createHash("sha256").update(bytes).digest("hex");
  if (bytes.byteLength !== input.sizeBytes) throw new Error("El tamaño almacenado no coincide con el registro");
  if (sha256 !== input.sha256) throw new Error("La verificación SHA-256 del objeto ha fallado");
  return { bytes, sizeBytes: bytes.byteLength, sha256, etag: response.ETag ?? null };
}

export async function verifyStoredObject(input: { bucket: string; key: string; sha256: string; sizeBytes: number }) {
  const verified = await readVerifiedStoredObject(input);
  return { sizeBytes: verified.sizeBytes, sha256: verified.sha256, etag: verified.etag };
}

export async function signedDownloadUrl(bucket: string, key: string, fileName: string) {
  return getSignedUrl(publicS3(), new GetObjectCommand({
    Bucket: bucket,
    Key: key,
    ResponseContentDisposition: `attachment; filename*=UTF-8''${encodeURIComponent(fileName)}`,
  }), { expiresIn: 300 });
}

export async function streamStoredObject(input: {
  bucket: string;
  key: string;
  range?: string;
  fallbackContentType: string;
}) {
  const response = await s3().send(new GetObjectCommand({
    Bucket: input.bucket,
    Key: input.key,
    Range: input.range,
  }));
  if (!response.Body) throw new Error("El objeto almacenado no contiene un stream");
  return {
    body: response.Body.transformToWebStream(),
    contentType: response.ContentType || input.fallbackContentType,
    contentLength: response.ContentLength,
    contentRange: response.ContentRange,
    etag: response.ETag,
    lastModified: response.LastModified,
  };
}
