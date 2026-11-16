"use client";

import { useSyncExternalStore } from "react";
import { Loader2, RotateCcw, Save, ShieldCheck, Sparkles } from "lucide-react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Select } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";
import {
  AUTO_SKILLS,
  AUTO_PLAN_SYSTEM_KEY,
  AUTO_PLAN_TASK_KEY,
  type AutoModelRole,
} from "@/lib/auto/types";
import { modelLabel, useModelOptions } from "@/components/auto/model-select";
import type { AutoSkillsController } from "@/components/auto/use-auto-skills";

type PanelDefinition = {
  key: AutoModelRole;
  label: string;
  summary: string;
  systemKey: string;
  taskKey: string;
  placeholders: string[];
};

const PANELS: PanelDefinition[] = [
  {
    key: "plan",
    label: "Plan Discussion",
    summary: "The pre-run planning chat.",
    systemKey: AUTO_PLAN_SYSTEM_KEY,
    taskKey: AUTO_PLAN_TASK_KEY,
    placeholders: ["premise", "tone", "targetChapters", "existingSummaries", "message"],
  },
  ...AUTO_SKILLS.map((skill) => ({
    key: skill.key as AutoModelRole,
    label: skill.label,
    summary: skill.summary,
    systemKey: `auto_${skill.key}_system`,
    taskKey: `auto_${skill.key}_task`,
    placeholders: skill.placeholders,
  })),
];

const ROLE_LABEL: Record<string, string> = {
  planner: "planning model",
  executor: "prose model",
  summarizer: "analysis model",
};

export function AutoSkillsPanel({
  state,
  panel,
  onPanelChange,
  readOnlyHint,
}: {
  state: AutoSkillsController;
  panel: AutoModelRole;
  onPanelChange: (panel: AutoModelRole) => void;
  readOnlyHint?: string | null;
}) {
  const { options } = useModelOptions();
  const active = PANELS.find((item) => item.key === panel) ?? PANELS[0];
  const { draft, setDraft, models, setModels, overrides, defaults, roleModels, busy, error } =
    state;
  // Override badges depend on stored state; render the neutral form until mount so
  // the first client paint always matches the server HTML.
  const mounted = useSyncExternalStore(
    () => () => {},
    () => true,
    () => false,
  );

  const promptOverridden =
    overrides[active.systemKey] !== undefined || overrides[active.taskKey] !== undefined;
  const modelValue = models.skills[active.key] ?? "";
  const modelOverridden = Boolean(modelValue);
  const filledSkills = Object.keys(models.skills).filter((key) => models.skills[key]).length;
  const overriddenCount = Object.keys(overrides).length + filledSkills;
  const showCustom = mounted && (promptOverridden || modelOverridden);

  const effective = active.key;
  const optionalSkill = AUTO_SKILLS.find(
    (skill) => skill.key === active.key && skill.optional,
  );
  const skillEnabled = !state.disabled.includes(active.key);
  const inheritedModel = models.default
    ? modelLabel(options, models.default)
    : roleModels
      ? modelLabel(options, roleModels[activeRole(active.key)])
      : "";

  async function save() {
    const ok = await state.save();
    if (ok) toast.success("Skill settings saved for this novel.");
  }

  async function resetToGlobal() {
    const ok = await state.resetPrompts([active.systemKey, active.taskKey]);
    setModels((current) => {
      const next = { ...current, skills: { ...current.skills } };
      delete next.skills[active.key];
      return next;
    });
    if (ok) toast.success(`${active.label} now follows the global template.`);
  }

  function toggleSkill() {
    state.setDisabled((current) =>
      current.includes(active.key)
        ? current.filter((key) => key !== active.key)
        : [...current, active.key],
    );
  }

  return (
    <div className="grid gap-6 lg:grid-cols-[232px_minmax(0,1fr)]">
      <nav aria-label="Novel skill prompts" className="lg:border-r lg:border-border lg:pr-4">
        <p className="font-mono text-[9px] uppercase tracking-[0.16em] text-[#f2c477]">
          This novel&apos;s skills
        </p>
        <ul className="mt-2 divide-y divide-border border-y border-border">
          {PANELS.map((item) => {
            const current = item.key === panel;
            const own =
              overrides[item.systemKey] !== undefined ||
              overrides[item.taskKey] !== undefined ||
              Boolean(models.skills[item.key]);
            const showOwn = mounted && own;
            return (
              <li key={item.key}>
                <button
                  type="button"
                  onClick={() => onPanelChange(item.key)}
                  aria-current={current ? "true" : undefined}
                  className={cn(
                    "flex w-full items-center justify-between gap-2 py-2 text-left text-[12px] transition-colors",
                    current ? "text-[#f2c477]" : "text-foreground/85 hover:text-foreground",
                  )}
                >
                  <span
                    className={cn(
                      "truncate",
                      state.disabled.includes(item.key as AutoModelRole) && "text-muted-foreground/60",
                    )}
                  >
                    {item.label}
                  </span>
                  {state.disabled.includes(item.key as AutoModelRole) ? (
                    <span className="font-mono text-[8.5px] uppercase tracking-[0.12em] text-muted-foreground">
                      off
                    </span>
                  ) : showOwn ? (
                    <span className="font-mono text-[8.5px] uppercase tracking-[0.12em] text-[#f2c477]">
                      own
                    </span>
                  ) : null}
                </button>
              </li>
            );
          })}
        </ul>
        <div className="mt-3 space-y-1.5">
          <label
            htmlFor="auto-default-model"
            className="font-mono text-[9px] uppercase tracking-[0.14em] text-muted-foreground"
          >
            Default run model
          </label>
          <Select
            id="auto-default-model"
            value={models.default}
            onChange={(event) =>
              setModels((current) => ({ ...current, default: event.target.value }))
            }
            className="h-8 text-[11.5px]"
          >
            <option value="">Book default</option>
            {options.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </Select>
          <p className="text-[10px] leading-relaxed text-muted-foreground">
            Skills without their own model use this. Book default keeps each role&apos;s existing
            model.
          </p>
        </div>
        <p className="mt-3 text-[10.5px] leading-relaxed text-muted-foreground">
          {!mounted
            ? "Global templates and book models apply until this novel overrides them."
            : overriddenCount === 0
              ? "Every skill follows the global templates and book models."
              : `${overriddenCount} custom setting${overriddenCount === 1 ? "" : "s"} on this novel. Global defaults stay untouched.`}
        </p>
      </nav>

      <div className="min-w-0">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <h3 className="text-[13px] font-medium">{active.label}</h3>
              <Badge variant={showCustom ? "amber" : "default"}>
                {showCustom ? "Custom" : "Global"}
              </Badge>
              {active.key === "plan" ? null : optionalSkill ? (
                <button
                  type="button"
                  role="switch"
                  aria-checked={skillEnabled}
                  aria-label={`${active.label} enabled for this novel`}
                  onClick={() => toggleSkill()}
                  className={cn(
                    "inline-flex items-center gap-1.5 rounded-full border px-2 py-0.5 font-mono text-[9px] uppercase tracking-[0.12em] transition-colors",
                    skillEnabled
                      ? "border-[#2d4a36] bg-[#14211a] text-[#9cc9a6]"
                      : "border-border bg-secondary text-muted-foreground",
                  )}
                >
                  <span
                    className={cn(
                      "size-1.5 rounded-full",
                      skillEnabled ? "bg-[#86bd93]" : "bg-muted-foreground/50",
                    )}
                  />
                  {skillEnabled ? "Enabled" : "Disabled"}
                </button>
              ) : (
                <span className="font-mono text-[9px] uppercase tracking-[0.12em] text-muted-foreground/70">
                  Always on
                </span>
              )}
            </div>
            <p className="mt-0.5 text-[11px] leading-relaxed text-muted-foreground">
              {active.summary}
            </p>
            <p className="mt-1 flex flex-wrap items-baseline gap-x-1.5 gap-y-0.5 font-mono text-[10px] text-muted-foreground/80">
              <span className="text-muted-foreground/55">Placeholders</span>
              {active.placeholders.map((name) => (
                <span key={name}>{`{{${name}}}`}</span>
              ))}
            </p>
          </div>
          <div className="flex items-center gap-1.5">
            <Button
              size="sm"
              variant="ghost"
              onClick={() => void resetToGlobal()}
              disabled={busy !== null || (!promptOverridden && !modelOverridden)}
            >
              {busy === "reset" ? <Loader2 className="animate-spin" /> : <RotateCcw />}
              Use global
            </Button>
            <Button size="sm" onClick={() => void save()} disabled={busy !== null || !state.dirty}>
              {busy === "save" ? <Loader2 className="animate-spin" /> : <Save />}
              Save
            </Button>
          </div>
        </div>

        {readOnlyHint ? (
          <p className="mt-3 flex items-start gap-2 border border-[#5b431c] bg-[#1b1409] px-3 py-2 text-[11px] leading-relaxed text-[#c9a86e]">
            <ShieldCheck className="mt-0.5 size-3.5 shrink-0" />
            {readOnlyHint}
          </p>
        ) : null}

        {error ? (
          <p className="mt-3 text-[11.5px] leading-relaxed text-[#f2937f]">{error}</p>
        ) : null}

        <div className="mt-4 space-y-1.5">
          <label
            htmlFor={`skill-model-${effective}`}
            className="font-mono text-[9px] uppercase tracking-[0.14em] text-muted-foreground"
          >
            Model
          </label>
          <Select
            id={`skill-model-${effective}`}
            value={modelValue}
            onChange={(event) =>
              setModels((current) => ({
                ...current,
                skills: { ...current.skills, [active.key]: event.target.value },
              }))
            }
            className="h-8 text-[11.5px]"
          >
            <option value="">Use run default</option>
            {options.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </Select>
          <p className="text-[10px] leading-relaxed text-muted-foreground">
            {!mounted
              ? "Inherits the run default."
              : modelOverridden
                ? `Runs on ${modelLabel(options, modelValue)} for this skill only.`
                : `Inherits ${inheritedModel || "the book's model"}.`}
          </p>
        </div>

        <div className="mt-4 space-y-4">
          <div className="space-y-1.5">
            <div className="flex items-baseline justify-between gap-3">
              <label
                htmlFor={`skill-system-${active.key}`}
                className="font-mono text-[9px] uppercase tracking-[0.14em] text-muted-foreground"
              >
                System prompt
              </label>
              <span className="font-mono text-[9px] text-muted-foreground/70">
                {new Intl.NumberFormat("en-US").format((draft[active.systemKey] ?? "").length)} chars
              </span>
            </div>
            <Textarea
              id={`skill-system-${active.key}`}
              value={draft[active.systemKey] ?? ""}
              onChange={(event) =>
                setDraft((current) => ({ ...current, [active.systemKey]: event.target.value }))
              }
              spellCheck={false}
              className="min-h-32 resize-y bg-[#0b1016] font-mono text-[10.5px] leading-relaxed"
            />
          </div>
          <div className="space-y-1.5">
            <div className="flex items-baseline justify-between gap-3">
              <label
                htmlFor={`skill-task-${active.key}`}
                className="font-mono text-[9px] uppercase tracking-[0.14em] text-muted-foreground"
              >
                Task prompt
              </label>
              <span className="font-mono text-[9px] text-muted-foreground/70">
                {new Intl.NumberFormat("en-US").format((draft[active.taskKey] ?? "").length)} chars
              </span>
            </div>
            <Textarea
              id={`skill-task-${active.key}`}
              value={draft[active.taskKey] ?? ""}
              onChange={(event) =>
                setDraft((current) => ({ ...current, [active.taskKey]: event.target.value }))
              }
              spellCheck={false}
              className="min-h-64 resize-y bg-[#0b1016] font-mono text-[10.5px] leading-relaxed"
            />
          </div>
        </div>

        <div className="mt-3 flex flex-wrap items-center justify-between gap-2 border-t border-border pt-3">
          <p className="text-[10.5px] text-muted-foreground">
            Affects this novel only. Global templates stay untouched.
          </p>
          <div className="flex items-center gap-1.5">
            <Button
              size="sm"
              variant="ghost"
              onClick={() =>
                setDraft((current) => ({
                  ...current,
                  [active.systemKey]: defaults[active.systemKey],
                }))
              }
              disabled={busy !== null}
            >
              <Sparkles />
              Copy global
            </Button>
            {state.dirty ? (
              <span className="font-mono text-[9px] uppercase tracking-[0.12em] text-[#f2c477]">
                Unsaved
              </span>
            ) : null}
          </div>
        </div>
      </div>
    </div>
  );
}

function activeRole(key: AutoModelRole): "planner" | "executor" | "summarizer" {
  if (key === "prose") return "executor";
  if (key === "qa" || key === "archivist") return "summarizer";
  return "planner";
}

export { ROLE_LABEL };