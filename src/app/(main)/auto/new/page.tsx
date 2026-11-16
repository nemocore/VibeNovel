import Link from "next/link";
import { ArrowLeft, Workflow } from "lucide-react";
import { Button } from "@/components/ui/button";
import { AutoCreateForm } from "@/components/auto/auto-create-form";
import { listAutoBooks } from "@/lib/auto/create";
import { getConfig } from "@/lib/storage/config";
import { listAutoRuns } from "@/lib/storage/auto-runs";

export const dynamic = "force-dynamic";

export default async function AutoNewPage() {
  const [books, global, runs] = await Promise.all([
    listAutoBooks().catch(() => []),
    getConfig(),
    listAutoRuns().catch(() => []),
  ]);

  const activeBySlug = new Map<string, string>();
  for (const run of runs) {
    if (run.status === "running" || run.status === "paused" || run.status === "queued") {
      activeBySlug.set(run.slug, run.id);
    }
  }

  return (
    <div className="h-full overflow-y-auto">
      <div className="mx-auto w-full max-w-5xl px-5 pb-16 pt-6 sm:px-8">
        <Button asChild variant="ghost" size="sm" className="text-muted-foreground">
          <Link href="/auto">
            <ArrowLeft />
            All runs
          </Link>
        </Button>

        <header className="mt-4 border-b border-border pb-5">
          <div className="flex items-center gap-2">
            <Workflow className="size-4 text-[#f2c477]" />
            <p className="font-mono text-[9px] uppercase tracking-[0.16em] text-[#f2c477]">
              New Auto Mode project
            </p>
          </div>
          <h1 className="mt-2 font-serif text-[2.2rem] leading-none tracking-[-0.03em]">
            Start a novel
          </h1>
          <p className="mt-2 max-w-2xl text-[12.5px] leading-relaxed text-muted-foreground">
            Begin a novel from scratch or continue one you already drafted. Both paths open the
            planning workspace before a single chapter is written.
          </p>
        </header>

        <div className="mt-6">
          <AutoCreateForm
            books={books.map((book) => ({
              ...book,
              activeRunId: activeBySlug.get(book.slug) ?? null,
            }))}
            presets={global?.presets.map((preset) => ({ id: preset.id, name: preset.name })) ?? []}
            defaultPresetId={global?.defaultPresetId ?? null}
          />
        </div>
      </div>
    </div>
  );
}
