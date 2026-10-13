import type { Chapter, Scene, VersionTargetType } from '@storytime/shared';
import type { Db } from '../db/client.js';
import { currentText } from '../services/manuscript.js';

/** One piece of written text that can be given dialogue voices. */
export interface AttributableVersion {
  label: string;
  versionId: string;
  targetType: VersionTargetType;
  targetId: string;
  chapterId: string;
  /** The viewpoint character when this is a scene with one set. */
  povCharacterId: string | null;
}

/**
 * The versions currently showing for each chapter: its own text, or its scenes'
 * text when it was written scene by scene. `chapterIds` narrows the list.
 */
export function attributableVersions(
  db: Db,
  chapters: Chapter[],
  scenes: Scene[],
  chapterIds?: string[],
): AttributableVersion[] {
  const wanted = chapterIds?.length ? new Set(chapterIds) : null;
  const found: AttributableVersion[] = [];

  for (const chapter of chapters) {
    if (wanted && !wanted.has(chapter.id)) continue;

    if (chapter.currentVersionId && currentText(db, 'chapter', chapter.id).trim()) {
      found.push({
        label: chapter.title,
        versionId: chapter.currentVersionId,
        targetType: 'chapter',
        targetId: chapter.id,
        chapterId: chapter.id,
        povCharacterId: null,
      });
      continue;
    }

    for (const scene of scenes.filter((s) => s.chapterId === chapter.id)) {
      if (!scene.currentVersionId) continue;
      found.push({
        label: `${chapter.title} — ${scene.title}`,
        versionId: scene.currentVersionId,
        targetType: 'scene',
        targetId: scene.id,
        chapterId: chapter.id,
        povCharacterId: scene.povCharacterId,
      });
    }
  }
  return found;
}
