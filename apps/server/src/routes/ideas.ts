import { and, asc, desc, eq, inArray } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import {
  IdeaCreate,
  IdeaLinkCreate,
  IdeaPromote,
  IdeaUpdate,
  type Idea,
  type IdeaLink,
  type LinkableEntityType,
} from '@storytime/shared';
import type { Db } from '../db/client.js';
import {
  chapters,
  characters,
  ideaLinks,
  ideas,
  locations,
  plotLines,
  plotPoints,
  scenes,
  storyParameters,
} from '../db/schema.js';
import { badRequest, conflict, newId, nextSortOrder, notFound, readPlotLine } from '../services/entities.js';
import { commitChange } from '../services/revisions.js';
import { readProject } from './projects.js';

/** Human-readable name for a linked entity, so the UI can show chips. */
function entityLabel(db: Db, entityType: LinkableEntityType, entityId: string): string | null {
  switch (entityType) {
    case 'character':
      return db.select({ n: characters.name }).from(characters).where(eq(characters.id, entityId)).get()?.n ?? null;
    case 'location':
      return db.select({ n: locations.name }).from(locations).where(eq(locations.id, entityId)).get()?.n ?? null;
    case 'plot_line':
      return db.select({ n: plotLines.name }).from(plotLines).where(eq(plotLines.id, entityId)).get()?.n ?? null;
    case 'plot_point':
      return db.select({ n: plotPoints.title }).from(plotPoints).where(eq(plotPoints.id, entityId)).get()?.n ?? null;
    case 'chapter':
      return db.select({ n: chapters.title }).from(chapters).where(eq(chapters.id, entityId)).get()?.n ?? null;
    case 'scene':
      return db.select({ n: scenes.title }).from(scenes).where(eq(scenes.id, entityId)).get()?.n ?? null;
    case 'story_parameters':
      return 'Story parameters';
    default:
      return null;
  }
}

/** Confirm the entity exists and belongs to this project before linking. */
function assertEntityInProject(db: Db, projectId: string, entityType: LinkableEntityType, entityId: string) {
  const owner = (() => {
    switch (entityType) {
      case 'character':
        return db.select({ p: characters.projectId }).from(characters).where(eq(characters.id, entityId)).get()?.p;
      case 'location':
        return db.select({ p: locations.projectId }).from(locations).where(eq(locations.id, entityId)).get()?.p;
      case 'plot_line':
        return db.select({ p: plotLines.projectId }).from(plotLines).where(eq(plotLines.id, entityId)).get()?.p;
      case 'plot_point':
        return db.select({ p: plotPoints.projectId }).from(plotPoints).where(eq(plotPoints.id, entityId)).get()?.p;
      case 'chapter':
        return db.select({ p: chapters.projectId }).from(chapters).where(eq(chapters.id, entityId)).get()?.p;
      case 'scene':
        return db.select({ p: scenes.projectId }).from(scenes).where(eq(scenes.id, entityId)).get()?.p;
      case 'story_parameters':
        return db
          .select({ p: storyParameters.projectId })
          .from(storyParameters)
          .where(eq(storyParameters.id, entityId))
          .get()?.p;
      default:
        return undefined;
    }
  })();
  if (!owner) throw notFound('Linked entity');
  if (owner !== projectId) throw badRequest('That entity belongs to a different project.');
}

function readLinks(db: Db, ideaIds: string[]): Map<string, IdeaLink[]> {
  const map = new Map<string, IdeaLink[]>();
  if (ideaIds.length === 0) return map;
  const rows = db.select().from(ideaLinks).where(inArray(ideaLinks.ideaId, ideaIds)).all();
  for (const row of rows) {
    const link: IdeaLink = {
      id: row.id,
      ideaId: row.ideaId,
      entityType: row.entityType as LinkableEntityType,
      entityId: row.entityId,
      entityLabel: entityLabel(db, row.entityType as LinkableEntityType, row.entityId),
      note: row.note,
      createdAt: row.createdAt,
    };
    map.set(row.ideaId, [...(map.get(row.ideaId) ?? []), link]);
  }
  return map;
}

export function readIdea(db: Db, id: string): Idea {
  const row = db.select().from(ideas).where(eq(ideas.id, id)).get();
  if (!row) throw notFound('Idea');
  const links = readLinks(db, [id]).get(id) ?? [];
  return { ...(row as Omit<Idea, 'links' | 'status'>), status: row.status as Idea['status'], links };
}

export async function ideaRoutes(app: FastifyInstance) {
  const db = app.db;

  app.get('/projects/:projectId/ideas', async (request) => {
    const { projectId } = request.params as { projectId: string };
    const { status } = request.query as { status?: string };
    readProject(db, projectId);

    const where = status ? and(eq(ideas.projectId, projectId), eq(ideas.status, status)) : eq(ideas.projectId, projectId);
    const rows = db.select().from(ideas).where(where).orderBy(desc(ideas.createdAt)).all();
    const links = readLinks(
      db,
      rows.map((r) => r.id),
    );
    return rows.map((row) => ({
      ...(row as Omit<Idea, 'links' | 'status'>),
      status: row.status as Idea['status'],
      links: links.get(row.id) ?? [],
    }));
  });

  /** Quick capture: one box, one POST, no structure required. */
  app.post('/projects/:projectId/ideas', async (request, reply) => {
    const { projectId } = request.params as { projectId: string };
    const body = IdeaCreate.parse(request.body);
    readProject(db, projectId);
    const id = newId();
    db.insert(ideas).values({ id, projectId, text: body.text, status: 'inbox' }).run();
    return reply.status(201).send(readIdea(db, id));
  });

  app.patch('/ideas/:id', async (request) => {
    const { id } = request.params as { id: string };
    const body = IdeaUpdate.parse(request.body);
    readIdea(db, id);
    const patch: Record<string, unknown> = { updatedAt: Date.now() };
    if (body.text !== undefined) patch.text = body.text;
    if (body.status !== undefined) patch.status = body.status;
    db.update(ideas).set(patch).where(eq(ideas.id, id)).run();
    return readIdea(db, id);
  });

  app.delete('/ideas/:id', async (request, reply) => {
    const { id } = request.params as { id: string };
    readIdea(db, id);
    db.delete(ideas).where(eq(ideas.id, id)).run();
    return reply.status(204).send();
  });

  /** File an idea against an existing entity. One idea may touch several. */
  app.post('/ideas/:id/links', async (request, reply) => {
    const { id } = request.params as { id: string };
    const body = IdeaLinkCreate.parse(request.body);
    const idea = readIdea(db, id);
    assertEntityInProject(db, idea.projectId, body.entityType, body.entityId);

    const existing = db
      .select({ id: ideaLinks.id })
      .from(ideaLinks)
      .where(
        and(eq(ideaLinks.ideaId, id), eq(ideaLinks.entityType, body.entityType), eq(ideaLinks.entityId, body.entityId)),
      )
      .get();
    if (existing) throw conflict('This idea is already filed against that entity.');

    db.transaction((tx) => {
      tx.insert(ideaLinks)
        .values({
          id: newId(),
          ideaId: id,
          entityType: body.entityType,
          entityId: body.entityId,
          note: body.note ?? null,
        })
        .run();
      // Filing an idea anywhere counts as triaging it.
      tx.update(ideas).set({ status: 'triaged', updatedAt: Date.now() }).where(eq(ideas.id, id)).run();
    });
    return reply.status(201).send(readIdea(db, id));
  });

  app.delete('/ideas/:id/links/:linkId', async (request) => {
    const { id, linkId } = request.params as { id: string; linkId: string };
    readIdea(db, id);
    db.delete(ideaLinks).where(and(eq(ideaLinks.id, linkId), eq(ideaLinks.ideaId, id))).run();
    return readIdea(db, id);
  });

  /**
   * Turn a raw idea straight into a new bible entity, carrying the text into the
   * description and linking the two so the origin stays visible.
   */
  app.post('/ideas/:id/promote', async (request, reply) => {
    const { id } = request.params as { id: string };
    const body = IdeaPromote.parse(request.body);
    const idea = readIdea(db, id);
    const projectId = idea.projectId;

    const result = db.transaction((tx) => {
      const txDb = tx as unknown as Db;
      const entityId = newId();
      let label = body.name;

      if (body.entityType === 'character') {
        tx.insert(characters)
          .values({
            id: entityId,
            projectId,
            name: body.name,
            role: 'supporting',
            description: idea.text,
            sortOrder: nextSortOrder(txDb, characters, projectId),
          })
          .run();
        commitChange({
          db: txDb,
          projectId,
          entityType: 'character',
          entityId,
          label,
          before: null,
          after: { name: body.name, description: idea.text },
          revision: 1,
        });
      } else if (body.entityType === 'location') {
        tx.insert(locations)
          .values({
            id: entityId,
            projectId,
            name: body.name,
            description: idea.text,
            sortOrder: nextSortOrder(txDb, locations, projectId),
          })
          .run();
        commitChange({
          db: txDb,
          projectId,
          entityType: 'location',
          entityId,
          label,
          before: null,
          after: { name: body.name, description: idea.text },
          revision: 1,
        });
      } else if (body.entityType === 'plot_line') {
        tx.insert(plotLines)
          .values({
            id: entityId,
            projectId,
            name: body.name,
            description: idea.text,
            kind: 'subplot',
            sortOrder: nextSortOrder(txDb, plotLines, projectId),
          })
          .run();
        commitChange({
          db: txDb,
          projectId,
          entityType: 'plot_line',
          entityId,
          label,
          before: null,
          after: { name: body.name, description: idea.text },
          revision: 1,
        });
      } else {
        if (!body.plotLineId) throw badRequest('Filing an idea as a plot point needs a plot line.');
        const line = readPlotLine(txDb, body.plotLineId);
        if (line.projectId !== projectId) throw badRequest('That plot line belongs to a different project.');
        const maxOrder = txDb
          .select({ id: plotPoints.id, sortOrder: plotPoints.sortOrder })
          .from(plotPoints)
          .where(eq(plotPoints.plotLineId, body.plotLineId))
          .orderBy(asc(plotPoints.sortOrder))
          .all();
        tx.insert(plotPoints)
          .values({
            id: entityId,
            plotLineId: body.plotLineId,
            projectId,
            title: body.name,
            summary: idea.text,
            status: 'idea',
            sortOrder: maxOrder.length,
          })
          .run();
        label = body.name;
        commitChange({
          db: txDb,
          projectId,
          entityType: 'plot_point',
          entityId,
          label,
          before: null,
          after: { title: body.name, summary: idea.text },
          revision: 1,
        });
      }

      tx.insert(ideaLinks)
        .values({
          id: newId(),
          ideaId: id,
          entityType: body.entityType,
          entityId,
          note: 'Created from this idea',
        })
        .run();
      tx.update(ideas).set({ status: 'triaged', updatedAt: Date.now() }).where(eq(ideas.id, id)).run();

      return { entityType: body.entityType, entityId, label };
    });

    return reply.status(201).send({ ...result, idea: readIdea(db, id) });
  });

  /** Reverse lookup: which raw ideas fed this character/location/plot point. */
  app.get('/entities/:entityType/:entityId/ideas', async (request) => {
    const { entityType, entityId } = request.params as { entityType: LinkableEntityType; entityId: string };
    const rows = db
      .select()
      .from(ideaLinks)
      .where(and(eq(ideaLinks.entityType, entityType), eq(ideaLinks.entityId, entityId)))
      .all();
    if (rows.length === 0) return [];
    const ideaRows = db
      .select()
      .from(ideas)
      .where(
        inArray(
          ideas.id,
          rows.map((r) => r.ideaId),
        ),
      )
      .orderBy(desc(ideas.createdAt))
      .all();
    const noteByIdea = new Map(rows.map((r) => [r.ideaId, { note: r.note, linkId: r.id }]));
    return ideaRows.map((row) => ({
      id: row.id,
      text: row.text,
      status: row.status,
      note: noteByIdea.get(row.id)?.note ?? null,
      linkId: noteByIdea.get(row.id)?.linkId ?? null,
      createdAt: row.createdAt,
    }));
  });
}

