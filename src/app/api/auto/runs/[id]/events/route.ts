import { errorResponse, jsonOk } from "@/lib/api";
import { getAutoRun, listAutoEvents } from "@/lib/storage/auto-runs";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Params = { params: Promise<{ id: string }> };

export async function GET(request: Request, { params }: Params) {
  try {
    const { id } = await params;
    await getAutoRun(id);
    const url = new URL(request.url);
    const after = Number(url.searchParams.get("after") ?? 0);
    const limit = Number(url.searchParams.get("limit") ?? 200);
    return jsonOk({
      events: await listAutoEvents(
        id,
        Number.isFinite(after) ? after : 0,
        Number.isFinite(limit) ? limit : 200,
      ),
    });
  } catch (error) {
    return errorResponse(error);
  }
}
