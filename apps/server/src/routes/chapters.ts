import { eq, sql } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import { ChapterCreate, ChapterUpdate, ReorderInput, SceneCreate, SceneUpdate } from '@storytime/shared';
import type { Db } from '../db/client.js';
import { chapters, scenes } from '../db/schema.js';
import { deleteLinksFor, newId, notFound } from '../services/entities.js';
import { readChapter, readChapters, readScene, readScenes } from '../services/manuscript.js';
import { commitChange } from '../services/revisions.js';
import { markReviewed } from '../services/staleness.js';
import { readProject } from './projects.js';

function chapterSnapshot(db: Db, id: string): Record<string, unknown> {
  const { createdAt: _c, updatedAt: _u, staleReasons: _s, wordCount: _w, versionCount: _v, ...rest } = readChapter(db, id);
  return rest as Record<string, unknown>;
}

function sceneSnapshot(db: Db, id: string): Record<string, unknown> {
  const { createdAt: _c, updatedAt: _u, staleReasons: _s, wordCount: _w, versionCount: _v, ...rest } = readScene(db, id);
  return rest as Record<string, unknown>;
}

function nextOrder(db: Db, table: typeof chapters | typeof scenes, column: unknown, value: string): number {
  const row = db
    .select({ max: sql<number | null>`max(${table.sortOrder})` })
    .from(table)
    .where(eq(column as never, value))
    .get();
  return (row?.max ?? -1) + 1;
}

export async function chapterRoutes(app: FastifyInstance) {
  const db = app.db;

  app.get('/projects/:projectId/chapters', async (request) => {
    const { projectId } = request.params as { projectId: string };
    readProject(db, projectId);
    return readChapters(db, projectId);
  });

  app.post('/projects/:projectId/chapters', async (request, reply) => {
    const { projectId } = request.params as { projectId: string };
    const body = ChapterCreate.parse(request.body);
    readProject(db, projectId);

    const id = newId();
    db.insert(chapters)
      .values({
        id,
        projectId,
        sortOrder: nextOrder(db, chapters, chapters.projectId, projectId),
        title: body.title,
        summary: body.summary ?? null,
        plotPointIds: JSON.stringify(body.plotPointIds ?? []),
      })
      .run();
    return reply.status(201).send(readChapter(db, id));
  });

  app.get('/chapters/:id', async (request) => {
    const { id } = request.params as { id: string };
    const chapter = readChapter(db, id);
    return { ...chapter, scenes: readScenes(db, chapter.projectId, id) };
  });

  app.patch('/chapters/:id', async (request) => {
    const { id } = request.params as { id: string };
    const body = ChapterUpdate.parse(request.body);

    return db.transaction((tx) => {
      const txDb = tx as unknown as Db;
      const current = readChapter(txDb, id);
      const before = chapterSnapshot(txDb, id);
      const revision = current.revision + 1;

      const patch: Record<string, unknown> = { updatedAt: Date.now(), revision };
      if ('title' in body) patch.title = body.title;
      if ('summary' in body) patch.summary = body.summary ?? null;
      if (body.plotPointIds) patch.plotPointIds = JSON.stringify(body.plotPointIds);
      tx.update(chapters).set(patch).where(eq(chapters.id, id)).run();

      commitChange({
        db: txDb,
        projectId: current.projectId,
        entityType: 'chapter',
        entityId: id,
        label: (body.title as string | undefined) ?? current.title,
        before,
        after: chapterSnapshot(txDb, id),
        revision,
        // Editing chapter metadata should not mark its own text stale.
        skipStale: true,
      });
      return readChapter(txDb, id);
    });
  });

  app.delete('/chapters/:id', async (request, reply) => {
    const { id } = request.params as { id: string };
    db.transaction((tx) => {
      const txDb = tx as unknown as Db;
      const current = readChapter(txDb, id);
      const sceneIds = readScenes(txDb, current.projectId, id).map((s) => s.id);
      deleteLinksFor(txDb, 'scene', sceneIds);
      deleteLinksFor(txDb, 'chapter', [id]);
      tx.delete(chapters).where(eq(chapters.id, id)).run();
    });
    return reply.status(204).send();
  });

  app.post('/projects/:projectId/chapters/reorder', async (request) => {
    const { projectId } = request.params as { projectId: string };
    const body = ReorderInput.parse(request.body);
    readProject(db, projectId);
    db.transaction((tx) => {
      const existing = readChapters(tx as unknown as Db, projectId).map((c) => c.id);
      const known = new Set(existing);
      const ordered = body.ids.filter((chapterId) => known.has(chapterId));
      const rest = existing.filter((chapterId) => !ordered.includes(chapterId));
      [...ordered, ...rest].forEach((chapterId, index) => {
        tx.update(chapters).set({ sortOrder: index }).where(eq(chapters.id, chapterId)).run();
      });
    });
    return readChapters(db, projectId);
  });

  /** The user has read a stale chapter and accepts it as-is. */
  app.post('/chapters/:id/mark-reviewed', async (request) => {
    const { id } = request.params as { id: string };
    readChapter(db, id);
    markReviewed(db, 'chapter', id);
    return readChapter(db, id);
  });

  // --- Scenes ---------------------------------------------------------------

  app.get('/chapters/:chapterId/scenes', async (request) => {
    const { chapterId } = request.params as { chapterId: string };
    const chapter = readChapter(db, chapterId);
    return readScenes(db, chapter.projectId, chapterId);
  });

  app.post('/chapters/:chapterId/scenes', async (request, reply) => {
    const { chapterId } = request.params as { chapterId: string };
    const body = SceneCreate.parse(request.body);
    const chapter = readChapter(db, chapterId);

    const id = newId();
    db.insert(scenes)
      .values({
        id,
        chapterId,
        projectId: chapter.projectId,
        sortOrder: nextOrder(db, scenes, scenes.chapterId, chapterId),
        title: body.title,
        summary: body.summary ?? null,
        goal: body.goal ?? null,
        povCharacterId: body.povCharacterId ?? null,
        locationId: body.locationId ?? null,
        plotPointIds: JSON.stringify(body.plotPointIds ?? []),
      })
      .run();
    return reply.status(201).send(readScene(db, id));
  });

  app.patch('/scenes/:id', async (request) => {
    const { id } = request.params as { id: string };
    const body = SceneUpdate.parse(request.body);

    return db.transaction((tx) => {
      const txDb = tx as unknown as Db;
      const current = readScene(txDb, id);
      const before = sceneSnapshot(txDb, id);
      const revision = current.revision + 1;

      const patch: Record<string, unknown> = { updatedAt: Date.now(), revision };
      for (const key of ['title', 'summary', 'goal', 'povCharacterId', 'locationId'] as const) {
        if (key in body) patch[key] = body[key] ?? null;
      }
      if (body.plotPointIds) patch.plotPointIds = JSON.stringify(body.plotPointIds);
      tx.update(scenes).set(patch).where(eq(scenes.id, id)).run();

      commitChange({
        db: txDb,
        projectId: current.projectId,
        entityType: 'scene',
        entityId: id,
        label: (body.title as string | undefined) ?? current.title,
        before,
        after: sceneSnapshot(txDb, id),
        revision,
        skipStale: true,
      });
      return readScene(txDb, id);
    });
  });

  app.delete('/scenes/:id', async (request, reply) => {
    const { id } = request.params as { id: string };
    readScene(db, id);
    db.transaction((tx) => {
      deleteLinksFor(tx as unknown as Db, 'scene', [id]);
      tx.delete(scenes).where(eq(scenes.id, id)).run();
    });
    return reply.status(204).send();
  });

  app.post('/chapters/:chapterId/scenes/reorder', async (request) => {
    const { chapterId } = request.params as { chapterId: string };
    const body = ReorderInput.parse(request.body);
    const chapter = readChapter(db, chapterId);
    db.transaction((tx) => {
      const existing = readScenes(tx as unknown as Db, chapter.projectId, chapterId).map((s) => s.id);
      const known = new Set(existing);
      const ordered = body.ids.filter((sceneId) => known.has(sceneId));
      const rest = existing.filter((sceneId) => !ordered.includes(sceneId));
      [...ordered, ...rest].forEach((sceneId, index) => {
        tx.update(scenes).set({ sortOrder: index }).where(eq(scenes.id, sceneId)).run();
      });
    });
    return readScenes(db, chapter.projectId, chapterId);
  });

  app.post('/scenes/:id/mark-reviewed', async (request) => {
    const { id } = request.params as { id: string };
    readScene(db, id);
    markReviewed(db, 'scene', id);
    return readScene(db, id);
  });
}

