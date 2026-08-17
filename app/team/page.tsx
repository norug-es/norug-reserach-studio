import { redirect } from "next/navigation";
import { requireSession } from "@/lib/auth";
import { hasPermission } from "@/lib/permissions";
import { listWorkspaceInvitations, listWorkspaceMembers } from "@/lib/workspaces";
import { TeamManager } from "@/components/team-manager";

export const dynamic = "force-dynamic";

export default async function TeamPage() {
  const user = await requireSession();
  if (!hasPermission(user, "workspace:manage")) redirect("/");
  const [members, invitations] = await Promise.all([
    listWorkspaceMembers(user.id, user.workspaceId),
    listWorkspaceInvitations(user.id, user.workspaceId),
  ]);
  return <TeamManager user={user} initialMembers={members} initialInvitations={invitations} />;
}
