import { apiUser, unauthorized } from "@/lib/api";
import { getSessionToken } from "@/lib/auth";
import { mutationOriginError, recordSecurityEvent } from "@/lib/security";
import { revokeOtherUserSessions } from "@/lib/sessions";

export async function DELETE(request: Request) {
  const originError = mutationOriginError(request);
  if (originError) return originError;
  const user = await apiUser();
  const token = await getSessionToken();
  if (!user || !token) return unauthorized();
  const revoked = await revokeOtherUserSessions(user.id, token);
  await recordSecurityEvent({
    request, eventType: "account.sessions.revoke_others", outcome: "success",
    userId: user.id, workspaceId: user.workspaceId, metadata: { revoked },
  });
  return Response.json({ revoked });
}
