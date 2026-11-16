import { notFound } from "next/navigation";
import { getAutoRun, listAutoEvents } from "@/lib/storage/auto-runs";
import { getChapterContent, getNovel } from "@/lib/storage/novels";
import { previousChapterPage } from "@/lib/auto/context";
import { isAppError } from "@/lib/errors";
import { AutoMonitor } from "@/components/auto/auto-monitor";
import type { Chapter, Outline } from "@/lib/schemas";

export const dynamic = "force-dynamic";

const label = (chapter: Chapter) => chapter.chapterNumber ?? chapter.number;

export default async function AutoMonitorPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ chapter?: string }>;
}) {
  const { id } = await params;
  const { chapter } = await searchParams;

  let data: {
    run: Awaited<ReturnType<typeof getAutoRun>>;
    outline: Outline;
    pages: Array<{
      number: number;
      chapterNumber: number;
      title: string;
      content: string;
      summary: string;
    }>;
    previous: { chapterNumber: number; pageNumber: number } | null;
    events: Awaited<ReturnType<typeof listAutoEvents>>;
  };

  try {
    const run = await getAutoRun(id);
    const [outline, events] = await Promise.all([getNovel(run.slug), listAutoEvents(id, 0, 40)]);
    const chapters = outline.chapters
      .filter((item) => item.kind === "chapter")
      .sort((a, b) => label(a) - label(b));
    const pages = [];
    for (const item of chapters.slice(-8).reverse()) {
      pages.push({
        number: item.number,
        chapterNumber: label(item),
        title: item.title,
        content: await getChapterContent(run.slug, item.number),
        summary: item.summary,
      });
    }
    const latest = chapters[chapters.length - 1];
    const previous = latest ? previousChapterPage(outline, label(latest)) : null;
    data = {
      run,
      outline,
      pages,
      previous: previous
        ? { chapterNumber: label(previous), pageNumber: previous.number }
        : null,
      events,
    };
  } catch (error) {
    if (isAppError(error) && error.status === 404) notFound();
    throw error;
  }

  const focus = chapter ? Number(chapter) : null;

  return (
    <AutoMonitor
      slug={data.run.slug}
      runId={data.run.id}
      bookTitle={data.run.bookTitle}
      status={data.run.status}
      phase={data.run.phase}
      focusChapter={Number.isFinite(focus) ? focus : null}
      initial={{
        pages: data.pages,
        current: data.pages[0]
          ? { chapterNumber: data.pages[0].chapterNumber, pageNumber: data.pages[0].number }
          : null,
        previous: data.previous,
      }}
      initialEvents={data.events}
    />
  );
}
