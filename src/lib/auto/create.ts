import { createDraft, getNovel, listNovels, publishDraft } from "@/lib/storage/novels";
import { exportBookBackup, importBookBackup } from "@/lib/storage/backup";
import { requireConfig } from "@/lib/storage/config";
import { nextLogicalChapter } from "@/lib/auto/context";

export type AutoBookRecord = {
  slug: string;
  title: string;
  premise: string;
  tone: string;
  chapterCount: number;
  currentChapter: number;
  wordCount: number;
  /** First chapter Auto Mode will write: chapter 01 for an untouched book. */
  startChapter: number;
};

export type AutoNovelDraftInput = {
  title: string;
  premise: string;
  genre?: string;
  presetId?: string;
};

const TONE_OPEN = "<!-- auto-tone:";
const TONE_CLOSE = "-->";
const TONE_PATTERN = /<!--\s*auto-tone:\s*([\s\S]*?)\s*-->/i;

export function encodePremise(premise: string, genre?: string): string {
  const clean = premise.trim();
  const tone = genre?.trim();
  if (!tone) return clean;
  return `${clean}\n\n${TONE_OPEN} ${tone.replace(/-->/g, "→")} ${TONE_CLOSE}`;
}

export function decodePremise(value: string): { premise: string; tone: string } {
  const match = TONE_PATTERN.exec(value ?? "");
  if (!match) return { premise: (value ?? "").trim(), tone: "" };
  return {
    premise: value.replace(TONE_PATTERN, "").trim(),
    tone: match[1].trim(),
  };
}

export async function createAutoNovel(input: AutoNovelDraftInput): Promise<{ slug: string }> {
  await requireConfig();
  const draft = await createDraft(input.presetId);
  const { slug } = await publishDraft(draft.id, {
    title: input.title,
    premise: encodePremise(input.premise, input.genre),
  });
  return { slug };
}

/**
 * Copies a Studio book into a standalone book so Auto Mode never writes into
 * the source manuscript. Chapters, summaries, and characters carry over.
 */
export async function forkNovelForAuto(
  slug: string,
): Promise<{ slug: string; title: string }> {
  const backup = await exportBookBackup(slug);
  const title = `${backup.book.title} (Auto)`;
  const forked = await importBookBackup({
    ...backup,
    book: { ...backup.book, title, updatedAt: new Date().toISOString() },
  });
  return { slug: forked.slug, title };
}

export async function listAutoBooks(): Promise<AutoBookRecord[]> {
  const novels = await listNovels(false);
  const books: AutoBookRecord[] = [];
  for (const novel of novels) {
    const decoded = decodePremise(novel.premise ?? "");
    const outline = await getNovel(novel.slug);
    books.push({
      slug: novel.slug,
      title: novel.title,
      premise: decoded.premise,
      tone: decoded.tone,
      chapterCount: novel.chapterCount ?? 0,
      currentChapter: novel.currentChapter,
      wordCount: novel.wordCount,
      startChapter: nextLogicalChapter(outline),
    });
  }
  return books;
}
