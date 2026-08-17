import { requireSession } from "@/lib/auth";
import { tenantContext } from "@/lib/api";
import { getProjectSnapshot, listProjects } from "@/lib/repository";
import { listUserWorkspaces } from "@/lib/workspaces";
import { ResearchStudio } from "@/components/research-studio";

export const dynamic = "force-dynamic";

type Props = { searchParams: Promise<{ project?: string }> };

export default async function Home({ searchParams }: Props) {
  const user = await requireSession();
  const context = tenantContext(user);
  const [projects, workspaces] = await Promise.all([
    listProjects(context),
    listUserWorkspaces(user.id),
  ]);
  const { project: requestedId } = await searchParams;
  const selected = projects.find((project) => project.id === requestedId) ?? projects[0];
  const snapshot = selected ? await getProjectSnapshot(context, selected.id) : null;

  return <ResearchStudio user={user} workspaces={workspaces} projects={projects} initialSnapshot={snapshot} />;
}
