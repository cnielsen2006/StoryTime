import type { z } from 'zod';
import type { Effort, ModelInfo, ProviderId, StopReason } from '@storytime/shared';

export interface ChatMessage {
  role: 'user' | 'assistant';
  content: string;
}

export interface TextRequest {
  model: string;
  /** Stable across a run so providers that cache prompt prefixes can do so. */
  system: string;
  messages: ChatMessage[];
  maxTokens?: number;
  effort?: Effort;
}

export interface StructuredRequest<S extends z.ZodTypeAny> {
  model: string;
  system: string;
  messages: ChatMessage[];
  schema: S;
  schemaName: string;
  maxTokens?: number;
  effort?: Effort;
}

export interface Usage {
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
}

export type TextEvent =
  | { type: 'text'; delta: string }
  | { type: 'status'; message: string }
  | { type: 'usage'; usage: Usage }
  | { type: 'done'; text: string; stopReason: StopReason }
  | { type: 'error'; message: string; retryable: boolean };

export interface StructuredResult<T> {
  data: T;
  usage: Usage;
}

export interface LlmProvider {
  readonly id: ProviderId;
  /** Streamed prose. Must honour the abort signal promptly. */
  generateText(req: TextRequest, signal: AbortSignal): AsyncIterable<TextEvent>;
  /** JSON matching a Zod schema, validated before it is returned. */
  generateStructured<S extends z.ZodTypeAny>(
    req: StructuredRequest<S>,
    signal: AbortSignal,
  ): Promise<StructuredResult<z.infer<S>>>;
  /** Exact where the provider offers it, estimated otherwise. */
  countTokens(req: Pick<TextRequest, 'model' | 'system' | 'messages'>): Promise<number>;
  listModels(): Promise<ModelInfo[]>;
}

/** Thrown by providers so the runner can decide whether a retry makes sense. */
export class ProviderError extends Error {
  constructor(
    message: string,
    readonly retryable: boolean,
    override readonly cause?: unknown,
  ) {
    super(message);
    this.name = 'ProviderError';
  }
}

export const emptyUsage = (): Usage => ({ inputTokens: 0, outputTokens: 0, cacheReadTokens: 0 });

export function isAbortError(err: unknown): boolean {
  return (
    err instanceof Error && (err.name === 'AbortError' || err.message.toLowerCase().includes('abort'))
  );
}
