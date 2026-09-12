/**
 * Timeout policy, ported from SystemGen's section 6. The expensive bug it exists
 * to prevent: one configured timeout, sized for a short summary, applied to a
 * call asking for tens of thousands of output tokens, then retried three times
 * against the same impossible clock.
 */

/** The configured timeout is a FLOOR, not a budget. It can only lengthen a call. */
export const TIMEOUT_FLOOR_MS = 60_000;

/**
 * Cancellation is only checked between calls, so a hung call must not outlast
 * this. SystemGen capped every call at ten minutes because its Anthropic path
 * was blocking; we stream prose, where a long generation is working normally
 * rather than hanging, so a streamed call gets a longer leash.
 */
export const TIMEOUT_CAP_MS = 600_000;
export const STREAM_TIMEOUT_CAP_MS = 1_800_000;

/** Output budgets above this stream by default. */
export const STREAM_OVER_TOKENS = 4_096;

/**
 * Roughly 20 output tokens per second, plus a fixed head start.
 *
 * A chapter at 64k tokens would blow straight through the blocking cap, which is
 * why `streaming` raises it: capping a streamed call at the same ten minutes the
 * SDK already defaults to would make this whole policy a no-op for exactly the
 * calls it exists to protect.
 */
export function timeoutForTokens(maxTokens: number, streaming = false): number {
  const cap = streaming ? STREAM_TIMEOUT_CAP_MS : TIMEOUT_CAP_MS;
  const scaled = TIMEOUT_FLOOR_MS + Math.max(0, Math.floor(maxTokens)) * 50;
  return Math.min(cap, Math.max(TIMEOUT_FLOOR_MS, scaled));
}

/**
 * A timeout message must say how many seconds were given for how many output
 * tokens. Blaming the provider when the endpoint was merely slower than its
 * clock sent SystemGen's debugging in the wrong direction for a day.
 */
export function timeoutMessage(maxTokens: number, timeoutMs: number): string {
  const seconds = Math.round(timeoutMs / 1000);
  return (
    `The request ran past its ${seconds}s limit while generating up to ${maxTokens} tokens. ` +
    'Ask for less in one go, or raise the budget for this step.'
  );
}
