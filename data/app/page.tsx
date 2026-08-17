import { requireSession } from "@/lib/auth";
import { getProjectSnapshot, listProjects } from "@/lib/repository";
import { ResearchStudio } from "@/components/research-studio";

export const dynamic = "force-dynamic";

type Props = { searchParams: Promise<{ project?: string }> };

export default async function Home({ searchParams }: Props) {
  const user = await requireSession();
  const projects = await listProjects();
  const { project: requestedId } = await searchParams;
  const selected = projects.find((project) => project.id === requestedId) ?? projects[0];
  const snapshot = selected ? await getProjectSnapshot(selected.id) : null;

  return <ResearchStudio user={user} projects={projects} initialSnapshot={snapshot} />;
}
