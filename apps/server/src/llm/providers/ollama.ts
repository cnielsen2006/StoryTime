import { zodToJsonSchema } from '../json-schema.js';
import type { z } from 'zod';
import type { ModelInfo } from '@storytime/shared';
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

interface OllamaChunk {
  message?: { content?: string };
  done?: boolean;
  done_reason?: string;
  prompt_eval_count?: number;
  eval_count?: number;
}

/** Local models via Ollama's REST API. No SDK needed. */
export class OllamaProvider implements LlmProvider {
  readonly id = 'ollama' as const;

  constructor(private baseUrl: string = config.OLLAMA_BASE_URL) {
    this.baseUrl = this.baseUrl.replace(/\/$/, '');
  }

  private async post(path: string, body: unknown, signal: AbortSignal): Promise<Response> {
    let response: Response;
    try {
      response = await fetch(`${this.baseUrl}${path}`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body),
        signal,
      });
    } catch (err) {
      if (isAbortError(err)) throw err;
      throw new ProviderError(
        `Could not reach Ollama at ${this.baseUrl}. Is it running? (${(err as Error).message})`,
        true,
        err,
      );
    }
    if (!response.ok) {
      const detail = await response.text().catch(() => '');
      throw new ProviderError(
        `Ollama returned ${response.status}: ${detail.slice(0, 300)}`,
        response.status >= 500,
      );
    }
    return response;
  }

  async *generateText(req: TextRequest, signal: AbortSignal): AsyncIterable<TextEvent> {
    try {
      const response = await this.post(
        '/api/chat',
        {
          model: req.model,
          stream: true,
          messages: [
            { role: 'system', content: req.system },
            ...req.messages.map((m) => ({ role: m.role, content: m.content })),
          ],
        },
        signal,
      );

      if (!response.body) throw new ProviderError('Ollama sent an empty response body.', true);

      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';
      let text = '';
      let inputTokens = 0;
      let outputTokens = 0;
      let doneReason: string | undefined;

      // Ollama streams newline-delimited JSON, one object per chunk.
      while (true) {
        if (signal.aborted) {
          await reader.cancel().catch(() => {});
          return;
        }
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });

        let newlineIndex: number;
        while ((newlineIndex = buffer.indexOf('\n')) !== -1) {
          const line = buffer.slice(0, newlineIndex).trim();
          buffer = buffer.slice(newlineIndex + 1);
          if (!line) continue;
          let chunk: OllamaChunk;
          try {
            chunk = JSON.parse(line) as OllamaChunk;
          } catch {
            continue;
          }
          const delta = chunk.message?.content;
          if (delta) {
            text += delta;
            yield { type: 'text', delta };
          }
          if (chunk.prompt_eval_count) inputTokens = chunk.prompt_eval_count;
          if (chunk.eval_count) outputTokens = chunk.eval_count;
          if (chunk.done) doneReason = chunk.done_reason;
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
      yield { type: 'done', text, stopReason: doneReason === 'length' ? 'max_tokens' : 'end_turn' };
    } catch (err) {
      if (isAbortError(err) || signal.aborted) return;
      const mapped =
        err instanceof ProviderError ? err : new ProviderError((err as Error).message ?? 'Ollama failed.', true, err);
      yield { type: 'error', message: mapped.message, retryable: mapped.retryable };
    }
  }

  async generateStructured<S extends z.ZodTypeAny>(
    req: StructuredRequest<S>,
    signal: AbortSignal,
  ): Promise<StructuredResult<z.infer<S>>> {
    const response = await this.post(
      '/api/chat',
      {
        model: req.model,
        stream: false,
        format: zodToJsonSchema(req.schema),
        messages: [
          { role: 'system', content: req.system },
          ...req.messages.map((m) => ({ role: m.role, content: m.content })),
        ],
      },
      signal,
    );

    const payload = (await response.json()) as OllamaChunk;
    const content = payload.message?.content ?? '';
    let raw: unknown;
    try {
      raw = JSON.parse(content);
    } catch {
      throw new ProviderError(
        `Ollama did not return valid JSON for "${req.schemaName}". Local models often need a larger context window.`,
        true,
      );
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
        inputTokens: payload.prompt_eval_count ?? estimateRequestTokens(req.system, req.messages),
        outputTokens: payload.eval_count ?? estimateTokens(content),
        cacheReadTokens: 0,
      },
    };
  }

  async countTokens(req: Pick<TextRequest, 'model' | 'system' | 'messages'>): Promise<number> {
    return estimateRequestTokens(req.system, req.messages);
  }

  async listModels(): Promise<ModelInfo[]> {
    let response: Response;
    try {
      response = await fetch(`${this.baseUrl}/api/tags`);
    } catch (err) {
      throw new ProviderError(`Could not reach Ollama at ${this.baseUrl}. Is it running?`, true, err);
    }
    if (!response.ok) throw new ProviderError(`Ollama returned ${response.status} listing models.`, true);
    const payload = (await response.json()) as { models?: Array<{ name: string; details?: { parameter_size?: string } }> };
    return (payload.models ?? []).map((m) => ({
      id: m.name,
      displayName: m.details?.parameter_size ? `${m.name} (${m.details.parameter_size})` : m.name,
      contextWindow: null,
      maxOutput: null,
    }));
  }
}
