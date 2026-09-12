import type { z } from 'zod';
import type { ModelInfo } from '@storytime/shared';
import { estimateRequestTokens, estimateTokens } from '../tokens.js';
import {
  ProviderError,
  type LlmProvider,
  type StructuredRequest,
  type StructuredResult,
  type TextEvent,
  type TextRequest,
} from '../types.js';

const LOREM = [
  'The light came in sideways, the way it always did at that hour.',
  'Nobody spoke, which was its own kind of answer.',
  'Somewhere below, a door closed and stayed closed.',
  'It was the sort of quiet that asks you to fill it.',
  'She counted to ten and did not feel better.',
  'The floor was cold and the cold was honest.',
  'He had rehearsed this and the rehearsal was no help at all.',
  'Outside, the weather went on without them.',
];

/** Entity tags the serializer writes into the bible, e.g. [C:ab12]. */
function extractTags(text: string, prefix: string): string[] {
  const pattern = new RegExp(`\\[${prefix}:([A-Za-z0-9_-]+)\\]`, 'g');
  const found = new Set<string>();
  for (const match of text.matchAll(pattern)) {
    if (match[1]) found.add(match[1]);
  }
  return [...found];
}

/** Names as they appear under a markdown heading, so tests can assert on them. */
function extractHeadings(text: string): string[] {
  return text
    .split('\n')
    .filter((line) => line.startsWith('### '))
    .map((line) => line.slice(4).replace(/\s*\[[A-Z]+:[A-Za-z0-9_-]+\]\s*$/, '').trim())
    .filter(Boolean);
}

function targetWordsFrom(text: string): number {
  const match = text.match(/~\s*([\d,]+)\s*words/i);
  if (!match?.[1]) return 220;
  const parsed = Number(match[1].replace(/,/g, ''));
  return Number.isFinite(parsed) ? Math.min(Math.max(parsed, 40), 4000) : 220;
}

/** Deterministic pseudo-prose sized to the requested word count. */
function buildText(req: TextRequest): string {
  const task = req.messages.at(-1)?.content ?? '';
  const names = extractHeadings(req.system).slice(0, 4);
  const targetWords = targetWordsFrom(task);

  const parts: string[] = [`[MOCK] ${names.length ? `Featuring ${names.join(', ')}.` : 'No named cast in context.'}`];
  let words = parts[0]!.split(/\s+/).length;
  let index = 0;
  while (words < targetWords) {
    const sentence = LOREM[index % LOREM.length]!;
    parts.push(sentence);
    words += sentence.split(/\s+/).length;
    index += 1;
    if (index % 4 === 0) parts.push('');
  }
  return parts.join(' ').replace(/\s+\n/g, '\n\n').trim();
}

export class MockProvider implements LlmProvider {
  readonly id = 'mock' as const;

  /** mock-slow leaves room for a cancel to land mid-stream in tests. */
  private chunkDelay(model: string): number {
    return model === 'mock-slow' ? 60 : 1;
  }

  async *generateText(req: TextRequest, signal: AbortSignal): AsyncIterable<TextEvent> {
    if (req.model === 'mock-error') {
      yield { type: 'error', message: 'Mock provider was asked to fail.', retryable: false };
      return;
    }

    const full = buildText(req);
    const delay = this.chunkDelay(req.model);
    let emitted = '';

    yield { type: 'status', message: 'Mock provider generating' };

    for (let i = 0; i < full.length; i += 40) {
      if (signal.aborted) return;
      if (delay > 0) {
        await new Promise((resolve) => setTimeout(resolve, delay));
        if (signal.aborted) return;
      }
      const chunk = full.slice(i, i + 40);
      emitted += chunk;
      yield { type: 'text', delta: chunk };
    }

    yield {
      type: 'usage',
      usage: {
        inputTokens: estimateRequestTokens(req.system, req.messages),
        outputTokens: estimateTokens(emitted),
        cacheReadTokens: 0,
      },
    };
    yield { type: 'done', text: emitted, stopReason: 'end_turn' };
  }

  async generateStructured<S extends z.ZodTypeAny>(
    req: StructuredRequest<S>,
    signal: AbortSignal,
  ): Promise<StructuredResult<z.infer<S>>> {
    if (signal.aborted) throw new ProviderError('Cancelled before the mock responded.', false);

    const fixture = this.fixtureFor(req);
    const parsed = req.schema.safeParse(fixture);
    if (!parsed.success) {
      // A failure here means the fixture drifted from the schema, not a model bug.
      throw new ProviderError(
        `Mock fixture for "${req.schemaName}" no longer matches its schema: ${parsed.error.issues
          .map((i) => `${i.path.join('.')} ${i.message}`)
          .join('; ')}`,
        false,
      );
    }
    return {
      data: parsed.data,
      usage: {
        inputTokens: estimateRequestTokens(req.system, req.messages),
        outputTokens: 200,
        cacheReadTokens: 0,
      },
    };
  }

  /** Fixtures reuse real ids from the bible so materialization is exercised. */
  private fixtureFor<S extends z.ZodTypeAny>(req: StructuredRequest<S>): unknown {
    const characterIds = extractTags(req.system, 'C');
    const locationIds = extractTags(req.system, 'L');
    const plotPointIds = extractTags(req.system, 'PP');
    const wantsScenes = /scene/i.test(req.messages.at(-1)?.content ?? '');

    if (req.schemaName === 'outline') {
      const chapterCount = Math.max(1, Math.min(3, Math.ceil(plotPointIds.length / 3) || 1));
      return {
        chapters: Array.from({ length: chapterCount }, (_, index) => {
          const slice = plotPointIds.slice(index * 3, index * 3 + 3);
          return {
            title: `Chapter ${index + 1}`,
            summary: `Mock chapter ${index + 1} covering ${slice.length} plot point(s).`,
            plotPointIds: slice,
            characterIds: characterIds.slice(0, 2),
            locationIds: locationIds.slice(0, 1),
            estimatedWords: 1200,
            scenes: wantsScenes
              ? [
                  {
                    title: `Scene ${index + 1}.1`,
                    goal: 'Establish the situation.',
                    povCharacterId: characterIds[0] ?? '',
                    locationId: locationIds[0] ?? '',
                    beats: ['Arrive', 'Discover', 'Decide'],
                    plotPointIds: slice.slice(0, 1),
                    estimatedWords: 600,
                  },
                  {
                    title: `Scene ${index + 1}.2`,
                    goal: 'Raise the cost.',
                    povCharacterId: characterIds[1] ?? characterIds[0] ?? '',
                    locationId: locationIds[1] ?? locationIds[0] ?? '',
                    beats: ['Confront', 'Fail', 'Regroup'],
                    plotPointIds: slice.slice(1, 2),
                    estimatedWords: 600,
                  },
                ]
              : [],
          };
        }),
      };
    }

    if (req.schemaName === 'chapter_summary') {
      return {
        summary: 'Mock summary: the chapter happened and left one thread open.',
        openThreads: ['The unopened letter is still unopened.'],
      };
    }

    if (req.schemaName === 'triage') {
      return {
        links: [
          {
            entityType: characterIds.length ? 'character' : 'plot_line',
            entityId: characterIds[0] ?? '',
            newEntityName: characterIds.length ? '' : 'New thread from idea',
            note: 'Mock suggestion.',
          },
        ],
      };
    }

    throw new ProviderError(`No mock fixture for schema "${req.schemaName}".`, false);
  }

  async countTokens(req: Pick<TextRequest, 'model' | 'system' | 'messages'>): Promise<number> {
    return estimateRequestTokens(req.system, req.messages);
  }

  async listModels(): Promise<ModelInfo[]> {
    return [
      { id: 'mock-fast', displayName: 'Mock (instant)', contextWindow: 200_000, maxOutput: 64_000 },
      { id: 'mock-slow', displayName: 'Mock (slow, for testing cancel)', contextWindow: 200_000, maxOutput: 64_000 },
      { id: 'mock-error', displayName: 'Mock (always fails)', contextWindow: 200_000, maxOutput: 64_000 },
    ];
  }
}
