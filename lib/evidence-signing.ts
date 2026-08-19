import {
  createHash,
  createPrivateKey,
  createPublicKey,
  generateKeyPairSync,
  sign,
  verify,
} from "node:crypto";

export function canonicalJson(value: unknown): string {
  if (value === null) return "null";
  if (typeof value !== "object") {
    const encoded = JSON.stringify(value);
    if (encoded === undefined) throw new Error("El manifiesto contiene un valor no serializable");
    return encoded;
  }
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  const entries = Object.entries(value as Record<string, unknown>)
    .filter(([, item]) => item !== undefined)
    .sort(([left], [right]) => left.localeCompare(right));
  return `{${entries.map(([key, item]) => `${JSON.stringify(key)}:${canonicalJson(item)}`).join(",")}}`;
}

function privateKeyPem() {
  const encoded = process.env.EVIDENCE_SIGNING_PRIVATE_KEY_B64?.trim();
  if (!encoded) throw new Error("EVIDENCE_SIGNING_PRIVATE_KEY_B64 es obligatorio para firmar paquetes ZIP");
  const pem = Buffer.from(encoded, "base64").toString("utf8");
  if (!pem.includes("PRIVATE KEY")) throw new Error("La clave privada de evidencia no contiene PEM válido");
  return pem;
}

export function assertEvidenceSigningReady() {
  const key = createPrivateKey(privateKeyPem());
  if (key.asymmetricKeyType !== "ed25519") throw new Error("La clave de evidencia debe ser Ed25519");
  return key;
}

export function signEvidenceManifest(manifest: unknown) {
  const canonical = canonicalJson(manifest);
  const privateKey = assertEvidenceSigningReady();
  const publicKey = createPublicKey(privateKey);
  const publicKeyPem = publicKey.export({ type: "spki", format: "pem" }).toString();
  const publicDer = publicKey.export({ type: "spki", format: "der" });
  return {
    canonical,
    manifestSha256: createHash("sha256").update(canonical).digest("hex"),
    signatureBase64: sign(null, Buffer.from(canonical), privateKey).toString("base64"),
    publicKeyPem,
    keyId: process.env.EVIDENCE_SIGNING_KEY_ID?.trim() ||
      `ed25519:${createHash("sha256").update(publicDer).digest("hex").slice(0, 24)}`,
  };
}

export function verifyEvidenceManifest(manifest: unknown, signatureBase64: string, publicKeyPem: string) {
  try {
    return verify(null, Buffer.from(canonicalJson(manifest)), createPublicKey(publicKeyPem),
      Buffer.from(signatureBase64, "base64"));
  } catch {
    return false;
  }
}

export function generateEvidenceKeyPair() {
  const pair = generateKeyPairSync("ed25519");
  const privatePem = pair.privateKey.export({ type: "pkcs8", format: "pem" }).toString();
  const publicPem = pair.publicKey.export({ type: "spki", format: "pem" }).toString();
  const publicDer = pair.publicKey.export({ type: "spki", format: "der" });
  return {
    privateKeyBase64: Buffer.from(privatePem).toString("base64"),
    publicKeyPem: publicPem,
    keyId: `ed25519:${createHash("sha256").update(publicDer).digest("hex").slice(0, 24)}`,
  };
}
