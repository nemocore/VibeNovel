"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { ArrowDownToLine, Loader2 } from "lucide-react";
import { ChatThread } from "@/components/chat/chat-thread";
import { Button } from "@/components/ui/button";
import { streamChat, StreamClientError } from "@/lib/ai/client-stream";
import { createId } from "@/lib/utils";
import type { ChatFailure } from "@/components/chat/chat-thread";
import type { ChatMessage } from "@/lib/schemas";

type PlanTurn = {
  messages: ChatMessage[];
  reply?: ChatMessage;
  continued?: boolean;
};

/**
 * Planning chat streams token-by-token. The server persists the user message on
 * send and the assistant message when the stream ends (or aborts), so a reload
 * always restores the same transcript.
 */
export function AutoPlanChat({
  runId,
  initialMessages,
  locked,
  disabled,
  footer,
  onMessagesChange,
}: {
  runId: string;
  initialMessages: ChatMessage[];
  locked: boolean;
  disabled?: boolean;
  footer?: React.ReactNode;
  onMessagesChange?: (messages: ChatMessage[]) => void;
}) {
  const [messages, setMessages] = useState(initialMessages);
  const [streamText, setStreamText] = useState<string | null>(null);
  const [error, setError] = useState<ChatFailure>(null);
  const controllerRef = useRef<AbortController | null>(null);
  const notifyRef = useRef(onMessagesChange);

  useEffect(() => {
    notifyRef.current = onMessagesChange;
  }, [onMessagesChange]);

  const commit = useCallback((next: ChatMessage[]) => {
    setMessages(next);
    notifyRef.current?.(next);
  }, []);

  const reload = useCallback(async () => {
    try {
      const response = await fetch(`/api/auto/runs/${runId}/plan`, { cache: "no-store" });
      const payload = (await response.json().catch(() => null)) as
        | { messages?: ChatMessage[] }
        | null;
      if (response.ok && payload?.messages) commit(payload.messages);
    } catch {
      // Keep the last known transcript.
    }
  }, [commit, runId]);

  // Hydrate from SQLite after mount so a reload never shows stale chat.
  useEffect(() => {
    const timer = window.setTimeout(() => void reload(), 0);
    return () => window.clearTimeout(timer);
  }, [reload]);

  useEffect(() => {
    return () => controllerRef.current?.abort();
  }, []);

  const run = useCallback(
    async (body: Record<string, unknown>) => {
      const controller = new AbortController();
      controllerRef.current = controller;
      setStreamText("");
      setError(null);
      try {
        const done = (await streamChat(
          `/api/auto/runs/${runId}/plan`,
          body,
          {
            onDelta: (_text, full) => setStreamText(full),
            onDone: (payload) => {
              const data = payload as PlanTurn | null;
              if (data?.messages) commit(data.messages);
            },
          },
          controller.signal,
        )) as PlanTurn | null;
        if (done?.messages) commit(done.messages);
      } catch (caught) {
        if (caught instanceof StreamClientError && caught.code === "ABORTED") {
          await reload();
          return;
        }
        const failure =
          caught instanceof StreamClientError
            ? caught.message
            : "Could not reach the app server.";
        setError({ message: failure, retryable: true, saved: false });
        await reload();
      } finally {
        setStreamText(null);
        controllerRef.current = null;
      }
    },
    [commit, reload, runId],
  );

  const send = useCallback(
    (text: string) => {
      const clean = text.trim();
      if (!clean || streamText !== null) return;
      const clientMessageId = createId();
      commit([
        ...messages,
        {
          id: clientMessageId,
          role: "user",
          content: clean,
          createdAt: new Date().toISOString(),
        },
      ]);
      void run({ message: clean, clientMessageId });
    },
    [commit, messages, run, streamText],
  );

  const stop = useCallback(() => {
    controllerRef.current?.abort();
  }, []);

  const lastAssistant = [...messages].reverse().find((item) => item.role === "assistant");
  const streaming = streamText !== null;

  const continueLast = useCallback(() => {
    if (!lastAssistant || streaming) return;
    void run({ continueMessageId: lastAssistant.id });
  }, [lastAssistant, run, streaming]);

  return (
    <ChatThread
      messages={messages}
      streamingContent={streamText ?? ""}
      streaming={streaming}
      error={error}
      onSend={send}
      onRetry={() => {
        const lastUser = [...messages].reverse().find((item) => item.role === "user");
        if (lastUser) send(lastUser.content);
      }}
      onStop={stop}
      disabled={disabled || locked}
      placeholder={
        locked
          ? "The plan is locked. Unlock it to keep planning."
          : "Shape the premise, cast, arc, pacing, and ending…"
      }
      footer={
        <>
          {footer}
          {lastAssistant && !locked ? (
            <div className="mx-2 mb-2 flex flex-wrap items-center justify-between gap-2 border-t border-border px-1 pt-2">
              <p className="text-[10.5px] leading-relaxed text-muted-foreground">
                {streaming ? "Writing…" : "Long answer cut short?"}
              </p>
              <Button
                size="sm"
                variant="ghost"
                onClick={continueLast}
                disabled={streaming || disabled}
              >
                {streaming ? <Loader2 className="animate-spin" /> : <ArrowDownToLine />}
                Continue
              </Button>
            </div>
          ) : null}
        </>
      }
      empty={
        <div className="space-y-2">
          <p className="text-[13px] font-medium">Plan the novel before it writes a word.</p>
          <p className="max-w-md text-[11.5px] leading-relaxed text-muted-foreground">
            Settle the premise, world rules, cast, arc, and ending here. When the plan is solid,
            approve it and the six Auto Mode skills take over.
          </p>
        </div>
      }
      suggestions={[
        "Pressure-test the premise and tell me what is missing.",
        "Propose three possible endings with the cost of each.",
        "Draft a chapter count and the turning points that hold the arc.",
      ]}
    />
  );
}