import { AppError } from "@/lib/errors";
import {
  advanceChapter,
  addPage,
  getChapterContent,
  getNovel,
  saveChapterContent,
  saveChapterSummary,
  saveCharacters,
  updateChapterTitle,
} from "@/lib/storage/novels";
import {
  appendAutoEvent,
  getAutoRun,
  getAutoRunChapter,
  updateAutoRun,
  upsertAutoRunChapter,
} from "@/lib/storage/auto-runs";
import {
  runArchitect,
  runArchivist,
  runCharacters,
  runOutline,
  runProse,
  runQa,
} from "@/lib/auto/skills";
import {
  AUTO_MAX_REVISIONS,
  type AutoChapterPlan,
  type AutoRun,
} from "@/lib/auto/types";

type ActiveRun = { controller: AbortController };

const globalForAuto = globalThis as unknown as {
  __vibeAutoRuns?: Map<string, ActiveRun>;
};
const activeRuns = (globalForAuto.__vibeAutoRuns ??= new Map<string, ActiveRun>());

const now = () => new Date().toISOString();

const PHASE_SKILL: Record<string, string> = {
  architect: "Story Architect",
  characters: "Character Weaver",
  outline: "Arc & Scene Outliner",
  prose: "Scene Prose Writer",
  qa: "Continuity & QA Critic",
  archive: "State Archivist",
  done: "Complete",
};

function stitch(scenes: string[]): string {
  return scenes
    .filter(Boolean)
    .map((scene) => scene.trim())
    .join("\n\n");
}

function appendNote(existing: string, incoming: string): string {
  const clean = incoming.trim();
  if (!clean) return existing.slice(-6_000);
  const merged = existing.trim() ? `${existing.trim()}\n\n${clean}` : clean;
  return merged.slice(-6_000);
}

function stateNotesFor(run: AutoRun): string {
  return [run.state.continuityNotes, run.state.characterNotes]
    .map((note) => note.trim())
    .filter(Boolean)
    .join("\n\n");
}

function nextChapterPlan(run: AutoRun): AutoChapterPlan | null {
  return run.outline.find((chapter) => chapter.number === run.currentChapter) ?? null;
}

function ensureRunReady(run: AutoRun): void {
  if (!run.storyBible) {
    throw new AppError("AI_BAD_RESPONSE", "Auto Mode is missing its Story Bible.", {
      status: 500,
    });
  }
}

function errorMessage(error: unknown): string {
  if (error instanceof AppError) {
    return error.code ? `${error.message} (${error.code})` : error.message;
  }
  return error instanceof Error ? error.message : "Auto Mode failed unexpectedly.";
}

async function pageForLogicalChapter(slug: string, logicalChapter: number): Promise<number> {
  const outline = await getNovel(slug);
  const existing = outline.chapters.find(
    (chapter) =>
      chapter.kind === "chapter" &&
      (chapter.chapterNumber ?? chapter.number) === logicalChapter,
  );
  if (existing) return existing.number;

  const added = await addPage(slug, "chapter");
  const refreshed = await getNovel(slug);
  const created = refreshed.chapters.find((chapter) => chapter.number === added.pageNumber);
  if (!created || (created.chapterNumber ?? created.number) !== logicalChapter) {
    throw new AppError(
      "CONFLICT",
      `Auto Mode could not create chapter ${logicalChapter}. Check the book's chapter order.`,
      { status: 409 },
    );
  }
  return added.pageNumber;
}

async function saveSceneProgress(input: {
  slug: string;
  runId: string;
  logicalChapter: number;
  pageNumber: number;
  scenes: string[];
  sceneIndex: number;
  status: "prose" | "qa" | "revising";
  qa?: Parameters<typeof upsertAutoRunChapter>[2]["qa"];
  revisionCount?: number;
}): Promise<void> {
  const text = stitch(input.scenes);
  if (text.trim()) {
    await saveChapterContent(input.slug, input.pageNumber, text);
  }
  await upsertAutoRunChapter(input.runId, input.logicalChapter, {
    pageNumber: input.pageNumber,
    status: input.status,
    sceneIndex: input.sceneIndex,
    scenes: input.scenes,
    qa: input.qa,
    revisionCount: input.revisionCount,
  });
}

async function stepArchitect(run: AutoRun, signal: AbortSignal): Promise<void> {
  const outline = await getNovel(run.slug);
  const { storyBible: generatedBible } = await runArchitect({
    slug: run.slug,
    outline,
    targetChapters: run.targetChapters || undefined,
    planBrief: run.state.planBrief,
    signal,
  });
  const target = run.targetChapters > 0 ? run.targetChapters : generatedBible.targetChapters;
  if (target < run.currentChapter) {
    throw new AppError(
      "BAD_REQUEST",
      `Target chapter count ${target} is before the next chapter (${run.currentChapter}).`,
      { status: 400 },
    );
  }
  const storyBible = { ...generatedBible, targetChapters: target };
  await updateAutoRun(run.id, {
    storyBible,
    targetChapters: target,
    phase: "characters",
    startedAt: run.startedAt ?? now(),
    lastError: null,
  });
  await appendAutoEvent(run.id, {
    phase: "architect",
    chapter: run.currentChapter,
    message: `Story Bible ready: ${storyBible.targetChapters} target chapters.`,
  });
}

async function stepCharacters(run: AutoRun, signal: AbortSignal): Promise<void> {
  ensureRunReady(run);
  const outline = await getNovel(run.slug);
  const generated = await runCharacters({
    slug: run.slug,
    outline,
    storyBible: run.storyBible!,
    planBrief: run.state.planBrief,
    signal,
  });
  const existing = new Set(outline.characters.map((character) => character.name.toLowerCase()));
  const merged = [
    ...outline.characters,
    ...generated.filter((character) => !existing.has(character.name.toLowerCase())),
  ].slice(0, 100);
  await saveCharacters(run.slug, merged);
  await updateAutoRun(run.id, { phase: "outline", lastError: null });
  await appendAutoEvent(run.id, {
    phase: "characters",
    message: `Character roster updated: ${merged.length} characters.`,
  });
}

async function stepOutline(run: AutoRun, signal: AbortSignal): Promise<void> {
  ensureRunReady(run);
  const outline = await getNovel(run.slug);
  const chapters = await runOutline({
    slug: run.slug,
    outline,
    storyBible: run.storyBible!,
    planBrief: run.state.planBrief,
    signal,
  });
  const approved = run.mode === "autopilot" || run.state.approved;
  await updateAutoRun(run.id, {
    outline: chapters,
    phase: "prose",
    currentChapter: Math.max(run.currentChapter, chapters[0]?.number ?? run.currentChapter),
    currentScene: 0,
    revisionCount: 0,
    state: { ...run.state, approved, pendingRevision: null },
    lastError: null,
  });
  await appendAutoEvent(run.id, {
    phase: "outline",
    message: `Master outline ready: ${chapters.length} chapters from chapter ${chapters[0]?.number ?? run.currentChapter}.`,
  });
  if (!approved) {
    await updateAutoRun(run.id, { status: "paused" });
    await appendAutoEvent(run.id, {
      level: "warn",
      phase: "outline",
      message: "Checkpoint reached. Review the Story Bible, characters, and outline, then approve to continue.",
    });
  }
}

async function stepProse(run: AutoRun, signal: AbortSignal): Promise<void> {
  ensureRunReady(run);
  const plan = nextChapterPlan(run);
  if (!plan) {
    if (run.currentChapter >= run.targetChapters) {
      await completeRun(run);
      return;
    }
    throw new AppError(
      "CONFLICT",
      `No outline exists for chapter ${run.currentChapter}. Edit the outline or restart the run.`,
      { status: 409 },
    );
  }

  const pageNumber = await pageForLogicalChapter(run.slug, run.currentChapter);
  const current = await getAutoRunChapter(run.id, run.currentChapter);
  if (!current) {
    await updateChapterTitle(run.slug, pageNumber, plan.title);
  }
  const scenes = [...(current?.scenes ?? [])];
  while (scenes.length < plan.scenes.length) scenes.push("");

  const pending = run.state.pendingRevision;

  if (pending) {
    const indexes = pending.scenes.length
      ? pending.scenes
      : plan.scenes.map((scene) => scene.index);
    for (const index of indexes) {
      if (signal.aborted) return;
      const scene = plan.scenes.find((item) => item.index === index) ?? plan.scenes[index - 1];
      if (!scene) continue;
      const text = await runProse({
        slug: run.slug,
        outline: await getNovel(run.slug),
        storyBible: run.storyBible!,
        chapterPlan: plan,
        scene,
        priorScenes: scenes.slice(0, Math.max(0, scene.index - 1)),
        revisionNotes: pending.notes,
        stateNotes: stateNotesFor(run),
        signal,
      });
      scenes[scene.index - 1] = text;
    }
    await saveSceneProgress({
      slug: run.slug,
      runId: run.id,
      logicalChapter: run.currentChapter,
      pageNumber,
      scenes,
      sceneIndex: plan.scenes.length,
      status: "qa",
      revisionCount: run.revisionCount,
    });
    await updateAutoRun(run.id, {
      phase: "qa",
      currentScene: 0,
      state: { ...run.state, pendingRevision: null },
    });
    await appendAutoEvent(run.id, {
      phase: "qa",
      chapter: run.currentChapter,
      message: `Revision pass complete for chapter ${run.currentChapter}.`,
    });
    return;
  }

  const sceneIndex = current?.sceneIndex ?? 0;
  if (sceneIndex < plan.scenes.length) {
    const scene = plan.scenes[sceneIndex];
    const outline = await getNovel(run.slug);
    const text = await runProse({
      slug: run.slug,
      outline,
      storyBible: run.storyBible!,
      chapterPlan: plan,
      scene,
      priorScenes: scenes.slice(0, sceneIndex),
      stateNotes: stateNotesFor(run),
      signal,
    });
    scenes[sceneIndex] = text;
    await saveSceneProgress({
      slug: run.slug,
      runId: run.id,
      logicalChapter: run.currentChapter,
      pageNumber,
      scenes,
      sceneIndex: sceneIndex + 1,
      status: "prose",
    });
    await updateAutoRun(run.id, { currentScene: sceneIndex + 1, lastError: null });
    await appendAutoEvent(run.id, {
      phase: "prose",
      chapter: run.currentChapter,
      message: `Chapter ${run.currentChapter} - Scene Prose Writer (scene ${sceneIndex + 1}/${plan.scenes.length}).`,
    });
    return;
  }

  await updateAutoRun(run.id, { phase: "qa", currentScene: 0 });
  await appendAutoEvent(run.id, {
    phase: "qa",
    chapter: run.currentChapter,
    message: `Chapter ${run.currentChapter} drafted. Running Continuity & QA Critic.`,
  });
}

async function stepQa(run: AutoRun, signal: AbortSignal): Promise<void> {
  ensureRunReady(run);
  const plan = nextChapterPlan(run);
  if (!plan) throw new AppError("CONFLICT", "Chapter plan missing for QA.", { status: 409 });
  const chapter = await getAutoRunChapter(run.id, run.currentChapter);
  const text = stitch(chapter?.scenes ?? []) || (await getChapterContent(run.slug, chapter?.pageNumber ?? 1));
  const qa = await runQa({
    slug: run.slug,
    outline: await getNovel(run.slug),
    storyBible: run.storyBible!,
    chapterPlan: plan,
    chapterText: text,
    stateNotes: stateNotesFor(run),
    signal,
  });
  await upsertAutoRunChapter(run.id, run.currentChapter, {
    pageNumber: chapter?.pageNumber ?? null,
    status: "qa",
    qa,
    scenes: chapter?.scenes ?? [],
  });

  if (qa.pass) {
    await updateAutoRun(run.id, { phase: "archive", lastError: null });
    await appendAutoEvent(run.id, {
      phase: "qa",
      chapter: run.currentChapter,
      message: `QA passed for chapter ${run.currentChapter}.`,
    });
    return;
  }

  if (run.revisionCount < AUTO_MAX_REVISIONS) {
    const scenes = Array.from(
      new Set(
        qa.issues
          .map((issue) => issue.scene)
          .filter((scene): scene is number => typeof scene === "number"),
      ),
    );
    const notes =
      qa.revisionInstructions.trim() ||
      qa.issues.map((issue) => `Scene ${issue.scene ?? "?"}: ${issue.problem} Fix: ${issue.fix}`).join("\n");
    await updateAutoRun(run.id, {
      phase: "prose",
      revisionCount: run.revisionCount + 1,
      currentScene: 0,
      state: {
        ...run.state,
        pendingRevision: {
          scenes: scenes.filter((scene) => scene >= 1 && scene <= plan.scenes.length),
          notes,
        },
      },
    });
    await upsertAutoRunChapter(run.id, run.currentChapter, {
      pageNumber: chapter?.pageNumber ?? null,
      status: "revising",
      revisionCount: run.revisionCount + 1,
      scenes: chapter?.scenes ?? [],
      qa,
    });
    await appendAutoEvent(run.id, {
      level: "warn",
      phase: "qa",
      chapter: run.currentChapter,
      message: `QA revision ${run.revisionCount + 1}/${AUTO_MAX_REVISIONS} for chapter ${run.currentChapter}.`,
    });
    return;
  }

  await updateAutoRun(run.id, { phase: "archive", lastError: null });
  await appendAutoEvent(run.id, {
    level: "warn",
    phase: "qa",
    chapter: run.currentChapter,
    message: `Revision cap reached for chapter ${run.currentChapter}. Force-passing with warnings.`,
  });
}

async function stepArchive(run: AutoRun, signal: AbortSignal): Promise<void> {
  ensureRunReady(run);
  const plan = nextChapterPlan(run);
  if (!plan) throw new AppError("CONFLICT", "Chapter plan missing for archive.", { status: 409 });
  const chapter = await getAutoRunChapter(run.id, run.currentChapter);
  const pageNumber = chapter?.pageNumber ?? (await pageForLogicalChapter(run.slug, run.currentChapter));
  const text = stitch(chapter?.scenes ?? []) || (await getChapterContent(run.slug, pageNumber));
  const archive = await runArchivist({
    slug: run.slug,
    outline: await getNovel(run.slug),
    storyBible: run.storyBible!,
    chapterPlan: plan,
    chapterText: text,
    signal,
  });
  await saveChapterSummary(run.slug, pageNumber, archive.summary, plan.title);
  await upsertAutoRunChapter(run.id, run.currentChapter, {
    pageNumber,
    status: "archived",
    summary: archive.summary,
    scenes: chapter?.scenes ?? [],
  });

  const nextState = {
    ...run.state,
    continuityNotes: appendNote(run.state.continuityNotes, archive.plotState),
    characterNotes: appendNote(run.state.characterNotes, archive.characterState),
    pendingRevision: null,
  };

  if (run.currentChapter >= run.targetChapters) {
    await updateAutoRun(run.id, {
      status: "completed",
      phase: "done",
      state: nextState,
      finishedAt: now(),
      lastError: null,
    });
    await appendAutoEvent(run.id, {
      phase: "done",
      chapter: run.currentChapter,
      message: `Auto Mode completed at chapter ${run.currentChapter}.`,
    });
    return;
  }

  await advanceChapter(run.slug, pageNumber);
  await updateAutoRun(run.id, {
    phase: "prose",
    currentChapter: run.currentChapter + 1,
    currentScene: 0,
    revisionCount: 0,
    state: nextState,
    lastError: null,
  });
  await appendAutoEvent(run.id, {
    phase: "archive",
    chapter: run.currentChapter,
    message: `Chapter ${run.currentChapter} archived. Moving to chapter ${run.currentChapter + 1}.`,
  });
}

async function completeRun(run: AutoRun): Promise<void> {
  await updateAutoRun(run.id, {
    status: "completed",
    phase: "done",
    finishedAt: now(),
    lastError: null,
  });
  await appendAutoEvent(run.id, {
    phase: "done",
    message: "Auto Mode run completed.",
  });
}

async function failRun(runId: string, error: unknown): Promise<void> {
  const message = errorMessage(error);
  try {
    const run = await getAutoRun(runId);
    const detail = `${message} — stopped at ${PHASE_SKILL[run.phase] ?? run.phase} (chapter ${run.currentChapter}). Drafted prose is saved; Resume continues from this step.`;
    const details = error instanceof AppError ? error.details : undefined;
    await updateAutoRun(runId, { status: "failed", lastError: detail });
    await appendAutoEvent(runId, {
      level: "error",
      phase: run.phase,
      chapter: run.currentChapter,
      message: detail,
      data: details ?? null,
    });
    console.error("[auto] run failed:", runId, detail);
    if (details) {
      console.error(
        "[auto] failure details:",
        JSON.stringify(details).slice(0, 2_000),
      );
    }
  } catch (nested) {
    console.error("[auto] could not record failure:", runId, nested);
  }
}

async function loop(runId: string, signal: AbortSignal): Promise<void> {
  try {
    while (!signal.aborted) {
      const run = await getAutoRun(runId);
      if (run.status !== "running") return;
      // Executing without an approved plan wastes tokens on chapters the author never reviewed.
      if (!run.state.planLockedAt) {
        await updateAutoRun(runId, {
          status: "paused",
          lastError: "Approve the plan before autonomous execution starts.",
        });
        await appendAutoEvent(runId, {
          level: "warn",
          phase: run.phase,
          chapter: run.currentChapter,
          message: "Run paused: no plan is approved yet.",
        });
        return;
      }
      if (run.phase === "done") {
        await completeRun(run);
        return;
      }
      if (signal.aborted) return;

      switch (run.phase) {
        case "architect":
          await stepArchitect(run, signal);
          break;
        case "characters":
          await stepCharacters(run, signal);
          break;
        case "outline":
          await stepOutline(run, signal);
          break;
        case "prose":
          await stepProse(run, signal);
          break;
        case "qa":
          await stepQa(run, signal);
          break;
        case "archive":
          await stepArchive(run, signal);
          break;
        default:
          return;
      }
    }
  } catch (error) {
    if (signal.aborted) return;
    await failRun(runId, error);
  }
}

export function startAutoRun(runId: string): void {
  const existing = activeRuns.get(runId);
  if (existing && !existing.controller.signal.aborted) return;
  if (existing) activeRuns.delete(runId);
  const controller = new AbortController();
  activeRuns.set(runId, { controller });
  void loop(runId, controller.signal).finally(() => {
    const current = activeRuns.get(runId);
    if (current?.controller === controller) activeRuns.delete(runId);
  });
}

export function abortAutoRun(runId: string): void {
  activeRuns.get(runId)?.controller.abort();
}

export function isAutoRunActive(runId: string): boolean {
  return activeRuns.has(runId);
}
