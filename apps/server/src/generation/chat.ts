import type { AppliedRevision, ChatScope, VersionTargetType } from '@storytime/shared';
import type { Db } from '../db/client.js';
import { buildChatSystemPrompt, buildChatUserMessage } from '../bible/prompts.js';
import { ReplyParser, type RevisedSection } from '../chat/parse.js';
import { collectSections, type ChatSection } from '../chat/sections.js';
import { addMessage, readMessages } from '../chat/store.js';
import { attributeWritten } from '../dialogue/run.js';
import { estimateTokens } from '../llm/tokens.js';
import { badRequest } from '../services/entities.js';
import { currentVersionId, saveVersion } from '../services/manuscript.js';
import { emit } from './events.js';
import { focusFor, mergeFocus, prepareBible, type RunContext } from './context.js';
import { accumulate, failRun, finish, hashBible, recordUsage, streamOnce, type RunRecord } from './steps.js';

/**
 * How much manuscript one conversation will carry. The text is sent with every
 * message and may be written back in full, so it has to fit in the prompt budget
 * twice over, alongside the story bible and the conversation so far.
 */
export function maxChatManuscriptTokens(budgetTokens: number): number {
  return Math.max(8_000, Math.floor((budgetTokens - 12_000) / 2));
}
/** Earlier turns kept for context; older ones are dropped rather than growing the prompt without limit. */
const HISTORY_MESSAGES = 16;

export interface ChatRunInput {
  chatId: string;
  /** The author message this run answers, already stored. */
  userMessageId: string;
  scope: ChatScope;
  message: string;
  attributeDialogue: boolean;
}

/** Fail early, before a run exists, when a conversation cannot work. */
export function assertChatable(db: Db, projectId: string, scope: ChatScope, budgetTokens: number): ChatSection[] {
  const sections = collectSections(db, projectId, scope);
  if (sections.length === 0) {
    throw badRequest('Nothing is written here yet, so there is nothing to revise. Generate it first.');
  }
  const tokens = estimateTokens(sections.map((s) => s.text).join('\n\n'));
  const limit = maxChatManuscriptTokens(budgetTokens);
  if (tokens > limit) {
    throw badRequest(
      `This is about ${Math.round(tokens / 1000)}k tokens of text, and a conversation can carry about ${Math.round(limit / 1000)}k with this book's token budget, because the text is sent and may be written back in full. Open a single chapter and chat there instead, or raise the token budget in Parameters.`,
    );
  }
  return sections;
}

type ModelMessage = { role: 'user' | 'assistant'; content: string };

/** Earlier turns as the model should see them, merged so roles alternate even after a failed turn. */
function historyFor(db: Db, input: ChatRunInput): ModelMessage[] {
  const all = readMessages(db, input.chatId);
  const cutoff = all.findIndex((m) => m.id === input.userMessageId);
  const earlier = (cutoff === -1 ? all : all.slice(0, cutoff)).slice(-HISTORY_MESSAGES);

  const merged: ModelMessage[] = [];
  for (const message of earlier) {
    if (message.error || !message.content.trim()) continue;
    const note = message.applied.length
      ? `\n\n(You rewrote: ${message.applied.map((a) => a.label).join('; ')}.)`
      : '';
    const content = `${message.content}${note}`;
    const last = merged[merged.length - 1];
    if (last && last.role === message.role) last.content += `\n\n${content}`;
    else merged.push({ role: message.role, content });
  }
  // The conversation must open with the author.
  while (merged[0]?.role === 'assistant') merged.shift();
  return merged;
}

function pickTarget(section: RevisedSection, sections: ChatSection[]): ChatSection | null {
  const byId = section.id ? sections.find((s) => s.targetId === section.id) : undefined;
  if (byId) return byId;
  // A lone section cannot be ambiguous, whatever the model called it.
  return sections.length === 1 ? sections[0]! : null;
}


/** Kind "chat": answer the author's message, rewriting sections of the manuscript when asked to. */
export async function runChat(db: Db, ctx: RunContext, run: RunRecord, input: ChatRunInput, signal: AbortSignal) {
  const fail = (message: string, retryable: boolean) => {
    addMessage({ db, chatId: input.chatId, role: 'assistant', content: '', error: message, runId: run.id });
    failRun(db, run.id, message, retryable);
  };

  try {
    let sections: ChatSection[];
    try {
      sections = assertChatable(db, ctx.projectId, input.scope, ctx.budgetTokens);
    } catch (err) {
      fail(err instanceof Error ? err.message : 'This conversation cannot continue.', false);
      return;
    }

    const manuscriptTokens = estimateTokens(sections.map((s) => s.text).join('\n\n'));
    const focus = sections.length === 1 ? focusFor(ctx, sections[0]!.targetType, sections[0]!.targetId) : mergeFocus();
    // What the bible must leave room for: the manuscript going in and, at worst, the whole of it coming back.
    const bible = prepareBible(ctx, focus, manuscriptTokens * 2 + 4_000);
    const system = buildChatSystemPrompt(bible.markdown, ctx.graph.storyParameters);
    const hash = hashBible(bible.markdown);

    const userTurn = buildChatUserMessage(
      sections.map((s) => ({ id: s.targetId, title: s.label, text: s.text })),
      input.message,
    );
    const messages: ModelMessage[] = [...historyFor(db, input), { role: 'user', content: userTurn }];

    const parser = new ReplyParser();
    const labels = new Map(sections.map((s) => [s.targetId, s.label]));
    emit(run.id, { type: 'status', message: 'Thinking it over' });

    const outcome = await streamOnce(
      ctx,
      run.id,
      input.scope.scopeId,
      system,
      messages,
      Math.min(64_000, manuscriptTokens * 2 + 4_000),
      ctx.effort,
      signal,
      (delta) => {
        const { reply, opened } = parser.push(delta);
        if (reply) emit(run.id, { type: 'reply', delta: reply });
        if (opened) {
          const label = opened.id ? labels.get(opened.id) : sections.length === 1 ? sections[0]!.label : undefined;
          emit(run.id, { type: 'status', message: label ? `Rewriting ${label}` : 'Rewriting' });
        }
      },
    );
    if (signal.aborted) {
      addMessage({ db, chatId: input.chatId, role: 'assistant', content: parser.finalReply(), error: 'Stopped before it finished.', runId: run.id });
      return;
    }
    if (outcome.error) {
      fail(outcome.error.message, outcome.error.retryable);
      return;
    }
    parser.end();
    if (!outcome.text.trim()) {
      fail('The model returned no reply.', true);
      return;
    }

    // --- Apply what the model rewrote ---------------------------------------
    const applied: AppliedRevision[] = [];
    const notes: string[] = [];
    let usage = outcome.usage;
    const written = parser.finalSections();
    const cutOff = written.filter((s) => !s.complete);

    for (const section of written.filter((s) => s.complete && s.text.trim())) {
      const target = pickTarget(section, sections);
      if (!target) {
        notes.push('One revised section did not match any part of the manuscript, so it was ignored.');
        continue;
      }
      if (section.text.trim() === target.text.trim()) continue;

      const previousVersionId = currentVersionId(db, target.targetType as VersionTargetType, target.targetId);
      const version = saveVersion({
        db,
        projectId: ctx.projectId,
        targetType: target.targetType,
        targetId: target.targetId,
        runId: run.id,
        content: section.text,
        instructions: input.message,
        bibleHash: hash,
        stopReason: outcome.stopReason,
        refs: bible.refs,
      });
      const revision: AppliedRevision = {
        targetType: target.targetType,
        targetId: target.targetId,
        label: target.label,
        versionId: version.id,
        previousVersionId,
        wordCount: version.wordCount,
      };
      applied.push(revision);
      emit(run.id, { type: 'revised', revision });
      // Later turns must see this text, not the original.
      target.text = section.text;
    }

    if (cutOff.length > 0) {
      notes.push(
        applied.length > 0
          ? 'The reply was cut off partway through the last section, so that section was not changed. Ask for it again on its own.'
          : 'The reply was cut off before the revised text finished, so nothing was changed. Try asking for a smaller change, or work on one chapter at a time.',
      );
    }

    if (input.attributeDialogue) {
      for (const revision of applied) {
        usage = accumulate(
          usage,
          await attributeWritten(db, ctx, run, { id: revision.versionId, targetType: revision.targetType, targetId: revision.targetId }, signal),
        );
      }
    }
    if (signal.aborted) return;

    let reply = parser.finalReply();
    if (!reply) reply = applied.length ? `Done. I rewrote ${applied.map((a) => a.label).join(', ')}.` : 'I did not change anything.';
    if (notes.length) reply = `${reply}\n\n${notes.join(' ')}`;

    addMessage({ db, chatId: input.chatId, role: 'assistant', content: reply, applied, runId: run.id });
    recordUsage(db, run.id, usage, estimateTokens(system + userTurn), hash, bible.markdown);
    finish(db, run.id, 'succeeded');
    emit(run.id, { type: 'done', status: 'succeeded', stopReason: outcome.stopReason });
  } catch (err) {
    if (!signal.aborted) {
      addMessage({
        db,
        chatId: input.chatId,
        role: 'assistant',
        content: '',
        error: err instanceof Error ? err.message : 'The reply failed unexpectedly.',
        runId: run.id,
      });
    }
    throw err;
  }
}

