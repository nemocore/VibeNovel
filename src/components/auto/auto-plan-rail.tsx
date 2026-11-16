"use client";

import { useState } from "react";
import { Database, Loader2, Play, ShieldCheck } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";
import { finalPlanText } from "@/lib/auto/plan-brief";

export type PlanLockPayload = {
  planBrief: string;
  targetChapters: number;
  mode: "autopilot" | "checkpoint";
};

export function AutoPlanRail({
  runId,
  messages,
  premise,
  initialBrief,
  minChapter,
  initialTarget,
  initialMode,
  planLockedAt,
  status,
  onLocked,
}: {
  runId: string;
  messages: { id: string; role: "user" | "assistant"; content: string }[];
  /** Fallback blueprint when the author has no assistant reply yet. */
  premise: string;
  initialBrief: string;
  minChapter: number;
  initialTarget: number;
  initialMode: "autopilot" | "checkpoint";
  planLockedAt: string | null;
  status: string;
  onLocked: () => void;
}) {
  const [brief, setBrief] = useState(initialBrief);
  const [target, setTarget] = useState(String(initialTarget));
  const [mode, setMode] = useState<"autopilot" | "checkpoint">(initialMode);
  const [busy, setBusy] = useState<"draft" | "lock" | null>(null);
  const [error, setError] = useState<string | null>(null);

  const targetNumber = Number(target);
  const targetValid = Number.isInteger(targetNumber) && targetNumber >= minChapter;

  /**
   * The final assistant reply already contains the approved plan, so copy it
   * verbatim. Earlier turns (rejected ideas, critiques) would only bleed context
   * into the blueprint, and any character cap would drop settled beats.
   */
  function transferFinalReply() {
    const source = finalPlanText(messages, premise);
    if (!source) {
      setError("Nothing to transfer yet. Ask the planner for the plan, or write it below.");
      return;
    }
    setBrief(source);
    setError(null);
  }

  async function submit() {
    if (!brief.trim() || brief.trim().length < 20) {
      setError("Transfer or write the agreed plan first (at least a sentence or two).");
      return;
    }
    if (!targetValid) {
      setError(`Target must be ${minChapter} or higher.`);
      return;
    }
    setBusy("lock");
    setError(null);
    try {
      const response = await fetch(`/api/auto/runs/${runId}/plan/lock`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ planBrief: brief, targetChapters: targetNumber, mode }),
      });
      const payload = (await response.json().catch(() => null)) as
        | { error?: { message?: string } }
        | null;
      if (!response.ok) {
        setError(payload?.error?.message || "The plan could not be locked.");
        return;
      }
      toast.success("Plan approved. The pipeline is starting.");
      onLocked();
    } catch {
      setError("Could not reach the app server.");
    } finally {
      setBusy(null);
    }
  }

  const locked = Boolean(planLockedAt);

  return (
    <div className="space-y-5">
      <section>
        <p className="font-mono text-[9px] uppercase tracking-[0.16em] text-[#f2c477]">
          Locked plan
        </p>
        <p className="mt-1 text-[11px] leading-relaxed text-muted-foreground">
          The plan the Story Architect and Character Weaver must obey. Edit it, then approve.
        </p>
        <Textarea
          value={brief}
          onChange={(event) => setBrief(event.target.value)}
          disabled={locked}
          spellCheck={false}
          placeholder="The blueprint every skill must follow. Use the final reply, then edit if needed."
          className="mt-2 min-h-40 resize-y text-[11.5px] leading-relaxed"
        />
        <div className="mt-2 flex items-center justify-between gap-2">
          <Button
            size="sm"
            variant="ghost"
            onClick={transferFinalReply}
            disabled={locked || !messages.length}
          >
            <Database />
            Use final reply
          </Button>
          {locked ? (
            <span className="flex items-center gap-1.5 font-mono text-[9px] uppercase tracking-[0.12em] text-[#9cc9a6]">
              <ShieldCheck className="size-3" />
              Locked
            </span>
          ) : null}
        </div>
      </section>

      <section className="border-t border-border pt-4">
        <label
          htmlFor="plan-target"
          className="font-mono text-[9px] uppercase tracking-[0.16em] text-[#f2c477]"
        >
          Target chapters
        </label>
        <Input
          id="plan-target"
          type="number"
          min={minChapter}
          max={200}
          value={target}
          disabled={locked}
          onChange={(event) => setTarget(event.target.value)}
          className="mt-2 font-mono"
        />
        <p className="mt-1 text-[10.5px] leading-relaxed text-muted-foreground">
          The book starts at chapter {minChapter}. Auto Mode writes through the target.
        </p>
      </section>

      <section className="border-t border-border pt-4">
        <p className="font-mono text-[9px] uppercase tracking-[0.16em] text-[#f2c477]">
          Execution mode
        </p>
        <div className="mt-2 grid grid-cols-2 gap-1.5">
          {(
            [
              { value: "checkpoint", label: "Checkpoint" },
              { value: "autopilot", label: "Autopilot" },
            ] as const
          ).map((option) => (
            <button
              key={option.value}
              type="button"
              disabled={locked}
              onClick={() => setMode(option.value)}
              className={cn(
                "h-9 border text-[11.5px] transition-colors",
                mode === option.value
                  ? "border-[#f2a93b] bg-[#241a0b] text-[#f2c477]"
                  : "border-border text-muted-foreground hover:text-foreground",
              )}
            >
              {option.label}
            </button>
          ))}
        </div>
        <p className="mt-1.5 text-[10.5px] leading-relaxed text-muted-foreground">
          {mode === "checkpoint"
            ? "Pauses after the Story Bible, characters, and master outline for your review."
            : "Runs straight through. Revisions stop at two per chapter."}
        </p>
      </section>

      {error ? (
        <p className="text-[11px] leading-relaxed text-[#f2937f]">{error}</p>
      ) : null}

      <Button
        className="w-full"
        onClick={() => void submit()}
        disabled={busy !== null || locked}
      >
        {busy === "lock" ? <Loader2 className="animate-spin" /> : <Play />}
        {locked ? "Plan approved" : "Approve plan & start execution"}
      </Button>
      <p className="text-[10px] leading-relaxed text-muted-foreground/80">
        Status: {status}. Nothing is generated until you approve.
      </p>
    </div>
  );
}
