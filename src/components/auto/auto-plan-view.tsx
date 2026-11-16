"use client";

import { useState } from "react";
import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { useRouter } from "next/navigation";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { StatusDot } from "@/components/status-dot";
import { AutoPlanChat } from "@/components/auto/auto-plan-chat";
import { AutoPlanRail } from "@/components/auto/auto-plan-rail";
import { AutoSkillsPanel } from "@/components/auto/auto-skills-panel";
import { useAutoSkillsState, type AutoSkillsSnapshot } from "@/components/auto/use-auto-skills";
import { cn } from "@/lib/utils";
import type { AutoModelRole, AutoRun } from "@/lib/auto/types";
import type { ChatMessage } from "@/lib/schemas";

export function AutoPlanView({
  run,
  messages,
  tone,
  premise,
  skills,
}: {
  run: AutoRun;
  messages: ChatMessage[];
  tone: string;
  premise: string;
  skills: AutoSkillsSnapshot;
}) {
  const locked = Boolean(run.state.planLockedAt);
  const router = useRouter();
  const [tab, setTab] = useState<"plan" | "skills">("plan");
  const [planMessages, setPlanMessages] = useState(messages);
  const [skillPanel, setSkillPanel] = useState<AutoModelRole>("plan");
  const skillsState = useAutoSkillsState(run.id, skills);

  return (
    <div className="h-full overflow-y-auto">
      <div className="mx-auto w-full max-w-6xl px-5 pb-12 pt-6 sm:px-8">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <Button asChild variant="ghost" size="sm" className="text-muted-foreground">
            <Link href="/auto">
              <ArrowLeft />
              All runs
            </Link>
          </Button>
          <div className="flex items-center gap-2">
            <StatusDot tone={locked ? "success" : "amber"} pulse={!locked} />
            <span className="font-mono text-[9px] uppercase tracking-[0.14em] text-[#f2c477]">
              {locked ? "Plan approved" : "Planning"}
            </span>
            <Badge variant={locked ? "success" : "amber"}>{run.status}</Badge>
          </div>
        </div>

        <header className="mt-4 border-b border-border pb-5">
          <h1 className="font-serif text-[2.1rem] leading-tight tracking-[-0.03em]">
            {run.bookTitle}
          </h1>
          <p className="mt-1 max-w-2xl text-[12px] leading-relaxed text-muted-foreground">
            {premise || "No premise yet. Describe the novel here, or let the conversation build it."}
          </p>
          {tone ? (
            <p className="mt-1 max-w-2xl font-mono text-[10px] uppercase tracking-[0.1em] text-muted-foreground/80">
              {tone}
            </p>
          ) : null}
        </header>

        <div
          role="tablist"
          aria-label="Planning workspace"
          className="mt-4 flex items-center gap-1 border-b border-border"
        >
          {(
            [
              { value: "plan", label: "Plan discussion" },
              { value: "skills", label: "Novel skill prompts" },
            ] as const
          ).map((item) => (
            <button
              key={item.value}
              type="button"
              role="tab"
              aria-selected={tab === item.value}
              aria-controls={`auto-panel-${item.value}`}
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

        {/* Both panels stay mounted: tab switches must never drop drafts or chat. */}
        <div
          id="auto-panel-plan"
          role="tabpanel"
          aria-label="Plan discussion"
          hidden={tab !== "plan"}
          className={tab === "plan" ? "mt-5" : "hidden"}
        >
          <div className="grid gap-8 lg:grid-cols-[minmax(0,1fr)_320px]">
            <section aria-label="Plan discussion" className="min-w-0 border border-border bg-[#0d131a]">
              <AutoPlanChat
                runId={run.id}
                initialMessages={messages}
                locked={locked}
                disabled={run.status === "running"}
                onMessagesChange={setPlanMessages}
              />
            </section>
            <aside aria-label="Plan lock" className="min-w-0 lg:sticky lg:top-4 lg:self-start">
              <AutoPlanRail
                runId={run.id}
                messages={planMessages}
                premise={premise}
                initialBrief={run.state.planBrief}
                minChapter={run.currentChapter}
                initialTarget={run.targetChapters}
                initialMode={run.mode}
                planLockedAt={run.state.planLockedAt}
                status={run.status}
                onLocked={() => {
                  router.push(`/auto/${run.id}`);
                }}
              />
            </aside>
          </div>
        </div>

        <div
          id="auto-panel-skills"
          role="tabpanel"
          aria-label="Novel skill prompts"
          hidden={tab !== "skills"}
          className={tab === "skills" ? "mt-5" : "hidden"}
        >
          <section className="border border-border bg-[#0d131a] p-4 sm:p-5">
            <AutoSkillsPanel
              state={skillsState}
              panel={skillPanel}
              onPanelChange={setSkillPanel}
              readOnlyHint={
                locked
                  ? "The plan is approved. Edits still apply from the next skill call."
                  : null
              }
            />
          </section>
        </div>
      </div>
    </div>
  );
}