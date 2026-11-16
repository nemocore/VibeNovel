import { assertSameOrigin, errorResponse, jsonOk, parseBody } from "@/lib/api";
import { AppError } from "@/lib/errors";
import { requireConfig } from "@/lib/storage/config";
import { getNovel, updateNovelMeta } from "@/lib/storage/novels";
import {
  appendAutoEvent,
  createAutoRun,
  findActiveAutoRun,
  getAutoRun,
  listAutoRuns,
} from "@/lib/storage/auto-runs";
import { nextLogicalChapter } from "@/lib/auto/context";
import { autoStartSchema } from "@/lib/auto/schemas";
import { createAutoNovel, forkNovelForAuto } from "@/lib/auto/create";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  try {
    return jsonOk({ runs: await listAutoRuns() });
  } catch (error) {
    return errorResponse(error);
  }
}

/**
 * Creates an Auto Mode project. Nothing runs yet: the new run stays `queued`
 * until the plan is approved in the planning workspace.
 */
export async function POST(request: Request) {
  try {
    assertSameOrigin(request);
    const input = await parseBody(request, autoStartSchema);
    await requireConfig();

    let slug: string;
    let forkSource: string | null = null;

    if (input.slug) {
      slug = input.slug;
      const outline = await getNovel(slug);
      if (!outline.premise.trim()) {
        throw new AppError(
          "BAD_REQUEST",
          "Auto Mode needs a premise. Add one in Studio Mode first.",
          { status: 400 },
        );
      }
      const active = await findActiveAutoRun(outline.id);
      if (active) {
        throw new AppError(
          "CONFLICT",
          "This book already has an active Auto Mode run. Pause or stop it before starting another.",
          { status: 409 },
        );
      }
      if (input.fork) {
        forkSource = slug;
        const forked = await forkNovelForAuto(slug);
        slug = forked.slug;
      }
    } else {
      const created = await createAutoNovel({
        title: input.title!,
        premise: input.premise!,
        genre: input.genre,
        presetId: input.presetId,
      });
      slug = created.slug;
    }

    if (input.premise && !forkSource) {
      await updateNovelMeta(slug, { premise: input.premise });
    }

    const outline = await getNovel(slug);
    const startChapter = nextLogicalChapter(outline);
    const target = input.targetChapters ?? outline.chapters.filter((c) => c.kind === "chapter").length + 10;

    if (target < startChapter) {
      throw new AppError(
        "BAD_REQUEST",
        `Target chapter count must be at least ${startChapter}.`,
        { status: 400 },
      );
    }

    const run = await createAutoRun({
      bookId: outline.id,
      mode: input.mode,
      targetChapters: target,
      currentChapter: startChapter,
      approved: false,
    });

    await appendAutoEvent(run.id, {
      phase: "architect",
      chapter: startChapter,
      message: forkSource
        ? `Auto Mode project created from ${forkSource}. Planning starts at chapter ${startChapter}.`
        : `Auto Mode project created. Planning starts at chapter ${startChapter}.`,
    });

    return jsonOk({ run: await getAutoRun(run.id) }, { status: 201 });
  } catch (error) {
    return errorResponse(error);
  }
}
