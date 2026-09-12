import { and, asc, desc, eq, inArray, sql } from 'drizzle-orm';
import type { Chapter, GeneratedVersion, Scene, StaleLevel, StaleReason, VersionTargetType } from '@storytime/shared';
import type { Db } from '../db/client.js';
import { chapters, generatedVersions, projects, scenes, versionEntityRefs } from '../db/schema.js';
import { countWords, newId, notFound, parseJsonArray } from './entities.js';

function parseReasons(raw: string): StaleReason[] {
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? (parsed as StaleReason[]) : [];
  } catch {
    return [];
  }
}

interface VersionStat {
  wordCount: number;
  versionCount: number;
}

/** Word counts and version counts for a batch of targets, in one pass. */
function versionStats(db: Db, targetType: VersionTargetType, targetIds: string[]): Map<string, VersionStat> {
  const stats = new Map<string, VersionStat>();
  if (targetIds.length === 0) return stats;
  const rows = db
    .select({
      targetId: generatedVersions.targetId,
      id: generatedVersions.id,
      wordCount: generatedVersions.wordCount,
    })
    .from(generatedVersions)
    .where(and(eq(generatedVersions.targetType, targetType), inArray(generatedVersions.targetId, targetIds)))
    .all();
  for (const row of rows) {
    const stat = stats.get(row.targetId) ?? { wordCount: 0, versionCount: 0 };
    stat.versionCount += 1;
    stats.set(row.targetId, stat);
  }
  return stats;
}

function currentWordCounts(db: Db, versionIds: string[]): Map<string, number> {
  const map = new Map<string, number>();
  if (versionIds.length === 0) return map;
  const rows = db
    .select({ id: generatedVersions.id, wordCount: generatedVersions.wordCount })
    .from(generatedVersions)
    .where(inArray(generatedVersions.id, versionIds))
    .all();
  for (const row of rows) map.set(row.id, row.wordCount);
  return map;
}

export function readChapters(db: Db, projectId: string): Chapter[] {
  const rows = db
    .select()
    .from(chapters)
    .where(eq(chapters.projectId, projectId))
    .orderBy(asc(chapters.sortOrder), asc(chapters.id))
    .all();
  const stats = versionStats(
    db,
    'chapter',
    rows.map((r) => r.id),
  );
  const words = currentWordCounts(
    db,
    rows.map((r) => r.currentVersionId).filter((v): v is string => Boolean(v)),
  );
  return rows.map((row) => ({
    ...row,
    plotPointIds: parseJsonArray(row.plotPointIds),
    staleLevel: row.staleLevel as StaleLevel,
    staleReasons: parseReasons(row.staleReasons),
    wordCount: row.currentVersionId ? (words.get(row.currentVersionId) ?? 0) : 0,
    versionCount: stats.get(row.id)?.versionCount ?? 0,
  }));
}

export function readChapter(db: Db, id: string): Chapter {
  const row = db.select().from(chapters).where(eq(chapters.id, id)).get();
  if (!row) throw notFound('Chapter');
  const all = readChapters(db, row.projectId);
  const found = all.find((c) => c.id === id);
  if (!found) throw notFound('Chapter');
  return found;
}

export function readScenes(db: Db, projectId: string, chapterId?: string): Scene[] {
  const where = chapterId
    ? and(eq(scenes.projectId, projectId), eq(scenes.chapterId, chapterId))
    : eq(scenes.projectId, projectId);
  const rows = db.select().from(scenes).where(where).orderBy(asc(scenes.sortOrder), asc(scenes.id)).all();
  const stats = versionStats(
    db,
    'scene',
    rows.map((r) => r.id),
  );
  const words = currentWordCounts(
    db,
    rows.map((r) => r.currentVersionId).filter((v): v is string => Boolean(v)),
  );
  return rows.map((row) => ({
    ...row,
    plotPointIds: parseJsonArray(row.plotPointIds),
    staleLevel: row.staleLevel as StaleLevel,
    staleReasons: parseReasons(row.staleReasons),
    wordCount: row.currentVersionId ? (words.get(row.currentVersionId) ?? 0) : 0,
    versionCount: stats.get(row.id)?.versionCount ?? 0,
  }));
}

export function readScene(db: Db, id: string): Scene {
  const row = db.select().from(scenes).where(eq(scenes.id, id)).get();
  if (!row) throw notFound('Scene');
  const found = readScenes(db, row.projectId, row.chapterId).find((s) => s.id === id);
  if (!found) throw notFound('Scene');
  return found;
}

export function isCurrentVersion(db: Db, version: { id: string; targetType: string; targetId: string }): boolean {
  if (version.targetType === 'chapter') {
    return db.select({ id: chapters.id }).from(chapters).where(eq(chapters.currentVersionId, version.id)).get() !== undefined;
  }
  if (version.targetType === 'scene') {
    return db.select({ id: scenes.id }).from(scenes).where(eq(scenes.currentVersionId, version.id)).get() !== undefined;
  }
  // Draft and outline: the newest version is the current one.
  const newest = db
    .select({ id: generatedVersions.id })
    .from(generatedVersions)
    .where(and(eq(generatedVersions.targetType, version.targetType), eq(generatedVersions.targetId, version.targetId)))
    .orderBy(desc(generatedVersions.versionNo))
    .get();
  return newest?.id === version.id;
}

export function readVersions(db: Db, targetType: VersionTargetType, targetId: string): GeneratedVersion[] {
  const rows = db
    .select()
    .from(generatedVersions)
    .where(and(eq(generatedVersions.targetType, targetType), eq(generatedVersions.targetId, targetId)))
    .orderBy(desc(generatedVersions.versionNo))
    .all();
  return rows.map((row) => ({
    ...(row as Omit<GeneratedVersion, 'isCurrent' | 'targetType' | 'stopReason'>),
    targetType: row.targetType as VersionTargetType,
    stopReason: row.stopReason as GeneratedVersion['stopReason'],
    isCurrent: isCurrentVersion(db, row),
  }));
}

export function readVersion(db: Db, id: string): GeneratedVersion {
  const row = db.select().from(generatedVersions).where(eq(generatedVersions.id, id)).get();
  if (!row) throw notFound('Version');
  return {
    ...(row as Omit<GeneratedVersion, 'isCurrent' | 'targetType' | 'stopReason'>),
    targetType: row.targetType as VersionTargetType,
    stopReason: row.stopReason as GeneratedVersion['stopReason'],
    isCurrent: isCurrentVersion(db, row),
  };
}

export interface SaveVersionInput {
  db: Db;
  projectId: string;
  targetType: VersionTargetType;
  targetId: string;
  runId: string | null;
  content: string;
  instructions?: string | null;
  bibleHash?: string | null;
  stopReason?: string | null;
  refs?: Array<{ entityType: string; entityId: string; entityRevision: number; focus: boolean }>;
  /** Point the owning chapter/scene at this version and clear its staleness. */
  makeCurrent?: boolean;
}

/**
 * Persist one generated (or hand-written) version and, by default, make it the
 * current text for its target. Prior versions are kept so the user can compare
 * and roll back.
 */
export function saveVersion(input: SaveVersionInput): GeneratedVersion {
  const {
    db,
    projectId,
    targetType,
    targetId,
    runId,
    content,
    instructions = null,
    bibleHash = null,
    stopReason = null,
    refs = [],
    makeCurrent = true,
  } = input;

  const last = db
    .select({ versionNo: generatedVersions.versionNo, id: generatedVersions.id })
    .from(generatedVersions)
    .where(and(eq(generatedVersions.targetType, targetType), eq(generatedVersions.targetId, targetId)))
    .orderBy(desc(generatedVersions.versionNo))
    .get();

  const id = newId();
  db.insert(generatedVersions)
    .values({
      id,
      projectId,
      targetType,
      targetId,
      runId,
      versionNo: (last?.versionNo ?? 0) + 1,
      content,
      wordCount: countWords(content),
      instructions,
      parentVersionId: last?.id ?? null,
      bibleHash,
      stopReason,
    })
    .run();

  for (const ref of refs) {
    db.insert(versionEntityRefs)
      .values({
        versionId: id,
        entityType: ref.entityType,
        entityId: ref.entityId,
        entityRevision: ref.entityRevision,
        focus: ref.focus ? 1 : 0,
      })
      .onConflictDoNothing()
      .run();
  }

  if (makeCurrent) setCurrentVersion(db, targetType, targetId, id);
  return readVersion(db, id);
}

/** Repoint a target at a version and reset its staleness to clean. */
export function setCurrentVersion(db: Db, targetType: VersionTargetType, targetId: string, versionId: string) {
  const patch = { currentVersionId: versionId, staleLevel: 'none', staleReasons: '[]', updatedAt: Date.now() };
  if (targetType === 'chapter') {
    db.update(chapters).set(patch).where(eq(chapters.id, targetId)).run();
  } else if (targetType === 'scene') {
    db.update(scenes).set(patch).where(eq(scenes.id, targetId)).run();
  }
}

/** Text of the current version for a target, or empty string when unwritten. */
export function currentText(db: Db, targetType: VersionTargetType, targetId: string): string {
  if (targetType === 'chapter') {
    const row = db.select({ v: chapters.currentVersionId }).from(chapters).where(eq(chapters.id, targetId)).get();
    if (!row?.v) return '';
    return db.select({ c: generatedVersions.content }).from(generatedVersions).where(eq(generatedVersions.id, row.v)).get()?.c ?? '';
  }
  if (targetType === 'scene') {
    const row = db.select({ v: scenes.currentVersionId }).from(scenes).where(eq(scenes.id, targetId)).get();
    if (!row?.v) return '';
    return db.select({ c: generatedVersions.content }).from(generatedVersions).where(eq(generatedVersions.id, row.v)).get()?.c ?? '';
  }
  const newest = db
    .select({ content: generatedVersions.content })
    .from(generatedVersions)
    .where(and(eq(generatedVersions.targetType, targetType), eq(generatedVersions.targetId, targetId)))
    .orderBy(desc(generatedVersions.versionNo))
    .get();
  return newest?.content ?? '';
}

export interface AssembledManuscript {
  title: string;
  /** Chapters in order with their assembled text. Empty when a whole draft is used. */
  chapters: Array<{ title: string; text: string; wordCount: number }>;
  /** Set when the project only has a single whole-draft version. */
  draft: string | null;
  wordCount: number;
}

/**
 * Build the readable manuscript. A chapter's text is its own current version, or
 * the concatenation of its scenes when it was written scene by scene.
 */
export function assembleManuscript(db: Db, projectId: string): AssembledManuscript {
  const project = db.select().from(projects).where(eq(projects.id, projectId)).get();
  if (!project) throw notFound('Project');

  const chapterRows = readChapters(db, projectId);
  const sceneRows = readScenes(db, projectId);
  const scenesByChapter = new Map<string, Scene[]>();
  for (const scene of sceneRows) {
    scenesByChapter.set(scene.chapterId, [...(scenesByChapter.get(scene.chapterId) ?? []), scene]);
  }

  const assembled = chapterRows.map((chapter) => {
    const own = currentText(db, 'chapter', chapter.id);
    if (own.trim()) {
      return { title: chapter.title, text: own, wordCount: countWords(own) };
    }
    const sceneTexts = (scenesByChapter.get(chapter.id) ?? [])
      .map((scene) => currentText(db, 'scene', scene.id))
      .filter((t) => t.trim().length > 0);
    const text = sceneTexts.join('\n\n');
    return { title: chapter.title, text, wordCount: countWords(text) };
  });

  const written = assembled.filter((c) => c.text.trim().length > 0);
  const draft = written.length === 0 ? currentText(db, 'draft', projectId) : '';

  return {
    title: project.title,
    chapters: written,
    draft: draft.trim() ? draft : null,
    wordCount: written.reduce((sum, c) => sum + c.wordCount, 0) || countWords(draft),
  };
}

export function projectWordCount(db: Db, projectId: string): number {
  const row = db
    .select({ total: sql<number>`coalesce(sum(${generatedVersions.wordCount}), 0)` })
    .from(generatedVersions)
    .innerJoin(chapters, eq(chapters.currentVersionId, generatedVersions.id))
    .where(eq(chapters.projectId, projectId))
    .get();
  return row?.total ?? 0;
}
