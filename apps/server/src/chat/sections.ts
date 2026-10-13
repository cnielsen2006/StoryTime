import { eq } from 'drizzle-orm';
import type { ChatScope, VersionTargetType } from '@storytime/shared';
import type { Db } from '../db/client.js';
import { chapters, projects, scenes } from '../db/schema.js';
import { badRequest, notFound } from '../services/entities.js';
import { currentText, readChapters, readScenes } from '../services/manuscript.js';

/** One piece of the manuscript the assistant may read and rewrite. */
export interface ChatSection {
  targetType: Extract<VersionTargetType, 'chapter' | 'scene' | 'draft'>;
  targetId: string;
  label: string;
  text: string;
}

function chapterSections(db: Db, projectId: string, chapterId: string): ChatSection[] {
  const chapter = readChapters(db, projectId).find((c) => c.id === chapterId);
  if (!chapter) throw notFound('Chapter');

  const own = currentText(db, 'chapter', chapter.id);
  if (own.trim()) return [{ targetType: 'chapter', targetId: chapter.id, label: chapter.title, text: own }];

  // A chapter written scene by scene has no text of its own; its scenes are what can be revised.
  return readScenes(db, projectId, chapter.id)
    .map((scene) => ({
      targetType: 'scene' as const,
      targetId: scene.id,
      label: `${chapter.title} — ${scene.title}`,
      text: currentText(db, 'scene', scene.id),
    }))
    .filter((section) => section.text.trim().length > 0);
}

/** Whether a conversation scope points at something that exists in this project. */
export function assertScope(db: Db, projectId: string, scope: ChatScope) {
  const { scopeType, scopeId } = scope;
  if (scopeType === 'book' || scopeType === 'draft') {
    if (scopeId !== projectId) throw badRequest('A book or draft conversation belongs to the project itself.');
    if (!db.select({ id: projects.id }).from(projects).where(eq(projects.id, projectId)).get()) throw notFound('Project');
    return;
  }
  if (scopeType === 'chapter') {
    const row = db.select({ projectId: chapters.projectId }).from(chapters).where(eq(chapters.id, scopeId)).get();
    if (!row || row.projectId !== projectId) throw notFound('Chapter');
    return;
  }
  const row = db.select({ projectId: scenes.projectId }).from(scenes).where(eq(scenes.id, scopeId)).get();
  if (!row || row.projectId !== projectId) throw notFound('Scene');
}

/** The text in play for a conversation, as it stands now. Empty when nothing is written yet. */
export function collectSections(db: Db, projectId: string, scope: ChatScope): ChatSection[] {
  assertScope(db, projectId, scope);

  switch (scope.scopeType) {
    case 'chapter':
      return chapterSections(db, projectId, scope.scopeId);

    case 'scene': {
      const scene = readScenes(db, projectId).find((s) => s.id === scope.scopeId);
      if (!scene) throw notFound('Scene');
      const text = currentText(db, 'scene', scene.id);
      return text.trim() ? [{ targetType: 'scene', targetId: scene.id, label: scene.title, text }] : [];
    }

    case 'draft': {
      const text = currentText(db, 'draft', projectId);
      const title = db.select({ title: projects.title }).from(projects).where(eq(projects.id, projectId)).get()?.title ?? 'Draft';
      return text.trim() ? [{ targetType: 'draft', targetId: projectId, label: title, text }] : [];
    }

    case 'book': {
      const fromChapters = readChapters(db, projectId).flatMap((chapter) => chapterSections(db, projectId, chapter.id));
      if (fromChapters.length > 0) return fromChapters;
      return collectSections(db, projectId, { scopeType: 'draft', scopeId: projectId });
    }
  }
}
