import { and, eq } from "drizzle-orm";
import { getDb } from "@/lib/db";
import { books, chats } from "@/lib/db/schema";
import { NotFoundError } from "@/lib/errors";
import type { Chat, ChatMessage } from "@/lib/schemas";
import { AUTO_PLAN_CHAT_SCOPE } from "@/lib/auto/chat";

const now = () => new Date().toISOString();

export type ChatScope = "premise" | number | typeof AUTO_PLAN_CHAT_SCOPE;

export function emptyChat(scope: ChatScope): Chat {
  return {
    version: 1,
    scope,
    messages: [],
    updatedAt: now(),
  };
}

function scopeKey(scope: ChatScope): string {
  if (scope === "premise") return "premise";
  if (scope === AUTO_PLAN_CHAT_SCOPE) return AUTO_PLAN_CHAT_SCOPE;
  return `chapter_${scope}`;
}

async function getBookIdBySlug(slug: string): Promise<string> {
  const db = await getDb();
  const row = db
    .select({ id: books.id })
    .from(books)
    .where(and(eq(books.slug, slug), eq(books.isDraft, false)))
    .get();
  if (!row) throw new NotFoundError("That book does not exist.");
  return row.id;
}

async function getDraftId(id: string): Promise<string> {
  const db = await getDb();
  const row = db
    .select({ id: books.id })
    .from(books)
    .where(and(eq(books.id, id), eq(books.isDraft, true)))
    .get();
  if (!row) throw new NotFoundError("That draft does not exist.");
  return row.id;
}

async function readChatByBookId(
  bookId: string,
  scope: ChatScope,
): Promise<Chat> {
  const db = await getDb();
  const row = db
    .select()
    .from(chats)
    .where(and(eq(chats.bookId, bookId), eq(chats.scope, scopeKey(scope))))
    .get();
  if (!row) return emptyChat(scope);
  return {
    version: 1,
    scope,
    messages: row.messagesJson ?? [],
    updatedAt: row.updatedAt,
  };
}

async function writeChat(bookId: string, chat: Chat): Promise<Chat> {
  const db = await getDb();
  const timestamp = now();
  const next: Chat = { ...chat, updatedAt: timestamp };
  db.insert(chats)
    .values({
      bookId,
      scope: scopeKey(chat.scope),
      messagesJson: next.messages,
      updatedAt: timestamp,
    })
    .onConflictDoUpdate({
      target: [chats.bookId, chats.scope],
      set: { messagesJson: next.messages, updatedAt: timestamp },
    })
    .run();
  return next;
}

async function appendByBookId(
  bookId: string,
  scope: ChatScope,
  message: ChatMessage,
): Promise<Chat> {
  const chat = await readChatByBookId(bookId, scope);
  return writeChat(bookId, { ...chat, messages: [...chat.messages, message] });
}

async function updateByBookId(
  bookId: string,
  scope: ChatScope,
  messageId: string,
  patch: Partial<ChatMessage>,
): Promise<Chat> {
  const chat = await readChatByBookId(bookId, scope);
  return writeChat(bookId, {
    ...chat,
    messages: chat.messages.map((message) =>
      message.id === messageId ? { ...message, ...patch } : message,
    ),
  });
}

export async function saveNovelChat(slug: string, chat: Chat): Promise<Chat> {
  return writeChat(await getBookIdBySlug(slug), chat);
}

export async function saveDraftChat(id: string, chat: Chat): Promise<Chat> {
  return writeChat(await getDraftId(id), chat);
}

export async function readNovelChat(
  slug: string,
  scope: ChatScope,
): Promise<Chat> {
  return readChatByBookId(await getBookIdBySlug(slug), scope);
}

export async function appendNovelChatMessage(
  slug: string,
  scope: ChatScope,
  message: ChatMessage,
): Promise<Chat> {
  return appendByBookId(await getBookIdBySlug(slug), scope, message);
}

export async function updateNovelChatMessage(
  slug: string,
  scope: ChatScope,
  messageId: string,
  patch: Partial<ChatMessage>,
): Promise<Chat> {
  return updateByBookId(await getBookIdBySlug(slug), scope, messageId, patch);
}

export async function readDraftChat(
  id: string,
  scope: ChatScope,
): Promise<Chat> {
  return readChatByBookId(await getDraftId(id), scope);
}

export async function appendDraftChatMessage(
  id: string,
  scope: ChatScope,
  message: ChatMessage,
): Promise<Chat> {
  return appendByBookId(await getDraftId(id), scope, message);
}

export async function updateDraftChatMessage(
  id: string,
  scope: ChatScope,
  messageId: string,
  patch: Partial<ChatMessage>,
): Promise<Chat> {
  return updateByBookId(await getDraftId(id), scope, messageId, patch);
}

export async function ensureChat(
  bookId: string,
  scope: ChatScope,
): Promise<void> {
  const db = await getDb();
  db.insert(chats)
    .values({
      bookId,
      scope: scopeKey(scope),
      messagesJson: [],
      updatedAt: now(),
    })
    .onConflictDoNothing()
    .run();
}
