import { assertSameOrigin, errorResponse, jsonOk, parseBody } from "@/lib/api";
import { AppError } from "@/lib/errors";
import { getNovel, updateNovelMeta } from "@/lib/storage/novels";
import {
  appendAutoEvent,
  getAutoRun,
  updateAutoRun,
} from "@/lib/storage/auto-runs";
import { saveAutoSkillPrompts } from "@/lib/storage/auto-skills";
import { decodePremise, encodePremise } from "@/lib/auto/create";
import { startAutoRun } from "@/lib/auto/runner";
import { autoPlanLockSchema } from "@/lib/auto/schemas";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Params = { params: Promise<{ id: string }> };

/**
 * Locks the discussed plan as the foundation for the pipeline and either starts
 * autonomous execution or leaves the run parked at the Story Bible checkpoint.
 */
export async function POST(request: Request, { params }: Params) {
  try {
    assertSameOrigin(request);
    const { id } = await params;
    const input = await parseBody(request, autoPlanLockSchema);
    const run = await getAutoRun(id);
    if (run.status === "completed") {
      throw new AppError("CONFLICT", "This run already finished.", { status: 409 });
    }
    if (run.status === "running") {
      throw new AppError("CONFLICT", "Pause the run before changing the plan.", { status: 409 });
    }

    const outline = await getNovel(run.slug);
    const decoded = decodePremise(outline.premise);
    const brief = input.planBrief.trim();

    // The discussed plan becomes the premise every skill reads, so Studio Mode shows it too.
    await updateNovelMeta(run.slug, {
      premise: encodePremise(brief, decoded.tone),
    });

    if (input.planPrompts) {
      await saveAutoSkillPrompts(run.slug, {
        values: {
          ...(input.planPrompts.system !== undefined
            ? { auto_plan_system: input.planPrompts.system }
            : {}),
          ...(input.planPrompts.task !== undefined
            ? { auto_plan_task: input.planPrompts.task }
            : {}),
        },
      });
    }

    const target = input.targetChapters ?? run.targetChapters;
    if (target < run.currentChapter) {
      throw new AppError(
        "BAD_REQUEST",
        `Target chapter count must be at least ${run.currentChapter}.`,
        { status: 400 },
      );
    }

    const started = new Date().toISOString();
    const next = await updateAutoRun(id, {
      targetChapters: target,
      mode: input.mode ?? run.mode,
      status: "running",
      startedAt: run.startedAt ?? started,
      finishedAt: null,
      lastError: null,
      state: {
        ...run.state,
        planBrief: brief,
        planLockedAt: run.state.planLockedAt ?? started,
        approved: (input.mode ?? run.mode) === "autopilot" ? true : run.state.approved,
      },
    });

    await appendAutoEvent(id, {
      phase: next.phase,
      chapter: next.currentChapter,
      message: `Plan approved. Autonomous execution started (${next.mode}) at chapter ${next.currentChapter}.`,
    });

    startAutoRun(id);
    return jsonOk({ run: next, chapters: [] });
  } catch (error) {
    return errorResponse(error);
  }
}
