import { describe, expect, it } from "vitest";
import {
  existingChapterSummaries,
  formatCharacters,
  formatSummaries,
  nextLogicalChapter,
  previousChapterPage,
} from "@/lib/auto/context";
import {
  autoOutlineSchema,
  autoPlanLockSchema,
  autoQaSchema,
  autoSkillsSchema,
  autoStartSchema,
  autoStoryBibleSchema,
  autoCharacterListSchema,
} from "@/lib/auto/schemas";
import { extractJson } from "@/lib/auto/json";
import { finalPlanText } from "@/lib/auto/plan-brief";
import { decodePremise, encodePremise } from "@/lib/auto/create";
import { buildPlanMessages } from "@/lib/auto/plan";
import { normalizeAutoRunState } from "@/lib/auto/types";
import {
  AUTO_SKILLS,
  nextPhase,
  normalizeAutoModelOverrides,
  normalizeDisabledSkills,
  resolveAutoModel,
} from "@/lib/auto/types";
import { joinContinuation } from "@/lib/auto/continuation";
import type { Outline } from "@/lib/schemas";

const outline: Outline = {
  version: 1,
  id: "book-1",
  title: "Test Book",
  premise: "A test premise.",
  status: "active",
  archived: false,
  characters: [
    { name: "Mara", role: "protagonist", description: "Cartographer." },
    { name: "Ren", role: "ally", description: "Knows the house." },
  ],
  chapters: [
    {
      number: 1,
      title: "One",
      summary: "Mara arrives.",
      status: "summarized",
      wordCount: 100,
      summaryStale: false,
      kind: "chapter",
      chapterNumber: 1,
      updatedAt: "2026-01-01T00:00:00.000Z",
    },
    {
      number: 2,
      title: "Plate",
      summary: "",
      status: "planned",
      wordCount: 0,
      summaryStale: false,
      kind: "illustration",
      updatedAt: "2026-01-01T00:00:00.000Z",
    },
    {
      number: 3,
      title: "Two",
      summary: "Mara opens the gate.",
      status: "summarized",
      wordCount: 120,
      summaryStale: false,
      kind: "chapter",
      chapterNumber: 2,
      updatedAt: "2026-01-02T00:00:00.000Z",
    },
  ],
  currentChapter: 3,
  createdAt: "2026-01-01T00:00:00.000Z",
  updatedAt: "2026-01-02T00:00:00.000Z",
};

describe("auto context", () => {
  it("counts logical chapters and ignores illustration pages", () => {
    expect(nextLogicalChapter(outline)).toBe(3);
    expect(previousChapterPage(outline, 3)?.chapterNumber).toBe(2);
  });

  it("starts at chapter 01 when the only chapter is an empty placeholder", () => {
    const fresh: Outline = {
      ...outline,
      chapters: [
        {
          number: 1,
          title: "Untitled Chapter",
          summary: "",
          status: "planned",
          wordCount: 0,
          summaryStale: false,
          kind: "chapter",
          chapterNumber: 1,
          updatedAt: "2026-01-01T00:00:00.000Z",
        },
      ],
    };
    expect(nextLogicalChapter(fresh)).toBe(1);
  });

  it("skips placeholders but never rewinds past written chapters", () => {
    const mixed: Outline = {
      ...outline,
      chapters: [
        { ...outline.chapters[0] },
        {
          number: 2,
          title: "Untitled Chapter",
          summary: "",
          status: "planned",
          wordCount: 0,
          summaryStale: false,
          kind: "chapter",
          chapterNumber: 2,
          updatedAt: "2026-01-03T00:00:00.000Z",
        },
      ],
    };
    expect(nextLogicalChapter(mixed)).toBe(2);

    const draftedOnly: Outline = {
      ...outline,
      chapters: [
        {
          ...outline.chapters[0],
          wordCount: 0,
          status: "drafted",
        },
      ],
    };
    expect(nextLogicalChapter(draftedOnly)).toBe(2);
  });

  it("formats only active characters when names are supplied", () => {
    const text = formatCharacters(outline, ["Ren"]);
    expect(text).toContain("Ren");
    expect(text).not.toContain("Mara");
  });

  it("keeps prior chapter summaries in order", () => {
    const text = formatSummaries(outline, 3);
    expect(text).toContain("Chapter 1");
    expect(text).toContain("Chapter 2");
    expect(text).not.toContain("Chapter 3");
  });

  it("lists existing summaries for the architect", () => {
    const text = existingChapterSummaries(outline);
    expect(text).toContain("Chapter 1 - One");
    expect(text).toContain("Chapter 2 - Two");
  });
});

describe("auto schemas", () => {
  it("requires a viable story bible", () => {
    expect(
      autoStoryBibleSchema.safeParse({
        title: "Book",
        logline: "A logline.",
        tone: "Dark.",
        worldRules: ["Rule"],
        coreConflict: "Conflict.",
        endingResolution: "Resolved.",
        targetChapters: 12,
        constraints: [],
      }).success,
    ).toBe(true);
    expect(
      autoStoryBibleSchema.safeParse({
        title: "Book",
        logline: "A logline.",
        tone: "Dark.",
        worldRules: ["Rule"],
        coreConflict: "Conflict.",
        endingResolution: "Resolved.",
        targetChapters: 1,
        constraints: [],
      }).success,
    ).toBe(false);
  });

  it("validates QA output", () => {
    expect(
      autoQaSchema.safeParse({
        pass: false,
        severity: "minor",
        issues: [{ scene: 2, problem: "Weak turn.", fix: "Add a decision." }],
        revisionInstructions: "Tighten scene 2.",
      }).success,
    ).toBe(true);
  });

  it("accepts the QA shape variations providers actually return", () => {
    const wrapped = autoQaSchema.safeParse({
      review: {
        pass: "false",
        severity: "high",
        issues: ["Scene 2 has no turn.", "The letter contradicts chapter 1."],
        instructions: ["Rewrite scene 2", "Fix the letter date"],
      },
    });
    expect(wrapped.success).toBe(true);
    if (wrapped.success) {
      expect(wrapped.data.pass).toBe(false);
      expect(wrapped.data.severity).toBe("major");
      expect(wrapped.data.issues).toHaveLength(2);
      expect(wrapped.data.issues[0]).toMatchObject({
        problem: "Scene 2 has no turn.",
        fix: "Revise as noted.",
      });
      expect(wrapped.data.revisionInstructions).toContain("Rewrite scene 2");
    }

    const loose = autoQaSchema.safeParse({
      pass: 0,
      severity: "moderate",
      issues: [{ scene: "2", issue: "POV slips.", suggestion: "Stay in Mara." }],
      revisionBrief: null,
    });
    expect(loose.success).toBe(true);
    if (loose.success) {
      expect(loose.data.pass).toBe(false);
      expect(loose.data.severity).toBe("minor");
      expect(loose.data.issues[0]).toEqual({
        scene: 2,
        problem: "POV slips.",
        fix: "Stay in Mara.",
      });
      expect(loose.data.revisionInstructions).toBe("");
    }

    const inferred = autoQaSchema.safeParse({
      severity: "ok",
      issues: [],
    });
    expect(inferred.success).toBe(true);
    if (inferred.success) {
      expect(inferred.data.pass).toBe(true);
      expect(inferred.data.severity).toBe("none");
    }
  });

  it("still rejects a QA reply with no usable fields", () => {
    expect(autoQaSchema.safeParse({}).success).toBe(false);
    expect(autoQaSchema.safeParse({ unrelated: true }).success).toBe(false);
  });

  it("validates start input", () => {
    expect(
      autoStartSchema.safeParse({ slug: "book", mode: "checkpoint", targetChapters: 12 }).success,
    ).toBe(true);
    expect(autoStartSchema.safeParse({ slug: "book", mode: "autopilot" }).success).toBe(true);
  });

  it("accepts a new novel without a slug", () => {
    expect(
      autoStartSchema.safeParse({
        title: "New Book",
        premise: "A cartographer returns home and finds an impossible coastline.",
        mode: "checkpoint",
      }).success,
    ).toBe(true);
    expect(autoStartSchema.safeParse({ mode: "checkpoint" }).success).toBe(false);
    expect(
      autoStartSchema.safeParse({ title: "New Book", premise: "Too short." }).success,
    ).toBe(false);
  });

  it("validates plan lock and skill updates", () => {
    expect(
      autoPlanLockSchema.safeParse({ planBrief: "Too short." }).success,
    ).toBe(false);
    expect(
      autoPlanLockSchema.safeParse({
        planBrief: "The map is a living coastline the family agreed to forget.",
        targetChapters: 14,
        mode: "autopilot",
      }).success,
    ).toBe(true);
    expect(autoSkillsSchema.safeParse({ values: { auto_prose_system: "Voice." } }).success).toBe(
      true,
    );
    expect(autoSkillsSchema.safeParse({ reset: ["auto_prose_system"] }).success).toBe(true);
  });
});

describe("auto model overrides", () => {
  const roleModels = {
    planner: "p|plan-model",
    executor: "p|prose-model",
    summarizer: "p|analysis-model",
  };

  it("falls back from skill to run default to book role", () => {
    expect(resolveAutoModel("prose", null, roleModels)).toBe("p|prose-model");
    expect(
      resolveAutoModel("prose", { default: "p|run-model", skills: {} }, roleModels),
    ).toBe("p|run-model");
    expect(
      resolveAutoModel(
        "prose",
        { default: "p|run-model", skills: { prose: "p|creative-model" } },
        roleModels,
      ),
    ).toBe("p|creative-model");
  });

  it("routes each skill to its natural role when nothing is overridden", () => {
    expect(resolveAutoModel("plan", null, roleModels)).toBe("p|plan-model");
    expect(resolveAutoModel("outline", null, roleModels)).toBe("p|plan-model");
    expect(resolveAutoModel("qa", null, roleModels)).toBe("p|analysis-model");
    expect(resolveAutoModel("archivist", null, roleModels)).toBe("p|analysis-model");
  });

  it("drops blank overrides instead of storing empty models", () => {
    const normalized = normalizeAutoModelOverrides({
      default: "  ",
      skills: { prose: "  ", qa: "p|critic" },
    });
    expect(normalized.default).toBe("");
    expect(normalized.skills).toEqual({ qa: "p|critic" });
  });
});

describe("auto continuation", () => {
  it("resumes a mid-word cut without inserting a space", () => {
    expect(joinContinuation("The coast is architec", "ture of the house.")).toBe(
      "The coast is architecture of the house.",
    );
  });

  it("separates a sentence continuation", () => {
    expect(joinContinuation("That was the plan.", "The map answered.")).toBe(
      "That was the plan. The map answered.",
    );
    expect(joinContinuation("the orchard,", "then the lane")).toBe("the orchard, then the lane");
  });

  it("keeps existing whitespace and handles empty halves", () => {
    expect(joinContinuation("line one\n", "line two")).toBe("line one\nline two");
    expect(joinContinuation("", "only continuation")).toBe("only continuation");
    expect(joinContinuation("only left", "")).toBe("only left");
  });
});

describe("auto JSON extraction", () => {
  it("reads fenced JSON with prose around it", () => {
    const raw = `Here is the plan:\n\n\`\`\`json\n{"pass": true, "issues": []}\n\`\`\`\n\nTell me if you want changes.`;
    expect(extractJson(raw)).toEqual({ pass: true, issues: [] });
  });

  it("finds the outermost object even with nested braces in strings", () => {
    const raw = `Sure — {"summary": "A gate {not json} opens", "chapters": [{"number": 1}]} thanks`;
    expect(extractJson(raw)).toEqual({
      summary: "A gate {not json} opens",
      chapters: [{ number: 1 }],
    });
  });

  it("accepts a bare array reply", () => {
    expect(extractJson(`[{"name":"Mara"}]`)).toEqual([{ name: "Mara" }]);
  });

  it("throws when no JSON exists", () => {
    expect(() => extractJson("No structured reply here.")).toThrow();
  });
});

describe("auto payload normalisers", () => {
  it("accepts aliases for the story bible", () => {
    const parsed = autoStoryBibleSchema.safeParse({
      story_bible: {
        name: "The Salt Ledger",
        premise: "A smuggler keeps two ledgers.",
        voice: "Cold, close third.",
        rules: ["The sea ledger always wins."],
        central_conflict: "Crown versus sea.",
        ending: "The town pays the difference.",
        chapters: "12",
      },
    });
    expect(parsed.success).toBe(true);
    if (parsed.success) {
      expect(parsed.data.targetChapters).toBe(12);
      expect(parsed.data.worldRules).toEqual(["The sea ledger always wins."]);
    }
  });

  it("accepts cast aliases and bare character arrays", () => {
    const parsed = autoCharacterListSchema.safeParse({
      cast: [{ character: "Mara", archetype: "protagonist", bio: "Cartographer." }],
    });
    expect(parsed.success).toBe(true);
    if (parsed.success) {
      expect(parsed.data.characters[0]).toMatchObject({
        name: "Mara",
        role: "protagonist",
        description: "Cartographer.",
      });
    }
    expect(autoCharacterListSchema.safeParse([{ name: "Ren" }]).success).toBe(true);
  });

  it("accepts outline and scene aliases", () => {
    const parsed = autoOutlineSchema.safeParse({
      roadmap: [
        {
          chapter: "4",
          name: "The Warm Ink",
          goal: "Mara touches the map.",
          synopsis: "She learns the coast is warm.",
          cast: ["Mara"],
          beats: [{ title: "Kitchen", action: "Mara studies the map.", viewpoint: "Mara" }],
        },
      ],
    });
    expect(parsed.success).toBe(true);
    if (parsed.success) {
      const chapter = parsed.data.chapters[0];
      expect(chapter.number).toBe(4);
      expect(chapter.scenes[0].beat).toBe("Mara studies the map.");
      expect(chapter.scenes[0].pov).toBe("Mara");
    }
  });
});

describe("auto plan brief", () => {
  it("uses only the final assistant reply", () => {
    const text = finalPlanText(
      [
        { role: "user", content: "Make it a comedy." },
        { role: "assistant", content: "Draft A: the keeper is a ghost." },
        { role: "user", content: "No ghosts. Dark gothic." },
        { role: "assistant", content: "Final plan: 12 chapters, keeper alive, letters from 1891." },
      ],
      "Original premise.",
    );
    expect(text).toBe("Final plan: 12 chapters, keeper alive, letters from 1891.");
    expect(text).not.toContain("comedy");
    expect(text).not.toContain("ghost");
  });

  it("falls back to the premise before the first chat", () => {
    expect(finalPlanText([], "Original premise.")).toBe("Original premise.");
    expect(finalPlanText([{ role: "user", content: "hello" }], "Premise.")).toBe("Premise.");
  });

  it("keeps the full reply instead of compressing it", () => {
    const long = `Final plan.\n${"Beat detail line. ".repeat(5_000)}`;
    expect(finalPlanText([{ role: "assistant", content: long }], "Premise.")).toHaveLength(
      long.trim().length,
    );
  });
});

describe("auto skill toggles", () => {
  it("keeps only optional skills and de-duplicates", () => {
    expect(normalizeDisabledSkills(["qa", "qa", "prose", "outline", "archivist", "bogus"])).toEqual([
      "qa",
      "archivist",
    ]);
    expect(normalizeDisabledSkills(null)).toEqual([]);
    expect(normalizeDisabledSkills("qa")).toEqual([]);
  });

  it("routes skipped phases to the next enabled step", () => {
    expect(nextPhase("qa")).toBe("archive");
    expect(nextPhase("architect")).toBe("characters");
    expect(nextPhase("characters")).toBe("outline");
    expect(nextPhase("prose")).toBe("prose");
  });

  it("marks core skills as non-optional", () => {
    const optional = AUTO_SKILLS.filter((skill) => skill.optional).map((skill) => skill.key);
    expect(optional).toEqual(["architect", "characters", "qa", "archivist"]);
  });
});

describe("auto project helpers", () => {
  it("round-trips the tone notes out of the stored premise", () => {
    const stored = encodePremise("A cartographer returns home.", "Literary suspense");
    const decoded = decodePremise(stored);
    expect(decoded.premise).toBe("A cartographer returns home.");
    expect(decoded.tone).toBe("Literary suspense");
    expect(decodePremise("Plain premise only.").tone).toBe("");
  });

  it("normalises legacy run state without losing continuity notes", () => {
    const state = normalizeAutoRunState({
      approved: true,
      continuityNotes: "Gate is open.",
    });
    expect(state.approved).toBe(true);
    expect(state.continuityNotes).toBe("Gate is open.");
    expect(state.planLockedAt).toBeNull();
    expect(state.planBrief).toBe("");
  });

  it("keeps every Auto Mode payload ending with a single user message", () => {
    const messages = buildPlanMessages({
      outline,
      history: [
        { id: "a", role: "user", content: "Gritty?", createdAt: "2026-01-01T00:00:00.000Z" },
        { id: "b", role: "assistant", content: "Somewhat.", createdAt: "2026-01-01T00:00:01.000Z" },
      ],
      message: "Good. Lock it.",
      systemPrompt: "You plan novels.",
      taskPrompt: "{{premise}} | tone={{tone}} | {{targetChapters}} | {{message}}",
      toneNotes: "Quiet",
      targetChapters: 12,
    });
    expect(messages[0].role).toBe("system");
    expect(messages[messages.length - 1].role).toBe("user");
    expect(messages[messages.length - 1].content).toContain("Good. Lock it.");
    expect(messages.some((message) => message.content.includes("Quiet"))).toBe(true);
  });
});
