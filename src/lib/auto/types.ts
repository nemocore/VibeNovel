export type AutoRunStatus =
  | "queued"
  | "running"
  | "paused"
  | "completed"
  | "failed"
  | "stopped";

export type AutoRunMode = "autopilot" | "checkpoint";

export type AutoPhase =
  | "architect"
  | "characters"
  | "outline"
  | "prose"
  | "qa"
  | "archive"
  | "done";

export type AutoStoryBible = {
  title: string;
  logline: string;
  tone: string;
  worldRules: string[];
  coreConflict: string;
  endingResolution: string;
  targetChapters: number;
  constraints: string[];
};

export type AutoScenePlan = {
  index: number;
  title: string;
  beat: string;
  pov?: string;
};

export type AutoChapterPlan = {
  number: number;
  title: string;
  purpose: string;
  summary: string;
  characters: string[];
  scenes: AutoScenePlan[];
};

export type AutoQaIssue = {
  scene?: number;
  problem: string;
  fix: string;
};

export type AutoQaResult = {
  pass: boolean;
  severity: "none" | "minor" | "major";
  issues: AutoQaIssue[];
  revisionInstructions: string;
};

export type AutoArchiveResult = {
  summary: string;
  characterState: string;
  plotState: string;
};

export type AutoPendingRevision = {
  scenes: number[];
  notes: string;
};

export type AutoRunState = {
  approved: boolean;
  continuityNotes: string;
  characterNotes: string;
  pendingRevision: AutoPendingRevision | null;
  planBrief: string;
  planLockedAt: string | null;
};

export type AutoRun = {
  id: string;
  bookId: string;
  slug: string;
  bookTitle: string;
  status: AutoRunStatus;
  mode: AutoRunMode;
  phase: AutoPhase;
  targetChapters: number;
  currentChapter: number;
  currentScene: number;
  revisionCount: number;
  storyBible: AutoStoryBible | null;
  outline: AutoChapterPlan[];
  state: AutoRunState;
  lastError: string | null;
  createdAt: string;
  updatedAt: string;
  startedAt: string | null;
  finishedAt: string | null;
};

export type AutoRunChapterStatus =
  | "planned"
  | "prose"
  | "qa"
  | "revising"
  | "archived"
  | "failed";

export type AutoRunChapter = {
  runId: string;
  chapterNumber: number;
  pageNumber: number | null;
  status: AutoRunChapterStatus;
  sceneIndex: number;
  revisionCount: number;
  scenes: string[];
  qa: AutoQaResult | null;
  summary: string;
  updatedAt: string;
};

export type AutoRunEvent = {
  id: number;
  runId: string;
  level: "info" | "warn" | "error";
  phase: AutoPhase;
  chapter: number | null;
  message: string;
  data: unknown;
  createdAt: string;
};

export type AutoRunSummary = AutoRun & {
  lastEvent: string | null;
};

export const AUTO_MAX_REVISIONS = 2;
export const AUTO_PREVIOUS_TAIL_WORDS = 400;
export const AUTO_SUMMARY_BUDGET = 12_000;
export const AUTO_MIN_SCENES = 3;
export const AUTO_MAX_SCENES = 4;

export type AutoSkillKey =
  | "architect"
  | "characters"
  | "outline"
  | "prose"
  | "qa"
  | "archivist";

export type AutoSkillDefinition = {
  key: AutoSkillKey;
  label: string;
  role: "planner" | "executor" | "summarizer";
  summary: string;
  placeholders: string[];
  /** Optional skills can be switched off per novel. */
  optional: boolean;
};

export const AUTO_SKILLS: AutoSkillDefinition[] = [
  {
    key: "architect",
    label: "Story Architect",
    role: "planner",
    summary: "Premise and discussion into the Story Bible.",
    placeholders: ["premise", "existingSummaries", "startChapter", "desiredChapters", "planBrief"],
    optional: true,
  },
  {
    key: "characters",
    label: "Character Weaver",
    role: "planner",
    summary: "Story Bible into the character roster.",
    placeholders: ["storyBible", "existingCharacters", "planBrief"],
    optional: true,
  },
  {
    key: "outline",
    label: "Arc & Scene Outliner",
    role: "planner",
    summary: "Story Bible into the chapter and scene roadmap.",
    placeholders: [
      "storyBible",
      "characters",
      "existingSummaries",
      "startChapter",
      "targetChapters",
      "planBrief",
    ],
    optional: false,
  },
  {
    key: "prose",
    label: "Scene Prose Writer",
    role: "executor",
    summary: "One scene at a time, in the novel's voice.",
    placeholders: [
      "storyBible",
      "characters",
      "summaries",
      "stateNotes",
      "previousTail",
      "chapterPlan",
      "scene",
      "chapterNumber",
      "priorScenes",
      "revisionNotes",
    ],
    optional: false,
  },
  {
    key: "qa",
    label: "Continuity & QA Critic",
    role: "summarizer",
    summary: "Chapter review before it is archived.",
    optional: true,
    placeholders: ["storyBible", "characters", "summaries", "stateNotes", "chapterPlan", "chapterText"],
  },
  {
    key: "archivist",
    label: "State Archivist",
    role: "summarizer",
    summary: "Chapter summary and continuity notes.",
    placeholders: ["chapterPlan", "chapterText", "summaries"],
    optional: true,
  },
];

export const AUTO_SKILL_PROMPT_KEYS = AUTO_SKILLS.flatMap((skill) => [
  `auto_${skill.key}_system`,
  `auto_${skill.key}_task`,
]);

export const AUTO_PLAN_SYSTEM_KEY = "auto_plan_system";
export const AUTO_PLAN_TASK_KEY = "auto_plan_task";

export const AUTO_OPTIONAL_SKILLS = AUTO_SKILLS.filter((skill) => skill.optional);

const OPTIONAL_SKILL_KEYS = new Set(AUTO_OPTIONAL_SKILLS.map((skill) => skill.key));

/** Keeps only optional skills, de-duplicated, in a stable order. */
export function normalizeDisabledSkills(value: unknown): AutoSkillKey[] {
  if (!Array.isArray(value)) return [];
  const seen = new Set<AutoSkillKey>();
  for (const item of value) {
    if (typeof item !== "string") continue;
    if (!OPTIONAL_SKILL_KEYS.has(item as AutoSkillKey)) continue;
    seen.add(item as AutoSkillKey);
  }
  return AUTO_OPTIONAL_SKILLS.map((skill) => skill.key).filter((key) => seen.has(key));
}

export const PHASE_SKILL: Record<AutoPhase, AutoSkillKey | null> = {
  architect: "architect",
  characters: "characters",
  outline: "outline",
  prose: "prose",
  qa: "qa",
  archive: "archivist",
  done: null,
};

/** Next pipeline phase, used when a step is skipped. */
export function nextPhase(phase: AutoPhase): AutoPhase {
  switch (phase) {
    case "architect":
      return "characters";
    case "characters":
      return "outline";
    case "qa":
      return "archive";
    default:
      return phase;
  }
}

export const AUTO_PROMPT_KEYS = [
  AUTO_PLAN_SYSTEM_KEY,
  AUTO_PLAN_TASK_KEY,
  ...AUTO_SKILL_PROMPT_KEYS,
];

/** Skill keys that can carry their own model, including the planning chat. */
export type AutoModelRole = "plan" | AutoSkillKey;

export type AutoModelOverrides = {
  /** Base model for every Auto Mode call. Empty inherits the book role model. */
  default: string;
  /** Per-skill model. Empty inherits `default`. */
  skills: Partial<Record<AutoModelRole, string>>;
};

export function emptyAutoModelOverrides(): AutoModelOverrides {
  return { default: "", skills: {} };
}

export function normalizeAutoModelOverrides(
  value: Partial<AutoModelOverrides> | null | undefined,
): AutoModelOverrides {
  const skills: Partial<Record<AutoModelRole, string>> = {};
  for (const [key, model] of Object.entries(value?.skills ?? {})) {
    if (typeof model === "string" && model.trim()) {
      skills[key as AutoModelRole] = model.trim();
    }
  }
  return { default: value?.default?.trim() ?? "", skills };
}

/**
 * Precedence: skill override, then the run's default model, then the book's
 * model for that provider role.
 */
export function resolveAutoModel(
  skill: AutoModelRole,
  overrides: AutoModelOverrides | null | undefined,
  roleModels: { planner: string; executor: string; summarizer: string },
): string {
  const normalized = normalizeAutoModelOverrides(overrides);
  return (
    normalized.skills[skill]?.trim() ||
    normalized.default.trim() ||
    roleModels[autoSkillRole(skill)]
  );
}

export function autoSkillRole(skill: AutoModelRole): "planner" | "executor" | "summarizer" {
  if (skill === "plan") return "planner";
  const found = AUTO_SKILLS.find((item) => item.key === skill);
  return found?.role ?? "planner";
}

export function emptyAutoRunState(): AutoRunState {
  return {
    approved: false,
    continuityNotes: "",
    characterNotes: "",
    pendingRevision: null,
    planBrief: "",
    planLockedAt: null,
  };
}

export function normalizeAutoRunState(state: Partial<AutoRunState> | null | undefined): AutoRunState {
  const base = emptyAutoRunState();
  if (!state) return base;
  return {
    approved: Boolean(state.approved),
    continuityNotes: state.continuityNotes ?? "",
    characterNotes: state.characterNotes ?? "",
    pendingRevision: state.pendingRevision ?? null,
    planBrief: state.planBrief ?? "",
    planLockedAt: state.planLockedAt ?? null,
  };
}
