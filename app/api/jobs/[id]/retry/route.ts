import { apiUser, authorized, forbidden, tenantContext, unauthorized } from "@/lib/api";
import { retryProcessingJob } from "@/lib/ingestion";
import { mutationOriginError, recordSecurityEvent } from "@/lib/security";

type Context = { params: Promise<{ id: string }> };

export async function POST(request: Request, { params }: Context) {
  const originError = mutationOriginError(request);
  if (originError) return originError;
  const user = await apiUser();
  if (!user) return unauthorized();
  if (!authorized(user, "job:retry")) return forbidden();
  const { id } = await params;
  const job = await retryProcessingJob(tenantContext(user), id, user.id);
  if (!job) return Response.json({ error: "El trabajo no existe o no admite reintento" }, { status: 409 });
  await recordSecurityEvent({
    request, eventType: "job.retry", outcome: "success", userId: user.id,
    workspaceId: user.workspaceId, metadata: { jobId: id },
  });
  return Response.json({ job });
}
