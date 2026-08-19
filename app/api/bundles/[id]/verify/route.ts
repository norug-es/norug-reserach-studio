import { createHash } from "node:crypto";
import { apiUser, tenantContext, unauthorized } from "@/lib/api";
import { canonicalJson, verifyEvidenceManifest } from "@/lib/evidence-signing";
import { getEvidenceBundleForVerification } from "@/lib/ingestion";
import { readVerifiedStoredObject } from "@/lib/storage";

export const runtime = "nodejs";
type Context = { params: Promise<{ id: string }> };

export async function GET(_request: Request, { params }: Context) {
  const user = await apiUser();
  if (!user) return unauthorized();
  const { id } = await params;
  const bundle = await getEvidenceBundleForVerification(tenantContext(user), id);
  if (!bundle) return Response.json({ error: "Paquete no encontrado" }, { status: 404 });
  const computedManifestSha256 = createHash("sha256").update(canonicalJson(bundle.manifest)).digest("hex");
  const manifestHashMatches = computedManifestSha256 === bundle.manifestSha256;
  const signatureValid = Boolean(bundle.signatureBase64 && bundle.publicKeyPem && manifestHashMatches &&
    verifyEvidenceManifest(bundle.manifest, bundle.signatureBase64, bundle.publicKeyPem));
  let archiveHashMatches = false;
  try {
    await readVerifiedStoredObject({
      bucket: bundle.bucket, key: bundle.objectKey,
      sha256: bundle.archiveSha256, sizeBytes: bundle.sizeBytes,
    });
    archiveHashMatches = true;
  } catch {
    archiveHashMatches = false;
  }
  return Response.json({
    id: bundle.id,
    archiveObjectId: bundle.archiveObjectId,
    archiveSha256: bundle.archiveSha256,
    manifest: bundle.manifest,
    manifestSha256: bundle.manifestSha256,
    computedManifestSha256,
    signatureAlgorithm: bundle.signatureAlgorithm,
    signatureBase64: bundle.signatureBase64,
    publicKeyPem: bundle.publicKeyPem,
    keyId: bundle.keyId,
    status: bundle.status,
    manifestHashMatches,
    signatureValid,
    archiveHashMatches,
    verified: bundle.status === "signed" && manifestHashMatches && signatureValid && archiveHashMatches,
    entryCount: bundle.entryCount,
    rejectedCount: bundle.rejectedCount,
    signedAt: bundle.signedAt,
  }, { headers: { "Cache-Control": "private, no-store" } });
}
