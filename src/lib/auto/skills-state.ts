import { getBookConfig } from "@/lib/storage/book-config";
import { getAutoSkillPrompts } from "@/lib/storage/auto-skills";
import { resolveAutoModel, type AutoModelRole } from "@/lib/auto/types";

export type AutoSkillsSnapshotPayload = {
  values: Record<string, string>;
  overrides: Record<string, string>;
  defaults: Record<string, string>;
  models: { default: string; skills: Record<string, string> };
  roleModels: { planner: string; executor: string; summarizer: string };
  effectiveModels: Record<AutoModelRole, string>;
};

const MODEL_ROLES: AutoModelRole[] = [
  "plan",
  "architect",
  "characters",
  "outline",
  "prose",
  "qa",
  "archivist",
];

/** One snapshot for every Auto Mode surface: prompts plus resolved models. */
export async function getAutoSkillsSnapshot(
  slug: string,
): Promise<AutoSkillsSnapshotPayload> {
  const [prompts, book] = await Promise.all([
    getAutoSkillPrompts(slug),
    getBookConfig(slug),
  ]);
  const roleModels = {
    planner: book.config.models.planner,
    executor: book.config.models.executor,
    summarizer: book.config.models.summarizer,
  };
  const effectiveModels = Object.fromEntries(
    MODEL_ROLES.map((role) => [
      role,
      resolveAutoModel(role, prompts.models, roleModels),
    ]),
  ) as Record<AutoModelRole, string>;

  return {
    values: prompts.values,
    overrides: prompts.overrides,
    defaults: prompts.defaults,
    models: prompts.models,
    roleModels,
    effectiveModels,
  };
}