import { randomUUID } from "node:crypto";
import { and, asc, desc, eq, gt, inArray } from "drizzle-orm";
import { getDb } from "@/lib/db";
import {
  autoRunChapters,
  autoRunEvents,
  autoRuns,
  books,
  type DbAutoRun,
  type DbAutoRunChapter,
  type DbAutoRunEvent,
} from "@/lib/db/schema";
import { NotFoundError } from "@/lib/errors";
import {
  emptyAutoRunState,
  normalizeAutoRunState,
  type AutoChapterPlan,
  type AutoPhase,
  type AutoQaResult,
  type AutoRun,
  type AutoRunChapter,
  type AutoRunChapterStatus,
  type AutoRunEvent,
  type AutoRunMode,
  type AutoRunState,
  type AutoRunStatus,
  type AutoRunSummary,
  type AutoStoryBible,
} from "@/lib/auto/types";

const now = () => new Date().toISOString();

type RunRow = DbAutoRun & { bookSlug: string | null; bookTitle: string };

function parseState(raw: AutoRunState | null | undefined): AutoRunState {
  return normalizeAutoRunState(raw);
}

function rowToRun(row: RunRow): AutoRun {
  return {
    id: row.id,
    bookId: row.bookId,
    slug: row.bookSlug ?? "",
    bookTitle: row.bookTitle,
    status: row.status,
    mode: row.mode,
    phase: row.phase,
    targetChapters: row.targetChapters,
    currentChapter: row.currentChapter,
    currentScene: row.currentScene,
    revisionCount: row.revisionCount,
    storyBible: row.storyBibleJson ?? null,
    outline: row.outlineJson ?? [],
    state: parseState(row.stateJson),
    lastError: row.lastError,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
    startedAt: row.startedAt,
    finishedAt: row.finishedAt,
  };
}

function rowToChapter(row: DbAutoRunChapter): AutoRunChapter {
  return {
    runId: row.runId,
    chapterNumber: row.chapterNumber,
    pageNumber: row.pageNumber,
    status: row.status,
    sceneIndex: row.sceneIndex,
    revisionCount: row.revisionCount,
    scenes: row.scenesJson ?? [],
    qa: row.qaJson ?? null,
    summary: row.summary,
    updatedAt: row.updatedAt,
  };
}

function rowToEvent(row: DbAutoRunEvent): AutoRunEvent {
  return {
    id: row.id,
    runId: row.runId,
    level: row.level,
    phase: row.phase,
    chapter: row.chapter,
    message: row.message,
    data: row.dataJson,
    createdAt: row.createdAt,
  };
}

const runSelect = {
  id: autoRuns.id,
  bookId: autoRuns.bookId,
  status: autoRuns.status,
  mode: autoRuns.mode,
  phase: autoRuns.phase,
  targetChapters: autoRuns.targetChapters,
  currentChapter: autoRuns.currentChapter,
  currentScene: autoRuns.currentScene,
  revisionCount: autoRuns.revisionCount,
  storyBibleJson: autoRuns.storyBibleJson,
  outlineJson: autoRuns.outlineJson,
  stateJson: autoRuns.stateJson,
  lastError: autoRuns.lastError,
  createdAt: autoRuns.createdAt,
  updatedAt: autoRuns.updatedAt,
  startedAt: autoRuns.startedAt,
  finishedAt: autoRuns.finishedAt,
  bookSlug: books.slug,
  bookTitle: books.title,
};

export async function createAutoRun(input: {
  bookId: string;
  mode: AutoRunMode;
  targetChapters: number;
  currentChapter: number;
  planBrief?: string;
  approved?: boolean;
}): Promise<AutoRun> {
  const db = await getDb();
  const id = randomUUID();
  const timestamp = now();
  db.insert(autoRuns)
    .values({
      id,
      bookId: input.bookId,
      status: "queued",
      mode: input.mode,
      phase: "architect",
      targetChapters: input.targetChapters,
      currentChapter: input.currentChapter,
      currentScene: 0,
      revisionCount: 0,
      storyBibleJson: null,
      outlineJson: [],
      stateJson: {
        ...emptyAutoRunState(),
        planBrief: input.planBrief?.trim() ?? "",
        planLockedAt: input.planBrief?.trim() ? timestamp : null,
        approved: Boolean(input.approved),
      },
      lastError: null,
      createdAt: timestamp,
      updatedAt: timestamp,
      startedAt: null,
      finishedAt: null,
    })
    .run();
  return getAutoRun(id);
}

export async function getAutoRun(id: string): Promise<AutoRun> {
  const db = await getDb();
  const row = db
    .select(runSelect)
    .from(autoRuns)
    .innerJoin(books, eq(autoRuns.bookId, books.id))
    .where(eq(autoRuns.id, id))
    .get();
  if (!row) throw new NotFoundError("That Auto Mode run does not exist.");
  return rowToRun(row);
}

export async function findActiveAutoRun(bookId: string): Promise<AutoRun | null> {
  const db = await getDb();
  const row = db
    .select(runSelect)
    .from(autoRuns)
    .innerJoin(books, eq(autoRuns.bookId, books.id))
    .where(
      and(
        eq(autoRuns.bookId, bookId),
        inArray(autoRuns.status, ["queued", "running", "paused"]),
      ),
    )
    .orderBy(desc(autoRuns.updatedAt))
    .get();
  return row ? rowToRun(row) : null;
}

export async function listAutoRuns(): Promise<AutoRunSummary[]> {
  const db = await getDb();
  const rows = db
    .select(runSelect)
    .from(autoRuns)
    .innerJoin(books, eq(autoRuns.bookId, books.id))
    .orderBy(desc(autoRuns.updatedAt))
    .all();
  const summaries: AutoRunSummary[] = [];
  for (const row of rows) {
    const last = db
      .select({ message: autoRunEvents.message })
      .from(autoRunEvents)
      .where(eq(autoRunEvents.runId, row.id))
      .orderBy(desc(autoRunEvents.id))
      .limit(1)
      .get();
    summaries.push({ ...rowToRun(row), lastEvent: last?.message ?? null });
  }
  return summaries;
}

export async function updateAutoRun(
  id: string,
  patch: {
    status?: AutoRunStatus;
    mode?: AutoRunMode;
    phase?: AutoPhase;
    targetChapters?: number;
    currentChapter?: number;
    currentScene?: number;
    revisionCount?: number;
    storyBible?: AutoStoryBible | null;
    outline?: AutoChapterPlan[];
    state?: AutoRunState;
    lastError?: string | null;
    startedAt?: string | null;
    finishedAt?: string | null;
  },
): Promise<AutoRun> {
  const db = await getDb();
  const existing = db.select({ id: autoRuns.id }).from(autoRuns).where(eq(autoRuns.id, id)).get();
  if (!existing) throw new NotFoundError("That Auto Mode run does not exist.");
  db.update(autoRuns)
    .set({
      ...(patch.status !== undefined ? { status: patch.status } : {}),
      ...(patch.mode !== undefined ? { mode: patch.mode } : {}),
      ...(patch.phase !== undefined ? { phase: patch.phase } : {}),
      ...(patch.targetChapters !== undefined ? { targetChapters: patch.targetChapters } : {}),
      ...(patch.currentChapter !== undefined ? { currentChapter: patch.currentChapter } : {}),
      ...(patch.currentScene !== undefined ? { currentScene: patch.currentScene } : {}),
      ...(patch.revisionCount !== undefined ? { revisionCount: patch.revisionCount } : {}),
      ...(patch.storyBible !== undefined ? { storyBibleJson: patch.storyBible } : {}),
      ...(patch.outline !== undefined ? { outlineJson: patch.outline } : {}),
      ...(patch.state !== undefined ? { stateJson: patch.state } : {}),
      ...(patch.lastError !== undefined ? { lastError: patch.lastError } : {}),
      ...(patch.startedAt !== undefined ? { startedAt: patch.startedAt } : {}),
      ...(patch.finishedAt !== undefined ? { finishedAt: patch.finishedAt } : {}),
      updatedAt: now(),
    })
    .where(eq(autoRuns.id, id))
    .run();
  return getAutoRun(id);
}

export async function appendAutoEvent(
  runId: string,
  event: {
    level?: "info" | "warn" | "error";
    phase: AutoPhase;
    chapter?: number | null;
    message: string;
    data?: unknown;
  },
): Promise<void> {
  const db = await getDb();
  db.insert(autoRunEvents)
    .values({
      runId,
      level: event.level ?? "info",
      phase: event.phase,
      chapter: event.chapter ?? null,
      message: event.message,
      dataJson: event.data ?? null,
      createdAt: now(),
    })
    .run();
}

export async function listAutoEvents(
  runId: string,
  afterId = 0,
  limit = 200,
): Promise<AutoRunEvent[]> {
  const db = await getDb();
  return db
    .select()
    .from(autoRunEvents)
    .where(and(eq(autoRunEvents.runId, runId), gt(autoRunEvents.id, afterId)))
    .orderBy(asc(autoRunEvents.id))
    .limit(Math.min(Math.max(limit, 1), 500))
    .all()
    .map(rowToEvent);
}

export async function getAutoRunChapter(
  runId: string,
  chapterNumber: number,
): Promise<AutoRunChapter | null> {
  const db = await getDb();
  const row = db
    .select()
    .from(autoRunChapters)
    .where(
      and(
        eq(autoRunChapters.runId, runId),
        eq(autoRunChapters.chapterNumber, chapterNumber),
      ),
    )
    .get();
  return row ? rowToChapter(row) : null;
}

export async function listAutoRunChapters(runId: string): Promise<AutoRunChapter[]> {
  const db = await getDb();
  return db
    .select()
    .from(autoRunChapters)
    .where(eq(autoRunChapters.runId, runId))
    .orderBy(asc(autoRunChapters.chapterNumber))
    .all()
    .map(rowToChapter);
}

export async function upsertAutoRunChapter(
  runId: string,
  chapterNumber: number,
  patch: {
    pageNumber?: number | null;
    status?: AutoRunChapterStatus;
    sceneIndex?: number;
    revisionCount?: number;
    scenes?: string[];
    qa?: AutoQaResult | null;
    summary?: string;
  },
): Promise<AutoRunChapter> {
  const db = await getDb();
  const existing = await getAutoRunChapter(runId, chapterNumber);
  const values = {
    runId,
    chapterNumber,
    pageNumber: patch.pageNumber ?? existing?.pageNumber ?? null,
    status: patch.status ?? existing?.status ?? "planned",
    sceneIndex: patch.sceneIndex ?? existing?.sceneIndex ?? 0,
    revisionCount: patch.revisionCount ?? existing?.revisionCount ?? 0,
    scenesJson: patch.scenes ?? existing?.scenes ?? [],
    qaJson: patch.qa !== undefined ? patch.qa : existing?.qa ?? null,
    summary: patch.summary ?? existing?.summary ?? "",
    updatedAt: now(),
  };
  db.insert(autoRunChapters)
    .values(values)
    .onConflictDoUpdate({
      target: [autoRunChapters.runId, autoRunChapters.chapterNumber],
      set: {
        pageNumber: values.pageNumber,
        status: values.status,
        sceneIndex: values.sceneIndex,
        revisionCount: values.revisionCount,
        scenesJson: values.scenesJson,
        qaJson: values.qaJson,
        summary: values.summary,
        updatedAt: values.updatedAt,
      },
    })
    .run();
  return (await getAutoRunChapter(runId, chapterNumber))!;
}

export async function recoverInterruptedAutoRuns(): Promise<number> {
  const db = await getDb();
  const rows = db
    .select({ id: autoRuns.id, phase: autoRuns.phase })
    .from(autoRuns)
    .where(eq(autoRuns.status, "running"))
    .all();
  for (const row of rows) {
    db.update(autoRuns)
      .set({
        status: "paused",
        lastError: "Server restarted while this run was active. Resume when ready.",
        updatedAt: now(),
      })
      .where(eq(autoRuns.id, row.id))
      .run();
    await appendAutoEvent(row.id, {
      level: "warn",
      phase: row.phase,
      message: "Run paused: the app server restarted while this job was active.",
    });
  }
  return rows.length;
}

export async function deleteAutoRun(id: string): Promise<void> {
  const db = await getDb();
  const existing = db.select({ id: autoRuns.id }).from(autoRuns).where(eq(autoRuns.id, id)).get();
  if (!existing) throw new NotFoundError("That Auto Mode run does not exist.");
  db.delete(autoRuns).where(eq(autoRuns.id, id)).run();
}
