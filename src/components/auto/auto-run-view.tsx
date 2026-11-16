"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import {
  AlertTriangle,
  ArrowLeft,
  ArrowRight,
  BookOpen,
  Check,
  Loader2,
  MessagesSquare,
  Pause,
  Play,
  Save,
  SlidersHorizontal,
  Square,
} from "lucide-react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Textarea } from "@/components/ui/textarea";
import { StatusDot } from "@/components/status-dot";
import { LocalTime } from "@/components/relative-time";
import { AutoSkillsPanel } from "@/components/auto/auto-skills-panel";
import {
  useAutoSkillsState,
  type AutoSkillsController,
  type AutoSkillsSnapshot,
} from "@/components/auto/use-auto-skills";
import { cn } from "@/lib/utils";
import type {
  AutoOutlineInput,
  AutoStoryBibleInput,
} from "@/lib/auto/schemas";
import type {
  AutoModelRole,
  AutoRun,
  AutoRunChapter,
  AutoRunEvent,
} from "@/lib/auto/types";

const PHASE_LABEL: Record<string, string> = {
  architect: "Story Architect",
  characters: "Character Weaver",
  outline: "Arc & Scene Outliner",
  prose: "Scene Prose Writer",
  qa: "Continuity & QA Critic",
  archive: "State Archivist",
  done: "Complete",
};

function statusLabel(status: AutoRun["status"]) {
  if (status === "queued") return "Queued";
  if (status === "running") return "Running";
  if (status === "paused") return "Paused";
  if (status === "completed") return "Completed";
  if (status === "failed") return "Failed";
  return "Stopped";
}

function statusTone(status: AutoRun["status"]) {
  if (status === "completed") return "success" as const;
  if (status === "failed") return "danger" as const;
  if (status === "running" || status === "queued") return "amber" as const;
  return "default" as const;
}

export function AutoRunView({
  initialRun,
  initialChapters,
  initialEvents,
  initialSkills,
}: {
  initialRun: AutoRun;
  initialChapters: AutoRunChapter[];
  initialEvents: AutoRunEvent[];
  initialSkills: AutoSkillsSnapshot;
}) {
  const [run, setRun] = useState(initialRun);
  const [chapters, setChapters] = useState(initialChapters);
  const [events, setEvents] = useState(initialEvents);
  const [skillPanel, setSkillPanel] = useState<AutoModelRole>("prose");
  const skillsState = useAutoSkillsState(initialRun.id, initialSkills);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    try {
      const response = await fetch(`/api/auto/runs/${initialRun.id}`, { cache: "no-store" });
      const payload = (await response.json().catch(() => null)) as
        | { run?: AutoRun; chapters?: AutoRunChapter[]; error?: { message?: string } }
        | null;
      if (response.ok && payload?.run && payload.chapters) {
        setRun(payload.run);
        setChapters(payload.chapters);
      }
      const eventResponse = await fetch(
        `/api/auto/runs/${initialRun.id}/events?after=0&limit=200`,
        { cache: "no-store" },
      );
      const eventPayload = (await eventResponse.json().catch(() => null)) as
        | { events?: AutoRunEvent[] }
        | null;
      if (eventResponse.ok && eventPayload?.events) setEvents(eventPayload.events);
    } catch {
      // Keep last known state.
    }
  }, [initialRun.id]);

  useEffect(() => {
    const timer = window.setInterval(() => {
      void refresh();
    }, 2500);
    return () => window.clearInterval(timer);
  }, [refresh]);

  async function act(action: "pause" | "resume" | "stop") {
    setBusy(action);
    setError(null);
    try {
      const response = await fetch(`/api/auto/runs/${run.id}/actions`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action }),
      });
      const payload = (await response.json().catch(() => null)) as
        | { run?: AutoRun; chapters?: AutoRunChapter[]; error?: { message?: string } }
        | null;
      if (!response.ok) {
        setError(payload?.error?.message || "The run could not be updated.");
        return;
      }
      if (payload?.run) setRun(payload.run);
      if (payload?.chapters) setChapters(payload.chapters);
      toast.success(
        action === "pause" ? "Run paused." : action === "resume" ? "Run resumed." : "Run stopped.",
      );
    } catch {
      setError("Could not reach the app server.");
    } finally {
      setBusy(null);
    }
  }

  const active = run.status === "running" || run.status === "queued";
  const resumable = run.status === "paused" || run.status === "failed" || run.status === "stopped";
  const planApproved = Boolean(run.state.planLockedAt);
  const checkpointReady =
    run.mode === "checkpoint" &&
    !run.state.approved &&
    Boolean(run.storyBible) &&
    run.outline.length > 0 &&
    (run.status === "paused" || run.status === "failed" || run.status === "stopped");
  const progress =
    run.targetChapters > 0
      ? Math.min(100, Math.round(((run.currentChapter - 1) / run.targetChapters) * 100))
      : 0;
  const latestPage = [...chapters]
    .filter((chapter) => chapter.pageNumber)
    .sort((a, b) => b.chapterNumber - a.chapterNumber)
    .find((chapter) => chapter.status === "prose" || chapter.status === "archived");

  return (
    <div className="h-full overflow-y-auto">
      <div className="mx-auto w-full max-w-4xl px-5 pb-16 pt-6 sm:px-8">
        <div className="flex items-center justify-between gap-3">
          <Button asChild variant="ghost" size="sm" className="text-muted-foreground">
            <Link href="/auto">
              <ArrowLeft />
              All runs
            </Link>
          </Button>
          <span className="font-mono text-[9px] uppercase tracking-[0.14em] text-muted-foreground">
            Run {run.id.slice(0, 8)}
          </span>
        </div>

        <header className="mt-5 border-b border-border pb-5">
          <div className="flex flex-wrap items-center gap-2">
            <StatusDot
              tone={run.status === "running" ? "success" : run.status === "failed" ? "danger" : "muted"}
              pulse={run.status === "running"}
            />
            <span className="font-mono text-[9px] uppercase tracking-[0.16em] text-[#f2c477]">
              Auto Mode
            </span>
            <Badge variant={statusTone(run.status)}>{statusLabel(run.status)}</Badge>
            <span className="font-mono text-[10px] text-muted-foreground">
              {run.mode === "checkpoint" ? "Checkpoint" : "Autopilot"}
            </span>
          </div>
          <div className="mt-2 flex flex-wrap items-end justify-between gap-3">
            <div className="min-w-0">
              <h1 className="truncate font-serif text-[2rem] leading-tight tracking-[-0.02em]">
                {run.bookTitle}
              </h1>
              <p className="mt-1 text-[11.5px] text-muted-foreground">
                {checkpointReady ? "Checkpoint review" : PHASE_LABEL[run.phase] ?? run.phase}
                {run.targetChapters > 0
                  ? ` - Chapter ${run.currentChapter} of ${run.targetChapters}`
                  : " - planning"}
                {run.currentScene > 0 ? ` - Scene ${run.currentScene}` : ""}
                {run.revisionCount > 0 ? ` - Revision ${run.revisionCount}` : ""}
              </p>
            </div>
            <div className="flex flex-wrap items-center gap-1.5">
              {active ? (
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={() => void act("pause")}
                  disabled={busy !== null}
                >
                  {busy === "pause" ? <Loader2 className="animate-spin" /> : <Pause />}
                  Pause
                </Button>
              ) : null}
              {resumable ? (
                <Button
                  size="sm"
                  variant="secondary"
                  onClick={() => void act("resume")}
                  disabled={busy !== null || !planApproved}
                  title={planApproved ? "Resume the run" : "Approve the plan first"}
                >
                  {busy === "resume" ? <Loader2 className="animate-spin" /> : <Play />}
                  Resume
                </Button>
              ) : null}
              {!planApproved && run.mode === "checkpoint" ? (
                <Button asChild size="sm">
                  <Link href={`/auto/${run.id}/plan`}>
                    <MessagesSquare />
                    Approve plan
                  </Link>
                </Button>
              ) : null}
              <SkillsDialog
                state={skillsState}
                panel={skillPanel}
                onPanelChange={setSkillPanel}
                running={run.status === "running"}
              />
              {run.status !== "completed" && run.status !== "stopped" ? (
                <Button
                  size="sm"
                  variant="ghost"
                  className="text-muted-foreground hover:text-[#f2937f]"
                  onClick={() => void act("stop")}
                  disabled={busy !== null}
                >
                  {busy === "stop" ? <Loader2 className="animate-spin" /> : <Square className="size-3 fill-current" />}
                  Stop
                </Button>
              ) : null}
              <Button asChild size="sm" variant="ghost">
                <Link href={`/novels/${run.slug}`}>
                  Book
                  <ArrowRight />
                </Link>
              </Button>
              {latestPage?.pageNumber ? (
                <Button asChild size="sm" variant="ghost">
                  <Link href={`/auto/${run.id}/monitor?chapter=${latestPage.chapterNumber}`}>
                    <BookOpen />
                    Read latest
                  </Link>
                </Button>
              ) : null}
            </div>
          </div>
          <div className="mt-4 flex items-center gap-3">
            <div className="h-px flex-1 bg-border">
              <div
                className="h-px bg-[#f2c477] transition-[width] duration-500"
                style={{ width: `${progress}%` }}
              />
            </div>
            <span className="font-mono text-[9px] tabular text-muted-foreground">
              {run.targetChapters > 0 ? `${progress}%` : "Planning"}
            </span>
          </div>
          {run.lastError ? (
            <p className="mt-3 flex items-start gap-2 border border-[#5a2c25] bg-[#241411] p-2.5 text-[11.5px] leading-relaxed text-[#f2937f]">
              <AlertTriangle className="mt-0.5 size-3.5 shrink-0" />
              {run.lastError}
            </p>
          ) : null}
          <p className="mt-3 text-[10.5px] leading-relaxed text-muted-foreground/80">
            Reading is safe while Auto Mode writes. Avoid editing the chapter currently being
            drafted until the run pauses or completes.
          </p>
          {error ? (
            <p className="mt-3 text-[11.5px] leading-relaxed text-[#f2937f]">{error}</p>
          ) : null}
        </header>

        {checkpointReady ? (
          <CheckpointPanel
            run={run}
            onChanged={async () => {
              await refresh();
            }}
          />
        ) : run.storyBible ? (
          <details className="mt-6 border border-border bg-[#0d131a] p-3">
            <summary className="cursor-pointer select-none font-mono text-[10px] uppercase tracking-[0.14em] text-muted-foreground">
              Story Bible & outline
            </summary>
            <pre className="mt-3 max-h-80 overflow-auto bg-[#070b10] p-3 font-mono text-[10.5px] leading-relaxed text-foreground/80">
              {JSON.stringify({ storyBible: run.storyBible, outline: run.outline }, null, 2)}
            </pre>
          </details>
        ) : null}

        <section className="mt-6">
          <div className="flex items-baseline justify-between border-b border-border pb-2">
            <h2 className="font-mono text-[10px] uppercase tracking-[0.16em] text-[#f2c477]">
              Skill progress
            </h2>
            <Link
              href={`/auto/${run.id}/monitor`}
              className="font-mono text-[10px] text-muted-foreground hover:text-[#f2c477]"
            >
              Open live reader
            </Link>
          </div>
          <ol className="grid grid-cols-2 gap-px border-b border-border bg-border sm:grid-cols-3 lg:grid-cols-6">
            {(["architect", "characters", "outline", "prose", "qa", "archive"] as const).map(
              (phase, index) => {
                const order = [
                  "architect",
                  "characters",
                  "outline",
                  "prose",
                  "qa",
                  "archive",
                  "done",
                ];
                const currentIndex = order.indexOf(run.phase);
                const state =
                  run.phase === "done"
                    ? "done"
                    : index < currentIndex
                      ? "done"
                      : index === currentIndex
                        ? "active"
                        : "pending";
                return (
                  <li key={phase} className="bg-[#0d131a] px-3 py-2.5">
                    <div className="flex items-center gap-1.5">
                      <span
                        className={cn(
                          "size-1.5 rounded-full",
                          state === "done"
                            ? "bg-[#86bd93]"
                            : state === "active"
                              ? "animate-pulse-dot bg-[#f2c477]"
                              : "bg-muted-foreground/40",
                        )}
                      />
                      <span className="font-mono text-[9px] tabular text-muted-foreground">
                        {String(index + 1).padStart(2, "0")}
                      </span>
                    </div>
                    <p
                      className={cn(
                        "mt-1 text-[11px] leading-tight",
                        state === "pending" ? "text-muted-foreground/70" : "text-foreground",
                      )}
                    >
                      {PHASE_LABEL[phase]}
                    </p>
                  </li>
                );
              },
            )}
          </ol>
        </section>

        <section className="mt-6">
          <div className="flex items-baseline justify-between border-b border-border pb-2">
            <h2 className="font-mono text-[10px] uppercase tracking-[0.16em] text-[#f2c477]">
              Chapters
            </h2>
            <span className="font-mono text-[10px] text-muted-foreground">
              {chapters.filter((chapter) => chapter.status === "archived").length} archived
            </span>
          </div>
          {chapters.length ? (
            <ol className="divide-y divide-border border-b border-border">
              {chapters.map((chapter) => (
                <li key={chapter.chapterNumber} className="flex flex-wrap items-start gap-3 py-3">
                  <span className="font-mono text-[10px] tabular text-muted-foreground">
                    {String(chapter.chapterNumber).padStart(2, "0")}
                  </span>
                  <div className="min-w-0 flex-1">
                    <p className="text-[12.5px] font-medium">
                      {run.outline.find((plan) => plan.number === chapter.chapterNumber)?.title ??
                        `Chapter ${chapter.chapterNumber}`}
                    </p>
                    <p className="mt-0.5 line-clamp-1 text-[11px] text-muted-foreground">
                      {chapter.summary || `${chapter.scenes.filter(Boolean).length} scenes drafted`}
                    </p>
                  </div>
                  <Badge
                    variant={
                      chapter.status === "archived"
                        ? "success"
                        : chapter.status === "failed"
                          ? "danger"
                          : chapter.status === "qa" || chapter.status === "revising"
                            ? "amber"
                            : "default"
                    }
                  >
                    {chapter.status}
                  </Badge>
                  {chapter.pageNumber ? (
                    <Button asChild size="sm" variant="ghost" className="h-7 px-1.5 text-[10px]">
                      <Link href={`/auto/${run.id}/monitor?chapter=${chapter.chapterNumber}`}>
                        Read
                      </Link>
                    </Button>
                  ) : null}
                </li>
              ))}
            </ol>
          ) : (
            <p className="py-6 text-[12px] text-muted-foreground">
              No chapters written yet. The outline will appear here.
            </p>
          )}
        </section>

        <section className="mt-8">
          <div className="flex items-baseline justify-between border-b border-border pb-2">
            <h2 className="font-mono text-[10px] uppercase tracking-[0.16em] text-[#f2c477]">
              Execution log
            </h2>
            <span className="font-mono text-[10px] text-muted-foreground">
              {events.length} events
            </span>
          </div>
          <div className="max-h-80 overflow-y-auto border-b border-border bg-[#070b10] px-3 py-2 font-mono text-[10.5px] leading-relaxed">
            {events.length ? (
              events.map((event) => (
                <p
                  key={event.id}
                  className={cn(
                    "py-0.5",
                    event.level === "error"
                      ? "text-[#f2937f]"
                      : event.level === "warn"
                        ? "text-[#f2c477]"
                        : "text-muted-foreground",
                  )}
                >
                  <span className="mr-2 text-muted-foreground/50">
                    <LocalTime value={event.createdAt} />
                  </span>
                  <span className="mr-1 uppercase text-muted-foreground/60">
                    {event.phase}
                  </span>
                  {event.message}
                </p>
              ))
            ) : (
              <p className="py-3 text-muted-foreground">No events yet.</p>
            )}
          </div>
        </section>
      </div>
    </div>
  );
}

function SkillsDialog({
  state,
  panel,
  onPanelChange,
  running,
}: {
  state: AutoSkillsController;
  panel: AutoModelRole;
  onPanelChange: (panel: AutoModelRole) => void;
  running: boolean;
}) {
  return (
    <Dialog>
      <DialogTrigger asChild>
        <Button size="sm" variant="ghost">
          <SlidersHorizontal />
          Skill prompts
        </Button>
      </DialogTrigger>
      <DialogContent className="max-h-[90vh] w-full max-w-5xl overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Novel skill prompts</DialogTitle>
          <DialogDescription>
            The six Auto Mode skills as they run for this novel. Edits apply to this novel only and
            take effect on the next skill call.
          </DialogDescription>
        </DialogHeader>
        <AutoSkillsPanel
          state={state}
          panel={panel}
          onPanelChange={onPanelChange}
          readOnlyHint={
            running
              ? "This run is active. Saved edits apply from the next step; pause the run to change the plan itself."
              : null
          }
        />
      </DialogContent>
    </Dialog>
  );
}

function CheckpointPanel({
  run,
  onChanged,
}: {
  run: AutoRun;
  onChanged: () => Promise<void>;
}) {
  const [bible, setBible] = useState(() => JSON.stringify(run.storyBible, null, 2));
  const [outline, setOutline] = useState(() => JSON.stringify({ chapters: run.outline }, null, 2));
  const [busy, setBusy] = useState<"save" | "approve" | null>(null);
  const [error, setError] = useState<string | null>(null);

  function parseDrafts(): { storyBible: AutoStoryBibleInput; outline: AutoOutlineInput } | null {
    let parsedBible: unknown;
    let parsedOutline: unknown;
    try {
      parsedBible = JSON.parse(bible);
    } catch {
      setError("Story Bible is not valid JSON.");
      return null;
    }
    try {
      parsedOutline = JSON.parse(outline);
    } catch {
      setError("Outline is not valid JSON.");
      return null;
    }
    return {
      storyBible: parsedBible as AutoStoryBibleInput,
      outline: parsedOutline as AutoOutlineInput,
    };
  }

  async function submit(approve: boolean) {
    const drafts = parseDrafts();
    if (!drafts) return;
    setBusy(approve ? "approve" : "save");
    setError(null);
    try {
      const response = await fetch(`/api/auto/runs/${run.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          storyBible: drafts.storyBible,
          outline: drafts.outline,
          ...(approve ? { approve: true } : {}),
        }),
      });
      const payload = (await response.json().catch(() => null)) as
        | { error?: { message?: string } }
        | null;
      if (!response.ok) {
        setError(payload?.error?.message || "The checkpoint could not be saved.");
        return;
      }
      toast.success(approve ? "Checkpoint approved. Prose resumes." : "Checkpoint saved.");
      await onChanged();
    } catch {
      setError("Could not reach the app server.");
    } finally {
      setBusy(null);
    }
  }

  return (
    <section className="mt-6 border border-[#5b431c] bg-[#1b1409] p-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="font-mono text-[10px] uppercase tracking-[0.16em] text-[#f2c477]">
            Milestone checkpoint
          </h2>
          <p className="mt-1 max-w-2xl text-[11.5px] leading-relaxed text-[#c9a86e]">
            Review the Story Bible, character roster, and master outline. Edit the JSON, save,
            then approve to begin scene prose.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Button
            size="sm"
            variant="secondary"
            onClick={() => void submit(false)}
            disabled={busy !== null}
          >
            {busy === "save" ? <Loader2 className="animate-spin" /> : <Save />}
            Save
          </Button>
          <Button size="sm" onClick={() => void submit(true)} disabled={busy !== null}>
            {busy === "approve" ? <Loader2 className="animate-spin" /> : <Check />}
            Approve & continue
          </Button>
        </div>
      </div>

      {error ? (
        <p className="mt-3 text-[11.5px] leading-relaxed text-[#f2937f]">{error}</p>
      ) : null}

      <div className="mt-4 grid gap-4 lg:grid-cols-2">
        <div className="space-y-1.5">
          <p className="font-mono text-[9px] uppercase tracking-[0.14em] text-[#c9a86e]">
            Story Bible
          </p>
          <Textarea
            value={bible}
            onChange={(event) => setBible(event.target.value)}
            spellCheck={false}
            className="min-h-72 resize-y bg-[#0b1016] font-mono text-[10.5px] leading-relaxed"
          />
        </div>
        <div className="space-y-1.5">
          <p className="font-mono text-[9px] uppercase tracking-[0.14em] text-[#c9a86e]">
            Master Outline
          </p>
          <Textarea
            value={outline}
            onChange={(event) => setOutline(event.target.value)}
            spellCheck={false}
            className="min-h-72 resize-y bg-[#0b1016] font-mono text-[10.5px] leading-relaxed"
          />
        </div>
      </div>
      <p className="mt-3 text-[10.5px] leading-relaxed text-[#c9a86e]">
        Character profiles are saved to the book roster. Edit them from the book detail page.
      </p>
    </section>
  );
}
