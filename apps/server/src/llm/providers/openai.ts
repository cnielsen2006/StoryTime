import OpenAI from 'openai';
import { zodResponseFormat } from 'openai/helpers/zod';
import type { z } from 'zod';
import type { ModelInfo, StopReason } from '@storytime/shared';
import { config } from '../../config.js';
import { estimateRequestTokens, estimateTokens } from '../tokens.js';
import {
  ProviderError,
  isAbortError,
  type LlmProvider,
  type StructuredRequest,
  type StructuredResult,
  type TextEvent,
  type TextRequest,
} from '../types.js';

function mapFinishReason(reason: string | null | undefined): StopReason {
  switch (reason) {
    case 'stop':
      return 'end_turn';
    case 'length':
      return 'max_tokens';
    case 'content_filter':
      return 'refusal';
    default:
      return 'other';
  }
}

function toProviderError(err: unknown): ProviderError {
  if (err instanceof OpenAI.APIError) {
    const status = err.status ?? 0;
    if (status === 401 || status === 403) {
      return new ProviderError('OpenAI rejected the API key. Check OPENAI_API_KEY in your .env.', false, err);
    }
    const retryable = status === 408 || status === 429 || status >= 500;
    return new ProviderError(`OpenAI API error ${status}: ${err.message}`, retryable, err);
  }
  if (err instanceof Error) {
    return new ProviderError(err.message, /network|timeout|ECONN/i.test(err.message), err);
  }
  return new ProviderError('Unknown OpenAI error.', false, err);
}

export class OpenAIProvider implements LlmProvider {
  readonly id = 'openai' as const;
  private client: OpenAI;

  constructor(apiKey: string = config.OPENAI_API_KEY, baseURL: string = config.OPENAI_BASE_URL) {
    if (!apiKey) {
      throw new ProviderError('No OpenAI API key configured. Set OPENAI_API_KEY in your .env file.', false);
    }
    this.client = new OpenAI({ apiKey, ...(baseURL ? { baseURL } : {}) });
  }

  async *generateText(req: TextRequest, signal: AbortSignal): AsyncIterable<TextEvent> {
    try {
      const stream = await this.client.chat.completions.create(
        {
          model: req.model,
          max_completion_tokens: req.maxTokens ?? 16_000,
          stream: true,
          stream_options: { include_usage: true },
          messages: [
            { role: 'system', content: req.system },
            ...req.messages.map((m) => ({ role: m.role, content: m.content }) as const),
          ],
        },
        { signal },
      );

      let text = '';
      let finish: string | null = null;
      let inputTokens = 0;
      let outputTokens = 0;

      for await (const chunk of stream) {
        if (signal.aborted) return;
        const choice = chunk.choices[0];
        const delta = choice?.delta?.content;
        if (delta) {
          text += delta;
          yield { type: 'text', delta };
        }
        if (choice?.finish_reason) finish = choice.finish_reason;
        if (chunk.usage) {
          inputTokens = chunk.usage.prompt_tokens ?? 0;
          outputTokens = chunk.usage.completion_tokens ?? 0;
        }
      }

      if (signal.aborted) return;
      yield {
        type: 'usage',
        usage: {
          inputTokens: inputTokens || estimateRequestTokens(req.system, req.messages),
          outputTokens: outputTokens || estimateTokens(text),
          cacheReadTokens: 0,
        },
      };
      yield { type: 'done', text, stopReason: mapFinishReason(finish) };
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
      // In SDK 4.x the schema-parsing helper lives under the beta namespace.
      const completion = await this.client.beta.chat.completions.parse(
        {
          model: req.model,
          max_completion_tokens: req.maxTokens ?? 16_000,
          messages: [
            { role: 'system', content: req.system },
            ...req.messages.map((m) => ({ role: m.role, content: m.content }) as const),
          ],
          response_format: zodResponseFormat(req.schema, req.schemaName),
        },
        { signal },
      );

      const choice = completion.choices[0];
      if (choice?.finish_reason === 'content_filter') {
        throw new ProviderError('OpenAI declined to produce this output.', false);
      }
      const parsedOutput = choice?.message.parsed;
      if (parsedOutput == null) {
        throw new ProviderError('OpenAI returned no structured output for this request.', true);
      }

      const parsed = req.schema.safeParse(parsedOutput);
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
          inputTokens: completion.usage?.prompt_tokens ?? 0,
          outputTokens: completion.usage?.completion_tokens ?? 0,
          cacheReadTokens: 0,
        },
      };
    } catch (err) {
      if (err instanceof ProviderError) throw err;
      throw toProviderError(err);
    }
  }

  async countTokens(req: Pick<TextRequest, 'model' | 'system' | 'messages'>): Promise<number> {
    return estimateRequestTokens(req.system, req.messages);
  }

  async listModels(): Promise<ModelInfo[]> {
    try {
      const page = await this.client.models.list();
      return page.data
        .filter((m) => m.id.startsWith('gpt') || m.id.startsWith('o'))
        .map((m) => ({ id: m.id, displayName: m.id, contextWindow: null, maxOutput: null }));
    } catch (err) {
      throw toProviderError(err);
    }
  }
}
