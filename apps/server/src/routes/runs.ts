import { desc, eq } from 'drizzle-orm';
import type { FastifyInstance, FastifyReply } from 'fastify';
import {
  OutlineResult,
  RunCreate,
  type RunDetail,
  type RunEvent,
  type RunPreview,
} from '@storytime/shared';
import type { Db } from '../db/client.js';
import { generationRuns } from '../db/schema.js';
import {
  buildChapterPrompt,
  buildDraftPrompt,
  buildOutlinePrompt,
  buildScenePrompt,
  buildUpdatePrompt,
} from '../bible/prompts.js';
import { budgetExceeded } from '../bible/budget.js';
import { wordsToTokens } from '../llm/tokens.js';
import { badRequest, notFound } from '../services/entities.js';
import { currentText } from '../services/manuscript.js';
import {
  buildRunContext,
  focusFromPlotPoints,
  mergeFocus,
  plotPointTitles,
  prepareBible,
} from '../generation/context.js';
import { isFinished, replay, subscribe } from '../generation/events.js';
import { materializeOutline, splitDraftIntoChapters } from '../generation/outline.js';
import { cancelRun, startRun } from '../generation/runner.js';
import { readProject } from './projects.js';

function readRun(db: Db, id: string) {
  const row = db.select().from(generationRuns).where(eq(generationRuns.id, id)).get();
  if (!row) throw notFound('Run');
  return row;
}

/**
 * Assemble the exact prompts a run would send, without calling a model, so the
 * user can see the token cost and what got trimmed before spending anything.
 */
function buildPreview(db: Db, projectId: string, input: RunCreate): RunPreview {
  const ctx = buildRunContext(db, projectId, input);
  const warnings: string[] = [];

  const params = ctx.graph.storyParameters;
  if (!params.pov?.trim()) warnings.push('No point of view is set, so the model will pick one.');
  if (!params.audience?.trim()) warnings.push('No intended audience is set.');
  if (ctx.graph.characters.length === 0) warnings.push('This project has no characters yet.');

  const describedless = ctx.graph.characters.filter((c) => !c.description?.trim()).map((c) => c.name);
  if (describedless.length > 0) {
    warnings.push(`No description yet for: ${describedless.slice(0, 5).join(', ')}.`);
  }
  const looseCount = ctx.graph.plotLines.flatMap((l) => l.points).filter((p) => p.status === 'idea').length;
  if (looseCount > 0) {
    warnings.push(`${looseCount} plot point(s) are still marked as loose ideas and may be skipped or trimmed.`);
  }

  const targetWords = input.targetLengthWords ?? params.targetLengthWords ?? null;

  let taskPrompt = '';
  let focus = {};
  let targetLabels: string[] = [];
  let reserve = 8_000;

  if (input.kind === 'outline') {
    taskPrompt = buildOutlinePrompt({
      mode: input.mode,
      targetWords,
      chapterCountHint: input.chapterCountHint ?? null,
      instructions: input.instructions ?? null,
    });
    targetLabels = ['Chapter outline'];
  } else if (input.kind === 'update') {
    if (!input.targetType || !input.targetId) throw badRequest('An update needs a target.');
    const prior = currentText(db, input.targetType, input.targetId);
    if (!prior.trim()) throw badRequest('That target has no text yet, so there is nothing to revise.');
    const label =
      input.targetType === 'chapter'
        ? (ctx.chapters.find((c) => c.id === input.targetId)?.title ?? 'chapter')
        : input.targetType === 'scene'
          ? (ctx.scenes.find((s) => s.id === input.targetId)?.title ?? 'scene')
          : ctx.graph.project.title;
    taskPrompt = buildUpdatePrompt({ label, priorText: prior, instructions: input.instructions ?? '' });
    targetLabels = [label];
    reserve = 16_000;
  } else if (input.mode === 'draft') {
    taskPrompt = buildDraftPrompt({
      targetWords,
      chapterCountHint: input.chapterCountHint ?? null,
      instructions: input.instructions ?? null,
    });
    targetLabels = [ctx.graph.project.title];
    reserve = Math.min(64_000, wordsToTokens(targetWords ?? 5000) + 2_000);
  } else if (input.mode === 'chapters') {
    const wanted = new Set(input.targetIds ?? []);
    const selected = wanted.size
      ? ctx.chapters.filter((c) => wanted.has(c.id))
      : ctx.chapters.filter((c) => !c.currentVersionId || c.staleLevel === 'hard');
    const chapters = selected.length ? selected : ctx.chapters;
    if (chapters.length === 0) {
      warnings.push('There are no chapters yet. Run the outline step first.');
      taskPrompt = '(no chapters to write)';
    } else {
      const first = chapters[0]!;
      focus = focusFromPlotPoints(ctx.graph, first.plotPointIds);
      taskPrompt = buildChapterPrompt({
        chapter: first,
        index: ctx.chapters.findIndex((c) => c.id === first.id),
        total: ctx.chapters.length,
        targetWords: params.targetLengthWords ? Math.round(params.targetLengthWords / ctx.chapters.length) : null,
        plotPointTitles: plotPointTitles(ctx.graph, first.plotPointIds),
        priorSummaries: [],
        previousTail: null,
        instructions: input.instructions ?? null,
      });
    }
    targetLabels = chapters.map((c) => c.title);
    reserve = 32_000;
  } else {
    const wanted = new Set(input.targetIds ?? []);
    const selected = wanted.size
      ? ctx.scenes.filter((s) => wanted.has(s.id))
      : ctx.scenes.filter((s) => !s.currentVersionId || s.staleLevel === 'hard');
    const sceneList = selected.length ? selected : ctx.scenes;
    if (sceneList.length === 0) {
      warnings.push('There are no scenes yet. Run the outline step in scene mode first.');
      taskPrompt = '(no scenes to write)';
    } else {
      const first = sceneList[0]!;
      const chapter = ctx.chapters.find((c) => c.id === first.chapterId);
      focus = mergeFocus(focusFromPlotPoints(ctx.graph, first.plotPointIds), {
        characterIds: first.povCharacterId ? [first.povCharacterId] : [],
        locationIds: first.locationId ? [first.locationId] : [],
      });
      taskPrompt = chapter
        ? buildScenePrompt({
            scene: first,
            chapter,
            index: 0,
            total: sceneList.length,
            targetWords: null,
            povName: null,
            locationName: null,
            plotPointTitles: plotPointTitles(ctx.graph, first.plotPointIds),
            previousTail: null,
            nextGoal: null,
            instructions: input.instructions ?? null,
          })
        : '(scene has no chapter)';
    }
    targetLabels = sceneList.map((s) => s.title);
    reserve = 16_000;
  }

  const bible = prepareBible(ctx, focus, reserve);
  if (budgetExceeded(bible.trim)) {
    warnings.push('The story bible does not fit the token budget even at its smallest size. This run will fail.');
  }

  return {
    mode: input.mode,
    kind: input.kind,
    provider: ctx.providerId,
    model: ctx.model,
    effort: ctx.effort,
    targetCount: targetLabels.length,
    targetLabels: targetLabels.slice(0, 50),
    systemPrompt: bible.systemPrompt,
    taskPrompt,
    trim: bible.trim,
    warnings,
  };
}

function sseWrite(reply: FastifyReply, event: RunEvent) {
  reply.raw.write(`id: ${event.seq}\nevent: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`);
}

export async function runRoutes(app: FastifyInstance) {
  const db = app.db;

  app.get('/projects/:projectId/runs', async (request) => {
    const { projectId } = request.params as { projectId: string };
    readProject(db, projectId);
    return db
      .select()
      .from(generationRuns)
      .where(eq(generationRuns.projectId, projectId))
      .orderBy(desc(generationRuns.createdAt))
      .limit(100)
      .all()
      .map(({ bibleMarkdown: _omitted, ...run }) => run);
  });

  app.get('/runs/:id', async (request) => {
    const { id } = request.params as { id: string };
    // Includes the bible snapshot so the UI can show exactly what was sent.
    return readRun(db, id) as unknown as RunDetail;
  });

  /** Dry run: assemble the prompts and report cost without calling a model. */
  app.post('/projects/:projectId/runs/preview', async (request) => {
    const { projectId } = request.params as { projectId: string };
    const body = RunCreate.parse(request.body);
    readProject(db, projectId);
    return buildPreview(db, projectId, body);
  });

  app.post('/projects/:projectId/runs', async (request, reply) => {
    const { projectId } = request.params as { projectId: string };
    const body = RunCreate.parse(request.body);
    readProject(db, projectId);
    const { runId } = startRun(db, projectId, body);
    return reply.status(202).send({ runId, streamUrl: `/api/runs/${runId}/events` });
  });

  app.post('/runs/:id/cancel', async (request) => {
    const { id } = request.params as { id: string };
    const run = readRun(db, id);
    const cancelled = cancelRun(id);
    return { cancelled, status: cancelled ? 'cancelling' : run.status };
  });

  /**
   * Server-sent events for a run. Replays everything already buffered first, so
   * opening the page late or reconnecting shows the full stream.
   */
  app.get('/runs/:id/events', async (request, reply) => {
    const { id } = request.params as { id: string };
    readRun(db, id);

    const lastEventId = Number(request.headers['last-event-id'] ?? (request.query as { lastEventId?: string }).lastEventId ?? 0);
    const afterSeq = Number.isFinite(lastEventId) ? lastEventId : 0;

    reply.raw.writeHead(200, {
      'content-type': 'text/event-stream',
      'cache-control': 'no-cache, no-transform',
      connection: 'keep-alive',
      'x-accel-buffering': 'no',
    });

    for (const event of replay(id, afterSeq)) sseWrite(reply, event);

    if (isFinished(id)) {
      reply.raw.end();
      return reply;
    }

    const unsubscribe = subscribe(id, (event) => {
      sseWrite(reply, event);
      if (event.type === 'done' || event.type === 'error') {
        clearInterval(heartbeat);
        unsubscribe();
        reply.raw.end();
      }
    });

    // Comment frames keep proxies and browsers from closing an idle stream.
    const heartbeat = setInterval(() => reply.raw.write(': keep-alive\n\n'), 15_000);

    request.raw.on('close', () => {
      clearInterval(heartbeat);
      unsubscribe();
    });

    return reply;
  });

  /** Accept an outline (as generated, or after the user edited it). */
  app.put('/projects/:projectId/outline', async (request) => {
    const { projectId } = request.params as { projectId: string };
    const body = OutlineResult.parse(request.body);
    readProject(db, projectId);
    return materializeOutline(db, projectId, body);
  });

  /** Break a whole-draft result into editable chapters. */
  app.post('/projects/:projectId/draft/split', async (request) => {
    const { projectId } = request.params as { projectId: string };
    readProject(db, projectId);
    const draft = currentText(db, 'draft', projectId);
    if (!draft.trim()) throw badRequest('There is no whole draft to split yet.');
    const result = splitDraftIntoChapters(db, projectId, draft);
    if (result.created === 0) {
      throw badRequest('No "## Chapter N: Title" headings were found in the draft, so it could not be split.');
    }
    return result;
  });
}
