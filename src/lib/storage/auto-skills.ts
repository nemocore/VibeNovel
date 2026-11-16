import { and, eq } from "drizzle-orm";
import { getDb } from "@/lib/db";
import { books } from "@/lib/db/schema";
import { NotFoundError } from "@/lib/errors";
import { getPromptMap } from "@/lib/storage/prompts";
import {
  AUTO_PROMPT_KEYS,
  normalizeAutoModelOverrides,
  normalizeDisabledSkills,
  type AutoModelOverrides,
  type AutoSkillKey,
} from "@/lib/auto/types";

export type AutoSkillPromptState = {
  /** Effective prompt for every Auto Mode key, after overrides. */
  values: Record<string, string>;
  /** Keys this novel overrides. Everything else inherits the global template. */
  overrides: Record<string, string>;
  /** Global Prompt Templates, used as the starter copy. */
  defaults: Record<string, string>;
  /** Per-novel model choices. Empty strings mean "inherit". */
  models: AutoModelOverrides;
  /** Optional skills switched off for this novel. */
  disabled: AutoSkillKey[];
};

function pick(source: Record<string, string>): Record<string, string> {
  const picked: Record<string, string> = {};
  for (const key of AUTO_PROMPT_KEYS) {
    const value = source[key];
    if (typeof value === "string") picked[key] = value;
  }
  return picked;
}

async function bookRow(slug: string) {
  const db = await getDb();
  const row = db
    .select()
    .from(books)
    .where(and(eq(books.slug, slug), eq(books.isDraft, false)))
    .get();
  if (!row) throw new NotFoundError("That book does not exist.");
  return row;
}

export async function getAutoSkillPrompts(slug: string): Promise<AutoSkillPromptState> {
  const [row, global] = await Promise.all([bookRow(slug), getPromptMap()]);
  const defaults = pick(global);
  const stored = row.autoSkillPromptsJson ?? {};
  const overrides: Record<string, string> = {};
  for (const [key, value] of Object.entries(stored)) {
    if (typeof value === "string" && value.trim()) overrides[key] = value;
  }
  return {
    values: { ...defaults, ...overrides },
    overrides,
    defaults,
    models: normalizeAutoModelOverrides(row.autoModelsJson),
    disabled: normalizeDisabledSkills(row.autoDisabledSkillsJson),
  };
}

export { normalizeDisabledSkills };

export async function saveAutoSkillPrompts(
  slug: string,
  patch: {
    values?: Record<string, string>;
    reset?: string[];
    models?: Partial<AutoModelOverrides>;
    disabled?: string[];
  },
): Promise<AutoSkillPromptState> {
  const row = await bookRow(slug);
  const stored = { ...(row.autoSkillPromptsJson ?? {}) };

  for (const key of patch.reset ?? []) {
    delete stored[key];
  }

  for (const [key, value] of Object.entries(patch.values ?? {})) {
    if (!AUTO_PROMPT_KEYS.includes(key)) continue;
    if (typeof value !== "string") continue;
    if (value.trim()) stored[key] = value;
    else delete stored[key];
  }

  let models: AutoModelOverrides | null = normalizeAutoModelOverrides(row.autoModelsJson);
  if (patch.models) {
    const next = normalizeAutoModelOverrides({
      default: patch.models.default ?? models.default,
      skills: { ...models.skills, ...(patch.models.skills ?? {}) },
    });
    models = next.default || Object.keys(next.skills).length ? next : null;
  } else if (!models.default && !Object.keys(models.skills).length) {
    models = null;
  }

  const db = await getDb();
  db.update(books)
    .set({
      autoSkillPromptsJson: Object.keys(stored).length ? stored : null,
      autoModelsJson: models,
      autoDisabledSkillsJson:
        patch.disabled !== undefined
          ? normalizeDisabledSkills(patch.disabled)
          : normalizeDisabledSkills(row.autoDisabledSkillsJson),
      updatedAt: new Date().toISOString(),
    })
    .where(eq(books.id, row.id))
    .run();

  return getAutoSkillPrompts(slug);
}
