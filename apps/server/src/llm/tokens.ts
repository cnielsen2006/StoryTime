import type { ChatMessage } from './types.js';

/**
 * Character-based estimate. English prose runs around 3.6 characters per token,
 * which is deliberately a little conservative so budget checks err on the safe
 * side. Providers that expose a real counter override this.
 */
export function estimateTokens(text: string): number {
  return Math.ceil(text.length / 3.6);
}

export function estimateRequestTokens(system: string, messages: ChatMessage[]): number {
  const body = messages.map((m) => m.content).join('\n');
  // A few tokens of per-message framing overhead.
  return estimateTokens(system) + estimateTokens(body) + messages.length * 4;
}

/** Rough inverse: how many words fit in a token budget. */
export function tokensToWords(tokens: number): number {
  return Math.floor(tokens * 0.75);
}

export function wordsToTokens(words: number): number {
  return Math.ceil(words / 0.75);
}
