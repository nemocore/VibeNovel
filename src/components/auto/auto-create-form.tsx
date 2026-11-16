"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { ArrowRight, BookCopy, Loader2, Plus } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";

type BookOption = {
  slug: string;
  title: string;
  premise: string;
  tone: string;
  chapterCount: number;
  currentChapter: number;
  wordCount: number;
  startChapter: number;
  activeRunId: string | null;
};

type PresetOption = { id: string; name: string };

export function AutoCreateForm({
  books,
  presets,
  defaultPresetId,
}: {
  books: BookOption[];
  presets: PresetOption[];
  defaultPresetId: string | null;
}) {
  const router = useRouter();
  const [tab, setTab] = useState<"new" | "existing">("new");

  const [title, setTitle] = useState("");
  const [premise, setPremise] = useState("");
  const [genre, setGenre] = useState("");
  const [target, setTarget] = useState("12");
  const [presetId, setPresetId] = useState(defaultPresetId ?? presets[0]?.id ?? "");

  const [slug, setSlug] = useState(books[0]?.slug ?? "");
  const [fork, setFork] = useState(true);

  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const selected = books.find((book) => book.slug === slug);
  const newReady = title.trim().length > 0 && premise.trim().length >= 20;
  const existingReady = Boolean(slug);

  async function create() {
    if (tab === "new" && !newReady) {
      setError("Give the novel a working title and at least a sentence or two of premise.");
      return;
    }
    if (tab === "existing" && !existingReady) {
      setError("Choose a book to continue.");
      return;
    }
    setSubmitting(true);
    setError(null);
    try {
      const response = await fetch("/api/auto/runs", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(
          tab === "new"
            ? {
                title,
                premise,
                genre: genre || undefined,
                targetChapters: Number(target) || undefined,
                presetId: presetId || undefined,
              }
            : { slug, fork },
        ),
      });
      const payload = (await response.json().catch(() => null)) as
        | { run?: { id: string }; error?: { message?: string } }
        | null;
      if (!response.ok || !payload?.run) {
        setError(payload?.error?.message || "The project could not be created.");
        return;
      }
      toast.success("Project created. Plan it with the planner.");
      router.push(`/auto/${payload.run.id}/plan`);
    } catch {
      setError("Could not reach the app server.");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="grid gap-8 lg:grid-cols-[minmax(0,1fr)_340px]">
      <div className="min-w-0">
        <div
          role="tablist"
          aria-label="Project source"
          className="flex items-center gap-1 border-b border-border"
        >
          {(
            [
              { value: "new", label: "New novel" },
              { value: "existing", label: "Continue existing book" },
            ] as const
          ).map((item) => (
            <button
              key={item.value}
              type="button"
              role="tab"
              aria-selected={tab === item.value}
              onClick={() => setTab(item.value)}
              className={cn(
                "relative px-3 py-2 text-[11.5px] transition-colors",
                tab === item.value
                  ? "text-foreground"
                  : "text-muted-foreground hover:text-foreground",
              )}
            >
              {item.label}
              {tab === item.value ? (
                <span className="absolute inset-x-2 -bottom-px h-px bg-primary" />
              ) : null}
            </button>
          ))}
        </div>

        <div hidden={tab !== "new"} className={tab === "new" ? "mt-5 space-y-4" : "hidden"}>
          <div className="space-y-4">
            <div className="space-y-1.5">
              <Label htmlFor="auto-title">Working title</Label>
              <Input
                id="auto-title"
                value={title}
                onChange={(event) => setTitle(event.target.value)}
                placeholder="The Cartographer's Debt"
                maxLength={200}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="auto-premise">Premise / synopsis</Label>
              <Textarea
                id="auto-premise"
                value={premise}
                onChange={(event) => setPremise(event.target.value)}
                placeholder="Who the story follows, what they want, what stands in the way, and the ending the story must earn."
                className="min-h-44 resize-y text-[12.5px] leading-relaxed"
              />
              <p className="text-[10.5px] leading-relaxed text-muted-foreground">
                A few sentences are enough. The planning chat shapes the rest before anything runs.
              </p>
            </div>
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-1.5">
                <Label htmlFor="auto-genre">Genre &amp; tone notes</Label>
                <Input
                  id="auto-genre"
                  value={genre}
                  onChange={(event) => setGenre(event.target.value)}
                  placeholder="Literary suspense, quiet, close third"
                  maxLength={500}
                />
                <p className="text-[10.5px] leading-relaxed text-muted-foreground">
                  Drives the novel&apos;s voice and its skill prompts.
                </p>
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="auto-target">Target chapters</Label>
                <Input
                  id="auto-target"
                  type="number"
                  min={2}
                  max={200}
                  value={target}
                  onChange={(event) => setTarget(event.target.value)}
                  className="font-mono"
                />
                <p className="text-[10.5px] leading-relaxed text-muted-foreground">
                  Starts at chapter 01 and writes through the target.
                </p>
              </div>
            </div>
            {presets.length ? (
              <div className="space-y-1.5">
                <Label htmlFor="auto-preset">Preset</Label>
                <Select
                  id="auto-preset"
                  value={presetId}
                  onChange={(event) => setPresetId(event.target.value)}
                >
                  {presets.map((preset) => (
                    <option key={preset.id} value={preset.id}>
                      {preset.name}
                    </option>
                  ))}
                </Select>
                <p className="text-[10.5px] leading-relaxed text-muted-foreground">
                  The novel snapshots this preset&apos;s prompts and models. Later preset changes
                  do not reach it.
                </p>
              </div>
            ) : null}
          </div>
        </div>
        <div hidden={tab !== "existing"} className={tab === "existing" ? "mt-5 space-y-4" : "hidden"}>
          <div className="space-y-4">
            {!books.length ? (
              <p className="border border-border bg-[#0d131a] px-4 py-10 text-center text-[12px] text-muted-foreground">
                No books yet. Create a new novel in the other tab.
              </p>
            ) : (
              <>
                <div className="space-y-1.5">
                  <Label htmlFor="auto-book">Book</Label>
                  <Select
                    id="auto-book"
                    value={slug}
                    onChange={(event) => setSlug(event.target.value)}
                  >
                    {books.map((book) => (
                      <option key={book.slug} value={book.slug}>
                        {book.title} — {book.chapterCount} chapter
                        {book.chapterCount === 1 ? "" : "s"}
                      </option>
                    ))}
                  </Select>
                </div>
                {selected ? (
                  <div className="border border-border bg-[#0d131a] p-3">
                    <p className="text-[11.5px] leading-relaxed text-muted-foreground">
                      {selected.premise || "No premise recorded in Studio Mode."}
                    </p>
                    <dl className="mt-3 grid grid-cols-3 gap-3 border-t border-border pt-3">
                      <Stat label="Chapters" value={String(selected.chapterCount)} />
                      <Stat label="Current" value={String(selected.currentChapter)} />
                      <Stat label="Words" value={new Intl.NumberFormat("en-US").format(selected.wordCount)} />
                    </dl>
                    <p className="mt-2 text-[10.5px] leading-relaxed text-muted-foreground">
                      Auto Mode starts at chapter {String(selected.startChapter).padStart(2, "0")}
                      {selected.startChapter === 1 && selected.wordCount === 0
                        ? " — the first unwritten chapter, filled in place."
                        : " — the first unwritten chapter."}
                    </p>
                    {selected.activeRunId ? (
                      <p className="mt-3 text-[11px] leading-relaxed text-[#f2937f]">
                        This book already has an Auto Mode run. Pause or stop it before starting
                        another.
                      </p>
                    ) : null}
                  </div>
                ) : null}
                <label
                  htmlFor="auto-fork"
                  className="flex items-start gap-2.5 border border-border p-3"
                >
                  <input
                    id="auto-fork"
                    type="checkbox"
                    checked={fork}
                    onChange={(event) => setFork(event.target.checked)}
                    className="mt-0.5 size-3.5 accent-[#f2a93b]"
                  />
                  <span className="text-[11.5px] leading-relaxed">
                    <span className="flex items-center gap-1.5 font-medium">
                      <BookCopy className="size-3.5" />
                      Copy into a new Auto Mode book
                    </span>
                    <span className="mt-0.5 block text-muted-foreground">
                      Recommended. Chapters, summaries, and characters carry over. The original
                      Studio manuscript is left untouched.
                    </span>
                  </span>
                </label>
              </>
            )}
          </div>
        </div>

        {error ? (
          <p className="mt-4 text-[11.5px] leading-relaxed text-[#f2937f]">{error}</p>
        ) : null}

        <div className="mt-5">
          <Button
            onClick={() => void create()}
            disabled={submitting || (tab === "new" ? !newReady : !existingReady)}
          >
            {submitting ? <Loader2 className="animate-spin" /> : <Plus />}
            Create project
            <ArrowRight />
          </Button>
        </div>
      </div>

      <aside className="min-w-0 border-t border-border pt-5 lg:border-l lg:border-t-0 lg:pl-6 lg:pt-0">
        <p className="font-mono text-[9px] uppercase tracking-[0.16em] text-[#f2c477]">
          What happens next
        </p>
        <ol className="mt-3 space-y-3">
          {[
            ["Plan", "Chat with the planner to settle premise, cast, arc, and ending."],
            ["Approve", "Lock the plan. It becomes binding input for the pipeline."],
            ["Skills", "Tune any of the six skill prompts for this novel alone."],
            ["Run", "Autopilot or checkpoint. Chapters land one at a time."],
          ].map(([label, body], index) => (
            <li key={label} className="flex gap-3">
              <span className="mt-0.5 w-5 shrink-0 font-mono text-[10px] tabular text-[#f2c477]">
                {String(index + 1).padStart(2, "0")}
              </span>
              <span>
                <span className="block text-[12px] font-medium">{label}</span>
                <span className="mt-0.5 block text-[11px] leading-relaxed text-muted-foreground">
                  {body}
                </span>
              </span>
            </li>
          ))}
        </ol>
        <p className="mt-4 border-t border-border pt-3 text-[10.5px] leading-relaxed text-muted-foreground">
          Nothing is generated until you approve the plan.
        </p>
      </aside>
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt className="font-mono text-[9px] uppercase tracking-[0.12em] text-muted-foreground">
        {label}
      </dt>
      <dd className="mt-0.5 font-mono text-[13px] tabular">{value}</dd>
    </div>
  );
}
