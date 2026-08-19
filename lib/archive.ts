import { inflateRawSync } from "node:zlib";

const EOCD_SIGNATURE = 0x06054b50;
const CENTRAL_SIGNATURE = 0x02014b50;
const LOCAL_SIGNATURE = 0x04034b50;

export class ArchiveSecurityError extends Error {}

export type ArchiveEntry = {
  index: number;
  path: string;
  originalName: string;
  compressedSize: number;
  sizeBytes: number;
  crc32: string;
  bytes: Uint8Array;
};

export function archiveLimits() {
  const integer = (name: string, fallback: number) => {
    const value = Number(process.env[name] ?? fallback);
    if (!Number.isSafeInteger(value) || value < 1) throw new Error(`${name} no es válido`);
    return value;
  };
  return {
    maxEntries: integer("ARCHIVE_MAX_ENTRIES", 500),
    maxEntryBytes: integer("ARCHIVE_MAX_ENTRY_BYTES", 100 * 1024 * 1024),
    maxUncompressedBytes: integer("ARCHIVE_MAX_UNCOMPRESSED_BYTES", 250 * 1024 * 1024),
    maxCompressionRatio: integer("ARCHIVE_MAX_COMPRESSION_RATIO", 200),
  };
}

function findEndOfCentralDirectory(buffer: Buffer) {
  const minimum = Math.max(0, buffer.length - 65_557);
  for (let offset = buffer.length - 22; offset >= minimum; offset -= 1) {
    if (buffer.readUInt32LE(offset) === EOCD_SIGNATURE) return offset;
  }
  throw new ArchiveSecurityError("El ZIP no contiene un directorio central válido");
}

function normalizeArchivePath(value: string) {
  const path = value.normalize("NFKC").replace(/\\/g, "/");
  if (!path || path.includes("\0") || path.startsWith("/") || /^[A-Za-z]:\//.test(path)) {
    throw new ArchiveSecurityError("El ZIP contiene una ruta absoluta o vacía");
  }
  const segments = path.split("/").filter(Boolean);
  if (!segments.length || segments.some((segment) => segment === "." || segment === "..")) {
    throw new ArchiveSecurityError("El ZIP contiene una ruta de traversal");
  }
  const normalized = segments.join("/");
  if (normalized.length > 1_024) throw new ArchiveSecurityError("El ZIP contiene una ruta demasiado larga");
  return normalized;
}

let crcTable: Uint32Array | undefined;
function crc32(bytes: Uint8Array) {
  if (!crcTable) {
    crcTable = new Uint32Array(256);
    for (let index = 0; index < 256; index += 1) {
      let value = index;
      for (let bit = 0; bit < 8; bit += 1) value = (value & 1) ? 0xedb88320 ^ (value >>> 1) : value >>> 1;
      crcTable[index] = value >>> 0;
    }
  }
  let value = 0xffffffff;
  for (const byte of bytes) value = crcTable[(value ^ byte) & 0xff] ^ (value >>> 8);
  return (value ^ 0xffffffff) >>> 0;
}

function decodeName(bytes: Buffer) {
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch {
    throw new ArchiveSecurityError("El ZIP contiene un nombre que no es UTF-8 válido");
  }
}

export function extractSecureZip(input: Uint8Array): ArchiveEntry[] {
  const limits = archiveLimits();
  const buffer = Buffer.from(input);
  if (buffer.length < 22) throw new ArchiveSecurityError("El archivo ZIP está truncado");
  const eocd = findEndOfCentralDirectory(buffer);
  const disk = buffer.readUInt16LE(eocd + 4);
  const centralDisk = buffer.readUInt16LE(eocd + 6);
  const entriesOnDisk = buffer.readUInt16LE(eocd + 8);
  const entryCount = buffer.readUInt16LE(eocd + 10);
  const centralSize = buffer.readUInt32LE(eocd + 12);
  const centralOffset = buffer.readUInt32LE(eocd + 16);
  if (disk !== 0 || centralDisk !== 0 || entriesOnDisk !== entryCount) {
    throw new ArchiveSecurityError("No se admiten ZIP divididos en varios volúmenes");
  }
  if (entryCount === 0xffff || centralSize === 0xffffffff || centralOffset === 0xffffffff) {
    throw new ArchiveSecurityError("Zip64 no está permitido en esta versión");
  }
  if (entryCount < 1 || entryCount > limits.maxEntries) {
    throw new ArchiveSecurityError(`El ZIP debe contener entre 1 y ${limits.maxEntries} entradas`);
  }
  if (centralOffset + centralSize > eocd) {
    throw new ArchiveSecurityError("El directorio central del ZIP está fuera de rango");
  }

  const entries: ArchiveEntry[] = [];
  const seenPaths = new Set<string>();
  let offset = centralOffset;
  let totalUncompressed = 0;
  for (let index = 0; index < entryCount; index += 1) {
    if (offset + 46 > buffer.length || buffer.readUInt32LE(offset) !== CENTRAL_SIGNATURE) {
      throw new ArchiveSecurityError("El directorio central del ZIP está corrupto");
    }
    const flags = buffer.readUInt16LE(offset + 8);
    const compression = buffer.readUInt16LE(offset + 10);
    const expectedCrc = buffer.readUInt32LE(offset + 16);
    const compressedSize = buffer.readUInt32LE(offset + 20);
    const sizeBytes = buffer.readUInt32LE(offset + 24);
    const nameLength = buffer.readUInt16LE(offset + 28);
    const extraLength = buffer.readUInt16LE(offset + 30);
    const commentLength = buffer.readUInt16LE(offset + 32);
    const externalAttributes = buffer.readUInt32LE(offset + 38);
    const localOffset = buffer.readUInt32LE(offset + 42);
    const recordEnd = offset + 46 + nameLength + extraLength + commentLength;
    if (recordEnd > buffer.length) throw new ArchiveSecurityError("Una entrada ZIP está truncada");
    if (flags & 0x1) throw new ArchiveSecurityError("Los ZIP cifrados no están permitidos");
    if (![0, 8].includes(compression)) throw new ArchiveSecurityError("El ZIP usa un método de compresión no permitido");
    if ([compressedSize, sizeBytes, localOffset].includes(0xffffffff)) {
      throw new ArchiveSecurityError("Las entradas Zip64 no están permitidas");
    }
    const path = normalizeArchivePath(decodeName(buffer.subarray(offset + 46, offset + 46 + nameLength)));
    const directory = decodeName(buffer.subarray(offset + 46, offset + 46 + nameLength)).replace(/\\/g, "/").endsWith("/");
    const unixType = (externalAttributes >>> 16) & 0xf000;
    if (unixType && ![0x4000, 0x8000].includes(unixType)) {
      throw new ArchiveSecurityError(`El ZIP contiene un enlace o archivo especial: ${path}`);
    }
    offset = recordEnd;
    if (directory) continue;
    const collisionKey = path.toLocaleLowerCase("en-US");
    if (seenPaths.has(collisionKey)) throw new ArchiveSecurityError(`El ZIP repite la ruta ${path}`);
    seenPaths.add(collisionKey);
    if (sizeBytes < 1 || sizeBytes > limits.maxEntryBytes) {
      throw new ArchiveSecurityError(`La entrada ${path} supera el límite permitido o está vacía`);
    }
    totalUncompressed += sizeBytes;
    if (totalUncompressed > limits.maxUncompressedBytes) {
      throw new ArchiveSecurityError("El tamaño descomprimido total del ZIP supera el límite permitido");
    }
    const ratio = sizeBytes / Math.max(1, compressedSize);
    if (ratio > limits.maxCompressionRatio) {
      throw new ArchiveSecurityError(`La entrada ${path} presenta una relación de compresión sospechosa`);
    }
    if (localOffset + 30 > buffer.length || buffer.readUInt32LE(localOffset) !== LOCAL_SIGNATURE) {
      throw new ArchiveSecurityError(`La cabecera local de ${path} no es válida`);
    }
    const localNameLength = buffer.readUInt16LE(localOffset + 26);
    const localExtraLength = buffer.readUInt16LE(localOffset + 28);
    const dataOffset = localOffset + 30 + localNameLength + localExtraLength;
    const dataEnd = dataOffset + compressedSize;
    if (dataEnd > buffer.length) throw new ArchiveSecurityError(`Los datos de ${path} están truncados`);
    const compressed = buffer.subarray(dataOffset, dataEnd);
    const extracted = compression === 0
      ? Buffer.from(compressed)
      : inflateRawSync(compressed, { maxOutputLength: limits.maxEntryBytes });
    if (extracted.byteLength !== sizeBytes) throw new ArchiveSecurityError(`El tamaño declarado de ${path} no coincide`);
    if (crc32(extracted) !== expectedCrc) throw new ArchiveSecurityError(`El CRC-32 de ${path} no coincide`);
    entries.push({
      index: entries.length,
      path,
      originalName: path.split("/").at(-1) ?? path,
      compressedSize,
      sizeBytes,
      crc32: expectedCrc.toString(16).padStart(8, "0"),
      bytes: new Uint8Array(extracted),
    });
  }
  if (!entries.length) throw new ArchiveSecurityError("El ZIP no contiene archivos procesables");
  return entries;
}
