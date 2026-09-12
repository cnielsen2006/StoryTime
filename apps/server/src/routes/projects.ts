import { asc, eq, sql } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import {
  ProjectCreate,
  ProjectUpdate,
  StoryParametersUpdate,
  type Project,
  type ProjectGraph,
} from '@storytime/shared';
import type { Db } from '../db/client.js';
import {
  chapters,
  generatedVersions,
  ideas,
  plotPoints,
  projects,
  scenes,
  storyParameters,
} from '../db/schema.js';
import {
  HttpError,
  countWords,
  newId,
  notFound,
  parseJsonArray,
  readCharacters,
  readLocations,
  readPlotLines,
  readPlotPointsForProject,
  readRelationships,
  readStoryParameters,
} from '../services/entities.js';
import { commitChange } from '../services/revisions.js';
import { markProjectStale } from '../services/staleness.js';
import { readChapters, readScenes } from '../services/manuscript.js';

export function readProject(db: Db, id: string): Project {
  const row = db.select().from(projects).where(eq(projects.id, id)).get();
  if (!row) throw notFound('Project');
  return row as Project;
}

function storyParameterSnapshot(db: Db, projectId: string) {
  const params = readStoryParameters(db, projectId);
  const { createdAt: _c, updatedAt: _u, ...rest } = params;
  return rest as Record<string, unknown>;
}

export async function projectRoutes(app: FastifyInstance) {
  const db = app.db;

  app.get('/projects', async () => {
    const rows = db.select().from(projects).orderBy(asc(projects.title)).all();
    return rows.map((project) => {
      const words =
        db
          .select({ total: sql<number>`coalesce(sum(${generatedVersions.wordCount}), 0)` })
          .from(generatedVersions)
          .innerJoin(chapters, eq(chapters.currentVersionId, generatedVersions.id))
          .where(eq(chapters.projectId, project.id))
          .get()?.total ?? 0;
      const staleCount =
        db
          .select({ n: sql<number>`count(*)` })
          .from(chapters)
          .where(sql`${chapters.projectId} = ${project.id} and ${chapters.staleLevel} != 'none'`)
          .get()?.n ?? 0;
      return { ...(project as Project), wordCount: words, staleCount };
    });
  });

  app.post('/projects', async (request, reply) => {
    const body = ProjectCreate.parse(request.body);
    const id = newId();
    const created = db.transaction((tx) => {
      tx.insert(projects)
        .values({
          id,
          title: body.title,
          description: body.description ?? null,
          provider: body.provider ?? null,
          model: body.model ?? null,
          effort: body.effort ?? null,
          tokenBudget: body.tokenBudget ?? null,
        })
        .run();
      // Every project has exactly one story-parameters row from birth.
      tx.insert(storyParameters).values({ id: newId(), projectId: id }).run();
      return readProject(tx as unknown as Db, id);
    });
    return reply.status(201).send(created);
  });

  app.get('/projects/:id', async (request) => {
    const { id } = request.params as { id: string };
    const project = readProject(db, id);
    return { ...project, storyParameters: readStoryParameters(db, id) };
  });

  app.patch('/projects/:id', async (request) => {
    const { id } = request.params as { id: string };
    const body = ProjectUpdate.parse(request.body);
    readProject(db, id);
    const patch: Record<string, unknown> = { updatedAt: Date.now() };
    for (const key of ['title', 'description', 'provider', 'model', 'effort', 'tokenBudget'] as const) {
      if (key in body) patch[key] = body[key] ?? null;
    }
    db.update(projects).set(patch).where(eq(projects.id, id)).run();
    return readProject(db, id);
  });

  app.delete('/projects/:id', async (request, reply) => {
    const { id } = request.params as { id: string };
    readProject(db, id);
    db.delete(projects).where(eq(projects.id, id)).run();
    return reply.status(204).send();
  });

  // --- Story parameters -----------------------------------------------------

  app.get('/projects/:id/story-parameters', async (request) => {
    const { id } = request.params as { id: string };
    readProject(db, id);
    return readStoryParameters(db, id);
  });

  app.put('/projects/:id/story-parameters', async (request) => {
    const { id } = request.params as { id: string };
    const body = StoryParametersUpdate.parse(request.body);
    readProject(db, id);

    return db.transaction((tx) => {
      const txDb = tx as unknown as Db;
      const before = storyParameterSnapshot(txDb, id);
      const current = readStoryParameters(txDb, id);
      const patch: Record<string, unknown> = { updatedAt: Date.now(), revision: current.revision + 1 };
      for (const key of [
        'audience',
        'genre',
        'tone',
        'pov',
        'tense',
        'styleNotes',
        'contentGuidelines',
        'targetLengthWords',
      ] as const) {
        if (key in body) patch[key] = body[key] ?? null;
      }
      if (body.comparableTitles) patch.comparableTitles = JSON.stringify(body.comparableTitles);
      tx.update(storyParameters).set(patch).where(eq(storyParameters.projectId, id)).run();

      const after = storyParameterSnapshot(txDb, id);
      const changed = commitChange({
        db: txDb,
        projectId: id,
        entityType: 'story_parameters',
        entityId: current.id,
        label: 'Story parameters',
        before,
        after,
        revision: current.revision + 1,
        skipStale: true,
      });
      // Parameters govern the whole book, so everything written is now suspect.
      if (changed.length > 0) markProjectStale(txDb, id, 'Story parameters', changed);
      return readStoryParameters(txDb, id);
    });
  });

  // --- Full graph -----------------------------------------------------------

  app.get('/projects/:id/graph', async (request) => {
    const { id } = request.params as { id: string };
    const project = readProject(db, id);
    const characters = readCharacters(db, id);
    const locations = readLocations(db, id);
    const lines = readPlotLines(db, id);
    const points = readPlotPointsForProject(db, id);
    const chapterRows = readChapters(db, id);
    const sceneRows = readScenes(db, id);

    const pointsByLine = new Map<string, typeof points>();
    for (const point of points) {
      pointsByLine.set(point.plotLineId, [...(pointsByLine.get(point.plotLineId) ?? []), point]);
    }

    const inboxCount =
      db
        .select({ n: sql<number>`count(*)` })
        .from(ideas)
        .where(sql`${ideas.projectId} = ${id} and ${ideas.status} = 'inbox'`)
        .get()?.n ?? 0;

    const staleTargets =
      chapterRows.filter((c) => c.staleLevel !== 'none').length +
      sceneRows.filter((s) => s.staleLevel !== 'none').length;

    const graph: ProjectGraph = {
      project,
      storyParameters: readStoryParameters(db, id),
      characters,
      relationships: readRelationships(db, id),
      locations,
      plotLines: lines.map((line) => ({ ...line, points: pointsByLine.get(line.id) ?? [] })),
      chapters: chapterRows,
      scenes: sceneRows,
      counts: {
        characters: characters.length,
        locations: locations.length,
        plotLines: lines.length,
        plotPoints: points.length,
        ideasInbox: inboxCount,
        chapters: chapterRows.length,
        scenes: sceneRows.length,
        staleTargets,
        words: chapterRows.reduce((sum, c) => sum + c.wordCount, 0),
      },
    };
    return graph;
  });
}

