import Anthropic from '@anthropic-ai/sdk';
import { zodOutputFormat } from '@anthropic-ai/sdk/helpers/zod';
import type { z } from 'zod';
import type { ModelInfo, StopReason } from '@storytime/shared';
import { config } from '../../config.js';
import { estimateRequestTokens } from '../tokens.js';
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

/** 429 and 5xx are worth retrying; a bad request or bad key never is. */
function toProviderError(err: unknown): ProviderError {
  if (err instanceof Anthropic.APIError) {
    const status = err.status ?? 0;
    const retryable = status === 408 || status === 409 || status === 429 || status >= 500;
    if (status === 401 || status === 403) {
      return new ProviderError('Anthropic rejected the API key. Check ANTHROPIC_API_KEY in your .env.', false, err);
    }
    return new ProviderError(`Anthropic API error ${status}: ${err.message}`, retryable, err);
  }
  if (err instanceof Error) {
    return new ProviderError(err.message, /network|timeout|ECONN/i.test(err.message), err);
  }
  return new ProviderError('Unknown Anthropic error.', false, err);
}

export class AnthropicProvider implements LlmProvider {
  readonly id = 'anthropic' as const;
  private client: Anthropic;

  constructor(apiKey: string = config.ANTHROPIC_API_KEY) {
    if (!apiKey) {
      throw new ProviderError('No Anthropic API key configured. Set ANTHROPIC_API_KEY in your .env file.', false);
    }
    this.client = new Anthropic({ apiKey });
  }

  /**
   * The story bible lives in the system prompt with a cache breakpoint, so a run
   * that writes ten chapters pays full price for it once.
   */
  private systemBlocks(system: string) {
    return [{ type: 'text' as const, text: system, cache_control: { type: 'ephemeral' as const } }];
  }

  async *generateText(req: TextRequest, signal: AbortSignal): AsyncIterable<TextEvent> {
    try {
      const stream = this.client.messages.stream(
        {
          model: req.model,
          max_tokens: req.maxTokens ?? 64_000,
          system: this.systemBlocks(req.system),
          messages: req.messages.map((m) => ({ role: m.role, content: m.content })),
          thinking: { type: 'adaptive' },
          output_config: { effort: req.effort ?? 'high' },
        },
        { signal },
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
      const mapped = toProviderError(err);
      yield { type: 'error', message: mapped.message, retryable: mapped.retryable };
    }
  }

  async generateStructured<S extends z.ZodTypeAny>(
    req: StructuredRequest<S>,
    signal: AbortSignal,
  ): Promise<StructuredResult<z.infer<S>>> {
    try {
      const message = await this.client.messages.parse(
        {
          model: req.model,
          max_tokens: req.maxTokens ?? 16_000,
          system: this.systemBlocks(req.system),
          messages: req.messages.map((m) => ({ role: m.role, content: m.content })),
          thinking: { type: 'adaptive' },
          output_config: {
            effort: req.effort ?? 'medium',
            format: zodOutputFormat(req.schema as never),
          },
        },
        { signal },
      );

      if (message.stop_reason === 'refusal') {
        throw new ProviderError('Claude declined to produce this outline. Try adjusting the content guidelines.', false);
      }
      if (message.parsed_output == null) {
        throw new ProviderError('Claude returned no structured output for this request.', true);
      }

      // Validate against our own schema too: the helper uses a converted copy.
      const parsed = req.schema.safeParse(message.parsed_output);
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
      throw toProviderError(err);
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

  async listModels(): Promise<ModelInfo[]> {
    try {
      const page = await this.client.models.list({ limit: 50 });
      return page.data.map((model) => ({
        id: model.id,
        displayName: model.display_name ?? model.id,
        contextWindow: (model as { max_input_tokens?: number }).max_input_tokens ?? null,
        maxOutput: (model as { max_tokens?: number }).max_tokens ?? null,
      }));
    } catch (err) {
      throw toProviderError(err);
    }
  }
}
