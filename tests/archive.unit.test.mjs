import assert from "node:assert/strict";
import test from "node:test";
import { ArchiveSecurityError, extractSecureZip } from "../lib/archive.ts";
import { generateEvidenceKeyPair, signEvidenceManifest, verifyEvidenceManifest } from "../lib/evidence-signing.ts";

function crc32(bytes) {
  let value = 0xffffffff;
  for (const byte of bytes) {
    value ^= byte;
    for (let bit = 0; bit < 8; bit += 1) value = (value & 1) ? 0xedb88320 ^ (value >>> 1) : value >>> 1;
  }
  return (value ^ 0xffffffff) >>> 0;
}

function storedZip(path, content) {
  const name = Buffer.from(path);
  const bytes = Buffer.from(content);
  const crc = crc32(bytes);
  const local = Buffer.alloc(30);
  local.writeUInt32LE(0x04034b50, 0);
  local.writeUInt16LE(20, 4);
  local.writeUInt16LE(0x800, 6);
  local.writeUInt32LE(crc, 14);
  local.writeUInt32LE(bytes.length, 18);
  local.writeUInt32LE(bytes.length, 22);
  local.writeUInt16LE(name.length, 26);
  const central = Buffer.alloc(46);
  central.writeUInt32LE(0x02014b50, 0);
  central.writeUInt16LE(20, 4);
  central.writeUInt16LE(20, 6);
  central.writeUInt16LE(0x800, 8);
  central.writeUInt32LE(crc, 16);
  central.writeUInt32LE(bytes.length, 20);
  central.writeUInt32LE(bytes.length, 24);
  central.writeUInt16LE(name.length, 28);
  const centralOffset = local.length + name.length + bytes.length;
  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0);
  eocd.writeUInt16LE(1, 8);
  eocd.writeUInt16LE(1, 10);
  eocd.writeUInt32LE(central.length + name.length, 12);
  eocd.writeUInt32LE(centralOffset, 16);
  return Buffer.concat([local, name, bytes, central, name, eocd]);
}

test("extrae ZIP seguro conservando ruta, bytes y CRC", () => {
  const entries = extractSecureZip(storedZip("carpeta/informe.txt", "evidencia verificable"));
  assert.equal(entries.length, 1);
  assert.equal(entries[0].path, "carpeta/informe.txt");
  assert.equal(new TextDecoder().decode(entries[0].bytes), "evidencia verificable");
  assert.match(entries[0].crc32, /^[a-f0-9]{8}$/);
});

test("bloquea Zip Slip antes de materializar entradas", () => {
  assert.throws(() => extractSecureZip(storedZip("../escape.txt", "no")), ArchiveSecurityError);
});

test("firma y verifica manifiestos canónicos mediante Ed25519", () => {
  const key = generateEvidenceKeyPair();
  process.env.EVIDENCE_SIGNING_PRIVATE_KEY_B64 = key.privateKeyBase64;
  process.env.EVIDENCE_SIGNING_KEY_ID = key.keyId;
  const manifest = { manifestVersion: "norug.evidence-bundle.v1", entries: [{ path: "a.txt", sha256: "a".repeat(64) }] };
  const signed = signEvidenceManifest(manifest);
  assert.equal(signed.keyId, key.keyId);
  assert.equal(verifyEvidenceManifest(manifest, signed.signatureBase64, signed.publicKeyPem), true);
  assert.equal(verifyEvidenceManifest({ ...manifest, entries: [] }, signed.signatureBase64, signed.publicKeyPem), false);
});
