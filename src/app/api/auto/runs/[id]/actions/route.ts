import { assertSameOrigin, errorResponse, jsonOk, parseBody } from "@/lib/api";
import { AppError } from "@/lib/errors";
import {
  appendAutoEvent,
  getAutoRun,
  listAutoRunChapters,
  updateAutoRun,
} from "@/lib/storage/auto-runs";
import { autoActionSchema } from "@/lib/auto/schemas";
import { abortAutoRun, startAutoRun } from "@/lib/auto/runner";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Params = { params: Promise<{ id: string }> };

export async function POST(request: Request, { params }: Params) {
  try {
    assertSameOrigin(request);
    const { id } = await params;
    const input = await parseBody(request, autoActionSchema);
    const run = await getAutoRun(id);

    if (input.action === "pause") {
      if (run.status !== "running" && run.status !== "queued") {
        throw new AppError("CONFLICT", "This run is not active.", { status: 409 });
      }
      abortAutoRun(id);
      const updated = await updateAutoRun(id, { status: "paused", lastError: null });
      await appendAutoEvent(id, {
        level: "warn",
        phase: run.phase,
        chapter: run.currentChapter,
        message: "Run paused by the author.",
      });
      return jsonOk({ run: updated, chapters: await listAutoRunChapters(id) });
    }

    if (input.action === "stop") {
      if (run.status === "completed" || run.status === "stopped") {
        throw new AppError("CONFLICT", "This run is already finished.", { status: 409 });
      }
      abortAutoRun(id);
      const updated = await updateAutoRun(id, {
        status: "stopped",
        finishedAt: new Date().toISOString(),
      });
      await appendAutoEvent(id, {
        level: "warn",
        phase: run.phase,
        chapter: run.currentChapter,
        message: "Run stopped by the author.",
      });
      return jsonOk({ run: updated, chapters: await listAutoRunChapters(id) });
    }

    if (run.status !== "paused" && run.status !== "failed" && run.status !== "stopped") {
      throw new AppError("CONFLICT", "Only paused, stopped, or failed runs can resume.", {
        status: 409,
      });
    }
    if (!run.state.planLockedAt) {
      throw new AppError(
        "CONFLICT",
        "Approve the plan in the planning workspace before resuming execution.",
        { status: 409 },
      );
    }
    if (
      run.mode === "checkpoint" &&
      !run.state.approved &&
      run.phase === "prose" &&
      run.outline.length > 0
    ) {
      throw new AppError(
        "CONFLICT",
        "Review and approve the checkpoint before resuming prose generation.",
        { status: 409 },
      );
    }

    const updated = await updateAutoRun(id, {
      status: "running",
      lastError: null,
      startedAt: run.startedAt ?? new Date().toISOString(),
      finishedAt: null,
    });
    await appendAutoEvent(id, {
      phase: run.phase,
      chapter: run.currentChapter,
      message: "Run resumed.",
    });
    startAutoRun(id);
    return jsonOk({ run: updated, chapters: await listAutoRunChapters(id) });
  } catch (error) {
    return errorResponse(error);
  }
}
