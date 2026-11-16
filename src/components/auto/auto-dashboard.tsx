"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import {
  AlertTriangle,
  ArrowRight,
  BookOpen,
  Loader2,
  MessagesSquare,
  Pause,
  Play,
  Plus,
  Square,
  Workflow,
} from "lucide-react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { StatusDot } from "@/components/status-dot";
import { cn } from "@/lib/utils";
import type { AutoRunSummary } from "@/lib/auto/types";

const PHASE_LABEL: Record<string, string> = {
  architect: "Story Architect",
  characters: "Character Weaver",
  outline: "Arc & Scene Outliner",
  prose: "Scene Prose Writer",
  qa: "Continuity & QA Critic",
  archive: "State Archivist",
  done: "Complete",
};

function statusTone(status: AutoRunSummary["status"]) {
  if (status === "completed") return "success" as const;
  if (status === "failed") return "danger" as const;
  if (status === "running" || status === "queued") return "amber" as const;
  return "default" as const;
}

function statusLabel(status: AutoRunSummary["status"]) {
  if (status === "queued") return "Queued";
  if (status === "running") return "Running";
  if (status === "paused") return "Paused";
  if (status === "completed") return "Completed";
  if (status === "failed") return "Failed";
  return "Stopped";
}

export function AutoDashboard({ initialRuns }: { initialRuns: AutoRunSummary[] }) {
  const [runs, setRuns] = useState(initialRuns);
  const [busy, setBusy] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    try {
      const response = await fetch("/api/auto/runs", { cache: "no-store" });
      const payload = (await response.json().catch(() => null)) as
        | { runs?: AutoRunSummary[] }
        | null;
      if (response.ok && payload?.runs) setRuns(payload.runs);
    } catch {
      // Keep last known state.
    }
  }, []);

  useEffect(() => {
    const timer = window.setInterval(() => {
      void refresh();
    }, 2500);
    return () => window.clearInterval(timer);
  }, [refresh]);

  async function act(run: AutoRunSummary, action: "pause" | "resume" | "stop") {
    setBusy(`${run.id}:${action}`);
    try {
      const response = await fetch(`/api/auto/runs/${run.id}/actions`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action }),
      });
      const payload = (await response.json().catch(() => null)) as
        | { error?: { message?: string } }
        | null;
      if (!response.ok) {
        toast.error(payload?.error?.message || "The run could not be updated.");
        return;
      }
      toast.success(
        action === "pause" ? "Run paused." : action === "resume" ? "Run resumed." : "Run stopped.",
      );
      await refresh();
    } catch {
      toast.error("Could not reach the app server.");
    } finally {
      setBusy(null);
    }
  }

  const awaitingPlan = runs.filter((run) => !run.state.planLockedAt && run.status !== "completed");
  const active = runs.filter(
    (run) => (run.status === "running" || run.status === "queued") && run.state.planLockedAt,
  );
  const paused = runs.filter((run) => run.status === "paused" && run.state.planLockedAt);
  const finished = runs.filter(
    (run) => run.status === "completed" || run.status === "failed" || run.status === "stopped",
  );

  return (
    <div className="h-full overflow-y-auto">
      <div className="mx-auto w-full max-w-5xl px-5 pb-16 pt-8 sm:px-8 lg:pt-10">
        <header className="flex flex-wrap items-end justify-between gap-4 border-b border-border pb-6">
          <div>
            <div className="flex items-center gap-2">
              <Workflow className="size-4 text-[#f2c477]" />
              <p className="font-mono text-[9px] uppercase tracking-[0.16em] text-[#f2c477]">
                Autonomous novel pipeline
              </p>
            </div>
            <h1 className="mt-2 font-serif text-[2.2rem] leading-none tracking-[-0.03em]">
              Auto Mode
            </h1>
            <p className="mt-2 max-w-2xl text-[12.5px] leading-relaxed text-muted-foreground">
              Plan the novel with the planner, approve it, and the six skills write it in the
              background. Runs survive navigation and refresh.
            </p>
          </div>
          <Button asChild>
            <Link href="/auto/new">
              <Plus />
              New project
            </Link>
          </Button>
        </header>

        <div className="mt-6 grid gap-3 sm:grid-cols-4">
          <Metric
            label="Awaiting plan"
            value={awaitingPlan.length}
            tone={awaitingPlan.length ? "amber" : "default"}
          />
          <Metric label="Running" value={active.length} tone={active.length ? "amber" : "default"} />
          <Metric label="Paused" value={paused.length} tone={paused.length ? "amber" : "default"} />
          <Metric label="Finished" value={finished.length} tone="default" />
        </div>

        {!runs.length ? (
          <div className="mt-6 flex flex-col items-center gap-3 border border-border bg-[#0d131a] px-6 py-14 text-center">
            <span className="flex size-10 items-center justify-center rounded-full border border-border bg-[#0c1218]">
              <Workflow className="size-4 text-muted-foreground" />
            </span>
            <div>
              <p className="text-[13px] font-medium">No Auto Mode projects yet.</p>
              <p className="mt-1 max-w-sm text-[11.5px] leading-relaxed text-muted-foreground">
                Create a new novel, or continue one you already drafted. Both start in the
                planning workspace, before any chapter is written.
              </p>
            </div>
            <Button asChild size="sm" className="mt-1">
              <Link href="/auto/new">
                <Plus />
                Start a novel
              </Link>
            </Button>
          </div>
        ) : (
          <div className="mt-6 space-y-10">
            <RunGroup
              title="Awaiting plan approval"
              runs={awaitingPlan}
              busy={busy}
              act={act}
              emphasize="plan"
            />
            <RunGroup title="Running" runs={active} busy={busy} act={act} />
            <RunGroup title="Paused" runs={paused} busy={busy} act={act} />
            <RunGroup title="Finished" runs={finished} busy={busy} act={act} />
          </div>
        )}

        <p className="mt-8 border-t border-border pt-3 text-[10.5px] leading-relaxed text-muted-foreground/70">
          Auto Mode writes through the same books, chapters, and character roster as Studio Mode.
          Read any finished or in-progress chapter while a run continues.
        </p>
      </div>
    </div>
  );
}

function Metric({
  label,
  value,
  tone,
}: {
  label: string;
  value: number;
  tone: "amber" | "default";
}) {
  return (
    <div className="border border-border bg-[#0d131a] px-4 py-3">
      <p className="font-mono text-[9px] uppercase tracking-[0.14em] text-muted-foreground">
        {label}
      </p>
      <p
        className={cn(
          "mt-1 font-mono text-[22px] tabular",
          tone === "amber" ? "text-[#f2c477]" : "text-foreground",
        )}
      >
        {value}
      </p>
    </div>
  );
}

function RunGroup({
  title,
  runs,
  busy,
  act,
  emphasize,
}: {
  title: string;
  runs: AutoRunSummary[];
  busy: string | null;
  act: (run: AutoRunSummary, action: "pause" | "resume" | "stop") => void;
  emphasize?: "plan";
}) {
  if (!runs.length) return null;
  return (
    <section>
      <div className="flex items-baseline justify-between gap-3 border-b border-border pb-2">
        <h2 className="font-mono text-[10px] uppercase tracking-[0.16em] text-[#f2c477]">
          {title}
        </h2>
        <span className="font-mono text-[10px] text-muted-foreground">{runs.length}</span>
      </div>
      <ul className="divide-y divide-border border-b border-border">
        {runs.map((run) => {
          const planLocked = Boolean(run.state.planLockedAt);
          const neighbourPlan = emphasize === "plan";
          const progress =
            run.targetChapters > 0
              ? Math.min(100, Math.round(((run.currentChapter - 1) / run.targetChapters) * 100))
              : 0;
          return (
            <li key={run.id} className="py-4">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <StatusDot
                      tone={
                        run.status === "running"
                          ? "success"
                          : run.status === "failed"
                            ? "danger"
                            : neighbourPlan
                              ? "amber"
                              : "muted"
                      }
                      pulse={run.status === "running"}
                    />
                    <Link
                      href={`/auto/${run.id}`}
                      className="truncate text-[13px] font-medium hover:text-[#f2c477]"
                    >
                      {run.bookTitle}
                    </Link>
                    <Badge variant={neighbourPlan ? "amber" : statusTone(run.status)}>
                      {neighbourPlan ? "Needs plan" : statusLabel(run.status)}
                    </Badge>
                    <span className="font-mono text-[10px] text-muted-foreground">
                      {run.mode === "checkpoint" ? "Checkpoint" : "Autopilot"}
                    </span>
                  </div>
                  <p className="mt-1 text-[11.5px] text-muted-foreground">
                    {neighbourPlan ? "Planning conversation" : PHASE_LABEL[run.phase] ?? run.phase}
                    {run.targetChapters > 0
                      ? ` - Chapter ${run.currentChapter} of ${run.targetChapters}`
                      : ""}
                    {run.currentScene > 0 ? ` - Scene ${run.currentScene}` : ""}
                    {run.revisionCount > 0 ? ` - Revision ${run.revisionCount}` : ""}
                  </p>
                  <p className="mt-1 line-clamp-1 text-[11px] text-muted-foreground/80">
                    {run.lastEvent || run.lastError || "Waiting for the next step."}
                  </p>
                </div>
                <div className="flex flex-wrap items-center gap-1.5">
                  {neighbourPlan ? (
                    <Button asChild size="sm" variant="default">
                      <Link href={`/auto/${run.id}/plan`}>
                        <MessagesSquare />
                        Plan
                      </Link>
                    </Button>
                  ) : null}
                  {!neighbourPlan && (run.status === "running" || run.status === "queued") ? (
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={() => act(run, "pause")}
                      disabled={busy === `${run.id}:pause`}
                    >
                      {busy === `${run.id}:pause` ? <Loader2 className="animate-spin" /> : <Pause />}
                      Pause
                    </Button>
                  ) : null}
                  {!neighbourPlan && (run.status === "paused" || run.status === "failed") ? (
                    <Button
                      size="sm"
                      variant="secondary"
                      onClick={() => act(run, "resume")}
                      disabled={busy === `${run.id}:resume` || !planLocked}
                    >
                      {busy === `${run.id}:resume` ? <Loader2 className="animate-spin" /> : <Play />}
                      Resume
                    </Button>
                  ) : null}
                  {run.status !== "completed" && run.status !== "stopped" ? (
                    <Button
                      size="sm"
                      variant="ghost"
                      className="text-muted-foreground hover:text-[#f2937f]"
                      onClick={() => act(run, "stop")}
                      disabled={busy === `${run.id}:stop`}
                    >
                      {busy === `${run.id}:stop` ? (
                        <Loader2 className="animate-spin" />
                      ) : (
                        <Square className="size-3 fill-current" />
                      )}
                      Stop
                    </Button>
                  ) : null}
                  <Button asChild size="sm" variant="ghost">
                    <Link href={`/auto/${run.id}`}>
                      Open
                      <ArrowRight />
                    </Link>
                  </Button>
                </div>
              </div>
              {!neighbourPlan ? (
                <div className="mt-2 flex items-center gap-3">
                  <div className="h-px flex-1 bg-border">
                    <div
                      className="h-px bg-[#f2c477] transition-[width] duration-500"
                      style={{ width: `${progress}%` }}
                    />
                  </div>
                  <span className="font-mono text-[9px] tabular text-muted-foreground">
                    {run.targetChapters > 0 ? `${progress}%` : "Planning"}
                  </span>
                  <Button asChild size="sm" variant="ghost" className="h-6 px-1.5 text-[10px]">
                    <Link href={`/auto/${run.id}/monitor`}>
                      <BookOpen />
                      Read
                    </Link>
                  </Button>
                </div>
              ) : null}
              {run.status === "failed" && run.lastError ? (
                <p className="mt-2 flex items-start gap-1.5 text-[10.5px] leading-relaxed text-[#f2937f]">
                  <AlertTriangle className="mt-0.5 size-3 shrink-0" />
                  {run.lastError}
                </p>
              ) : null}
            </li>
          );
        })}
      </ul>
    </section>
  );
}
