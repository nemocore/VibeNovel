import { getChapterContent } from "@/lib/storage/novels";
import type { Chapter, Outline } from "@/lib/schemas";
import {
  AUTO_PREVIOUS_TAIL_WORDS,
  AUTO_SUMMARY_BUDGET,
  type AutoChapterPlan,
  type AutoScenePlan,
  type AutoStoryBible,
} from "@/lib/auto/types";

export function formatStoryBible(bible: AutoStoryBible): string {
  return JSON.stringify(bible, null, 2);
}

export function formatCharacters(outline: Outline, names: string[], limit = 24): string {
  const active = names.filter(Boolean);
  const list = active.length
    ? outline.characters.filter((character) =>
        active.some((name) => name.toLowerCase() === character.name.toLowerCase()),
      )
    : outline.characters;
  const selected = (list.length ? list : outline.characters).slice(0, limit);
  if (!selected.length) return "No character sheet recorded.";
  return selected
    .map((character) => {
      const role = character.role ? ` (${character.role})` : "";
      return `- ${character.name}${role}: ${character.description || "No description."}`;
    })
    .join("\n");
}

export function formatExistingCharacters(outline: Outline): string {
  if (!outline.characters.length) return "No characters exist yet.";
  return outline.characters
    .map(
      (character) =>
        `- ${character.name}${character.role ? ` (${character.role})` : ""}: ${character.description || "No description."}`,
    )
    .join("\n");
}

export function formatSummaries(
  outline: Outline,
  upToChapter: number,
  budget = AUTO_SUMMARY_BUDGET,
): string {
  const eligible = outline.chapters
    .filter(
      (chapter) =>
        chapter.kind === "chapter" &&
        (chapter.chapterNumber ?? chapter.number) < upToChapter &&
        chapter.summary.trim(),
    )
    .sort(
      (a, b) =>
        (a.chapterNumber ?? a.number) - (b.chapterNumber ?? b.number),
    );
  if (!eligible.length) return "No prior chapter summaries.";
  const selected: Chapter[] = [];
  let used = 0;
  for (let index = eligible.length - 1; index >= 0; index -= 1) {
    const chapter = eligible[index];
    const cost = chapter.summary.length + 80;
    if (selected.length && used + cost > budget) break;
    selected.unshift(chapter);
    used += cost;
  }
  return selected
    .map(
      (chapter) =>
        `Chapter ${chapter.chapterNumber ?? chapter.number} - ${chapter.title}\n${chapter.summary.trim()}`,
    )
    .join("\n\n");
}

export function previousChapterPage(
  outline: Outline,
  currentChapter: number,
): Chapter | null {
  return (
    outline.chapters
      .filter(
        (chapter) =>
          chapter.kind === "chapter" &&
          (chapter.chapterNumber ?? chapter.number) < currentChapter,
      )
      .sort(
        (a, b) =>
          (b.chapterNumber ?? b.number) - (a.chapterNumber ?? a.number),
      )[0] ?? null
  );
}

export async function previousChapterTail(
  slug: string,
  outline: Outline,
  currentChapter: number,
  words = AUTO_PREVIOUS_TAIL_WORDS,
): Promise<string> {
  const previous = outline.chapters
    .filter(
      (chapter) =>
        chapter.kind === "chapter" &&
        (chapter.chapterNumber ?? chapter.number) < currentChapter,
    )
    .sort(
      (a, b) =>
        (b.chapterNumber ?? b.number) - (a.chapterNumber ?? a.number),
    );
  for (const chapter of previous) {
    const content = await getChapterContent(slug, chapter.number);
    if (!content.trim()) continue;
    return content.trim().split(/\s+/).filter(Boolean).slice(-words).join(" ");
  }
  return "No previous chapter text.";
}

export function formatChapterPlan(plan: AutoChapterPlan): string {
  return JSON.stringify(plan, null, 2);
}

export function formatScene(scene: AutoScenePlan): string {
  return JSON.stringify(scene, null, 2);
}

export function formatPriorScenes(scenes: string[]): string {
  const text = scenes.filter(Boolean).join("\n\n").trim();
  return text ? text : "No scenes written yet.";
}

export function existingChapterSummaries(outline: Outline): string {
  const chapters = outline.chapters
    .filter((chapter) => chapter.kind === "chapter")
    .sort(
      (a, b) =>
        (a.chapterNumber ?? a.number) - (b.chapterNumber ?? b.number),
    );
  if (!chapters.length) return "No chapters exist yet.";
  return chapters
    .map((chapter) => {
      const number = chapter.chapterNumber ?? chapter.number;
      const summary = chapter.summary.trim() || "(not summarized)";
      return `Chapter ${number} - ${chapter.title}\n${summary}`;
    })
    .join("\n\n");
}

const WRITTEN_STATUSES = new Set(["drafted", "summarized", "summary_skipped", "summary_failed"]);

function hasWrittenProse(chapter: Outline["chapters"][number]): boolean {
  return chapter.wordCount > 0 || WRITTEN_STATUSES.has(chapter.status);
}

/**
 * The next chapter Auto Mode should write. Empty `planned` placeholders (the
 * default Chapter 01 created with a new book) are not counted as written, so a
 * fresh novel starts at Chapter 01 and fills that existing record.
 */
export function nextLogicalChapter(outline: Outline): number {
  const written = outline.chapters.filter(
    (chapter) => chapter.kind === "chapter" && hasWrittenProse(chapter),
  );
  if (!written.length) return 1;
  return (
    Math.max(...written.map((chapter) => chapter.chapterNumber ?? chapter.number)) + 1
  );
}

export function logicalChapterFromPlan(plan: AutoChapterPlan): number {
  return plan.number;
}
