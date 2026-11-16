import { assertSameOrigin, errorResponse, jsonOk, parseBody } from "@/lib/api";
import { getAutoRun } from "@/lib/storage/auto-runs";
import { saveAutoSkillPrompts } from "@/lib/storage/auto-skills";
import { autoSkillsSchema } from "@/lib/auto/schemas";
import { getAutoSkillsSnapshot, type AutoSkillsSnapshotPayload } from "@/lib/auto/skills-state";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Params = { params: Promise<{ id: string }> };

function payload(run: Awaited<ReturnType<typeof getAutoRun>>, snapshot: AutoSkillsSnapshotPayload) {
  return {
    ...snapshot,
    slug: run.slug,
    bookTitle: run.bookTitle,
    status: run.status,
    phase: run.phase,
  };
}

export async function GET(_request: Request, { params }: Params) {
  try {
    const { id } = await params;
    const run = await getAutoRun(id);
    return jsonOk(payload(run, await getAutoSkillsSnapshot(run.slug)));
  } catch (error) {
    return errorResponse(error);
  }
}

export async function PUT(request: Request, { params }: Params) {
  try {
    assertSameOrigin(request);
    const { id } = await params;
    const input = await parseBody(request, autoSkillsSchema);
    const run = await getAutoRun(id);
    await saveAutoSkillPrompts(run.slug, input);
    return jsonOk(payload(run, await getAutoSkillsSnapshot(run.slug)));
  } catch (error) {
    return errorResponse(error);
  }
}