import { assertSameOrigin, errorResponse, jsonOk } from "@/lib/api";
import { getChapterContent, getNovel } from "@/lib/storage/novels";
import { listAutoRunChapters } from "@/lib/storage/auto-runs";
import { previousChapterPage } from "@/lib/auto/context";
import type { Chapter, Outline } from "@/lib/schemas";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Params = { params: Promise<{ slug: string }> };

type Page = {
  number: number;
  chapterNumber: number;
  title: string;
  content: string;
  summary: string;
};

function chapterLabel(page: Chapter): number {
  return page.chapterNumber ?? page.number;
}

/**
 * Read-only manuscript view for the Auto Mode monitor. It shows whatever prose
 * exists on disk, including a chapter the runner is still writing.
 */
export async function GET(request: Request, { params }: Params) {
  try {
    assertSameOrigin(request);
    const { slug } = await params;
    const outline: Outline = await getNovel(slug);
    const chapters = outline.chapters
      .filter((chapter) => chapter.kind === "chapter")
      .sort((a, b) => chapterLabel(a) - chapterLabel(b));

    const url = new URL(request.url);
    const limitRaw = Number(url.searchParams.get("limit") ?? 6);
    const limit = Number.isFinite(limitRaw) ? Math.min(Math.max(limitRaw, 1), 40) : 6;

    const autoChapters = await (url.searchParams.get("run")
      ? listAutoRunChapters(url.searchParams.get("run")!).catch(() => [])
      : Promise.resolve([]));

    const pages: Page[] = [];
    for (const chapter of chapters.slice(-limit).reverse()) {
      const content = await getChapterContent(slug, chapter.number);
      pages.push({
        number: chapter.number,
        chapterNumber: chapterLabel(chapter),
        title: chapter.title,
        content,
        summary: chapter.summary,
      });
    }

    const latest = chapters[chapters.length - 1];
    const previous = latest ? previousChapterPage(outline, chapterLabel(latest)) : null;

    return jsonOk({
      pages,
      autoChapters,
      current: latest
        ? { chapterNumber: chapterLabel(latest), pageNumber: latest.number }
        : null,
      previous: previous
        ? { chapterNumber: chapterLabel(previous), pageNumber: previous.number }
        : null,
    });
  } catch (error) {
    return errorResponse(error);
  }
}
