import { apiUser, unauthorized } from "@/lib/api";
import { mutationOriginError, recordSecurityEvent } from "@/lib/security";
import { revokeUserSession } from "@/lib/sessions";

type Context = { params: Promise<{ id: string }> };

export async function DELETE(request: Request, { params }: Context) {
  const originError = mutationOriginError(request);
  if (originError) return originError;
  const user = await apiUser();
  if (!user) return unauthorized();
  const { id } = await params;
  const revoked = await revokeUserSession(user.id, id);
  await recordSecurityEvent({
    request, eventType: "account.session.revoked", outcome: "success",
    userId: user.id, workspaceId: user.workspaceId, metadata: { sessionId: id, revoked },
  });
  return Response.json({ revoked });
}
