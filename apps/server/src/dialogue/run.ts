import type { RunCreate, VersionTargetType } from '@storytime/shared';
import type { Db } from '../db/client.js';
import { emit } from '../generation/events.js';
import type { RunContext } from '../generation/context.js';
import { accumulate, failRun, finish, recordUsage, type RunRecord } from '../generation/steps.js';
import { emptyUsage, type Usage } from '../llm/types.js';
import { readVersion } from '../services/manuscript.js';
import { attributeVersion } from './attribute.js';
import { attributableVersions } from './targets.js';

function attributionContext(ctx: RunContext) {
  return {
    provider: ctx.resolved.provider,
    model: ctx.model,
    characters: ctx.graph.characters,
    storyParameters: ctx.graph.storyParameters,
  };
}

/**
 * Give a freshly written version its dialogue voices. This is a convenience on
 * top of the writing, so a failure is reported as a status line and never fails
 * the run that produced the text.
 */
export async function attributeWritten(
  db: Db,
  ctx: RunContext,
  run: RunRecord,
  version: { id: string; targetType: VersionTargetType; targetId: string },
  signal: AbortSignal,
): Promise<Usage> {
  if (ctx.graph.characters.length === 0 || version.targetType === 'outline') return emptyUsage();
  emit(run.id, { type: 'status', message: 'Assigning dialogue voices' });
  try {
    const povCharacterId =
      version.targetType === 'scene' ? (ctx.scenes.find((s) => s.id === version.targetId)?.povCharacterId ?? null) : null;
    const outcome = await attributeVersion({
      db,
      ctx: attributionContext(ctx),
      projectId: ctx.projectId,
      versionId: version.id,
      signal,
      povCharacterId,
      force: true,
    });
    return outcome.usage;
  } catch (err) {
    if (!signal.aborted) {
      const reason = err instanceof Error ? err.message : 'unknown error';
      emit(run.id, { type: 'status', message: `Could not assign dialogue voices (${reason}). You can do it later from the manuscript.` });
    }
    return emptyUsage();
  }
}

/** Kind "attribute": add dialogue voices to text that is already written. */
export async function runAttribute(db: Db, ctx: RunContext, run: RunRecord, input: RunCreate, signal: AbortSignal) {
  if (ctx.graph.characters.length === 0) {
    failRun(db, run.id, 'This book has no characters yet, so there is nobody to assign voices to.', false);
    return;
  }

  const jobs = attributableVersions(db, ctx.chapters, ctx.scenes, input.targetIds);
  if (jobs.length === 0) {
    failRun(db, run.id, 'There is no written text to assign voices to yet.', false);
    return;
  }

  let usage = emptyUsage();
  for (const job of jobs) {
    if (signal.aborted) return;
    emit(run.id, { type: 'target_started', targetType: job.targetType, targetId: job.targetId, label: job.label });

    let outcome;
    try {
      outcome = await attributeVersion({
        db,
        ctx: attributionContext(ctx),
        projectId: ctx.projectId,
        versionId: job.versionId,
        signal,
        povCharacterId: job.povCharacterId,
        force: input.reattribute === true,
      });
    } catch (err) {
      if (signal.aborted) return;
      failRun(db, run.id, `${job.label}: ${err instanceof Error ? err.message : 'could not assign voices.'}`, true);
      return;
    }
    usage = accumulate(usage, outcome.usage);

    emit(run.id, {
      type: 'target_done',
      targetType: job.targetType,
      targetId: job.targetId,
      versionId: job.versionId,
      wordCount: readVersion(db, job.versionId).wordCount,
    });
  }

  recordUsage(db, run.id, usage, 0, '', '');
  finish(db, run.id, 'succeeded');
  emit(run.id, { type: 'done', status: 'succeeded', stopReason: 'end_turn' });
}
