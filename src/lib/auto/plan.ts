import { chatCompletionStreaming, type ChatInputMessage } from "@/lib/ai/client";
import { renderPrompt } from "@/lib/ai/prompts";
import { resolveModelRoute } from "@/lib/ai/routing";
import { AppError } from "@/lib/errors";
import { requireConfig } from "@/lib/storage/config";
import { getBookConfig } from "@/lib/storage/book-config";
import { getAutoSkillPrompts } from "@/lib/storage/auto-skills";
import {
  AUTO_PLAN_SYSTEM_KEY,
  AUTO_PLAN_TASK_KEY,
  resolveAutoModel,
} from "@/lib/auto/types";
import { existingChapterSummaries } from "@/lib/auto/context";
import type { ChatMessage, GenerationParams, Outline } from "@/lib/schemas";

const MAX_HISTORY_MESSAGES = 30;
const MAX_HISTORY_CHARS = 24_000;
export function buildPlanMessages(input: {
  outline: Outline;
  history: ChatMessage[];
  message: string;
  systemPrompt: string;
  taskPrompt: string;
  toneNotes?: string;
  targetChapters?: number;
}): ChatInputMessage[] {
  const messages: ChatInputMessage[] = [
    {
      role: "system",
      content: input.systemPrompt.trim(),
    },
    {
      role: "user",
      content: renderPrompt(input.taskPrompt, {
        premise: input.outline.premise.trim() || "No premise recorded yet.",
        tone: input.toneNotes?.trim() || "No separate genre notes recorded.",
        targetChapters: input.targetChapters
          ? String(input.targetChapters)
          : "Decide with the author.",
        existingSummaries: existingChapterSummaries(input.outline),
      }),
    },
  ];

  const usable = input.history.filter((item) => item.content.trim() && !item.failed);
  const kept: ChatInputMessage[] = [];
  let used = 0;
  for (let index = usable.length - 1; index >= 0; index -= 1) {
    const entry = usable[index];
    const cost = entry.content.length;
    if (kept.length >= MAX_HISTORY_MESSAGES) break;
    if (kept.length && used + cost > MAX_HISTORY_CHARS) break;
    kept.unshift({ role: entry.role, content: entry.content.trim() });
    used += cost;
  }
  messages.push(...kept);

  // Every Auto Mode payload ends with a single user message.
  messages.push({
    role: "user",
    content: renderPrompt("[AUTHOR MESSAGE]\n{{message}}", { message: input.message.trim() }),
  });
  return messages;
}

export type PlanTurnInput = {
  slug: string;
  outline: Outline;
  history: ChatMessage[];
  message: string;
  toneNotes?: string;
  targetChapters?: number;
  overrides?: Record<string, string>;
  signal?: AbortSignal;
};

export type PlanRequest = {
  baseUrl: string;
  apiKey: string;
  model: string;
  params: GenerationParams;
  messages: ChatInputMessage[];
  overrides: Record<string, string>;
};

export async function buildPlanRequest(input: PlanTurnInput): Promise<PlanRequest> {
  const [global, book, skills] = await Promise.all([
    requireConfig(),
    getBookConfig(input.slug),
    getAutoSkillPrompts(input.slug),
  ]);
  const prompts = { ...skills.values, ...(input.overrides ?? {}) };
  const system = prompts[AUTO_PLAN_SYSTEM_KEY]?.trim();
  const task = prompts[AUTO_PLAN_TASK_KEY]?.trim();
  if (!system || !task) {
    throw new AppError(
      "CONFIG_REQUIRED",
      "The Auto Mode planning prompt is missing. Open the novel's skill prompts and restore it.",
      { status: 428 },
    );
  }

  const route = resolveModelRoute(global, resolveAutoModel("plan", skills.models, book.config.models));
  return {
    baseUrl: route.provider.baseUrl,
    apiKey: route.provider.apiKey,
    model: route.model,
    params: book.config.roles.planner.params,
    messages: buildPlanMessages({
      outline: input.outline,
      history: input.history,
      message: input.message,
      systemPrompt: system,
      taskPrompt: task,
      toneNotes: input.toneNotes,
      targetChapters: input.targetChapters,
    }),
    overrides: { ...skills.overrides, ...(input.overrides ?? {}) },
  };
}

export async function runPlanTurn(
  input: PlanTurnInput,
): Promise<{ text: string; model: string; truncated: boolean; overrides: Record<string, string> }> {
  const request = await buildPlanRequest(input);
  const result = await chatCompletionStreaming({
    baseUrl: request.baseUrl,
    apiKey: request.apiKey,
    model: request.model,
    messages: request.messages,
    params: request.params,
    retries: 1,
    signal: input.signal,
  });
  return {
    text: result.content.trim(),
    model: request.model,
    truncated: result.finishReason === "length",
    overrides: request.overrides,
  };
}
