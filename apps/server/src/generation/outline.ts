import { eq, inArray, notInArray } from 'drizzle-orm';
import type { OutlineResult } from '@storytime/shared';
import type { Db } from '../db/client.js';
import { chapters, characters, locations, plotPoints, scenes } from '../db/schema.js';
import { newId } from '../services/entities.js';
import { readChapters, readScenes, saveVersion } from '../services/manuscript.js';

export interface MaterializeOptions {
  /** Remove chapters and scenes the new outline does not mention. */
  replaceMissing?: boolean;
}

export interface MaterializeResult {
  chaptersCreated: number;
  chaptersUpdated: number;
  chaptersRemoved: number;
  scenesCreated: number;
  scenesRemoved: number;
  warnings: string[];
}

/** Keep only ids that actually exist in this project. */
function validIds(db: Db, projectId: string, table: typeof plotPoints | typeof characters | typeof locations, ids: string[]) {
  const cleaned = ids.map((id) => id.trim()).filter(Boolean);
  if (cleaned.length === 0) return { kept: [] as string[], dropped: [] as string[] };
  const found = new Set(
    db
      .select({ id: table.id })
      .from(table)
      .where(inArray(table.id, cleaned))
      .all()
      .filter(() => true)
      .map((r) => r.id),
  );
  // Confirm project ownership as well as existence.
  const owned = new Set(
    db
      .select({ id: table.id, projectId: table.projectId })
      .from(table)
      .where(inArray(table.id, [...found]))
      .all()
      .filter((r) => r.projectId === projectId)
      .map((r) => r.id),
  );
  return {
    kept: cleaned.filter((id) => owned.has(id)),
    dropped: cleaned.filter((id) => !owned.has(id)),
  };
}

/**
 * Turn a model-produced outline into real chapter and scene rows.
 *
 * Existing chapters are matched by position so regenerating an outline keeps
 * already-written text attached where it still makes sense, rather than
 * orphaning every chapter on each replan.
 */
export function materializeOutline(
  db: Db,
  projectId: string,
  outline: OutlineResult,
  options: MaterializeOptions = {},
): MaterializeResult {
  const result: MaterializeResult = {
    chaptersCreated: 0,
    chaptersUpdated: 0,
    chaptersRemoved: 0,
    scenesCreated: 0,
    scenesRemoved: 0,
    warnings: [],
  };

  const droppedPlotPoints = new Set<string>();
  const droppedCharacters = new Set<string>();
  const droppedLocations = new Set<string>();

  db.transaction((tx) => {
    const txDb = tx as unknown as Db;
    const existing = readChapters(txDb, projectId);
    const keptChapterIds: string[] = [];

    outline.chapters.forEach((outlineChapter, index) => {
      const plot = validIds(txDb, projectId, plotPoints, outlineChapter.plotPointIds ?? []);
      for (const id of plot.dropped) droppedPlotPoints.add(id);

      const current = existing[index];
      const chapterId = current?.id ?? newId();
      const title = outlineChapter.title.trim() || `Chapter ${index + 1}`;

      if (current) {
        tx.update(chapters)
          .set({
            title,
            summary: outlineChapter.summary.trim() || null,
            plotPointIds: JSON.stringify(plot.kept),
            sortOrder: index,
            revision: current.revision + 1,
            updatedAt: Date.now(),
          })
          .where(eq(chapters.id, chapterId))
          .run();
        result.chaptersUpdated += 1;
      } else {
        tx.insert(chapters)
          .values({
            id: chapterId,
            projectId,
            sortOrder: index,
            title,
            summary: outlineChapter.summary.trim() || null,
            plotPointIds: JSON.stringify(plot.kept),
          })
          .run();
        result.chaptersCreated += 1;
      }
      keptChapterIds.push(chapterId);

      // Scenes are replaced wholesale: they are cheap and fully described by the outline.
      const outlineScenes = outlineChapter.scenes ?? [];
      if (outlineScenes.length > 0) {
        const existingScenes = readScenes(txDb, projectId, chapterId);
        const removed = existingScenes.length;
        tx.delete(scenes).where(eq(scenes.chapterId, chapterId)).run();
        result.scenesRemoved += removed;

        outlineScenes.forEach((outlineScene, sceneIndex) => {
          const scenePlot = validIds(txDb, projectId, plotPoints, outlineScene.plotPointIds ?? []);
          for (const id of scenePlot.dropped) droppedPlotPoints.add(id);

          const pov = validIds(txDb, projectId, characters, outlineScene.povCharacterId ? [outlineScene.povCharacterId] : []);
          for (const id of pov.dropped) droppedCharacters.add(id);
          const loc = validIds(txDb, projectId, locations, outlineScene.locationId ? [outlineScene.locationId] : []);
          for (const id of loc.dropped) droppedLocations.add(id);

          tx.insert(scenes)
            .values({
              id: newId(),
              chapterId,
              projectId,
              sortOrder: sceneIndex,
              title: outlineScene.title.trim() || `Scene ${sceneIndex + 1}`,
              summary: (outlineScene.beats ?? []).join(' ').trim() || null,
              goal: outlineScene.goal.trim() || null,
              povCharacterId: pov.kept[0] ?? null,
              locationId: loc.kept[0] ?? null,
              plotPointIds: JSON.stringify(scenePlot.kept),
            })
            .run();
          result.scenesCreated += 1;
        });
      }
    });

    if (options.replaceMissing !== false && keptChapterIds.length > 0) {
      const removed = existing.filter((c) => !keptChapterIds.includes(c.id));
      if (removed.length > 0) {
        tx.delete(chapters)
          .where(notInArray(chapters.id, keptChapterIds))
          .run();
        result.chaptersRemoved = removed.length;
      }
    }
  });

  if (droppedPlotPoints.size > 0) {
    result.warnings.push(
      `The outline referenced ${droppedPlotPoints.size} plot point id(s) that do not exist in this project. They were ignored.`,
    );
  }
  if (droppedCharacters.size > 0) {
    result.warnings.push(`The outline referenced ${droppedCharacters.size} unknown character id(s), left unset.`);
  }
  if (droppedLocations.size > 0) {
    result.warnings.push(`The outline referenced ${droppedLocations.size} unknown location id(s), left unset.`);
  }

  return result;
}

/**
 * Split a whole-draft version into chapters by its "## Chapter N: Title"
 * headings, so mode (a) output can be edited chapter by chapter afterwards.
 */
export function splitDraftIntoChapters(
  db: Db,
  projectId: string,
  draftText: string,
  runId: string | null = null,
): { created: number } {
  const pattern = /^##\s*Chapter\s+[^\n:]*:?\s*(.*)$/gim;
  const matches = [...draftText.matchAll(pattern)];
  if (matches.length === 0) return { created: 0 };

  let created = 0;
  db.transaction((tx) => {
    const txDb = tx as unknown as Db;
    let order = readChapters(txDb, projectId).length;

    matches.forEach((match, index) => {
      const start = (match.index ?? 0) + match[0].length;
      const end = index + 1 < matches.length ? (matches[index + 1]!.index ?? draftText.length) : draftText.length;
      const body = draftText.slice(start, end).trim();
      if (!body) return;

      const title = (match[1] ?? '').trim() || `Chapter ${order + 1}`;
      const chapterId = newId();
      tx.insert(chapters)
        .values({ id: chapterId, projectId, sortOrder: order, title, summary: null, plotPointIds: '[]' })
        .run();

      // The split text becomes the chapter's first version, so it is editable
      // and revisable exactly like generated chapters are.
      saveVersion({
        db: txDb,
        projectId,
        targetType: 'chapter',
        targetId: chapterId,
        runId,
        content: body,
        bibleHash: null,
      });

      order += 1;
      created += 1;
    });
  });

  return { created };
}
