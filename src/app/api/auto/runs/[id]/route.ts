import { assertSameOrigin, errorResponse, jsonOk, parseBody } from "@/lib/api";
import { AppError } from "@/lib/errors";
import {
  appendAutoEvent,
  deleteAutoRun,
  getAutoRun,
  listAutoRunChapters,
  updateAutoRun,
} from "@/lib/storage/auto-runs";
import { autoPatchSchema } from "@/lib/auto/schemas";
import { startAutoRun } from "@/lib/auto/runner";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Params = { params: Promise<{ id: string }> };

export async function GET(_request: Request, { params }: Params) {
  try {
    const { id } = await params;
    const [run, chapters] = await Promise.all([getAutoRun(id), listAutoRunChapters(id)]);
    return jsonOk({ run, chapters });
  } catch (error) {
    return errorResponse(error);
  }
}

export async function PATCH(request: Request, { params }: Params) {
  try {
    assertSameOrigin(request);
    const { id } = await params;
    const input = await parseBody(request, autoPatchSchema);
    const run = await getAutoRun(id);
    if (run.status === "running") {
      throw new AppError(
        "CONFLICT",
        "Pause this run before editing the checkpoint.",
        { status: 409 },
      );
    }

    const updated = await updateAutoRun(id, {
      ...(input.storyBible
        ? { storyBible: input.storyBible, targetChapters: input.storyBible.targetChapters }
        : {}),
      ...(input.outline ? { outline: input.outline.chapters } : {}),
      ...(input.approve ? { state: { ...run.state, approved: true } } : {}),
      lastError: null,
    });

    if (input.storyBible || input.outline || input.approve) {
      await appendAutoEvent(id, {
        phase: updated.phase,
        chapter: updated.currentChapter,
        message: input.approve
          ? "Checkpoint approved. Prose generation resumes."
          : "Checkpoint edited and saved.",
      });
    }

    if (input.approve) {
      if (!run.state.planLockedAt) {
        throw new AppError(
          "CONFLICT",
          "Approve the plan in the planning workspace before starting execution.",
          { status: 409 },
        );
      }
      const resumed = await updateAutoRun(id, {
        status: "running",
        lastError: null,
        startedAt: updated.startedAt ?? new Date().toISOString(),
      });
      startAutoRun(id);
      return jsonOk({ run: resumed, chapters: await listAutoRunChapters(id) });
    }

    return jsonOk({ run: updated, chapters: await listAutoRunChapters(id) });
  } catch (error) {
    return errorResponse(error);
  }
}

export async function DELETE(request: Request, { params }: Params) {
  try {
    assertSameOrigin(request);
    const { id } = await params;
    const run = await getAutoRun(id);
    if (run.status === "running") {
      throw new AppError("CONFLICT", "Stop this run before deleting it.", { status: 409 });
    }
    await deleteAutoRun(id);
    return jsonOk({ deleted: true });
  } catch (error) {
    return errorResponse(error);
  }
}
