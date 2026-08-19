import { generateEvidenceKeyPair } from "../lib/evidence-signing.ts";

const key = generateEvidenceKeyPair();
console.log("Guarda estas variables como secretos persistentes. No publiques la clave privada.\n");
console.log(`EVIDENCE_SIGNING_KEY_ID=${key.keyId}`);
console.log(`EVIDENCE_SIGNING_PRIVATE_KEY_B64=${key.privateKeyBase64}`);
console.log("\nClave pública para verificadores externos:\n");
console.log(key.publicKeyPem);
