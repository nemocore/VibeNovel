import { errorResponse, jsonOk } from "@/lib/api";
import { getConfig } from "@/lib/storage/config";
import { getNovel, listNovels } from "@/lib/storage/novels";
import { findActiveAutoRun } from "@/lib/storage/auto-runs";
import { decodePremise } from "@/lib/auto/create";
import { nextLogicalChapter } from "@/lib/auto/context";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Books that can be continued inside Auto Mode, with existing-run flags. */
export async function GET() {
  try {
    const [novels, global] = await Promise.all([listNovels(false), getConfig()]);
    const books = [];
    for (const novel of novels) {
      const decoded = decodePremise(novel.premise);
      const outline = await getNovel(novel.slug);
      const active = await findActiveAutoRun(outline.id);
      books.push({
        slug: novel.slug,
        title: novel.title,
        premise: decoded.premise,
        tone: decoded.tone,
        chapterCount: novel.chapterCount,
        currentChapter: novel.currentChapter,
        wordCount: novel.wordCount,
        startChapter: nextLogicalChapter(outline),
        activeRunId: active?.id ?? null,
      });
    }
    return jsonOk({
      books,
      presets: global?.presets.map((preset) => ({ id: preset.id, name: preset.name })) ?? [],
      defaultPresetId: global?.defaultPresetId ?? null,
    });
  } catch (error) {
    return errorResponse(error);
  }
}
