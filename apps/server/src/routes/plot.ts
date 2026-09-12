import { asc, eq, sql } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import {
  PlotLineCreate,
  PlotLineUpdate,
  PlotPointCreate,
  PlotPointMove,
  PlotPointUpdate,
  ReorderInput,
} from '@storytime/shared';
import type { Db } from '../db/client.js';
import { plotLines, plotPoints } from '../db/schema.js';
import {
  applyReorder,
  badRequest,
  deleteLinksFor,
  newId,
  nextSortOrder,
  readPlotLine,
  readPlotLines,
  readPlotPoint,
  readPlotPointsForProject,
  writePlotPointLinks,
} from '../services/entities.js';
import { commitChange } from '../services/revisions.js';
import { readProject } from './projects.js';

function lineSnapshot(db: Db, id: string): Record<string, unknown> {
  const { createdAt: _c, updatedAt: _u, ...rest } = readPlotLine(db, id);
  return rest as Record<string, unknown>;
}

function pointSnapshot(db: Db, id: string): Record<string, unknown> {
  const { createdAt: _c, updatedAt: _u, ...rest } = readPlotPoint(db, id);
  return rest as Record<string, unknown>;
}

function nextPointOrder(db: Db, plotLineId: string): number {
  const row = db
    .select({ max: sql<number | null>`max(${plotPoints.sortOrder})` })
    .from(plotPoints)
    .where(eq(plotPoints.plotLineId, plotLineId))
    .get();
  return (row?.max ?? -1) + 1;
}

export async function plotRoutes(app: FastifyInstance) {
  const db = app.db;

  // --- Plot lines -----------------------------------------------------------

  app.get('/projects/:projectId/plot-lines', async (request) => {
    const { projectId } = request.params as { projectId: string };
    readProject(db, projectId);
    const lines = readPlotLines(db, projectId);
    const points = readPlotPointsForProject(db, projectId);
    const byLine = new Map<string, typeof points>();
    for (const point of points) {
      byLine.set(point.plotLineId, [...(byLine.get(point.plotLineId) ?? []), point]);
    }
    return lines.map((line) => ({ ...line, points: byLine.get(line.id) ?? [] }));
  });

  app.post('/projects/:projectId/plot-lines', async (request, reply) => {
    const { projectId } = request.params as { projectId: string };
    const body = PlotLineCreate.parse(request.body);
    readProject(db, projectId);

    const created = db.transaction((tx) => {
      const txDb = tx as unknown as Db;
      const id = newId();
      tx.insert(plotLines)
        .values({
          id,
          projectId,
          name: body.name,
          description: body.description ?? null,
          kind: body.kind,
          sortOrder: nextSortOrder(txDb, plotLines, projectId),
        })
        .run();
      commitChange({
        db: txDb,
        projectId,
        entityType: 'plot_line',
        entityId: id,
        label: body.name,
        before: null,
        after: lineSnapshot(txDb, id),
        revision: 1,
      });
      return readPlotLine(txDb, id);
    });
    return reply.status(201).send({ ...created, points: [] });
  });

  app.get('/plot-lines/:id', async (request) => {
    const { id } = request.params as { id: string };
    const line = readPlotLine(db, id);
    const points = readPlotPointsForProject(db, line.projectId).filter((p) => p.plotLineId === id);
    return { ...line, points };
  });

  app.patch('/plot-lines/:id', async (request) => {
    const { id } = request.params as { id: string };
    const body = PlotLineUpdate.parse(request.body);

    return db.transaction((tx) => {
      const txDb = tx as unknown as Db;
      const current = readPlotLine(txDb, id);
      const before = lineSnapshot(txDb, id);
      const revision = current.revision + 1;

      const patch: Record<string, unknown> = { updatedAt: Date.now(), revision };
      for (const key of ['name', 'description', 'kind'] as const) {
        if (key in body) patch[key] = body[key] ?? null;
      }
      tx.update(plotLines).set(patch).where(eq(plotLines.id, id)).run();

      commitChange({
        db: txDb,
        projectId: current.projectId,
        entityType: 'plot_line',
        entityId: id,
        label: (body.name as string | undefined) ?? current.name,
        before,
        after: lineSnapshot(txDb, id),
        revision,
      });
      return readPlotLine(txDb, id);
    });
  });

  app.delete('/plot-lines/:id', async (request, reply) => {
    const { id } = request.params as { id: string };
    db.transaction((tx) => {
      const txDb = tx as unknown as Db;
      const current = readPlotLine(txDb, id);
      const pointIds = txDb
        .select({ id: plotPoints.id })
        .from(plotPoints)
        .where(eq(plotPoints.plotLineId, id))
        .all()
        .map((r) => r.id);
      commitChange({
        db: txDb,
        projectId: current.projectId,
        entityType: 'plot_line',
        entityId: id,
        label: current.name,
        before: lineSnapshot(txDb, id),
        after: null,
        revision: current.revision + 1,
        deleted: true,
      });
      deleteLinksFor(txDb, 'plot_point', pointIds);
      deleteLinksFor(txDb, 'plot_line', [id]);
      tx.delete(plotLines).where(eq(plotLines.id, id)).run();
    });
    return reply.status(204).send();
  });

  app.post('/projects/:projectId/plot-lines/reorder', async (request) => {
    const { projectId } = request.params as { projectId: string };
    const body = ReorderInput.parse(request.body);
    readProject(db, projectId);
    db.transaction((tx) => {
      applyReorder(tx as unknown as Db, plotLines, plotLines.projectId, projectId, body.ids);
    });
    return readPlotLines(db, projectId);
  });

  // --- Plot points ----------------------------------------------------------

  app.post('/plot-lines/:plotLineId/plot-points', async (request, reply) => {
    const { plotLineId } = request.params as { plotLineId: string };
    const body = PlotPointCreate.parse(request.body);
    const line = readPlotLine(db, plotLineId);

    const created = db.transaction((tx) => {
      const txDb = tx as unknown as Db;
      const id = newId();
      tx.insert(plotPoints)
        .values({
          id,
          plotLineId,
          projectId: line.projectId,
          title: body.title,
          summary: body.summary ?? null,
          status: body.status,
          notes: body.notes ?? null,
          sortOrder: nextPointOrder(txDb, plotLineId),
        })
        .run();
      writePlotPointLinks(txDb, line.projectId, id, body.characterIds ?? [], body.locationIds ?? []);
      commitChange({
        db: txDb,
        projectId: line.projectId,
        entityType: 'plot_point',
        entityId: id,
        label: body.title,
        before: null,
        after: pointSnapshot(txDb, id),
        revision: 1,
      });
      return readPlotPoint(txDb, id);
    });
    return reply.status(201).send(created);
  });

  app.get('/plot-points/:id', async (request) => {
    const { id } = request.params as { id: string };
    return readPlotPoint(db, id);
  });

  app.patch('/plot-points/:id', async (request) => {
    const { id } = request.params as { id: string };
    const body = PlotPointUpdate.parse(request.body);

    return db.transaction((tx) => {
      const txDb = tx as unknown as Db;
      const current = readPlotPoint(txDb, id);
      const before = pointSnapshot(txDb, id);
      const revision = current.revision + 1;

      const patch: Record<string, unknown> = { updatedAt: Date.now(), revision };
      for (const key of ['title', 'summary', 'status', 'notes'] as const) {
        if (key in body) patch[key] = body[key] ?? null;
      }
      tx.update(plotPoints).set(patch).where(eq(plotPoints.id, id)).run();
      writePlotPointLinks(txDb, current.projectId, id, body.characterIds, body.locationIds);

      commitChange({
        db: txDb,
        projectId: current.projectId,
        entityType: 'plot_point',
        entityId: id,
        label: (body.title as string | undefined) ?? current.title,
        before,
        after: pointSnapshot(txDb, id),
        revision,
      });
      return readPlotPoint(txDb, id);
    });
  });

  app.delete('/plot-points/:id', async (request, reply) => {
    const { id } = request.params as { id: string };
    db.transaction((tx) => {
      const txDb = tx as unknown as Db;
      const current = readPlotPoint(txDb, id);
      commitChange({
        db: txDb,
        projectId: current.projectId,
        entityType: 'plot_point',
        entityId: id,
        label: current.title,
        before: pointSnapshot(txDb, id),
        after: null,
        revision: current.revision + 1,
        deleted: true,
      });
      deleteLinksFor(txDb, 'plot_point', [id]);
      tx.delete(plotPoints).where(eq(plotPoints.id, id)).run();
    });
    return reply.status(204).send();
  });

  /** Move a point to another plot line, keeping its history. */
  app.post('/plot-points/:id/move', async (request) => {
    const { id } = request.params as { id: string };
    const body = PlotPointMove.parse(request.body);

    return db.transaction((tx) => {
      const txDb = tx as unknown as Db;
      const current = readPlotPoint(txDb, id);
      const target = readPlotLine(txDb, body.plotLineId);
      if (target.projectId !== current.projectId) {
        throw badRequest('A plot point can only move to a plot line in the same project.');
      }
      const before = pointSnapshot(txDb, id);
      const revision = current.revision + 1;
      tx.update(plotPoints)
        .set({
          plotLineId: body.plotLineId,
          sortOrder: body.sortOrder ?? nextPointOrder(txDb, body.plotLineId),
          revision,
          updatedAt: Date.now(),
        })
        .where(eq(plotPoints.id, id))
        .run();
      commitChange({
        db: txDb,
        projectId: current.projectId,
        entityType: 'plot_point',
        entityId: id,
        label: current.title,
        before,
        after: pointSnapshot(txDb, id),
        revision,
      });
      return readPlotPoint(txDb, id);
    });
  });

  app.post('/plot-lines/:plotLineId/plot-points/reorder', async (request) => {
    const { plotLineId } = request.params as { plotLineId: string };
    const body = ReorderInput.parse(request.body);
    const line = readPlotLine(db, plotLineId);
    db.transaction((tx) => {
      applyReorder(tx as unknown as Db, plotPoints, plotPoints.plotLineId, plotLineId, body.ids);
    });
    return db
      .select()
      .from(plotPoints)
      .where(eq(plotPoints.plotLineId, plotLineId))
      .orderBy(asc(plotPoints.sortOrder))
      .all()
      .map((p) => readPlotPoint(db, p.id));
  });
}
