import { AccountSecurity } from "@/components/account-security";
import { getSessionToken, requireSession } from "@/lib/auth";
import { listUserSecurityEvents } from "@/lib/security";
import { listUserSessions } from "@/lib/sessions";

export const dynamic = "force-dynamic";

export default async function AccountPage() {
  const user = await requireSession();
  const token = await getSessionToken();
  const [sessions, events] = await Promise.all([
    listUserSessions(user.id, token),
    listUserSecurityEvents(user.id),
  ]);
  return <AccountSecurity user={user} initialSessions={sessions} events={events} />;
}
