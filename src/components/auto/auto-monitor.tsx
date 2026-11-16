"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { ArrowLeft, Loader2 } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { StatusDot } from "@/components/status-dot";
import { cn } from "@/lib/utils";
import type { AutoRunEvent } from "@/lib/auto/types";

type LivePage = {
  number: number;
  chapterNumber: number;
  title: string;
  content: string;
  summary: string;
};

type LivePayload = {
  pages: LivePage[];
  current: { chapterNumber: number; pageNumber: number } | null;
  previous: { chapterNumber: number; pageNumber: number } | null;
};

const WORD_FORMAT = new Intl.NumberFormat("en-US");

const PHASE_LABEL: Record<string, string> = {
  architect: "Story Architect",
  characters: "Character Weaver",
  outline: "Arc & Scene Outliner",
  prose: "Scene Prose Writer",
  qa: "Continuity & QA Critic",
  archive: "State Archivist",
  done: "Complete",
};

function wordCount(text: string): number {
  const trimmed = text.trim();
  return trimmed ? trimmed.split(/\s+/).length : 0;
}

export function AutoMonitor({
  slug,
  runId,
  bookTitle,
  status,
  phase,
  focusChapter,
  initial,
  initialEvents,
}: {
  slug: string;
  runId: string;
  bookTitle: string;
  status: string;
  phase: string;
  focusChapter: number | null;
  initial: LivePayload;
  initialEvents: AutoRunEvent[];
}) {
  const [data, setData] = useState(initial);
  const [events, setEvents] = useState(initialEvents);

  const refresh = useCallback(async () => {
    try {
      const [pagesRes, eventsRes] = await Promise.all([
        fetch(`/api/auto/books/${slug}/pages?run=${runId}&limit=8`, { cache: "no-store" }),
        fetch(`/api/auto/runs/${runId}/events?after=0&limit=40`, { cache: "no-store" }),
      ]);
      const pages = (await pagesRes.json().catch(() => null)) as LivePayload | null;
      if (pagesRes.ok && pages) setData(pages);
      const eventPayload = (await eventsRes.json().catch(() => null)) as
        | { events?: AutoRunEvent[] }
        | null;
      if (eventsRes.ok && eventPayload?.events) setEvents(eventPayload.events);
    } catch {
      // Keep last known state.
    }
  }, [slug, runId]);

  useEffect(() => {
    const timer = window.setInterval(() => {
      void refresh();
    }, 3000);
    return () => window.clearInterval(timer);
  }, [refresh]);

  const ordered = [...data.pages].sort((a, b) => b.chapterNumber - a.chapterNumber);
  const focus =
    (focusChapter !== null
      ? ordered.find((page) => page.chapterNumber === focusChapter)
      : undefined) ?? ordered[0];
  const others = ordered.filter((page) => page !== focus);
  const live = status === "running" || status === "queued";

  return (
    <div className="h-full overflow-y-auto">
      <div className="mx-auto w-full max-w-3xl px-4 pb-20 pt-6 sm:px-6 md:px-8">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <Button asChild variant="ghost" size="sm" className="text-muted-foreground">
            <Link href={`/auto/${runId}`}>
              <ArrowLeft />
              Run
            </Link>
          </Button>
          <div className="flex flex-wrap items-center gap-2">
            <StatusDot tone={live ? "success" : "muted"} pulse={live} />
            <span className="font-mono text-[9px] uppercase tracking-[0.14em] text-[#f2c477]">
              {PHASE_LABEL[phase] ?? phase}
            </span>
            <Badge variant={live ? "amber" : "default"}>{status}</Badge>
          </div>
        </div>

        <header className="mt-5 border-b border-border pb-5">
          <h1 className="font-serif text-[1.9rem] leading-tight tracking-[-0.02em] sm:text-[2.1rem]">
            {bookTitle}
          </h1>
          <p className="mt-1.5 text-[11.5px] leading-relaxed text-muted-foreground">
            Read-only live view. Prose appears as each scene lands.
            {live ? " Auto Mode is writing now." : ""}
          </p>
        </header>

        {focus ? (
          <article key={focus.number} className="mt-8">
            <div className="flex flex-col gap-1 border-b border-border pb-3 sm:flex-row sm:flex-wrap sm:items-baseline sm:justify-between sm:gap-3">
              <h2 className="font-serif text-[1.4rem] leading-snug tracking-[-0.01em]">
                {focus.title || `Chapter ${focus.chapterNumber}`}
              </h2>
              <p className="font-mono text-[9px] uppercase tracking-[0.14em] text-muted-foreground">
                Chapter {focus.chapterNumber} · {WORD_FORMAT.format(wordCount(focus.content))} words
                {live ? " · live" : ""}
              </p>
            </div>
            <div className="mt-6 max-w-[68ch] whitespace-pre-wrap font-serif text-[18px] leading-[1.78] text-foreground/90 sm:text-[19px]">
              {focus.content.trim() ||
                "No prose written yet. This chapter is still being planned."}
            </div>
          </article>
        ) : (
          <p className="mt-8 border border-border bg-[#0d131a] px-4 py-12 text-center text-[12px] text-muted-foreground">
            No chapters exist yet.
          </p>
        )}

        <section className="mt-12 border-t border-border pt-5">
          <h2 className="font-mono text-[10px] uppercase tracking-[0.16em] text-[#f2c477]">
            Earlier chapters
          </h2>
          {others.length ? (
            <ul className="mt-2 divide-y divide-border border-y border-border">
              {others.map((page) => (
                <li key={page.number} className="flex items-start justify-between gap-3 py-2.5">
                  <div className="min-w-0">
                    <p className="text-[12px] font-medium">
                      {String(page.chapterNumber).padStart(2, "0")} · {page.title}
                    </p>
                    <p className="mt-0.5 line-clamp-1 text-[10.5px] text-muted-foreground">
                      {page.summary || "No summary yet."}
                    </p>
                  </div>
                  <span className="shrink-0 font-mono text-[9px] text-muted-foreground">
                    {WORD_FORMAT.format(wordCount(page.content))} w
                  </span>
                </li>
              ))}
            </ul>
          ) : (
            <p className="py-3 text-[11.5px] text-muted-foreground">Nothing earlier yet.</p>
          )}
        </section>

        <section className="mt-8">
          <div className="flex items-baseline justify-between gap-2 border-b border-border pb-2">
            <h2 className="font-mono text-[10px] uppercase tracking-[0.16em] text-[#f2c477]">
              Live steps
            </h2>
            {live ? (
              <span className="flex items-center gap-1.5 text-[10px] text-muted-foreground">
                <Loader2 className="size-3 animate-spin" />
                Following the run
              </span>
            ) : null}
          </div>
          <div className="mt-2 max-h-64 overflow-y-auto bg-[#070b10] px-3 py-2 font-mono text-[10px] leading-relaxed">
            {events.length ? (
              [...events]
                .reverse()
                .slice(0, 24)
                .map((event) => (
                  <p
                    key={event.id}
                    className={cn(
                      "py-0.5",
                      event.level === "error"
                        ? "text-[#f2937f]"
                        : event.level === "warn"
                          ? "text-[#f2c477]"
                          : "text-muted-foreground",
                    )}
                  >
                    <span className="mr-1.5 uppercase text-muted-foreground/60">
                      {event.phase}
                    </span>
                    {event.message}
                  </p>
                ))
            ) : (
              <p className="py-3 text-muted-foreground">No steps yet.</p>
            )}
          </div>
        </section>
      </div>
    </div>
  );
}