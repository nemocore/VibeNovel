import { notFound } from "next/navigation";
import {
  getAutoRun,
  listAutoEvents,
  listAutoRunChapters,
} from "@/lib/storage/auto-runs";
import { getAutoSkillsSnapshot, type AutoSkillsSnapshotPayload } from "@/lib/auto/skills-state";
import { isAppError } from "@/lib/errors";
import { AutoRunView } from "@/components/auto/auto-run-view";

export const dynamic = "force-dynamic";

export default async function AutoRunPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  let data: {
    run: Awaited<ReturnType<typeof getAutoRun>>;
    chapters: Awaited<ReturnType<typeof listAutoRunChapters>>;
    events: Awaited<ReturnType<typeof listAutoEvents>>;
    skills: AutoSkillsSnapshotPayload;
  };
  try {
    const [run, chapters, events] = await Promise.all([
      getAutoRun(id),
      listAutoRunChapters(id),
      listAutoEvents(id, 0, 200),
    ]);
    data = { run, chapters, events, skills: await getAutoSkillsSnapshot(run.slug) };
  } catch (error) {
    if (isAppError(error) && error.status === 404) notFound();
    throw error;
  }
  return (
    <AutoRunView
      initialRun={data.run}
      initialChapters={data.chapters}
      initialEvents={data.events}
      initialSkills={data.skills}
    />
  );
}
