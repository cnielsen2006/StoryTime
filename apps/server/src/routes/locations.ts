import { eq } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import { LocationCreate, LocationUpdate, ReorderInput } from '@storytime/shared';
import type { Db } from '../db/client.js';
import { locations } from '../db/schema.js';
import {
  applyReorder,
  deleteLinksFor,
  newId,
  nextSortOrder,
  readLocation,
  readLocations,
} from '../services/entities.js';
import { commitChange } from '../services/revisions.js';
import { readProject } from './projects.js';

function snapshot(db: Db, id: string): Record<string, unknown> {
  const { createdAt: _c, updatedAt: _u, ...rest } = readLocation(db, id);
  return rest as Record<string, unknown>;
}

export async function locationRoutes(app: FastifyInstance) {
  const db = app.db;

  app.get('/projects/:projectId/locations', async (request) => {
    const { projectId } = request.params as { projectId: string };
    readProject(db, projectId);
    return readLocations(db, projectId);
  });

  app.post('/projects/:projectId/locations', async (request, reply) => {
    const { projectId } = request.params as { projectId: string };
    const body = LocationCreate.parse(request.body);
    readProject(db, projectId);

    const created = db.transaction((tx) => {
      const txDb = tx as unknown as Db;
      const id = newId();
      tx.insert(locations)
        .values({
          id,
          projectId,
          name: body.name,
          description: body.description ?? null,
          sensoryDetails: body.sensoryDetails ?? null,
          rulesLore: body.rulesLore ?? null,
          sortOrder: nextSortOrder(txDb, locations, projectId),
        })
        .run();
      commitChange({
        db: txDb,
        projectId,
        entityType: 'location',
        entityId: id,
        label: body.name,
        before: null,
        after: snapshot(txDb, id),
        revision: 1,
      });
      return readLocation(txDb, id);
    });
    return reply.status(201).send(created);
  });

  app.get('/locations/:id', async (request) => {
    const { id } = request.params as { id: string };
    return readLocation(db, id);
  });

  app.patch('/locations/:id', async (request) => {
    const { id } = request.params as { id: string };
    const body = LocationUpdate.parse(request.body);

    return db.transaction((tx) => {
      const txDb = tx as unknown as Db;
      const current = readLocation(txDb, id);
      const before = snapshot(txDb, id);
      const revision = current.revision + 1;

      const patch: Record<string, unknown> = { updatedAt: Date.now(), revision };
      for (const key of ['name', 'description', 'sensoryDetails', 'rulesLore'] as const) {
        if (key in body) patch[key] = body[key] ?? null;
      }
      tx.update(locations).set(patch).where(eq(locations.id, id)).run();

      commitChange({
        db: txDb,
        projectId: current.projectId,
        entityType: 'location',
        entityId: id,
        label: (body.name as string | undefined) ?? current.name,
        before,
        after: snapshot(txDb, id),
        revision,
      });
      return readLocation(txDb, id);
    });
  });

  app.delete('/locations/:id', async (request, reply) => {
    const { id } = request.params as { id: string };
    db.transaction((tx) => {
      const txDb = tx as unknown as Db;
      const current = readLocation(txDb, id);
      commitChange({
        db: txDb,
        projectId: current.projectId,
        entityType: 'location',
        entityId: id,
        label: current.name,
        before: snapshot(txDb, id),
        after: null,
        revision: current.revision + 1,
        deleted: true,
      });
      deleteLinksFor(txDb, 'location', [id]);
      tx.delete(locations).where(eq(locations.id, id)).run();
    });
    return reply.status(204).send();
  });

  app.post('/projects/:projectId/locations/reorder', async (request) => {
    const { projectId } = request.params as { projectId: string };
    const body = ReorderInput.parse(request.body);
    readProject(db, projectId);
    db.transaction((tx) => {
      applyReorder(tx as unknown as Db, locations, locations.projectId, projectId, body.ids);
    });
    return readLocations(db, projectId);
  });
}
