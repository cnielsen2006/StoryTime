import { and, eq, inArray, isNotNull, lt, or, sql } from 'drizzle-orm';
import { STALE_RANK, type StaleLevel, type StaleReason } from '@storytime/shared';
import type { Db } from '../db/client.js';
import {
  chapters,
  characters,
  generatedVersions,
  locations,
  plotLines,
  plotPoints,
  projects,
  scenes,
  storyParameters,
  versionEntityRefs,
} from '../db/schema.js';

export interface MarkStaleInput {
  db: Db;
  projectId: string;
  entityType: string;
  entityId: string;
  label: string;
  changedFields: string[];
}

function parseReasons(raw: string): StaleReason[] {
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? (parsed as StaleReason[]) : [];
  } catch {
    return [];
  }
}

function worst(a: StaleLevel, b: StaleLevel): StaleLevel {
  return STALE_RANK[a] >= STALE_RANK[b] ? a : b;
}

/** Cap the reason list so a long editing session cannot bloat the row. */
function appendReason(existing: StaleReason[], reason: StaleReason): StaleReason[] {
  const deduped = existing.filter((r) => !(r.entityType === reason.entityType && r.entityId === reason.entityId));
  return [...deduped, reason].slice(-20);
}

interface Target {
  kind: 'chapter' | 'scene';
  id: string;
  currentVersionId: string | null;
  staleLevel: StaleLevel;
  staleReasons: string;
}

function loadTargets(db: Db, projectId: string): Target[] {
  const chapterRows = db
    .select({
      id: chapters.id,
      currentVersionId: chapters.currentVersionId,
      staleLevel: chapters.staleLevel,
      staleReasons: chapters.staleReasons,
    })
    .from(chapters)
    .where(and(eq(chapters.projectId, projectId), isNotNull(chapters.currentVersionId)))
    .all();

  const sceneRows = db
    .select({
      id: scenes.id,
      currentVersionId: scenes.currentVersionId,
      staleLevel: scenes.staleLevel,
      staleReasons: scenes.staleReasons,
    })
    .from(scenes)
    .where(and(eq(scenes.projectId, projectId), isNotNull(scenes.currentVersionId)))
    .all();

  return [
    ...chapterRows.map((r) => ({ kind: 'chapter' as const, ...r, staleLevel: r.staleLevel as StaleLevel })),
    ...sceneRows.map((r) => ({ kind: 'scene' as const, ...r, staleLevel: r.staleLevel as StaleLevel })),
  ];
}

function applyStale(db: Db, target: Target, level: StaleLevel, reason: StaleReason) {
  const next = worst(target.staleLevel, level);
  const reasons = JSON.stringify(appendReason(parseReasons(target.staleReasons), reason));
  const table = target.kind === 'chapter' ? chapters : scenes;
  db.update(table)
    .set({ staleLevel: next, staleReasons: reasons, updatedAt: Date.now() })
    .where(eq(table.id, target.id))
    .run();
}

/**
 * After an entity changes, mark every chapter and scene whose *current* text was
 * generated from an older revision of that entity.
 *
 * A target is `hard` stale when the entity was in focus for that generation (the
 * chapter was written about it) and `soft` when it was only background context.
 * Severity never goes down; only regenerating or an explicit review clears it.
 */
export function markStale(input: MarkStaleInput): number {
  const { db, projectId, entityType, entityId, label, changedFields } = input;
  const targets = loadTargets(db, projectId);
  if (targets.length === 0) return 0;

  const versionIds = targets.map((t) => t.currentVersionId!).filter(Boolean);
  if (versionIds.length === 0) return 0;

  const refs = db
    .select()
    .from(versionEntityRefs)
    .where(
      and(
        inArray(versionEntityRefs.versionId, versionIds),
        eq(versionEntityRefs.entityType, entityType),
        eq(versionEntityRefs.entityId, entityId),
      ),
    )
    .all();
  if (refs.length === 0) return 0;

  // The row already carries its new revision number by the time we get here.
  const currentRevision = readCurrentRevision(db, entityType, entityId);
  const reason: StaleReason = {
    entityType,
    entityId,
    label,
    field: changedFields.slice(0, 3).join(', ') || null,
    at: Date.now(),
  };

  const byVersion = new Map(refs.map((r) => [r.versionId, r]));
  let touched = 0;
  for (const target of targets) {
    const ref = target.currentVersionId ? byVersion.get(target.currentVersionId) : undefined;
    if (!ref) continue;
    if (currentRevision !== null && ref.entityRevision >= currentRevision) continue;
    applyStale(db, target, ref.focus === 1 ? 'hard' : 'soft', reason);
    touched += 1;
  }
  return touched;
}

/**
 * Typed table lookup per entity type. Never build this as a raw SQL string:
 * entity ids come from request bodies.
 */
function readCurrentRevision(db: Db, entityType: string, entityId: string): number | null {
  switch (entityType) {
    case 'character':
      return db.select({ r: characters.revision }).from(characters).where(eq(characters.id, entityId)).get()?.r ?? null;
    case 'location':
      return db.select({ r: locations.revision }).from(locations).where(eq(locations.id, entityId)).get()?.r ?? null;
    case 'plot_line':
      return db.select({ r: plotLines.revision }).from(plotLines).where(eq(plotLines.id, entityId)).get()?.r ?? null;
    case 'plot_point':
      return db.select({ r: plotPoints.revision }).from(plotPoints).where(eq(plotPoints.id, entityId)).get()?.r ?? null;
    case 'story_parameters':
      return (
        db.select({ r: storyParameters.revision }).from(storyParameters).where(eq(storyParameters.id, entityId)).get()
          ?.r ?? null
      );
    case 'chapter':
      return db.select({ r: chapters.revision }).from(chapters).where(eq(chapters.id, entityId)).get()?.r ?? null;
    case 'scene':
      return db.select({ r: scenes.revision }).from(scenes).where(eq(scenes.id, entityId)).get()?.r ?? null;
    default:
      return null;
  }
}

/**
 * Story parameters govern every word in the book, so a change there makes the
 * whole manuscript hard stale regardless of what any prompt referenced.
 */
export function markProjectStale(db: Db, projectId: string, label: string, changedFields: string[]): number {
  const targets = loadTargets(db, projectId);
  const reason: StaleReason = {
    entityType: 'story_parameters',
    entityId: projectId,
    label,
    field: changedFields.slice(0, 3).join(', ') || null,
    at: Date.now(),
  };
  for (const target of targets) applyStale(db, target, 'hard', reason);
  return targets.length;
}

/** Clear staleness without regenerating: the user has read it and is happy. */
export function markReviewed(db: Db, kind: 'chapter' | 'scene', id: string) {
  const table = kind === 'chapter' ? chapters : scenes;
  db.update(table)
    .set({ staleLevel: 'none', staleReasons: '[]', updatedAt: Date.now() })
    .where(eq(table.id, id))
    .run();
}

export function countStaleTargets(db: Db, projectId: string): number {
  const rows = db
    .select({ n: sql<number>`count(*)` })
    .from(chapters)
    .where(and(eq(chapters.projectId, projectId), or(eq(chapters.staleLevel, 'soft'), eq(chapters.staleLevel, 'hard'))))
    .all();
  const sceneRows = db
    .select({ n: sql<number>`count(*)` })
    .from(scenes)
    .where(and(eq(scenes.projectId, projectId), or(eq(scenes.staleLevel, 'soft'), eq(scenes.staleLevel, 'hard'))))
    .all();
  return (rows[0]?.n ?? 0) + (sceneRows[0]?.n ?? 0);
}

/** Versions whose bible snapshot predates the entity's current revision. */
export function staleVersionIds(db: Db, entityType: string, entityId: string, revision: number): string[] {
  return db
    .select({ id: versionEntityRefs.versionId })
    .from(versionEntityRefs)
    .where(
      and(
        eq(versionEntityRefs.entityType, entityType),
        eq(versionEntityRefs.entityId, entityId),
        lt(versionEntityRefs.entityRevision, revision),
      ),
    )
    .all()
    .map((r) => r.id);
}

export function projectExists(db: Db, projectId: string): boolean {
  return db.select({ id: projects.id }).from(projects).where(eq(projects.id, projectId)).get() !== undefined;
}

export function versionExists(db: Db, versionId: string): boolean {
  return (
    db.select({ id: generatedVersions.id }).from(generatedVersions).where(eq(generatedVersions.id, versionId)).get() !==
    undefined
  );
}
