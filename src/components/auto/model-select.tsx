"use client";

import { useEffect, useState } from "react";
import type { ModelOption, ProviderModelGroup } from "@/lib/ai/model-options";

type ModelPayload = { groups?: ProviderModelGroup[]; options?: ModelOption[] };

/**
 * Shared model catalogue for the Auto Mode selectors. Same `/api/models`
 * endpoint Studio Mode uses, so the lists never drift apart.
 */
export function useModelOptions(): {
  groups: ProviderModelGroup[];
  options: ModelOption[];
  loading: boolean;
} {
  const [groups, setGroups] = useState<ProviderModelGroup[]>([]);
  const [options, setOptions] = useState<ModelOption[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    void fetch("/api/models", { cache: "no-store" })
      .then((response) => (response.ok ? response.json() : null))
      .then((payload: ModelPayload | null) => {
        if (cancelled || !payload) return;
        setGroups(payload.groups ?? []);
        setOptions(payload.options ?? []);
      })
      .catch(() => undefined)
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  return { groups, options, loading };
}

export function modelLabel(options: ModelOption[], value: string): string {
  if (!value.trim()) return "";
  const found = options.find((option) => option.value === value);
  if (found) return found.label;
  const bar = value.indexOf("|");
  return bar > 0 ? value.slice(bar + 1) : value;
}