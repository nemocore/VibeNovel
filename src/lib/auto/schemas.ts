import { z } from "zod";
import { characterSchema } from "@/lib/schemas";

export const autoStoryBibleSchema = z.preprocess(normalizeBiblePayload, z.object({
  title: z.string().trim().min(1).max(200),
  logline: z.string().trim().min(1).max(2_000),
  tone: z.string().trim().min(1).max(1_000),
  worldRules: z.array(z.string().trim().min(1).max(2_000)).min(1).max(30),
  coreConflict: z.string().trim().min(1).max(3_000),
  endingResolution: z.string().trim().min(1).max(3_000),
  targetChapters: z.number().int().min(2).max(200),
  constraints: z.array(z.string().trim().min(1).max(1_000)).max(30).default([]),
}));

export const autoScenePlanSchema = z.object({
  index: z.number().int().positive(),
  title: z.string().trim().min(1).max(200),
  beat: z.string().trim().min(1).max(4_000),
  pov: z.string().trim().max(200).optional().default(""),
});

export const autoChapterPlanSchema = z.object({
  number: z.number().int().positive(),
  title: z.string().trim().min(1).max(200),
  purpose: z.string().trim().max(2_000).default(""),
  summary: z.string().trim().max(4_000).default(""),
  characters: z.array(z.string().trim().max(120)).max(50).default([]),
  scenes: z.array(autoScenePlanSchema).min(1).max(10),
});

export const autoOutlineSchema = z.preprocess(
  normalizeOutlinePayload,
  z.object({ chapters: z.array(autoChapterPlanSchema).min(1).max(200) }),
);

export const autoCharacterListSchema = z.preprocess(
  normalizeCharacterListPayload,
  z.object({ characters: z.array(characterSchema).min(1).max(50) }),
);

export const autoQaIssueSchema = z.object({
  scene: z.number().int().positive().optional(),
  problem: z.string().trim().min(1).max(2_000),
  fix: z.string().trim().min(1).max(2_000),
});

export const autoQaSchema = z.preprocess(normalizeQaPayload, z.object({
  pass: z.boolean(),
  severity: z.enum(["none", "minor", "major"]),
  issues: z.array(autoQaIssueSchema).max(20),
  revisionInstructions: z.string().trim().max(4_000),
}));

type UnknownRecord = Record<string, unknown>;

function isRecord(value: unknown): value is UnknownRecord {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function asText(value: unknown): string {
  if (typeof value === "string") return value.trim();
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  return "";
}

function textField(record: UnknownRecord, keys: string[]): string {
  for (const key of keys) {
    const text = asText(record[key]);
    if (text) return text;
  }
  return "";
}

const QA_WRAPPER_KEYS = ["qa", "review", "result", "assessment", "evaluation", "critique"];

/** Providers vary the QA shape; normalise the common variants before validation. */
export function normalizeQaPayload(raw: unknown): unknown {
  let record: UnknownRecord | null = isRecord(raw) ? raw : null;
  if (!record) return raw;
  for (const key of QA_WRAPPER_KEYS) {
    if (isRecord(record[key])) {
      record = record[key] as UnknownRecord;
      break;
    }
  }

  const knownKeys = ["pass", "issues", "severity", "revisionInstructions"];
  const hasSignal =
    knownKeys.some((key) => key in record!) ||
    ["instructions", "revisionBrief", "notes", "problems", "feedback", "revisions", "findings"].some(
      (key) => key in record!,
    );
  if (!hasSignal) return raw;

  const severity = normalizeSeverity(textField(record, ["severity", "level", "rating"]));

  const rawIssues =
    record.issues ?? record.problems ?? record.findings ?? record.feedback ?? record.revisions;
  const issues: Array<{ scene?: number; problem: string; fix: string }> = [];
  const list = Array.isArray(rawIssues) ? rawIssues : rawIssues ? [rawIssues] : [];
  for (const item of list) {
    if (typeof item === "string") {
      const problem = item.trim();
      if (problem) issues.push({ problem, fix: "Revise as noted." });
      continue;
    }
    if (!isRecord(item)) continue;
    const problem = textField(item, ["problem", "issue", "description", "note"]);
    if (!problem) continue;
    const fix = textField(item, ["fix", "suggestion", "recommendation", "resolution"]) || "Revise as noted.";
    const scene = coerceScene(item.scene);
    issues.push(scene ? { scene, problem, fix } : { problem, fix });
  }

  const pass = normalizePass(record.pass, issues.length);

  return {
    pass,
    severity: severity ?? (issues.length ? "minor" : "none"),
    issues,
    revisionInstructions: normalizeInstructions(record),
  };
}

function normalizePass(value: unknown, issueCount: number): boolean {
  if (typeof value === "boolean") return value;
  if (typeof value === "number") return value !== 0;
  const text = asText(value).toLowerCase();
  if (["true", "yes", "pass", "passed", "ok"].includes(text)) return true;
  if (["false", "no", "fail", "failed", "revise"].includes(text)) return false;
  return issueCount === 0;
}

function normalizeSeverity(value: string): "none" | "minor" | "major" | null {
  const text = value.toLowerCase();
  if (!text) return null;
  if (/(none|pass|ok|clean|none)/.test(text)) return "none";
  if (/(major|high|critical|severe|blocker)/.test(text)) return "major";
  if (/(minor|low|moderate|medium|small)/.test(text)) return "minor";
  return "minor";
}

function coerceScene(value: unknown): number | undefined {
  if (typeof value === "number" && Number.isInteger(value) && value > 0) return value;
  const text = asText(value);
  const match = /\d+/.exec(text);
  if (!match) return undefined;
  const number = Number(match[0]);
  return Number.isInteger(number) && number > 0 ? number : undefined;
}

function normalizeInstructions(record: UnknownRecord): string {
  const value =
    record.revisionInstructions ??
    record.instructions ??
    record.revisionBrief ??
    record.notes;
  if (Array.isArray(value)) {
    return value.map((item) => asText(item)).filter(Boolean).join("\n").slice(0, 4_000);
  }
  return asText(value).slice(0, 4_000);
}

export const autoArchiveSchema = z.object({
  summary: z.string().trim().min(1).max(20_000),
  characterState: z.string().trim().max(4_000).default(""),
  plotState: z.string().trim().max(4_000).default(""),
});

export const autoStartSchema = z
  .object({
    /** Existing book to continue. Omitted when creating a new novel. */
    slug: z.string().min(1).max(80).optional(),
    /** New novel fields, used when `slug` is absent. */
    title: z.string().trim().min(1).max(200).optional(),
    premise: z.string().trim().min(20).max(20_000).optional(),
    genre: z.string().trim().max(500).optional(),
    mode: z.enum(["autopilot", "checkpoint"]).default("checkpoint"),
    targetChapters: z.number().int().min(2).max(200).optional(),
    presetId: z.string().trim().max(100).optional(),
    /** Copy the existing book into a new one instead of writing into the source. */
    fork: z.boolean().default(false),
  })
  .refine((value) => Boolean(value.slug) || Boolean(value.title && value.premise), {
    message: "Give the new novel a title and an initial premise, or choose an existing book.",
  });

export const autoPlanTurnSchema = z.object({
  message: z.string().trim().min(1).max(20_000),
});

export const autoPlanLockSchema = z.object({
  planBrief: z.string().trim().min(20).max(200_000),
  targetChapters: z.number().int().min(2).max(200).optional(),
  mode: z.enum(["autopilot", "checkpoint"]).optional(),
  planPrompts: z
    .object({
      system: z.string().max(80_000).optional(),
      task: z.string().max(80_000).optional(),
    })
    .optional(),
});

export const autoSkillsSchema = z.object({
  values: z.record(z.string(), z.string().max(80_000)).optional(),
  reset: z.array(z.string().max(80)).max(30).optional(),
  models: z
    .object({
      default: z.string().max(500).optional(),
      skills: z.record(z.string().max(80), z.string().max(500)).optional(),
    })
    .optional(),
});

export const autoActionSchema = z.object({
  action: z.enum(["pause", "resume", "stop"]),
});

export const autoPatchSchema = z
  .object({
    storyBible: autoStoryBibleSchema.optional(),
    outline: autoOutlineSchema.optional(),
    approve: z.boolean().optional(),
  })
  .refine(
    (value) =>
      value.storyBible !== undefined ||
      value.outline !== undefined ||
      value.approve !== undefined,
    { message: "Nothing to update." },
  );

export type AutoStoryBibleInput = z.infer<typeof autoStoryBibleSchema>;
export type AutoOutlineInput = z.infer<typeof autoOutlineSchema>;
export type AutoQaInput = z.infer<typeof autoQaSchema>;
export type AutoArchiveInput = z.infer<typeof autoArchiveSchema>;
export type AutoCharacterListInput = z.infer<typeof autoCharacterListSchema>;

/* ------------------------------------------------------------------ */
/* Flexible payload normalisers                                        */
/* ------------------------------------------------------------------ */

type AnyRecord = Record<string, unknown>;

function isObj(value: unknown): value is AnyRecord {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function camelKey(key: string): string {
  return key.replace(/[_\-\s]+([a-z0-9])/gi, (_, char: string) => char.toUpperCase());
}

function camelize(record: AnyRecord): AnyRecord {
  const next: AnyRecord = {};
  for (const [key, value] of Object.entries(record)) next[camelKey(key)] = value;
  return next;
}

function unwrapRecord(raw: unknown, keys: string[]): AnyRecord | null {
  if (!isObj(raw)) return null;
  const record = camelize(raw);
  for (const key of keys) {
    if (isObj(record[key])) return camelize(record[key] as AnyRecord);
  }
  return record;
}

function text(value: unknown): string {
  if (typeof value === "string") return value.trim();
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  return "";
}

function firstText(record: AnyRecord, keys: string[]): string {
  for (const key of keys) {
    const value = text(record[key]);
    if (value) return value;
  }
  return "";
}

function stringList(value: unknown): string[] {
  if (Array.isArray(value)) {
    return value.map((item) => (isObj(item) ? firstText(item, ["name", "rule", "text", "value"]) : text(item))).filter(Boolean);
  }
  const single = text(value);
  return single ? [single] : [];
}

function numberValue(value: unknown): number | undefined {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  const match = /\d+/.exec(text(value));
  if (!match) return undefined;
  const parsed = Number(match[0]);
  return Number.isFinite(parsed) ? parsed : undefined;
}

export function normalizeBiblePayload(raw: unknown): unknown {
  const record = unwrapRecord(raw, ["storyBible", "story_bible", "bible", "story"]);
  if (!record) return raw;
  const target = numberValue(record.targetChapters) ?? numberValue(record.chapters);
  return {
    title: firstText(record, ["title", "name", "workingTitle"]),
    logline: firstText(record, ["logline", "premise", "summary", "oneLine"]),
    tone: firstText(record, ["tone", "voice", "register", "genre"]),
    worldRules: stringList(record.worldRules ?? record.rules ?? record.world),
    coreConflict: firstText(record, ["coreConflict", "conflict", "centralConflict"]),
    endingResolution: firstText(record, ["endingResolution", "resolution", "ending"]),
    targetChapters: target,
    constraints: stringList(record.constraints ?? record.hardConstraints),
  };
}

export function normalizeCharacterListPayload(raw: unknown): unknown {
  if (Array.isArray(raw)) return { characters: raw };
  const record = unwrapRecord(raw, ["characters", "cast", "people", "roster"]);
  if (!record) return raw;
  const list = Array.isArray(raw)
    ? raw
    : Array.isArray(record.characters)
      ? record.characters
      : Array.isArray(record.cast)
        ? record.cast
        : Array.isArray(record.people)
          ? record.people
          : null;
  if (!list) return raw;
  return {
    characters: list.map((item) => {
      if (typeof item === "string") return { name: item, role: "", description: "" };
      if (!isObj(item)) return { name: "", role: "", description: "" };
      const entry = camelize(item);
      return {
        name: firstText(entry, ["name", "character", "title"]),
        role: firstText(entry, ["role", "archetype", "function"]),
        description: firstText(entry, ["description", "summary", "bio", "notes", "want"]),
      };
    }),
  };
}

export function normalizeOutlinePayload(raw: unknown): unknown {
  if (Array.isArray(raw)) return { chapters: raw };
  const record = unwrapRecord(raw, ["chapters", "outline", "arc", "roadmap", "plan", "book"]);
  if (!record) return raw;
  const list = Array.isArray(record.chapters)
    ? record.chapters
    : Array.isArray(record.outline)
      ? record.outline
      : Array.isArray(record.arc)
        ? record.arc
        : Array.isArray(record.roadmap)
          ? record.roadmap
          : Array.isArray(record.plan)
            ? record.plan
            : null;
  if (!list) return raw;
  return {
    chapters: list.map((item, position) => {
      const entry = isObj(item) ? camelize(item) : {};
      const number = numberValue(entry.number) ?? numberValue(entry.chapter) ?? position + 1;
      const scenesRaw = Array.isArray(entry.scenes)
        ? entry.scenes
        : Array.isArray(entry.beats)
          ? entry.beats
          : [];
      return {
        number,
        title: firstText(entry, ["title", "name"]) || `Chapter ${number}`,
        purpose: firstText(entry, ["purpose", "goal", "changes"]),
        summary: firstText(entry, ["summary", "synopsis", "description"]),
        characters: stringList(entry.characters ?? entry.cast),
        scenes: scenesRaw.map((scene, sceneIndex) => {
          const beat = isObj(scene) ? camelize(scene) : {};
          return {
            index: numberValue(beat.index) ?? numberValue(beat.number) ?? sceneIndex + 1,
            title:
              firstText(beat, ["title", "name"]) ||
              `Scene ${numberValue(beat.index) ?? sceneIndex + 1}`,
            beat: firstText(beat, ["beat", "action", "summary", "goal", "description"]),
            pov: firstText(beat, ["pov", "viewpoint", "character"]),
          };
        }),
      };
    }),
  };
}
