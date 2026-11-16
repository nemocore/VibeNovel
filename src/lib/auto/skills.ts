import { chatCompletionStreaming } from "@/lib/ai/client";
import { renderPrompt } from "@/lib/ai/prompts";
import { extractJson } from "@/lib/auto/json";
import { resolveModelRoute } from "@/lib/ai/routing";
import { AppError } from "@/lib/errors";
import { requireConfig } from "@/lib/storage/config";
import { getBookConfig } from "@/lib/storage/book-config";
import { getAutoSkillPrompts } from "@/lib/storage/auto-skills";
import {
  autoArchiveSchema,
  autoCharacterListSchema,
  autoOutlineSchema,
  autoQaSchema,
  autoStoryBibleSchema,
} from "@/lib/auto/schemas";
import {
  existingChapterSummaries,
  formatChapterPlan,
  formatCharacters,
  formatExistingCharacters,
  formatPriorScenes,
  formatScene,
  formatStoryBible,
  formatSummaries,
  nextLogicalChapter,
  previousChapterTail,
} from "@/lib/auto/context";
import type {
  AutoArchiveResult,
  AutoChapterPlan,
  AutoModelRole,
  AutoQaResult,
  AutoScenePlan,
  AutoStoryBible,
} from "@/lib/auto/types";
import { resolveAutoModel } from "@/lib/auto/types";
import type { Character, GenerationParams, Outline } from "@/lib/schemas";

type SkillRole = "planner" | "executor" | "summarizer";

type Runtime = {
  baseUrl: string;
  apiKey: string;
  model: string;
  params: GenerationParams;
  prompts: Record<string, string>;
};

async function runtimeFor(
  slug: string,
  role: SkillRole,
  modelRole: AutoModelRole,
): Promise<Runtime> {
  const [global, book, skillPrompts] = await Promise.all([
    requireConfig(),
    getBookConfig(slug),
    getAutoSkillPrompts(slug),
  ]);
  const model = resolveAutoModel(modelRole, skillPrompts.models, book.config.models);
  const route = resolveModelRoute(global, model);
  return {
    baseUrl: route.provider.baseUrl,
    apiKey: route.provider.apiKey,
    model: route.model,
    params: book.config.roles[role].params,
    prompts: skillPrompts.values,
  };
}

async function callText(
  slug: string,
  role: SkillRole,
  skill: string,
  values: Record<string, string>,
  signal?: AbortSignal,
  extraInstruction?: string,
): Promise<{ text: string; runtime: Runtime }> {
  const modelRole = skill.replace(/^auto_/, "") as AutoModelRole;
  const runtime = await runtimeFor(slug, role, modelRole);
  const system = runtime.prompts[`${skill}_system`];
  const task = runtime.prompts[`${skill}_task`];
  if (!system?.trim() || !task?.trim()) {
    throw new AppError(
      "CONFIG_REQUIRED",
      `Auto Mode skill prompt "${skill}" is missing. Open Settings > Prompt Templates.`,
      { status: 428 },
    );
  }
  const userContent = renderPrompt(task, values);
  // Streaming keeps the socket active through long scene and critic generations.
  const result = await chatCompletionStreaming({
    baseUrl: runtime.baseUrl,
    apiKey: runtime.apiKey,
    model: runtime.model,
    messages: [
      { role: "system", content: system },
      {
        role: "user",
        content: extraInstruction
          ? `${userContent}\n\n${extraInstruction}`
          : userContent,
      },
    ],
    params: runtime.params,
    retries: 1,
    signal,
  });
  return { text: result.content, runtime };
}

function zodSummary(error: unknown): string {
  if (
    error &&
    typeof error === "object" &&
    "issues" in error &&
    Array.isArray((error as { issues: unknown[] }).issues)
  ) {
    return (error as { issues: Array<{ path?: Array<string | number>; message?: string }> }).issues
      .slice(0, 6)
      .map((issue) => `${(issue.path ?? []).join(".") || "(root)"}: ${issue.message ?? "invalid"}`)
      .join("; ");
  }
  return error instanceof Error ? error.message : "unknown validation error";
}

function parseStructured<T>(
  raw: string,
  schema: { safeParse: (value: unknown) => { success: true; data: T } | { success: false; error: unknown } },
  label: string,
): T {
  const cleaned = raw.trim();
  let parsed: unknown;
  try {
    parsed = extractJson(cleaned);
  } catch {
    throw new AppError(
      "AI_BAD_RESPONSE",
      `${label} returned unreadable JSON. Try again or check the skill prompt in Settings.`,
      { status: 502, retryable: true, details: { raw: cleaned.slice(0, 500) } },
    );
  }
  const result = schema.safeParse(parsed);
  if (!result.success) {
    const issues = zodSummary(result.error);
    throw new AppError(
      "AI_BAD_RESPONSE",
      `${label} returned JSON that does not match the expected shape (${issues}). Check the skill prompt in Settings.`,
      {
        status: 502,
        retryable: true,
        details: {
          issues,
          raw: cleaned.slice(0, 500),
          parsed: JSON.stringify(parsed).slice(0, 1_000),
        },
      },
    );
  }
  return result.data;
}

/**
 * Structured skills get one repair attempt: providers occasionally answer with
 * a slightly different key set, and replaying with the exact validation issues
 * usually fixes it without failing the run.
 */
async function requestStructured<T>(input: {
  slug: string;
  role: SkillRole;
  skill: string;
  values: Record<string, string>;
  label: string;
  schema: {
    safeParse: (value: unknown) => { success: true; data: T } | { success: false; error: unknown };
  };
  signal?: AbortSignal;
}): Promise<T> {
  let extra: string | undefined;
  let lastError: unknown;
  for (let attempt = 0; attempt < 2; attempt += 1) {
    const { text } = await callText(
      input.slug,
      input.role,
      input.skill,
      input.values,
      input.signal,
      extra,
    );
    try {
      return parseStructured(text, input.schema, input.label);
    } catch (error) {
      lastError = error;
      if (!(error instanceof AppError) || !error.retryable || attempt === 1) throw error;
      const issues = (error.details as { issues?: unknown } | undefined)?.issues;
      const summary = typeof issues === "string" ? issues : zodSummary(issues);
      extra = `[FORMAT CORRECTION]\nThe previous reply could not be validated: ${summary}.\nReturn only one JSON object that matches the required shape. No prose, no code fences.`;
    }
  }
  throw lastError;
}

export async function runArchitect(input: {
  slug: string;
  outline: Outline;
  targetChapters?: number;
  planBrief?: string;
  signal?: AbortSignal;
}): Promise<{ storyBible: AutoStoryBible }> {
  const storyBible = await requestStructured({
    slug: input.slug,
    role: "planner",
    skill: "auto_architect",
    label: "Story Architect",
    schema: autoStoryBibleSchema,
    signal: input.signal,
    values: {
      premise: input.outline.premise || "No premise recorded.",
      existingSummaries: existingChapterSummaries(input.outline),
      startChapter: String(nextLogicalChapter(input.outline)),
      desiredChapters: input.targetChapters ? String(input.targetChapters) : "Choose a fitting total.",
      planBrief: input.planBrief?.trim() || "No pre-run discussion was locked in.",
    },
  });
  return { storyBible };
}

export async function runCharacters(input: {
  slug: string;
  outline: Outline;
  storyBible: AutoStoryBible;
  planBrief?: string;
  signal?: AbortSignal;
}): Promise<Character[]> {
  const list = await requestStructured({
    slug: input.slug,
    role: "planner",
    skill: "auto_characters",
    label: "Character Weaver",
    schema: autoCharacterListSchema,
    signal: input.signal,
    values: {
      storyBible: formatStoryBible(input.storyBible),
      existingCharacters: formatExistingCharacters(input.outline),
      planBrief: input.planBrief?.trim() || "No pre-run discussion was locked in.",
    },
  });
  return list.characters;
}

export async function runOutline(input: {
  slug: string;
  outline: Outline;
  storyBible: AutoStoryBible;
  planBrief?: string;
  signal?: AbortSignal;
}): Promise<AutoChapterPlan[]> {
  const start = nextLogicalChapter(input.outline);
  const outline = await requestStructured({
    slug: input.slug,
    role: "planner",
    skill: "auto_outline",
    label: "Arc & Scene Outliner",
    schema: autoOutlineSchema,
    signal: input.signal,
    values: {
      storyBible: formatStoryBible(input.storyBible),
      characters: formatExistingCharacters(input.outline),
      existingSummaries: existingChapterSummaries(input.outline),
      startChapter: String(start),
      targetChapters: String(input.storyBible.targetChapters),
      planBrief: input.planBrief?.trim() || "No pre-run discussion was locked in.",
    },
  });
  const chapters = outline.chapters
    .filter((chapter) => chapter.number >= start)
    .sort((a, b) => a.number - b.number);
  if (!chapters.length) {
    throw new AppError(
      "AI_BAD_RESPONSE",
      "The Arc & Scene Outliner returned no chapters for this run. Check the skill prompt and target chapter count.",
      { status: 502, retryable: true },
    );
  }
  const lastChapter = chapters[chapters.length - 1]?.number ?? 0;
  if (lastChapter < input.storyBible.targetChapters) {
    throw new AppError(
      "AI_BAD_RESPONSE",
      `The Arc & Scene Outliner stopped at chapter ${lastChapter} but the target is ${input.storyBible.targetChapters}. Check the skill prompt or lower the target.`,
      { status: 502, retryable: true },
    );
  }
  return chapters;
}

export async function runProse(input: {
  slug: string;
  outline: Outline;
  storyBible: AutoStoryBible;
  chapterPlan: AutoChapterPlan;
  scene: AutoScenePlan;
  priorScenes: string[];
  revisionNotes?: string;
  stateNotes?: string;
  signal?: AbortSignal;
}): Promise<string> {
  const { text } = await callText(
    input.slug,
    "executor",
    "auto_prose",
    {
      storyBible: formatStoryBible(input.storyBible),
      characters: formatCharacters(input.outline, input.chapterPlan.characters),
      summaries: formatSummaries(input.outline, input.chapterPlan.number),
      stateNotes: input.stateNotes?.trim() || "No state notes yet.",
      previousTail: await previousChapterTail(input.slug, input.outline, input.chapterPlan.number),
      chapterPlan: formatChapterPlan(input.chapterPlan),
      scene: formatScene(input.scene),
      chapterNumber: String(input.chapterPlan.number),
      priorScenes: formatPriorScenes(input.priorScenes),
      revisionNotes: input.revisionNotes?.trim() || "None.",
    },
    input.signal,
  );
  return text.trim();
}

export async function runQa(input: {
  slug: string;
  outline: Outline;
  storyBible: AutoStoryBible;
  chapterPlan: AutoChapterPlan;
  chapterText: string;
  stateNotes?: string;
  signal?: AbortSignal;
}): Promise<AutoQaResult> {
  return requestStructured({
    slug: input.slug,
    role: "summarizer",
    skill: "auto_qa",
    label: "Continuity & QA Critic",
    schema: autoQaSchema,
    signal: input.signal,
    values: {
      storyBible: formatStoryBible(input.storyBible),
      characters: formatCharacters(input.outline, input.chapterPlan.characters),
      summaries: formatSummaries(input.outline, input.chapterPlan.number),
      stateNotes: input.stateNotes?.trim() || "No state notes yet.",
      chapterPlan: formatChapterPlan(input.chapterPlan),
      chapterText: input.chapterText,
    },
  });
}

export async function runArchivist(input: {
  slug: string;
  outline: Outline;
  storyBible: AutoStoryBible;
  chapterPlan: AutoChapterPlan;
  chapterText: string;
  signal?: AbortSignal;
}): Promise<AutoArchiveResult> {
  return requestStructured({
    slug: input.slug,
    role: "summarizer",
    skill: "auto_archivist",
    label: "State Archivist",
    schema: autoArchiveSchema,
    signal: input.signal,
    values: {
      chapterPlan: formatChapterPlan(input.chapterPlan),
      chapterText: input.chapterText,
      summaries: formatSummaries(input.outline, input.chapterPlan.number),
    },
  });
}
