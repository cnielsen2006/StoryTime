import { createHash } from 'node:crypto';
import { eq } from 'drizzle-orm';
import type { Effort, RunStatus, StopReason } from '@storytime/shared';
import type { Db } from '../db/client.js';
import { generationRuns } from '../db/schema.js';
import type { TextEvent, Usage } from '../llm/types.js';
import { emit } from './events.js';
import type { RunContext } from './context.js';

/** Pieces every kind of run shares: streaming one completion, and closing the run row. */

export function hashBible(markdown: string): string {
  return createHash('sha256').update(markdown).digest('hex').slice(0, 16);
}

export function accumulate(total: Usage, next: Usage): Usage {
  return {
    inputTokens: total.inputTokens + next.inputTokens,
    outputTokens: total.outputTokens + next.outputTokens,
    cacheReadTokens: total.cacheReadTokens + next.cacheReadTokens,
  };
}

export interface StreamOutcome {
  text: string;
  stopReason: StopReason;
  usage: Usage;
  error: { message: string; retryable: boolean } | null;
}

/** Drive one streamed completion, forwarding deltas to the run's SSE channel. */
export async function streamOnce(
  ctx: RunContext,
  runId: string,
  targetId: string,
  systemPrompt: string,
  messages: Array<{ role: 'user' | 'assistant'; content: string }>,
  maxTokens: number,
  effort: Effort,
  signal: AbortSignal,
  /** Takes over the text deltas, for runs that interpret the stream instead of showing it as it is. */
  onText?: (delta: string, soFar: string) => void,
): Promise<StreamOutcome> {
  let text = '';
  let stopReason: StopReason = 'other';
  let usage: Usage = { inputTokens: 0, outputTokens: 0, cacheReadTokens: 0 };
  let error: StreamOutcome['error'] = null;

  const stream = ctx.resolved.provider.generateText(
    { model: ctx.model, system: systemPrompt, messages, maxTokens, effort },
    signal,
  );

  for await (const event of stream as AsyncIterable<TextEvent>) {
    if (signal.aborted) break;
    switch (event.type) {
      case 'text':
        text += event.delta;
        if (onText) onText(event.delta, text);
        else emit(runId, { type: 'text', targetId, delta: event.delta });
        break;
      case 'status':
        emit(runId, { type: 'status', message: event.message });
        break;
      case 'usage':
        usage = accumulate(usage, event.usage);
        break;
      case 'done':
        // Providers report the assembled text; prefer it over our accumulation.
        if (event.text) text = event.text;
        stopReason = event.stopReason;
        break;
      case 'error':
        error = { message: event.message, retryable: event.retryable };
        break;
    }
  }

  return { text, stopReason, usage, error };
}

export interface RunRecord {
  id: string;
  projectId: string;
}

export function finish(db: Db, runId: string, status: RunStatus, patch: Record<string, unknown> = {}) {
  db.update(generationRuns)
    .set({ status, finishedAt: Date.now(), ...patch })
    .where(eq(generationRuns.id, runId))
    .run();
}

export function recordUsage(db: Db, runId: string, usage: Usage, estimated: number, bibleHash: string, bible: string) {
  db.update(generationRuns)
    .set({
      inputTokens: usage.inputTokens,
      outputTokens: usage.outputTokens,
      cacheReadTokens: usage.cacheReadTokens,
      estimatedInputTokens: estimated,
      bibleHash,
      bibleMarkdown: bible,
    })
    .where(eq(generationRuns.id, runId))
    .run();
  emit(runId, {
    type: 'usage',
    inputTokens: usage.inputTokens,
    outputTokens: usage.outputTokens,
    cacheReadTokens: usage.cacheReadTokens,
  });
}

export function failRun(db: Db, runId: string, message: string, retryable: boolean) {
  finish(db, runId, 'failed', { error: message });
  emit(runId, { type: 'error', message, retryable });
}

