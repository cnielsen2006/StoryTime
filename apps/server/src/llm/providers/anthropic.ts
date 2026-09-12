import Anthropic from '@anthropic-ai/sdk';
import type { z } from 'zod';
import type { ModelInfo, StopReason } from '@storytime/shared';
import { config } from '../../config.js';
import { zodToJsonSchema } from '../json-schema.js';
import { estimateRequestTokens } from '../tokens.js';
import {
  NO_CREDENTIAL_MESSAGE,
  clientOptions,
  detectCredential,
  isConfigured,
  resolveBaseUrl,
  type AnthropicCredential,
} from './anthropic-auth.js';
import { timeoutForTokens, timeoutMessage } from './anthropic-timeout.js';
import {
  ProviderError,
  isAbortError,
  type LlmProvider,
  type StructuredRequest,
  type StructuredResult,
  type TextEvent,
  type TextRequest,
  type Usage,
} from '../types.js';

function mapStopReason(reason: string | null | undefined): StopReason {
  switch (reason) {
    case 'end_turn':
      return 'end_turn';
    case 'max_tokens':
      return 'max_tokens';
    case 'refusal':
      return 'refusal';
    default:
      return 'other';
  }
}

/**
 * A known-good id for connectivity probes. The native API 404s on an unknown id,
 * so a reachability test must not depend on whichever model a book has pinned.
 */
export const PROBE_MODEL = 'claude-sonnet-5';

/**
 * Offered when the live list cannot be fetched (no credential, or offline). A
 * convenience, not a source of truth: the live list wins whenever it is
 * available, and this is the ONE place such ids are hard-coded.
 */
export const FALLBACK_MODELS: ModelInfo[] = [
  { id: 'claude-opus-5', displayName: 'Claude Opus 5', contextWindow: null, maxOutput: null },
  { id: 'claude-sonnet-5', displayName: 'Claude Sonnet 5', contextWindow: null, maxOutput: null },
  { id: 'claude-fable-5-1', displayName: 'Claude Fable 5.1', contextWindow: null, maxOutput: null },
  { id: 'claude-haiku-4-5', displayName: 'Claude Haiku 4.5', contextWindow: null, maxOutput: null },
];

/**
 * The structured response arrives as a text block holding JSON. We build the
 * schema ourselves rather than with the SDK's `zodOutputFormat`, because that
 * helper reads the Zod v4 internals (`_zod.def`) and our schemas are built with
 * the classic v3 surface, which has `_def` instead.
 */
function extractJson(message: Anthropic.Message): unknown {
  const text = message.content
    .filter((block): block is Anthropic.TextBlock => block.type === 'text')
    .map((block) => block.text)
    .join('')
    .trim();
  if (!text) return null;
  try {
    return JSON.parse(text) as unknown;
  } catch {
    throw new ProviderError('Claude returned malformed JSON for a structured request.', true);
  }
}

/** 429 and 5xx are worth retrying; a bad request or bad key never is. */
function toProviderError(err: unknown, credential?: AnthropicCredential): ProviderError {
  if (err instanceof Anthropic.APIError) {
    const status = err.status ?? 0;
    const retryable = status === 408 || status === 409 || status === 429 || status >= 500;
    if (status === 401 || status === 403) {
      // The two failure modes get two different messages: a rejected credential
      // is a different problem from never having had one.
      const detail =
        credential?.kind === 'membership'
          ? 'Your Claude membership sign-in was rejected or has expired. Sign in again on the Settings page.'
          : 'Anthropic rejected the credential. Check ANTHROPIC_API_KEY in your .env, or sign in with Claude on the Settings page.';
      return new ProviderError(detail, false, err);
    }
    return new ProviderError(`Anthropic API error ${status}: ${err.message}`, retryable, err);
  }
  if (err instanceof Anthropic.APIConnectionTimeoutError) {
    return new ProviderError('The request timed out before Claude finished. Try asking for less in one go.', true, err);
  }
  if (err instanceof Error) {
    return new ProviderError(err.message, /network|timeout|ECONN/i.test(err.message), err);
  }
  return new ProviderError('Unknown Anthropic error.', false, err);
}

export class AnthropicProvider implements LlmProvider {
  readonly id = 'anthropic' as const;
  private client: Anthropic;
  private credential: AnthropicCredential;

  /**
   * A blank API key is deliberate, not broken: it means "use the ambient
   * credential", either ANTHROPIC_AUTH_TOKEN or the OAuth profile written by
   * `ant auth login`, which the SDK detects and refreshes on its own.
   */
  constructor(apiKey: string = config.ANTHROPIC_API_KEY, baseUrl: string = config.ANTHROPIC_BASE_URL) {
    this.credential = detectCredential(apiKey);
    if (!isConfigured(this.credential)) {
      throw new ProviderError(NO_CREDENTIAL_MESSAGE, false);
    }
    this.client = new Anthropic({
      ...clientOptions(this.credential),
      // An override is ignored unless it looks like a real Anthropic host.
      ...(resolveBaseUrl(baseUrl) ? { baseURL: resolveBaseUrl(baseUrl) } : {}),
    });
  }

  /** Which credential this provider authenticated with, for the settings page. */
  credentialKind(): AnthropicCredential['kind'] {
    return this.credential.kind;
  }

  /**
   * The story bible lives in the system prompt with a cache breakpoint, so a run
   * that writes ten chapters pays full price for it once.
   */
  private systemBlocks(system: string) {
    return [{ type: 'text' as const, text: system, cache_control: { type: 'ephemeral' as const } }];
  }

  async *generateText(req: TextRequest, signal: AbortSignal): AsyncIterable<TextEvent> {
    const maxTokens = req.maxTokens ?? 64_000;
    // The clock has to scale with what we asked for; a fixed one fails the long
    // calls and only the long calls.
    const timeout = timeoutForTokens(maxTokens, true);
    try {
      const stream = this.client.messages.stream(
        {
          model: req.model,
          max_tokens: maxTokens,
          system: this.systemBlocks(req.system),
          messages: req.messages.map((m) => ({ role: m.role, content: m.content })),
          thinking: { type: 'adaptive' },
          output_config: { effort: req.effort ?? 'high' },
        },
        { signal, timeout },
      );

      for await (const event of stream) {
        if (signal.aborted) return;
        if (event.type === 'content_block_delta' && event.delta.type === 'text_delta') {
          yield { type: 'text', delta: event.delta.text };
        }
      }

      if (signal.aborted) return;
      const final = await stream.finalMessage();

      const usage: Usage = {
        inputTokens: final.usage.input_tokens ?? 0,
        outputTokens: final.usage.output_tokens ?? 0,
        cacheReadTokens: final.usage.cache_read_input_tokens ?? 0,
      };
      yield { type: 'usage', usage };

      if (final.stop_reason === 'refusal') {
        const detail = final.stop_details && 'explanation' in final.stop_details ? final.stop_details.explanation : null;
        yield {
          type: 'error',
          message: `Claude declined this request${detail ? `: ${detail}` : '.'} Try rephrasing the content guidelines or plot points.`,
          retryable: false,
        };
        return;
      }

      const text = final.content
        .filter((block): block is Anthropic.TextBlock => block.type === 'text')
        .map((block) => block.text)
        .join('');
      yield { type: 'done', text, stopReason: mapStopReason(final.stop_reason) };
    } catch (err) {
      if (isAbortError(err) || signal.aborted) return;
      if (err instanceof Anthropic.APIConnectionTimeoutError) {
        yield { type: 'error', message: timeoutMessage(maxTokens, timeout), retryable: true };
        return;
      }
      const mapped = toProviderError(err, this.credential);
      yield { type: 'error', message: mapped.message, retryable: mapped.retryable };
    }
  }

  async generateStructured<S extends z.ZodTypeAny>(
    req: StructuredRequest<S>,
    signal: AbortSignal,
  ): Promise<StructuredResult<z.infer<S>>> {
    const maxTokens = req.maxTokens ?? 16_000;
    const timeout = timeoutForTokens(maxTokens);
    try {
      const message = await this.client.messages.create(
        {
          model: req.model,
          max_tokens: maxTokens,
          system: this.systemBlocks(req.system),
          messages: req.messages.map((m) => ({ role: m.role, content: m.content })),
          thinking: { type: 'adaptive' },
          output_config: {
            effort: req.effort ?? 'medium',
            format: {
              type: 'json_schema' as const,
              // The format carries no name field, so the schema name rides along
              // as a title rather than being dropped.
              schema: { title: req.schemaName, ...zodToJsonSchema(req.schema) },
            },
          },
        },
        { signal, timeout },
      );

      if (message.stop_reason === 'refusal') {
        throw new ProviderError('Claude declined to produce this outline. Try adjusting the content guidelines.', false);
      }

      const raw = extractJson(message);
      if (raw == null) {
        throw new ProviderError('Claude returned no structured output for this request.', true);
      }

      const parsed = req.schema.safeParse(raw);
      if (!parsed.success) {
        throw new ProviderError(
          `Structured output did not match the expected shape: ${parsed.error.issues
            .map((i) => `${i.path.join('.')} ${i.message}`)
            .join('; ')}`,
          true,
        );
      }

      return {
        data: parsed.data,
        usage: {
          inputTokens: message.usage.input_tokens ?? 0,
          outputTokens: message.usage.output_tokens ?? 0,
          cacheReadTokens: message.usage.cache_read_input_tokens ?? 0,
        },
      };
    } catch (err) {
      if (err instanceof ProviderError) throw err;
      if (err instanceof Anthropic.APIConnectionTimeoutError) {
        throw new ProviderError(timeoutMessage(maxTokens, timeout), true, err);
      }
      throw toProviderError(err, this.credential);
    }
  }

  async countTokens(req: Pick<TextRequest, 'model' | 'system' | 'messages'>): Promise<number> {
    try {
      const result = await this.client.messages.countTokens({
        model: req.model,
        system: this.systemBlocks(req.system),
        messages: req.messages.map((m) => ({ role: m.role, content: m.content })),
      });
      return result.input_tokens;
    } catch {
      // A failed count must never block a run; fall back to the estimate.
      return estimateRequestTokens(req.system, req.messages);
    }
  }

  /**
   * The live list wins whenever it can be fetched. An unreachable endpoint falls
   * back to known ids rather than leaving the model field empty, and says so via
   * `listModelsWithSource` so the UI can label it.
   */
  async listModels(): Promise<ModelInfo[]> {
    return (await this.listModelsWithSource()).models;
  }

  async listModelsWithSource(): Promise<{ models: ModelInfo[]; source: 'live' | 'fallback'; note?: string }> {
    try {
      const page = await this.client.models.list({ limit: 50 });
      const models = page.data.map((model) => ({
        id: model.id,
        displayName: model.display_name ?? model.id,
        contextWindow: model.max_input_tokens ?? null,
        maxOutput: model.max_tokens ?? null,
      }));
      if (models.length > 0) return { models, source: 'live' };
      return { models: [...FALLBACK_MODELS], source: 'fallback' };
    } catch (err) {
      const mapped = toProviderError(err, this.credential);
      return { models: [...FALLBACK_MODELS], source: 'fallback', note: mapped.message };
    }
  }

  /**
   * Reachability and auth, tested with a backend-chosen model so a mis-set model
   * on one book cannot make a healthy credential look broken.
   */
  async probe(): Promise<{ ok: boolean; latencyMs: number; model: string; error?: string }> {
    const started = Date.now();
    try {
      await this.client.messages.create({
        model: PROBE_MODEL,
        max_tokens: 4,
        messages: [{ role: 'user', content: 'ping' }],
      });
      return { ok: true, latencyMs: Date.now() - started, model: PROBE_MODEL };
    } catch (err) {
      return {
        ok: false,
        latencyMs: Date.now() - started,
        model: PROBE_MODEL,
        error: toProviderError(err, this.credential).message,
      };
    }
  }
}
