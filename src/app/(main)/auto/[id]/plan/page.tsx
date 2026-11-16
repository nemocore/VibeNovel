import { notFound } from "next/navigation";
import { getAutoRun } from "@/lib/storage/auto-runs";
import { getAutoSkillsSnapshot, type AutoSkillsSnapshotPayload } from "@/lib/auto/skills-state";
import { getNovel } from "@/lib/storage/novels";
import { readNovelChat } from "@/lib/storage/chats";
import { AUTO_PLAN_CHAT_SCOPE } from "@/lib/auto/chat";
import { decodePremise } from "@/lib/auto/create";
import { isAppError } from "@/lib/errors";
import { AutoPlanView } from "@/components/auto/auto-plan-view";

export const dynamic = "force-dynamic";

export default async function AutoPlanPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  let data: {
    run: Awaited<ReturnType<typeof getAutoRun>>;
    messages: Awaited<ReturnType<typeof readNovelChat>>["messages"];
    skills: AutoSkillsSnapshotPayload;
    premise: string;
    tone: string;
  };
  try {
    const run = await getAutoRun(id);
    const [chat, skills, outline] = await Promise.all([
      readNovelChat(run.slug, AUTO_PLAN_CHAT_SCOPE),
      getAutoSkillsSnapshot(run.slug),
      getNovel(run.slug),
    ]);
    const decoded = decodePremise(outline.premise);
    data = {
      run,
      messages: chat.messages,
      skills,
      premise: decoded.premise,
      tone: decoded.tone,
    };
  } catch (error) {
    if (isAppError(error) && error.status === 404) notFound();
    throw error;
  }
  return (
    <AutoPlanView
      run={data.run}
      messages={data.messages}
      tone={data.tone}
      premise={data.premise}
      skills={data.skills}
    />
  );
}
