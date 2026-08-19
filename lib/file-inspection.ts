import { fileTypeFromBuffer } from "file-type";

const signatures: Record<string, { extensions: string[]; mimes: string[] }> = {
  pdf: { extensions: ["pdf"], mimes: ["application/pdf"] },
  docx: { extensions: ["docx"], mimes: ["application/vnd.openxmlformats-officedocument.wordprocessingml.document"] },
  mp3: { extensions: ["mp3"], mimes: ["audio/mpeg"] },
  wav: { extensions: ["wav"], mimes: ["audio/wav", "audio/x-wav"] },
  m4a: { extensions: ["m4a", "mp4"], mimes: ["audio/mp4", "audio/x-m4a", "video/mp4"] },
  opus: { extensions: ["opus", "ogg"], mimes: ["audio/ogg", "audio/opus", "application/ogg"] },
  "3gp": { extensions: ["3gp", "3gpp"], mimes: ["video/3gpp", "audio/3gpp"] },
  "3gpp": { extensions: ["3gp", "3gpp"], mimes: ["video/3gpp", "audio/3gpp"] },
  mp4: { extensions: ["mp4", "m4v"], mimes: ["video/mp4"] },
  mpeg: { extensions: ["mpg", "mpeg", "mp3"], mimes: ["video/mpeg", "audio/mpeg"] },
  mpg: { extensions: ["mpg", "mpeg", "mp3"], mimes: ["video/mpeg", "audio/mpeg"] },
  webm: { extensions: ["webm"], mimes: ["video/webm", "audio/webm"] },
  mov: { extensions: ["mov"], mimes: ["video/quicktime"] },
  zip: { extensions: ["zip"], mimes: ["application/zip"] },
};

const textExtensions = new Set(["txt", "md", "csv"]);

export class FileSignatureError extends Error {}

function extensionOf(fileName: string) {
  return fileName.split(".").pop()?.toLowerCase() ?? "";
}

function validateUtf8Text(bytes: Uint8Array) {
  let text: string;
  try {
    text = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch {
    throw new FileSignatureError("El archivo de texto no contiene UTF-8 válido");
  }
  if (text.includes("\0")) throw new FileSignatureError("El archivo declarado como texto contiene bytes binarios");
  const sample = text.slice(0, 8_192);
  const controls = [...sample].filter((character) => {
    const code = character.charCodeAt(0);
    return code < 32 && ![9, 10, 13].includes(code);
  }).length;
  if (sample.length && controls / sample.length > 0.01) {
    throw new FileSignatureError("El archivo declarado como texto contiene demasiados caracteres de control");
  }
}

export async function inspectFileSignature(bytes: Uint8Array, fileName: string) {
  const declaredExtension = extensionOf(fileName);
  if (textExtensions.has(declaredExtension)) {
    validateUtf8Text(bytes);
    return { detectedExtension: declaredExtension, detectedMime: "text/plain", binary: false };
  }
  const policy = signatures[declaredExtension];
  if (!policy) throw new FileSignatureError(`No existe política de firma para .${declaredExtension || "desconocido"}`);
  const detected = await fileTypeFromBuffer(bytes);
  if (!detected) throw new FileSignatureError("No se pudo reconocer la firma binaria del archivo");
  const detectedMime = detected.mime.split(";", 1)[0].trim().toLowerCase();
  const extensionAllowed = policy.extensions.includes(detected.ext);
  const mimeAllowed = policy.mimes.includes(detectedMime);
  if (!extensionAllowed && !mimeAllowed) {
    throw new FileSignatureError(
      `La firma real ${detectedMime} (.${detected.ext}) no coincide con .${declaredExtension}`,
    );
  }
  return { detectedExtension: detected.ext, detectedMime, binary: true };
}

export function isExtractableDocument(fileName: string) {
  return new Set(["pdf", "docx", "txt", "md", "csv"]).has(extensionOf(fileName));
}
