import { and, asc, eq } from 'drizzle-orm';
import { AppliedRevision, type ChatScope, type RevisionChat, type RevisionChatMessage } from '@storytime/shared';
import type { Db } from '../db/client.js';
import { revisionChatMessages, revisionChats } from '../db/schema.js';
import { newId } from '../services/entities.js';

function toChat(row: typeof revisionChats.$inferSelect): RevisionChat {
  return { ...row, scopeType: row.scopeType as RevisionChat['scopeType'] };
}

function parseApplied(raw: string): AppliedRevision[] {
  try {
    const parsed = AppliedRevision.array().safeParse(JSON.parse(raw));
    return parsed.success ? parsed.data : [];
  } catch {
    return [];
  }
}

function toMessage(row: typeof revisionChatMessages.$inferSelect): RevisionChatMessage {
  return {
    id: row.id,
    chatId: row.chatId,
    role: row.role === 'assistant' ? 'assistant' : 'user',
    content: row.content,
    applied: parseApplied(row.applied),
    error: row.error,
    runId: row.runId,
    createdAt: row.createdAt,
  };
}

export function findChat(db: Db, projectId: string, scope: ChatScope): RevisionChat | null {
  const row = db
    .select()
    .from(revisionChats)
    .where(
      and(
        eq(revisionChats.projectId, projectId),
        eq(revisionChats.scopeType, scope.scopeType),
        eq(revisionChats.scopeId, scope.scopeId),
      ),
    )
    .get();
  return row ? toChat(row) : null;
}

export function readChat(db: Db, chatId: string): RevisionChat | null {
  const row = db.select().from(revisionChats).where(eq(revisionChats.id, chatId)).get();
  return row ? toChat(row) : null;
}

export function ensureChat(db: Db, projectId: string, scope: ChatScope): RevisionChat {
  const existing = findChat(db, projectId, scope);
  if (existing) return existing;
  const id = newId();
  db.insert(revisionChats).values({ id, projectId, scopeType: scope.scopeType, scopeId: scope.scopeId }).run();
  return readChat(db, id)!;
}

export function readMessages(db: Db, chatId: string): RevisionChatMessage[] {
  return db
    .select()
    .from(revisionChatMessages)
    .where(eq(revisionChatMessages.chatId, chatId))
    .orderBy(asc(revisionChatMessages.createdAt), asc(revisionChatMessages.id))
    .all()
    .map(toMessage);
}

export interface AddMessageInput {
  db: Db;
  chatId: string;
  role: 'user' | 'assistant';
  content: string;
  applied?: AppliedRevision[];
  error?: string | null;
  runId?: string | null;
}

export function addMessage(input: AddMessageInput): RevisionChatMessage {
  const { db, chatId, role, content, applied = [], error = null, runId = null } = input;
  const id = newId();
  db.insert(revisionChatMessages)
    .values({ id, chatId, role, content, applied: JSON.stringify(applied), error, runId })
    .run();
  db.update(revisionChats).set({ updatedAt: Date.now() }).where(eq(revisionChats.id, chatId)).run();
  return toMessage(db.select().from(revisionChatMessages).where(eq(revisionChatMessages.id, id)).get()!);
}

/** Forget a conversation's messages, so the next message starts fresh. The text it revised is untouched. */
export function clearChat(db: Db, chatId: string) {
  db.delete(revisionChatMessages).where(eq(revisionChatMessages.chatId, chatId)).run();
  db.update(revisionChats).set({ updatedAt: Date.now() }).where(eq(revisionChats.id, chatId)).run();
}

export function deleteMessage(db: Db, messageId: string) {
  db.delete(revisionChatMessages).where(eq(revisionChatMessages.id, messageId)).run();
}
