import { eq } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import {
  CharacterCreate,
  CharacterUpdate,
  ExperiencesReplace,
  RelationshipCreate,
  RelationshipUpdate,
  ReorderInput,
} from '@storytime/shared';
import type { Db } from '../db/client.js';
import { characterRelationships, characters } from '../db/schema.js';
import {
  applyReorder,
  badRequest,
  deleteLinksFor,
  newId,
  nextSortOrder,
  notFound,
  readCharacter,
  readCharacters,
  writeExperiences,
} from '../services/entities.js';
import { commitChange } from '../services/revisions.js';
import { readProject } from './projects.js';

/** Snapshot used for change history: the character plus its ordered experiences. */
function snapshot(db: Db, id: string): Record<string, unknown> {
  const character = readCharacter(db, id);
  const { createdAt: _c, updatedAt: _u, ...rest } = character;
  return {
    ...rest,
    experiences: character.experiences.map(({ id: _i, characterId: _ci, ...exp }) => exp),
  };
}

export async function characterRoutes(app: FastifyInstance) {
  const db = app.db;

  app.get('/projects/:projectId/characters', async (request) => {
    const { projectId } = request.params as { projectId: string };
    readProject(db, projectId);
    return readCharacters(db, projectId);
  });

  app.post('/projects/:projectId/characters', async (request, reply) => {
    const { projectId } = request.params as { projectId: string };
    const body = CharacterCreate.parse(request.body);
    readProject(db, projectId);

    const created = db.transaction((tx) => {
      const txDb = tx as unknown as Db;
      const id = newId();
      tx.insert(characters)
        .values({
          id,
          projectId,
          name: body.name,
          role: body.role,
          description: body.description ?? null,
          appearance: body.appearance ?? null,
          personality: body.personality ?? null,
          backstory: body.backstory ?? null,
          arcNotes: body.arcNotes ?? null,
          sortOrder: nextSortOrder(txDb, characters, projectId),
        })
        .run();
      if (body.experiences?.length) writeExperiences(txDb, id, body.experiences);
      commitChange({
        db: txDb,
        projectId,
        entityType: 'character',
        entityId: id,
        label: body.name,
        before: null,
        after: snapshot(txDb, id),
        revision: 1,
      });
      return readCharacter(txDb, id);
    });
    return reply.status(201).send(created);
  });

  app.get('/characters/:id', async (request) => {
    const { id } = request.params as { id: string };
    return readCharacter(db, id);
  });

  app.patch('/characters/:id', async (request) => {
    const { id } = request.params as { id: string };
    const body = CharacterUpdate.parse(request.body);

    return db.transaction((tx) => {
      const txDb = tx as unknown as Db;
      const before = snapshot(txDb, id);
      const current = readCharacter(txDb, id);
      const revision = current.revision + 1;

      const patch: Record<string, unknown> = { updatedAt: Date.now(), revision };
      for (const key of ['name', 'role', 'description', 'appearance', 'personality', 'backstory', 'arcNotes'] as const) {
        if (key in body) patch[key] = body[key] ?? null;
      }
      tx.update(characters).set(patch).where(eq(characters.id, id)).run();
      if (body.experiences) writeExperiences(txDb, id, body.experiences);

      const after = snapshot(txDb, id);
      commitChange({
        db: txDb,
        projectId: current.projectId,
        entityType: 'character',
        entityId: id,
        label: (body.name as string | undefined) ?? current.name,
        before,
        after,
        revision,
      });
      return readCharacter(txDb, id);
    });
  });

  app.delete('/characters/:id', async (request, reply) => {
    const { id } = request.params as { id: string };
    db.transaction((tx) => {
      const txDb = tx as unknown as Db;
      const current = readCharacter(txDb, id);
      const before = snapshot(txDb, id);
      commitChange({
        db: txDb,
        projectId: current.projectId,
        entityType: 'character',
        entityId: id,
        label: current.name,
        before,
        after: null,
        revision: current.revision + 1,
        deleted: true,
      });
      deleteLinksFor(txDb, 'character', [id]);
      tx.delete(characters).where(eq(characters.id, id)).run();
    });
    return reply.status(204).send();
  });

  /** Replace the whole ordered experience list in one call. */
  app.put('/characters/:id/experiences', async (request) => {
    const { id } = request.params as { id: string };
    const body = ExperiencesReplace.parse(request.body);

    return db.transaction((tx) => {
      const txDb = tx as unknown as Db;
      const current = readCharacter(txDb, id);
      const before = snapshot(txDb, id);
      const revision = current.revision + 1;
      writeExperiences(txDb, id, body.experiences);
      tx.update(characters).set({ revision, updatedAt: Date.now() }).where(eq(characters.id, id)).run();
      commitChange({
        db: txDb,
        projectId: current.projectId,
        entityType: 'character',
        entityId: id,
        label: current.name,
        before,
        after: snapshot(txDb, id),
        revision,
      });
      return readCharacter(txDb, id);
    });
  });

  app.post('/projects/:projectId/characters/reorder', async (request) => {
    const { projectId } = request.params as { projectId: string };
    const body = ReorderInput.parse(request.body);
    readProject(db, projectId);
    db.transaction((tx) => {
      applyReorder(tx as unknown as Db, characters, characters.projectId, projectId, body.ids);
    });
    return readCharacters(db, projectId);
  });

  // --- Relationships --------------------------------------------------------

  app.get('/projects/:projectId/relationships', async (request) => {
    const { projectId } = request.params as { projectId: string };
    readProject(db, projectId);
    return db.select().from(characterRelationships).where(eq(characterRelationships.projectId, projectId)).all();
  });

  app.post('/projects/:projectId/relationships', async (request, reply) => {
    const { projectId } = request.params as { projectId: string };
    const body = RelationshipCreate.parse(request.body);
    readProject(db, projectId);

    const from = readCharacter(db, body.fromCharacterId);
    const to = readCharacter(db, body.toCharacterId);
    if (from.projectId !== projectId || to.projectId !== projectId) {
      throw badRequest('Both characters must belong to this project.');
    }
    if (from.id === to.id) throw badRequest('A character cannot have a relationship with themselves.');

    const id = newId();
    db.insert(characterRelationships)
      .values({
        id,
        projectId,
        fromCharacterId: body.fromCharacterId,
        toCharacterId: body.toCharacterId,
        kind: body.kind,
        description: body.description ?? null,
      })
      .run();
    return reply.status(201).send(db.select().from(characterRelationships).where(eq(characterRelationships.id, id)).get());
  });

  app.patch('/relationships/:id', async (request) => {
    const { id } = request.params as { id: string };
    const body = RelationshipUpdate.parse(request.body);
    const existing = db.select().from(characterRelationships).where(eq(characterRelationships.id, id)).get();
    if (!existing) throw notFound('Relationship');

    const patch: Record<string, unknown> = { updatedAt: Date.now() };
    for (const key of ['kind', 'description', 'fromCharacterId', 'toCharacterId'] as const) {
      if (key in body) patch[key] = body[key] ?? null;
    }
    db.update(characterRelationships).set(patch).where(eq(characterRelationships.id, id)).run();
    return db.select().from(characterRelationships).where(eq(characterRelationships.id, id)).get();
  });

  app.delete('/relationships/:id', async (request, reply) => {
    const { id } = request.params as { id: string };
    const existing = db.select().from(characterRelationships).where(eq(characterRelationships.id, id)).get();
    if (!existing) throw notFound('Relationship');
    db.delete(characterRelationships).where(eq(characterRelationships.id, id)).run();
    return reply.status(204).send();
  });
}
