import { cookies } from "next/headers";
import { getSession, getSessionToken, SESSION_COOKIE } from "@/lib/auth";
import { revokeSessionToken } from "@/lib/sessions";
import { mutationOriginError, recordSecurityEvent } from "@/lib/security";

export async function POST(request: Request) {
  const originError = mutationOriginError(request);
  if (originError) return originError;
  const [token, user] = await Promise.all([getSessionToken(), getSession()]);
  await revokeSessionToken(token, "logout");
  const store = await cookies();
  store.delete(SESSION_COOKIE);
  await recordSecurityEvent({
    request, eventType: "auth.logout", outcome: "success",
    userId: user?.id, workspaceId: user?.workspaceId,
  });
  return Response.json({ ok: true });
}
