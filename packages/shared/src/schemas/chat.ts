import { z } from 'zod';
import { VersionTargetType } from '../enums.js';
import { Id } from './common.js';

/**
 * What a revision conversation is about. 'book' covers every chapter at once;
 * 'draft' is the single whole-draft blob of a book that was never split.
 */
export const CHAT_SCOPE_TYPES = ['chapter', 'scene', 'draft', 'book'] as const;
export const ChatScopeType = z.enum(CHAT_SCOPE_TYPES);
export type ChatScopeType = z.infer<typeof ChatScopeType>;

/** A new version the assistant wrote during a turn. */
export const AppliedRevision = z.object({
  targetType: VersionTargetType,
  targetId: Id,
  label: z.string(),
  versionId: Id,
  /** What was current before, so the author can undo. Null for a first version. */
  previousVersionId: Id.nullable(),
  wordCount: z.number().int(),
});
export type AppliedRevision = z.infer<typeof AppliedRevision>;

export const RevisionChatMessage = z.object({
  id: Id,
  chatId: Id,
  role: z.enum(['user', 'assistant']),
  content: z.string(),
  applied: z.array(AppliedRevision),
  error: z.string().nullable(),
  runId: Id.nullable(),
  createdAt: z.number().int(),
});
export type RevisionChatMessage = z.infer<typeof RevisionChatMessage>;

export const RevisionChat = z.object({
  id: Id,
  projectId: Id,
  scopeType: ChatScopeType,
  scopeId: Id,
  createdAt: z.number().int(),
  updatedAt: z.number().int(),
});
export type RevisionChat = z.infer<typeof RevisionChat>;

/** Where a conversation lives. The book scope uses the project id as its scope id. */
export const ChatScope = z.object({
  scopeType: ChatScopeType,
  scopeId: Id,
});
export type ChatScope = z.infer<typeof ChatScope>;

export const ChatHistory = z.object({
  chat: RevisionChat.nullable(),
  messages: z.array(RevisionChatMessage),
});
export type ChatHistory = z.infer<typeof ChatHistory>;

export const ChatSend = ChatScope.extend({
  message: z.string().trim().min(1, 'Write a message first.').max(20_000),
  /** Assign dialogue voices to any text the reply rewrites. Defaults to on. */
  attributeDialogue: z.boolean().optional(),
});
export type ChatSend = z.infer<typeof ChatSend>;
