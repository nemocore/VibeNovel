"use client";

import { useCallback, useMemo, useState } from "react";

export type AutoSkillsSnapshot = {
  values: Record<string, string>;
  overrides: Record<string, string>;
  defaults: Record<string, string>;
  models: { default: string; skills: Record<string, string> };
  disabled?: string[];
  roleModels?: { planner: string; executor: string; summarizer: string };
  effectiveModels?: Record<string, string>;
  error?: { message?: string };
};

function sameValues(a: Record<string, string>, b: Record<string, string>): boolean {
  const keys = new Set([...Object.keys(a), ...Object.keys(b)]);
  for (const key of keys) if ((a[key] ?? "") !== (b[key] ?? "")) return false;
  return true;
}

function sameModels(
  a: AutoSkillsSnapshot["models"],
  b: AutoSkillsSnapshot["models"],
): boolean {
  if ((a.default ?? "") !== (b.default ?? "")) return false;
  const keys = new Set([...Object.keys(a.skills), ...Object.keys(b.skills)]);
  for (const key of keys) if ((a.skills[key] ?? "") !== (b.skills[key] ?? "")) return false;
  return true;
}

/**
 * Holds every unsaved edit for a novel's skill prompts and models. It lives in
 * the parent view so closing a dialog, switching tabs, or polling never drops
 * what the author typed.
 */
export function useAutoSkillsState(runId: string, initial: AutoSkillsSnapshot) {
  const [draft, setDraft] = useState<Record<string, string>>(initial.values);
  const [saved, setSaved] = useState<Record<string, string>>(initial.values);
  const [models, setModels] = useState<AutoSkillsSnapshot["models"]>({
    default: initial.models?.default ?? "",
    skills: { ...(initial.models?.skills ?? {}) },
  });
  const [savedModels, setSavedModels] = useState<AutoSkillsSnapshot["models"]>({
    default: initial.models?.default ?? "",
    skills: { ...(initial.models?.skills ?? {}) },
  });
  const [overrides, setOverrides] = useState(initial.overrides);
  const [disabled, setDisabled] = useState<string[]>(initial.disabled ?? []);
  const [savedDisabled, setSavedDisabled] = useState<string[]>(initial.disabled ?? []);
  const [defaults] = useState(initial.defaults);
  const [roleModels, setRoleModels] = useState(initial.roleModels);
  const [effectiveModels, setEffectiveModels] = useState(initial.effectiveModels);
  const [busy, setBusy] = useState<"save" | "reset" | null>(null);
  const [error, setError] = useState<string | null>(null);

  const dirty = useMemo(
    () =>
      !sameValues(draft, saved) ||
      !sameModels(models, savedModels) ||
      [...disabled].sort().join("|") !== [...savedDisabled].sort().join("|"),
    [draft, saved, models, savedModels, disabled, savedDisabled],
  );

  const apply = useCallback((next: AutoSkillsSnapshot) => {
    setDraft(next.values);
    setSaved(next.values);
    setModels({
      default: next.models?.default ?? "",
      skills: { ...(next.models?.skills ?? {}) },
    });
    setSavedModels({
      default: next.models?.default ?? "",
      skills: { ...(next.models?.skills ?? {}) },
    });
    setOverrides(next.overrides);
    setDisabled(next.disabled ?? []);
    setSavedDisabled(next.disabled ?? []);
    setRoleModels(next.roleModels);
    setEffectiveModels(next.effectiveModels);
  }, []);

  const persist = useCallback(
    async (body: {
      values?: Record<string, string>;
      reset?: string[];
      models?: AutoSkillsSnapshot["models"];
      disabled?: string[];
    }): Promise<boolean> => {
      setError(null);
      try {
        const response = await fetch(`/api/auto/runs/${runId}/skills`, {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
        });
        const payload = (await response.json().catch(() => null)) as
          | (AutoSkillsSnapshot & { error?: { message?: string } })
          | null;
        if (!response.ok || !payload?.values) {
          setError(payload?.error?.message || "The skill settings could not be saved.");
          return false;
        }
        apply(payload);
        return true;
      } catch {
        setError("Could not reach the app server.");
        return false;
      }
    },
    [apply, runId],
  );

  const save = useCallback(async () => {
    setBusy("save");
    const ok = await persist({ values: draft, models, disabled });
    setBusy(null);
    return ok;
  }, [draft, models, disabled, persist]);

  const saveDisabled = useCallback(
    async (next: string[]) => {
      setBusy("save");
      const ok = await persist({ disabled: next });
      setBusy(null);
      return ok;
    },
    [persist],
  );

  const resetPrompts = useCallback(
    async (keys: string[]) => {
      setBusy("reset");
      const ok = await persist({ reset: keys });
      setBusy(null);
      return ok;
    },
    [persist],
  );

  return {
    draft,
    setDraft,
    disabled,
    setDisabled,
    models,
    setModels,
    defaults,
    overrides,
    roleModels,
    effectiveModels,
    dirty,
    busy,
    error,
    setError,
    save,
    saveDisabled,
    resetPrompts,
  };
}

export type AutoSkillsController = ReturnType<typeof useAutoSkillsState>;