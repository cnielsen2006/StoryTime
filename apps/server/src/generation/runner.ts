import { createHash } from 'node:crypto';
import { and, eq, inArray } from 'drizzle-orm';
import {
  ChapterSummaryResult,
  OutlineResult,
  type Effort,
  type RunCreate,
  type RunStatus,
  type StopReason,
  type TrimReport,
  type VersionTargetType,
} from '@storytime/shared';
import type { Db } from '../db/client.js';
import { chapters, generationRuns, scenes } from '../db/schema.js';
import {
  buildChapterPrompt,
  buildContinuationPrompt,
  buildDraftPrompt,
  buildOutlinePrompt,
  buildScenePrompt,
  buildSummaryPrompt,
  buildUpdatePrompt,
} from '../bible/prompts.js';
import type { EntityRef, Focus } from '../bible/serialize.js';
import { estimateTokens, wordsToTokens } from '../llm/tokens.js';
import { ProviderError, type TextEvent, type Usage } from '../llm/types.js';
import { badRequest, conflict, newId, notFound } from '../services/entities.js';
import { currentText, readChapters, readScenes, saveVersion } from '../services/manuscript.js';
import { emit } from './events.js';
import {
  buildRunContext,
  focusFromPlotPoints,
  mergeFocus,
  plotPointTitles,
  prepareBible,
  tailOf,
  type RunContext,
} from './context.js';
import { materializeOutline } from './outline.js';

/** One run per project at a time; the in-flight controller lives here. */
const inFlight = new Map<string, { runId: string; controller: AbortController }>();

const MAX_CONTINUATIONS = 3;
const PREVIOUS_TAIL_CHARS = 1500;
const PREVIOUS_SCENE_TAIL_CHARS = 1000;

export function hashBible(markdown: string): string {
  return createHash('sha256').update(markdown).digest('hex').slice(0, 16);
}

function accumulate(total: Usage, next: Usage): Usage {
  return {
    inputTokens: total.inputTokens + next.inputTokens,
    outputTokens: total.outputTokens + next.outputTokens,
    cacheReadTokens: total.cacheReadTokens + next.cacheReadTokens,
  };
}

/** A run left `running` by a crash can never resume, so retire it at boot. */
export function resetOrphanedRuns(db: Db) {
  db.update(generationRuns)
    .set({
      status: 'failed',
      error: 'The server restarted while this run was in progress.',
      finishedAt: Date.now(),
    })
    .where(inArray(generationRuns.status, ['queued', 'running']))
    .run();
}

export function isProjectBusy(projectId: string): boolean {
  return inFlight.has(projectId);
}

export function cancelRun(runId: string): boolean {
  for (const [projectId, entry] of inFlight) {
    if (entry.runId === runId) {
      entry.controller.abort();
      inFlight.delete(projectId);
      return true;
    }
  }
  return false;
}

interface StreamOutcome {
  text: string;
  stopReason: StopReason;
  usage: Usage;
  error: { message: string; retryable: boolean } | null;
}

/** Drive one streamed completion, forwarding deltas to the run's SSE channel. */
async function streamOnce(
  ctx: RunContext,
  runId: string,
  targetId: string,
  systemPrompt: string,
  messages: Array<{ role: 'user' | 'assistant'; content: string }>,
  maxTokens: number,
  effort: Effort,
  signal: AbortSignal,
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
        emit(runId, { type: 'text', targetId, delta: event.delta });
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

interface RunRecord {
  id: string;
  projectId: string;
}

function finish(db: Db, runId: string, status: RunStatus, patch: Record<string, unknown> = {}) {
  db.update(generationRuns)
    .set({ status, finishedAt: Date.now(), ...patch })
    .where(eq(generationRuns.id, runId))
    .run();
}

export interface StartRunResult {
  runId: string;
}

/**
 * Create the run row, then execute it in the background. Returns as soon as the
 * row exists so the HTTP request can hand the client a run id to stream from.
 */
export function startRun(db: Db, projectId: string, input: RunCreate): StartRunResult {
  if (inFlight.has(projectId)) {
    throw conflict('This project already has a generation running. Cancel it first, or wait for it to finish.');
  }

  const ctx = buildRunContext(db, projectId, input);
  const runId = newId();

  db.insert(generationRuns)
    .values({
      id: runId,
      projectId,
      mode: input.mode,
      kind: input.kind,
      targetType: input.targetType ?? null,
      targetId: input.targetId ?? null,
      provider: ctx.providerId,
      model: ctx.model,
      effort: ctx.effort,
      instructions: input.instructions ?? null,
      status: 'queued',
    })
    .run();

  const controller = new AbortController();
  inFlight.set(projectId, { runId, controller });

  void execute(db, ctx, { id: runId, projectId }, input, controller.signal)
    .catch((err: unknown) => {
      const message = err instanceof Error ? err.message : 'The run failed unexpectedly.';
      finish(db, runId, 'failed', { error: message });
      emit(runId, { type: 'error', message, retryable: err instanceof ProviderError ? err.retryable : false });
    })
    .finally(() => {
      const entry = inFlight.get(projectId);
      if (entry?.runId === runId) inFlight.delete(projectId);
    });

  return { runId };
}

async function execute(
  db: Db,
  ctx: RunContext,
  run: RunRecord,
  input: RunCreate,
  signal: AbortSignal,
): Promise<void> {
  db.update(generationRuns)
    .set({ status: 'running', startedAt: Date.now() })
    .where(eq(generationRuns.id, run.id))
    .run();

  try {
    if (input.kind === 'outline') {
      await runOutline(db, ctx, run, input, signal);
    } else if (input.kind === 'update') {
      await runUpdate(db, ctx, run, input, signal);
    } else if (input.mode === 'draft') {
      await runWholeDraft(db, ctx, run, input, signal);
    } else if (input.mode === 'chapters') {
      await runChapters(db, ctx, run, input, signal);
    } else {
      await runScenes(db, ctx, run, input, signal);
    }
  } catch (err) {
    if (signal.aborted) {
      finish(db, run.id, 'cancelled');
      emit(run.id, { type: 'done', status: 'cancelled', stopReason: null });
      return;
    }
    throw err;
  }

  if (signal.aborted) {
    finish(db, run.id, 'cancelled');
    emit(run.id, { type: 'done', status: 'cancelled', stopReason: null });
  }
}

function recordUsage(db: Db, runId: string, usage: Usage, estimated: number, bibleHash: string, bible: string) {
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

function failRun(db: Db, runId: string, message: string, retryable: boolean) {
  finish(db, runId, 'failed', { error: message });
  emit(runId, { type: 'error', message, retryable });
}

// --- Mode (b)/(c) step 1: the outline ---------------------------------------

async function runOutline(db: Db, ctx: RunContext, run: RunRecord, input: RunCreate, signal: AbortSignal) {
  const targetWords = input.targetLengthWords ?? ctx.graph.storyParameters.targetLengthWords ?? null;
  const bible = prepareBible(ctx, {}, 8_000);
  const prompt = buildOutlinePrompt({
    mode: ctx.mode,
    targetWords,
    chapterCountHint: input.chapterCountHint ?? null,
    instructions: input.instructions ?? null,
  });

  emit(run.id, { type: 'status', message: 'Planning the chapter outline' });

  const result = await ctx.resolved.provider.generateStructured(
    {
      model: ctx.model,
      system: bible.systemPrompt,
      messages: [{ role: 'user', content: prompt }],
      schema: OutlineResult,
      schemaName: 'outline',
      effort: ctx.effort === 'max' ? 'high' : ctx.effort,
    },
    signal,
  );
  if (signal.aborted) return;

  const hash = hashBible(bible.markdown);
  recordUsage(db, run.id, result.usage, estimateTokens(bible.systemPrompt + prompt), hash, bible.markdown);

  // Keep the outline itself in version history so it can be compared later.
  saveVersion({
    db,
    projectId: ctx.projectId,
    targetType: 'outline',
    targetId: ctx.projectId,
    runId: run.id,
    content: JSON.stringify(result.data, null, 2),
    bibleHash: hash,
    makeCurrent: false,
  });

  emit(run.id, { type: 'outline', outline: result.data });
  finish(db, run.id, 'succeeded');
  emit(run.id, { type: 'done', status: 'succeeded', stopReason: 'end_turn' });
}

// --- Mode (a): the whole draft in one pass -----------------------------------

async function runWholeDraft(db: Db, ctx: RunContext, run: RunRecord, input: RunCreate, signal: AbortSignal) {
  const targetWords = input.targetLengthWords ?? ctx.graph.storyParameters.targetLengthWords ?? null;
  const reserve = Math.min(64_000, wordsToTokens(targetWords ?? 5000) + 2_000);
  const bible = prepareBible(ctx, {}, reserve);
  const hash = hashBible(bible.markdown);

  const prompt = buildDraftPrompt({
    targetWords,
    chapterCountHint: input.chapterCountHint ?? null,
    instructions: input.instructions ?? null,
  });

  emit(run.id, {
    type: 'target_started',
    targetType: 'draft',
    targetId: ctx.projectId,
    label: ctx.graph.project.title,
  });

  const messages: Array<{ role: 'user' | 'assistant'; content: string }> = [{ role: 'user', content: prompt }];
  let full = '';
  let usage: Usage = { inputTokens: 0, outputTokens: 0, cacheReadTokens: 0 };
  let stopReason: StopReason = 'other';

  // A long book will not fit in one response; continue until it ends naturally.
  for (let attempt = 0; attempt <= MAX_CONTINUATIONS; attempt += 1) {
    const outcome = await streamOnce(
      ctx,
      run.id,
      ctx.projectId,
      bible.systemPrompt,
      messages,
      64_000,
      ctx.effort,
      signal,
    );
    if (signal.aborted) return;
    if (outcome.error) {
      failRun(db, run.id, outcome.error.message, outcome.error.retryable);
      return;
    }

    full += outcome.text;
    usage = accumulate(usage, outcome.usage);
    stopReason = outcome.stopReason;

    if (outcome.stopReason !== 'max_tokens' || attempt === MAX_CONTINUATIONS) break;

    emit(run.id, { type: 'status', message: `Hit the response limit; continuing (${attempt + 1}/${MAX_CONTINUATIONS})` });
    messages.push({ role: 'assistant', content: outcome.text });
    messages.push({ role: 'user', content: buildContinuationPrompt() });
  }

  if (!full.trim()) {
    failRun(db, run.id, 'The model returned no text.', true);
    return;
  }

  const version = saveVersion({
    db,
    projectId: ctx.projectId,
    targetType: 'draft',
    targetId: ctx.projectId,
    runId: run.id,
    content: full,
    bibleHash: hash,
    stopReason,
    refs: bible.refs,
    makeCurrent: false,
  });

  recordUsage(db, run.id, usage, estimateTokens(bible.systemPrompt + prompt), hash, bible.markdown);
  emit(run.id, {
    type: 'target_done',
    targetType: 'draft',
    targetId: ctx.projectId,
    versionId: version.id,
    wordCount: version.wordCount,
  });
  finish(db, run.id, 'succeeded');
  emit(run.id, { type: 'done', status: 'succeeded', stopReason });
}

// --- Mode (b): chapter by chapter --------------------------------------------

/** Chapters to write: an explicit selection, else everything unwritten or stale. */
function selectChapters(ctx: RunContext, targetIds: string[] | undefined) {
  const all = ctx.chapters;
  if (targetIds?.length) {
    const wanted = new Set(targetIds);
    return all.filter((c) => wanted.has(c.id));
  }
  const needing = all.filter((c) => !c.currentVersionId || c.staleLevel === 'hard');
  return needing.length > 0 ? needing : all;
}

async function summariseForContinuity(
  ctx: RunContext,
  label: string,
  text: string,
  signal: AbortSignal,
): Promise<string | null> {
  try {
    const result = await ctx.resolved.provider.generateStructured(
      {
        model: ctx.model,
        system: 'You summarise draft chapters for continuity. Be concise and factual.',
        messages: [{ role: 'user', content: buildSummaryPrompt(label, text) }],
        schema: ChapterSummaryResult,
        schemaName: 'chapter_summary',
        effort: 'low',
        maxTokens: 2_000,
      },
      signal,
    );
    const threads = result.data.openThreads.length ? ` Open threads: ${result.data.openThreads.join('; ')}` : '';
    return `${result.data.summary}${threads}`;
  } catch {
    // Continuity summaries are a nice-to-have; never fail a run over one.
    return null;
  }
}

async function runChapters(db: Db, ctx: RunContext, run: RunRecord, input: RunCreate, signal: AbortSignal) {
  const selected = selectChapters(ctx, input.targetIds);
  if (selected.length === 0) {
    failRun(db, run.id, 'There are no chapters to write yet. Generate an outline first.', false);
    return;
  }

  const ordered = [...ctx.chapters];
  let usage: Usage = { inputTokens: 0, outputTokens: 0, cacheReadTokens: 0 };
  let lastHash = '';
  let lastBible = '';
  let estimated = 0;

  // Continuity: summaries of prior chapters, built as we go.
  const summaries = new Map<string, string>();
  for (const chapter of ordered) {
    if (chapter.summary?.trim()) summaries.set(chapter.id, chapter.summary.trim());
  }

  for (const chapter of selected) {
    if (signal.aborted) return;

    const index = ordered.findIndex((c) => c.id === chapter.id);
    const focus = mergeFocus(focusFromPlotPoints(ctx.graph, chapter.plotPointIds));
    const targetWords = estimateChapterWords(ctx, ordered.length);
    const bible = prepareBible(ctx, focus, wordsToTokens(targetWords) + 2_000);
    lastHash = hashBible(bible.markdown);
    lastBible = bible.markdown;

    const priorSummaries = ordered
      .slice(0, Math.max(0, index))
      .map((prior) => ({ title: prior.title, summary: summaries.get(prior.id) ?? '' }))
      .filter((entry) => entry.summary.length > 0);

    const previous = index > 0 ? ordered[index - 1] : undefined;
    const previousTail = previous ? tailOf(currentText(db, 'chapter', previous.id), PREVIOUS_TAIL_CHARS) : null;

    const prompt = buildChapterPrompt({
      chapter,
      index,
      total: ordered.length,
      targetWords,
      plotPointTitles: plotPointTitles(ctx.graph, chapter.plotPointIds),
      priorSummaries,
      previousTail,
      instructions: input.instructions ?? null,
    });
    estimated = estimateTokens(bible.systemPrompt + prompt);

    emit(run.id, { type: 'target_started', targetType: 'chapter', targetId: chapter.id, label: chapter.title });

    const outcome = await streamOnce(
      ctx,
      run.id,
      chapter.id,
      bible.systemPrompt,
      [{ role: 'user', content: prompt }],
      Math.min(32_000, wordsToTokens(targetWords) + 4_000),
      ctx.effort,
      signal,
    );
    if (signal.aborted) return;
    if (outcome.error) {
      failRun(db, run.id, `${chapter.title}: ${outcome.error.message}`, outcome.error.retryable);
      return;
    }
    if (!outcome.text.trim()) {
      failRun(db, run.id, `The model returned no text for ${chapter.title}.`, true);
      return;
    }

    usage = accumulate(usage, outcome.usage);
    const version = saveVersion({
      db,
      projectId: ctx.projectId,
      targetType: 'chapter',
      targetId: chapter.id,
      runId: run.id,
      content: outcome.text,
      bibleHash: lastHash,
      stopReason: outcome.stopReason,
      refs: bible.refs,
    });

    emit(run.id, {
      type: 'target_done',
      targetType: 'chapter',
      targetId: chapter.id,
      versionId: version.id,
      wordCount: version.wordCount,
    });

    const summary = await summariseForContinuity(ctx, `chapter ${index + 1}, "${chapter.title}"`, outcome.text, signal);
    if (summary) {
      summaries.set(chapter.id, summary);
      // Only fill an empty summary; never overwrite what the author wrote.
      if (!chapter.summary?.trim()) {
        db.update(chapters).set({ summary, updatedAt: Date.now() }).where(eq(chapters.id, chapter.id)).run();
      }
    }
  }

  recordUsage(db, run.id, usage, estimated, lastHash, lastBible);
  finish(db, run.id, 'succeeded');
  emit(run.id, { type: 'done', status: 'succeeded', stopReason: 'end_turn' });
}

function estimateChapterWords(ctx: RunContext, chapterCount: number): number {
  const total = ctx.graph.storyParameters.targetLengthWords;
  if (!total || chapterCount === 0) return 2500;
  return Math.max(500, Math.round(total / chapterCount));
}

// --- Mode (c): scene by scene ------------------------------------------------

async function runScenes(db: Db, ctx: RunContext, run: RunRecord, input: RunCreate, signal: AbortSignal) {
  const allScenes = ctx.scenes;
  if (allScenes.length === 0) {
    failRun(db, run.id, 'There are no scenes yet. Generate a scene outline first.', false);
    return;
  }

  const selected = (() => {
    if (input.targetIds?.length) {
      const wanted = new Set(input.targetIds);
      return allScenes.filter((s) => wanted.has(s.id));
    }
    const needing = allScenes.filter((s) => !s.currentVersionId || s.staleLevel === 'hard');
    return needing.length > 0 ? needing : allScenes;
  })();

  if (selected.length === 0) {
    failRun(db, run.id, 'None of the selected scenes exist in this project.', false);
    return;
  }

  const chapterById = new Map(ctx.chapters.map((c) => [c.id, c]));
  const characterNames = new Map(ctx.graph.characters.map((c) => [c.id, c.name]));
  const locationNames = new Map(ctx.graph.locations.map((l) => [l.id, l.name]));

  let usage: Usage = { inputTokens: 0, outputTokens: 0, cacheReadTokens: 0 };
  let lastHash = '';
  let lastBible = '';
  let estimated = 0;

  for (const scene of selected) {
    if (signal.aborted) return;

    const chapter = chapterById.get(scene.chapterId);
    if (!chapter) continue;

    const siblings = allScenes.filter((s) => s.chapterId === scene.chapterId);
    const index = siblings.findIndex((s) => s.id === scene.id);
    const previous = index > 0 ? siblings[index - 1] : undefined;
    const next = siblings[index + 1];

    const focus = mergeFocus(focusFromPlotPoints(ctx.graph, scene.plotPointIds), {
      characterIds: scene.povCharacterId ? [scene.povCharacterId] : [],
      locationIds: scene.locationId ? [scene.locationId] : [],
    });

    const targetWords = estimateSceneWords(ctx, allScenes.length);
    const bible = prepareBible(ctx, focus, wordsToTokens(targetWords) + 2_000);
    lastHash = hashBible(bible.markdown);
    lastBible = bible.markdown;

    const prompt = buildScenePrompt({
      scene,
      chapter,
      index,
      total: siblings.length,
      targetWords,
      povName: scene.povCharacterId ? (characterNames.get(scene.povCharacterId) ?? null) : null,
      locationName: scene.locationId ? (locationNames.get(scene.locationId) ?? null) : null,
      plotPointTitles: plotPointTitles(ctx.graph, scene.plotPointIds),
      previousTail: previous ? tailOf(currentText(db, 'scene', previous.id), PREVIOUS_SCENE_TAIL_CHARS) : null,
      nextGoal: next?.goal ?? null,
      instructions: input.instructions ?? null,
    });
    estimated = estimateTokens(bible.systemPrompt + prompt);

    emit(run.id, {
      type: 'target_started',
      targetType: 'scene',
      targetId: scene.id,
      label: `${chapter.title} — ${scene.title}`,
    });

    const outcome = await streamOnce(
      ctx,
      run.id,
      scene.id,
      bible.systemPrompt,
      [{ role: 'user', content: prompt }],
      Math.min(16_000, wordsToTokens(targetWords) + 3_000),
      ctx.effort,
      signal,
    );
    if (signal.aborted) return;
    if (outcome.error) {
      failRun(db, run.id, `${scene.title}: ${outcome.error.message}`, outcome.error.retryable);
      return;
    }
    if (!outcome.text.trim()) {
      failRun(db, run.id, `The model returned no text for ${scene.title}.`, true);
      return;
    }

    usage = accumulate(usage, outcome.usage);
    const version = saveVersion({
      db,
      projectId: ctx.projectId,
      targetType: 'scene',
      targetId: scene.id,
      runId: run.id,
      content: outcome.text,
      bibleHash: lastHash,
      stopReason: outcome.stopReason,
      refs: bible.refs,
    });

    emit(run.id, {
      type: 'target_done',
      targetType: 'scene',
      targetId: scene.id,
      versionId: version.id,
      wordCount: version.wordCount,
    });
  }

  recordUsage(db, run.id, usage, estimated, lastHash, lastBible);
  finish(db, run.id, 'succeeded');
  emit(run.id, { type: 'done', status: 'succeeded', stopReason: 'end_turn' });
}

function estimateSceneWords(ctx: RunContext, sceneCount: number): number {
  const total = ctx.graph.storyParameters.targetLengthWords;
  if (!total || sceneCount === 0) return 900;
  return Math.max(300, Math.round(total / sceneCount));
}

// --- Revision: update an existing piece with instructions ---------------------

async function runUpdate(db: Db, ctx: RunContext, run: RunRecord, input: RunCreate, signal: AbortSignal) {
  const targetType = input.targetType as VersionTargetType;
  const targetId = input.targetId!;
  const instructions = input.instructions!;

  const label = resolveTargetLabel(db, ctx, targetType, targetId);
  const priorText = currentText(db, targetType, targetId);
  if (!priorText.trim()) {
    failRun(db, run.id, `${label} has no text yet, so there is nothing to revise. Generate it first.`, false);
    return;
  }

  const focus = focusFor(ctx, targetType, targetId);
  const reserve = Math.min(32_000, estimateTokens(priorText) + 4_000);
  const bible = prepareBible(ctx, focus, reserve);
  const hash = hashBible(bible.markdown);

  const prompt = buildUpdatePrompt({ label, priorText, instructions });

  emit(run.id, { type: 'target_started', targetType, targetId, label });

  const outcome = await streamOnce(
    ctx,
    run.id,
    targetId,
    bible.systemPrompt,
    [{ role: 'user', content: prompt }],
    Math.min(32_000, estimateTokens(priorText) * 2 + 4_000),
    ctx.effort,
    signal,
  );
  if (signal.aborted) return;
  if (outcome.error) {
    failRun(db, run.id, outcome.error.message, outcome.error.retryable);
    return;
  }
  if (!outcome.text.trim()) {
    failRun(db, run.id, 'The model returned no revised text.', true);
    return;
  }

  const version = saveVersion({
    db,
    projectId: ctx.projectId,
    targetType,
    targetId,
    runId: run.id,
    content: outcome.text,
    instructions,
    bibleHash: hash,
    stopReason: outcome.stopReason,
    refs: bible.refs,
    makeCurrent: targetType === 'chapter' || targetType === 'scene',
  });

  recordUsage(db, run.id, outcome.usage, estimateTokens(bible.systemPrompt + prompt), hash, bible.markdown);
  emit(run.id, {
    type: 'target_done',
    targetType,
    targetId,
    versionId: version.id,
    wordCount: version.wordCount,
  });
  finish(db, run.id, 'succeeded');
  emit(run.id, { type: 'done', status: 'succeeded', stopReason: outcome.stopReason });
}

function resolveTargetLabel(db: Db, ctx: RunContext, targetType: VersionTargetType, targetId: string): string {
  if (targetType === 'chapter') {
    const chapter = ctx.chapters.find((c) => c.id === targetId);
    if (!chapter) throw notFound('Chapter');
    return `chapter "${chapter.title}"`;
  }
  if (targetType === 'scene') {
    const scene = ctx.scenes.find((s) => s.id === targetId);
    if (!scene) throw notFound('Scene');
    return `scene "${scene.title}"`;
  }
  if (targetType === 'draft') return `the draft of "${ctx.graph.project.title}"`;
  throw badRequest('An outline cannot be revised with instructions. Regenerate it instead.');
}

function focusFor(ctx: RunContext, targetType: VersionTargetType, targetId: string): Focus {
  if (targetType === 'chapter') {
    const chapter = ctx.chapters.find((c) => c.id === targetId);
    return chapter ? focusFromPlotPoints(ctx.graph, chapter.plotPointIds) : {};
  }
  if (targetType === 'scene') {
    const scene = ctx.scenes.find((s) => s.id === targetId);
    if (!scene) return {};
    return mergeFocus(focusFromPlotPoints(ctx.graph, scene.plotPointIds), {
      characterIds: scene.povCharacterId ? [scene.povCharacterId] : [],
      locationIds: scene.locationId ? [scene.locationId] : [],
    });
  }
  return {};
}

export { materializeOutline };
export type { TrimReport, EntityRef };
