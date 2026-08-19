const uploadTypes: Record<string, {
  contentType: string; aliases?: string[]; category: "document" | "audio" | "video" | "archive";
}> = {
  ".pdf": { contentType: "application/pdf", category: "document" },
  ".docx": { contentType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document", category: "document" },
  ".txt": { contentType: "text/plain", category: "document" },
  ".md": { contentType: "text/markdown", aliases: ["text/plain"], category: "document" },
  ".csv": { contentType: "text/csv", aliases: ["application/vnd.ms-excel"], category: "document" },
  ".mp3": { contentType: "audio/mpeg", aliases: ["audio/mp3"], category: "audio" },
  ".wav": { contentType: "audio/wav", aliases: ["audio/x-wav"], category: "audio" },
  ".m4a": { contentType: "audio/mp4", aliases: ["audio/x-m4a"], category: "audio" },
  ".opus": { contentType: "audio/ogg", aliases: ["audio/opus", "application/ogg"], category: "audio" },
  ".3gp": { contentType: "audio/3gpp", aliases: ["video/3gpp", "audio/3gp", "video/3gp"], category: "audio" },
  ".3gpp": { contentType: "audio/3gpp", aliases: ["video/3gpp", "audio/3gp", "video/3gp"], category: "audio" },
  ".mp4": { contentType: "video/mp4", category: "video" },
  ".mpeg": { contentType: "video/mpeg", aliases: ["video/mpg", "audio/mpeg"], category: "video" },
  ".mpg": { contentType: "video/mpeg", aliases: ["video/mpg", "audio/mpeg"], category: "video" },
  ".webm": { contentType: "video/webm", category: "video" },
  ".mov": { contentType: "video/quicktime", category: "video" },
  ".zip": { contentType: "application/zip", aliases: ["application/x-zip-compressed"], category: "archive" },
};

export class UploadPolicyError extends Error {}

export function maximumUploadBytes() {
  const configured = Number(process.env.UPLOAD_MAX_BYTES ?? 50 * 1024 * 1024);
  if (!Number.isSafeInteger(configured) || configured < 1) throw new Error("UPLOAD_MAX_BYTES no es válido");
  return configured;
}

export function maximumBatchFiles() {
  const configured = Number(process.env.UPLOAD_BATCH_MAX_FILES ?? 100);
  if (!Number.isSafeInteger(configured) || configured < 1 || configured > 1_000) {
    throw new Error("UPLOAD_BATCH_MAX_FILES no es válido");
  }
  return configured;
}

export function maximumBatchBytes() {
  const configured = Number(process.env.UPLOAD_BATCH_MAX_BYTES ?? 500 * 1024 * 1024);
  if (!Number.isSafeInteger(configured) || configured < 1) {
    throw new Error("UPLOAD_BATCH_MAX_BYTES no es válido");
  }
  return configured;
}

export function sanitizeUploadName(name: string) {
  const normalized = name.normalize("NFKC").replace(/[\\/\0-\x1f\x7f]/g, "-").trim();
  const safe = normalized.replace(/[^\p{L}\p{N}._ -]/gu, "-").replace(/\s+/g, " ");
  return (safe || "archivo").slice(0, 180);
}

export function normalizeRelativePath(path: string, fallbackName: string) {
  const normalized = (path || fallbackName).normalize("NFKC").replace(/\\/g, "/");
  if (normalized.startsWith("/") || /^[A-Za-z]:\//.test(normalized)) {
    throw new UploadPolicyError("La ruta relativa del archivo no es válida");
  }
  const segments = normalized.split("/").filter(Boolean);
  if (!segments.length || segments.some((segment) => segment === "." || segment === "..")) {
    throw new UploadPolicyError("La ruta relativa contiene segmentos no permitidos");
  }
  const safe = segments.map(sanitizeUploadName).join("/");
  if (safe.length > 1_024) throw new UploadPolicyError("La ruta relativa es demasiado larga");
  return safe;
}

export function validateUpload(name: string, contentType: string, size: number) {
  if (!name || name.length > 255) throw new UploadPolicyError("El nombre del archivo no es válido");
  if (!Number.isSafeInteger(size) || size < 1) throw new UploadPolicyError("El archivo está vacío");
  if (size > maximumUploadBytes()) {
    throw new UploadPolicyError(`El archivo supera el límite de ${Math.round(maximumUploadBytes() / 1024 / 1024)} MB`);
  }
  const extension = name.includes(".") ? `.${name.split(".").pop()?.toLowerCase()}` : "";
  const policy = uploadTypes[extension];
  if (!policy) throw new UploadPolicyError("Formato no permitido. Usa PDF, DOCX, TXT, MD, CSV, MP3, WAV, M4A, OPUS, 3GP, 3GPP, MP4, MPEG, MPG, WEBM, MOV o ZIP");
  const supplied = contentType.split(";")[0]?.trim().toLowerCase();
  if (supplied && supplied !== "application/octet-stream" && supplied !== policy.contentType &&
      !policy.aliases?.includes(supplied)) {
    throw new UploadPolicyError("El tipo declarado no coincide con la extensión del archivo");
  }
  const compoundMp3 = /\.mp3\.(?:mpeg|mpg)$/i.test(name);
  const mpegAudio = [".mpeg", ".mpg"].includes(extension) &&
    (compoundMp3 || supplied === "audio/mpeg");
  return { contentType: mpegAudio ? "audio/mpeg" : policy.contentType,
    category: mpegAudio ? "audio" : policy.category,
    originalName: sanitizeUploadName(name), extension };
}
