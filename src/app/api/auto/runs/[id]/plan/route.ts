import { z } from "zod";
import { assertSameOrigin, errorResponse, jsonOk, parseBody } from "@/lib/api";
import { AppError } from "@/lib/errors";
import { getNovel } from "@/lib/storage/novels";
import { appendAutoEvent, getAutoRun } from "@/lib/storage/auto-runs";
import { readNovelChat, saveNovelChat, updateNovelChatMessage } from "@/lib/storage/chats";
import { AUTO_PLAN_CHAT_SCOPE } from "@/lib/auto/chat";
import { decodePremise } from "@/lib/auto/create";
import { joinContinuation } from "@/lib/auto/continuation";
import { buildPlanRequest } from "@/lib/auto/plan";
import { openChatStream } from "@/lib/ai/client";
import { parseOpenAIStream, sseResponse } from "@/lib/ai/sse";
import { createId } from "@/lib/utils";
import type { ChatMessage } from "@/lib/schemas";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 600;

type Params = { params: Promise<{ id: string }> };

const bodySchema = z
  .object({
    message: z.string().trim().max(20_000).optional(),
    clientMessageId: z.string().min(1).max(100).optional(),
    /** Extend this assistant reply instead of starting a new turn. */
    continueMessageId: z.string().min(1).max(100).optional(),
  })
  .refine((value) => Boolean(value.continueMessageId) || Boolean(value.message?.trim()), {
    message: "Write a message or continue the last reply.",
  });

const CONTINUE_DIRECTIVE = [
  "Your previous reply was cut off by the output limit.",
  "Continue the same answer from exactly where it stopped.",
  "Do not repeat anything already written, do not restart the answer, and do not add a preamble.",
  "Output only the continuation.",
].join(" ");

export async function GET(_request: Request, { params }: Params) {
  try {
    const { id } = await params;
    const run = await getAutoRun(id);
    const [chat, outline] = await Promise.all([
      readNovelChat(run.slug, AUTO_PLAN_CHAT_SCOPE),
      getNovel(run.slug),
    ]);
    return jsonOk({
      messages: chat.messages,
      planBrief: run.state.planBrief,
      planLockedAt: run.state.planLockedAt,
      meta: decodePremise(outline.premise),
      currentChapter: run.currentChapter,
      targetChapters: run.targetChapters,
      status: run.status,
      mode: run.mode,
    });
  } catch (error) {
    return errorResponse(error);
  }
}

function assistantMessage(content: string, model: string, failed = false): ChatMessage {
  return {
    id: createId(),
    role: "assistant",
    content,
    createdAt: new Date().toISOString(),
    model,
    ...(failed ? { failed: true } : {}),
  };
}

export async function POST(request: Request, { params }: Params) {
  try {
    assertSameOrigin(request);
    const { id } = await params;
    const input = await parseBody(request, bodySchema);
    const run = await getAutoRun(id);
    if (run.status === "running") {
      throw new AppError(
        "CONFLICT",
        "Pause the run before changing the plan conversation.",
        { status: 409 },
      );
    }
    if (run.state.planLockedAt && run.phase !== "architect") {
      throw new AppError(
        "CONFLICT",
        "The plan is locked and chapters are underway. Pause and edit the Story Bible instead.",
        { status: 409 },
      );
    }

    const [outline, chat] = await Promise.all([
      getNovel(run.slug),
      readNovelChat(run.slug, AUTO_PLAN_CHAT_SCOPE),
    ]);
    const meta = decodePremise(outline.premise);

    // Continue: extend the cut-off assistant reply with a user-role directive.
    const continueIndex = input.continueMessageId
      ? chat.messages.findIndex(
          (item) => item.id === input.continueMessageId && item.role === "assistant",
        )
      : -1;
    if (input.continueMessageId && continueIndex < 0) {
      throw new AppError("NOT_FOUND", "That reply is no longer in the conversation.", {
        status: 404,
      });
    }

    let baseChat = chat;
    let history = chat.messages;
    let prompt = input.message?.trim() ?? "";

    if (continueIndex >= 0) {
      const partial = chat.messages[continueIndex];
      history = chat.messages.slice(0, continueIndex);
      prompt = `${CONTINUE_DIRECTIVE}\n\n[CUT-OFF REPLY]\n${partial.content.slice(-4_000)}`;
    } else {
      const userMessage: ChatMessage = {
        id: input.clientMessageId || createId(),
        role: "user",
        content: prompt,
        createdAt: new Date().toISOString(),
      };
      baseChat = await saveNovelChat(run.slug, {
        ...chat,
        messages: [...chat.messages, userMessage],
      });
      history = baseChat.messages;
    }

    const planRequest = await buildPlanRequest({
      slug: run.slug,
      outline,
      history,
      message: prompt,
      toneNotes: meta.tone,
      targetChapters: run.targetChapters,
    });

    return sseResponse(async (send, signal) => {
      send("meta", {
        continued: continueIndex >= 0,
        messageId: continueIndex >= 0 ? chat.messages[continueIndex].id : baseChat.messages.at(-1)?.id,
      });

      let content = "";
      let reasoning = "";
      try {
        const upstream = await openChatStream({
          baseUrl: planRequest.baseUrl,
          apiKey: planRequest.apiKey,
          model: planRequest.model,
          messages: planRequest.messages,
          params: planRequest.params,
          retries: 1,
          signal,
        });
        if (!upstream.body) {
          throw new AppError("AI_BAD_RESPONSE", "The provider returned no stream.", {
            status: 502,
            retryable: true,
          });
        }
        for await (const piece of parseOpenAIStream(upstream.body)) {
          if (piece.type === "delta") {
            content += piece.text;
            send("delta", { text: piece.text });
          } else if (piece.type === "reasoning") {
            reasoning += piece.text;
            send("reasoning", { text: piece.text });
          }
        }
      } catch (error) {
        // Keep whatever streamed before the failure so nothing is lost.
        if (continueIndex >= 0) {
          const partial = chat.messages[continueIndex];
          if (content.trim()) {
            await updateNovelChatMessage(run.slug, AUTO_PLAN_CHAT_SCOPE, partial.id, {
              content: joinContinuation(partial.content, content),
              model: planRequest.model,
            });
          }
        } else if (content.trim()) {
          await saveNovelChat(run.slug, {
            ...baseChat,
            messages: [...baseChat.messages, assistantMessage(content.trim(), planRequest.model)],
          });
        } else {
          const failure =
            error instanceof Error ? error.message : "The planning turn failed.";
          await saveNovelChat(run.slug, {
            ...baseChat,
            messages: [...baseChat.messages, assistantMessage(failure, "", true)],
          });
        }
        throw error;
      }

      if (!content.trim()) {
        throw new AppError("AI_BAD_RESPONSE", "The model returned no text. Try again.", {
          status: 502,
          retryable: true,
        });
      }

      if (continueIndex >= 0) {
        const partial = chat.messages[continueIndex];
        const merged = joinContinuation(partial.content, content);
        const saved = await updateNovelChatMessage(
          run.slug,
          AUTO_PLAN_CHAT_SCOPE,
          partial.id,
          { content: merged, model: planRequest.model },
        );
        send("done", {
          messages: saved.messages,
          reply: { ...partial, content: merged, model: planRequest.model },
          truncated: false,
          continued: true,
        });
        return;
      }

      const reply = assistantMessage(content.trim(), planRequest.model);
      const saved = await saveNovelChat(run.slug, {
        ...baseChat,
        messages: [...baseChat.messages, reply],
      });
      send("done", {
        messages: saved.messages,
        reply,
        truncated: false,
        continued: false,
        reasoning,
      });
    }, request.signal);
  } catch (error) {
    return errorResponse(error);
  }
}

export async function DELETE(request: Request, { params }: Params) {
  try {
    assertSameOrigin(request);
    const { id } = await params;
    const run = await getAutoRun(id);
    if (run.state.planLockedAt) {
      throw new AppError("CONFLICT", "The plan is locked. Unlock it before clearing the chat.", {
        status: 409,
      });
    }
    await saveNovelChat(run.slug, {
      version: 1,
      scope: AUTO_PLAN_CHAT_SCOPE,
      messages: [],
      updatedAt: new Date().toISOString(),
    });
    await appendAutoEvent(id, {
      phase: run.phase,
      message: "Planning conversation cleared.",
    });
    return jsonOk({ messages: [] });
  } catch (error) {
    return errorResponse(error);
  }
}
