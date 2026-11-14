<!-- BEGIN:nextjs-agent-rules -->

## This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->

# AGENTS.md — VibeNovel

Technical operating guide for AI coding agents. This file does not restate product or design content; it points to the authoritative documents and records engineering contracts.

## 1. Source of Truth & Reference Docs

Consult these before architectural or interface changes:

| Document | Authority | Read it for |
| --- | --- | --- |
| `README.md` | Setup & overview | Stack, Docker quick start, feature summary, provider expectations |
| `PRODUCT.md` | Feature specs & workflows | Users, positioning, required capabilities, constraints, product principles |
| `DESIGN.md` | UI/UX system & visual rules | Tokens, type, layout, components, motion, copy, accessibility, file map |
| `DOCUMENTATION.md` | Operations | Env vars, LAN/Docker deployment, backup/restore, troubleshooting |

Rules:
- Do not duplicate the contents of these files into `AGENTS.md`, code comments, or UI copy. Link or reference them instead.
- If a change conflicts with `PRODUCT.md` (capabilities, principles) or `DESIGN.md` (visual system, interaction rules), stop and resolve the conflict with the user before implementing.
- Never fabricate capabilities, proof, benchmarks, pricing, or WCAG conformance. `PRODUCT.md` and `DESIGN.md` explicitly forbid unverified claims.
- Prefer the existing architecture over new abstractions. Read the relevant files before editing.

## 2. Build, Lint, Test & Database Commands

Run from the repository root.

| Task | Command |
| --- | --- |
| Dev server (binds `0.0.0.0`) | `npm run dev` |
| Production build | `npm run build` |
| Start production server | `npm start` |
| Lint | `npm run lint` |
| Type check | `npm run typecheck` |
| Tests (single run) | `npm test` |
| Tests (watch) | `npm run test:watch` |
| Mock OpenAI-compatible provider | `npm run mock-ai` |
| Seed synthetic demo book (destructive) | `npm run seed:demo` |
| Playwright UI check | `npm run check:ui` |
| Playwright preset check | `npm run check:presets` |
| Screenshots | `npm run shots` |

**SQLite operations:** there is no drizzle-kit script in this repo. Do not invent `db:push`, `db:generate`, or `db:migrate` commands.
- Schema DDL, additive column migrations, and surgical-preset seeding run automatically on first DB access in `src/lib/db/index.ts` (`DDL` → `migrateSchema()` → `seedSurgicalPresets()`).
- `src/instrumentation.ts` creates data directories and initializes the DB at server start.
- DB path: `DATA_DIR` env var, else `./data`; file is `data/vibedraft.db` (legacy filename, kept intentionally).
- To reset local state, stop the server and remove `DATA_DIR`. To create disposable demo state, run `npm run seed:demo` against a throwaway `DATA_DIR` only — it deletes the DB.
- Required env: `APP_USERNAME`, `APP_PASSWORD`. Recommended: `SESSION_SECRET`, `DATA_DIR`. See `.env.example`.

**Definition of done:** `npm run typecheck && npm run lint && npm test && npm run build` must pass before claiming work complete.

## 3. Codebase Architecture & Key Paths

Next.js 16 App Router + React 19 + TypeScript (strict) + Tailwind v4 + Radix/shadcn-style primitives + Zustand, backed by Drizzle ORM over better-sqlite3.

**AI routes**
- `src/app/api/ai/planner/route.ts` — Planner SSE chat.
- `src/app/api/ai/execute/route.ts` — Executor SSE drafting, overwrite confirmation, Continue Generation.
- `src/app/api/ai/summarize/route.ts` — chapter summaries, title generation, long-chapter chunk path.
- `src/app/api/ai/premise/route.ts` — premise distillation + book title.
- `src/app/api/ai/title/route.ts` — book/chapter titles.
- `src/app/api/ai/image-prompt/route.ts` — illustration/cover prompt generation.
- `src/app/api/ai/surgical/route.ts` — Surgical Polish inline rewrites (two takes).
- `src/app/api/generate-image/route.ts`, `src/app/api/generate-cover/route.ts` — image generation.
- `src/app/api/novels/[slug]/characters/generate/route.ts` — character extraction.
- `src/app/api/drafts/[id]/finalize/route.ts` — publish draft with title.
- Prompt/preset management: `src/app/api/prompts/route.ts`, `src/app/api/surgical-presets/**`.

**Payload compilers & prompt layer**
- `src/lib/ai/client.ts` — `buildChatRequestPayload()`, `deepMerge()`, `parseAdvancedParams()`, `generationFields()`, `chatCompletion()`, `openChatStream()`, `payloadOverride`.
- `src/lib/ai/prompts.ts` — `vaultContext()`, `renderPrompt()`, `roleInjections()`, `applyInjections()`, and all message builders.
- `src/lib/ai/prompt-definitions.ts` — canonical prompt keys and default seed text.
- `src/lib/ai/title.ts`, `surgical.ts`, `sse.ts`, `client-stream.ts`, `debug-preview.ts`, `routing.ts`, `urls.ts`, `model-options.ts`.

**SQLite schema & queries**
- `src/lib/db/schema.ts` — Drizzle tables (`global_settings`, `providers`, `presets`, `prompt_templates`, `surgical_presets`, `books`, `chapters`, `characters`, `chats`).
- `src/lib/db/index.ts` — singleton connection, DDL, column migrations, seeding.
- `src/lib/db/migrate.ts` — legacy JSON/file import migrations.
- `src/lib/storage/` — query layer: `novels.ts`, `chats.ts`, `config.ts`, `book-config.ts`, `prompts.ts`, `surgical-presets.ts`, `backup.ts`, `fs.ts`, `paths.ts`, `illustrations.ts`.
- Chapter prose: `data/novels/<slug>/chapters/*.md`. Metadata, chats, settings, images paths: SQLite.

**UI components**
- `src/components/workspace/workspace-view.tsx` — workspace orchestration, autosave, summary, execute/continue controls.
- `src/components/editor/markdown-editor.tsx` — TipTap Markdown editor, Surgical Polish selection bar and review carousel.
- `src/components/chat/chat-thread.tsx`, `chat/reasoning-block.tsx` — planner thread, versions, message actions.
- `src/components/outline/outline-view.tsx` — premise, characters, editable summaries.
- `src/components/settings/*` — providers/models, prompt templates, surgical presets.
- `src/components/debug/*` — debug-mode toggle and payload editor dialog.
- `src/components/ui/*` — shared primitives.
- `src/app/globals.css` — design tokens and page/manuscript styles.

**State & cross-cutting**
- Streaming: `src/lib/streams/{store,runners,use-executor-stream}.ts`, `src/lib/use-chat-stream.ts`.
- API helpers: `src/lib/api.ts` (`jsonOk`, `errorResponse`, `parseBody`, `assertSameOrigin`), `src/lib/errors.ts` (`AppError`).
- Auth: `src/lib/auth/*`; middleware: `src/proxy.ts`.
- Validation: `src/lib/schemas.ts` (Zod schemas for every persisted shape).
- Presets/defaults: `src/lib/presets/{constants,defaults}.ts`; surgical defaults: `src/lib/surgical/defaults.ts`.

## 4. Technical Constraints & Pitfalls (Non-Negotiable)

**LLM payload rules**
- Every outbound chat payload MUST end with a `"user"` message. Context Anchor, Assistant Prefill, and continuation directives must be folded into that final user message — never appended as a trailing `"assistant"` role.
- Known legacy debt: `applyInjections()` in `src/lib/ai/prompts.ts` and the Continue branch in `src/app/api/ai/execute/route.ts` still append an assistant message. Do not copy that shape; correct it when touching those paths.
- Custom JSON parameters merge with `deepMerge()` in `buildChatRequestPayload()`. Never shallow-spread. Core `messages` and `model` must survive; re-apply them after merging.
- Do not hand-assemble provider request bodies in routes. Use `buildChatRequestPayload()` / `chatCompletion()` / `openChatStream()`.
- Preserve per-book model routing and fallbacks (`book surgical → global surgical → book executor`; same pattern for other roles).

**Dynamic prompts**
- Never hardcode AI instructions in routes, components, or builders. Fetch from SQLite via `getPromptMap()` / `resolveRolePrompt()` (`src/lib/storage/prompts.ts`) and render with `renderPrompt()`.
- Default text belongs only in `src/lib/ai/prompt-definitions.ts` as seed data. Editable copies live in the `prompt_templates` table.
- Per-book/preset role prompts override globals; task prompts are global templates.
- `{{placeholder}}` names must stay documented on the prompt definition and supported by the builder.

**Dependencies & SSR**
- No heavy editors (Monaco) and no PrismJS. Browser-only editors/highlighters use `next/dynamic` with `{ ssr: false }`; the debug payload editor is the reference implementation (`src/components/debug/debug-payload-dialog.tsx`, `@uiw/react-textarea-code-editor`).
- Prefer existing dependencies and `src/components/ui/*` primitives. Do not add a library for a small problem.
- Keep server-only modules (Drizzle, SQLite, provider keys, filesystem) out of client components.
- Verify hydration-sensitive UI in a production build, not just dev.

**Streaming**
- Continue Generation MUST append: `text = continuationText + incomingChunk`; the server saves `continuationText + content`. Never overwrite existing prose.
- `.trimEnd()` the cutoff text before using it as continuation input.
- Keep SSE parsing/emission in `src/lib/ai/sse.ts` and client consumption in `src/lib/ai/client-stream.ts`.
- Preserve abort handling; cancel in-flight requests on discard, navigation, or unmount.
- Streaming must not steal the viewport; follow only when the writer is at the bottom.

**Security & data**
- Validate request bodies with Zod via `parseBody()`; call `assertSameOrigin()` on mutations.
- Validate filesystem inputs with `assertSlug`, `assertDraftId`, `assertChapterNumber`, `assertInside`.
- Never commit `.env`, `data/`, SQLite files/journals, manuscripts, or provider keys. No secrets in source, fixtures, or logs.
- Provider keys are stored in SQLite at runtime; `.env` only holds app credentials.
- Structural logs only (`console.warn` / `console.error`). No temporary `console.log` in `src/`.
- Preserve the single-user model; do not add multi-tenant auth or sharing endpoints without an explicit request and a `PRODUCT.md` update.

**Data integrity**
- Save chapter prose through `saveChapterContent()` (atomic writes + version snapshots); do not write manuscript files directly.
- Keep summary/title updates going through the storage layer so `summaryStale`, status, and timestamps stay consistent.
- Backups/imports must stay schema-validated and must never overwrite existing books.

## 5. UI & Code Style Conventions

- Follow `DESIGN.md` for tokens, typography, layout, components, motion, copy, and accessibility. Do not introduce new colors, fonts, radii, or shadows.
- TypeScript strict; import through the `@/*` alias; avoid `any`.
- Compose Tailwind classes with `cn()` and reuse `src/components/ui/*` primitives. Match the surrounding file's spacing and type scale.
- Client components require `"use client"`. Keep data fetching and persistence in server routes.
- Copy follows `DESIGN.md`: name the action, name the problem and recovery. No praise, no "AI magic", no invented claims.
- Interactive row actions (Edit, Delete, Regenerate, version controls) must be visible by default on touch (`opacity-100`) and hover-revealed only on desktop: `md:opacity-0 md:group-hover:opacity-100`. Use `lg:` only where the component already does. Never ship hover-only controls on mobile.
- Keep keyboard affordances and accessibility: Enter to commit, Escape to cancel, `aria-label` on icon-only buttons, disabled states during in-flight work, Radix focus management in dialogs.
- Do not break autosave, editor selection/focus, reading preferences, or stream resumption when adding UI.
- Add focused Vitest coverage for pure helpers and regressions (`src/lib/**/__tests__`). Update or add tests when behavior changes.
