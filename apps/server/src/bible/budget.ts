import type { BibleLevel, TrimReport } from '@storytime/shared';
import { estimateTokens } from '../llm/tokens.js';
import { serializeBible, type BibleGraph, type Focus, type SerializedBible } from './serialize.js';

const LEVELS: BibleLevel[] = ['full', 'compact', 'minimal'];

export interface FitResult extends SerializedBible {
  level: BibleLevel;
  trim: TrimReport;
}

const LEVEL_NOTES: Record<BibleLevel, string[]> = {
  full: [],
  compact: [
    'Background characters reduced to a one-line description.',
    'Background locations reduced to their description only.',
    'Loose "idea" plot points outside this chapter were left out.',
  ],
  minimal: [
    'Only the characters and locations this piece is about are described in full.',
    'Everyone else appears as a single line.',
    'Only confirmed plot points outside this chapter were kept.',
  ],
};

export interface FitOptions {
  focus?: Focus;
  /** Total tokens the prompt may occupy, before output is reserved. */
  budgetTokens: number;
  /** Tokens to leave for the model's own response. */
  reserveOutputTokens?: number;
}

/**
 * Render the bible at the richest level that still fits the budget.
 *
 * Returns a report the UI shows before a run starts, so the user can see what
 * was left out rather than wondering why a character never appeared.
 */
export function fitToBudget(graph: BibleGraph, options: FitOptions): FitResult {
  const reserve = options.reserveOutputTokens ?? 0;
  const available = Math.max(1000, options.budgetTokens - reserve);

  let last: { level: BibleLevel; serialized: SerializedBible; tokens: number } | null = null;

  for (const level of LEVELS) {
    const serialized = serializeBible(graph, { focus: options.focus, level });
    const tokens = estimateTokens(serialized.markdown);
    last = { level, serialized, tokens };
    if (tokens <= available) {
      return {
        ...serialized,
        level,
        trim: {
          level,
          estimatedTokens: tokens,
          budgetTokens: available,
          notes: LEVEL_NOTES[level],
        },
      };
    }
  }

  // Even minimal overflows. Return it with an honest warning rather than
  // silently truncating the story bible mid-character.
  const fallback = last!;
  return {
    ...fallback.serialized,
    level: fallback.level,
    trim: {
      level: fallback.level,
      estimatedTokens: fallback.tokens,
      budgetTokens: available,
      notes: [
        ...LEVEL_NOTES.minimal,
        `This project is still about ${(fallback.tokens - available).toLocaleString()} tokens over the budget even at the smallest size. Raise the token budget in project settings, choose a model with a larger context window, or split the book into smaller projects.`,
      ],
    },
  };
}

export function budgetExceeded(trim: TrimReport): boolean {
  return trim.estimatedTokens > trim.budgetTokens;
}

/** Context window fallbacks when a provider does not report one. */
export const DEFAULT_CONTEXT_WINDOW = 200_000;

export function defaultBudgetTokens(contextWindow: number | null | undefined): number {
  return Math.floor((contextWindow ?? DEFAULT_CONTEXT_WINDOW) * 0.6);
}
