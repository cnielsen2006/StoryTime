import { eq } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import {
  RevisableEntityType,
  type EntityRevision,
  type EntityRevisionDetail,
  type RevisableEntityType as RevisableEntityTypeT,
} from '@storytime/shared';
import type { Db } from '../db/client.js';
import { characters, locations, plotLines, plotPoints, storyParameters } from '../db/schema.js';
import { badRequest, notFound, writeExperiences, writePlotPointLinks } from '../services/entities.js';
import { commitChange, diffFields, getPreviousRevision, getRevision, listRevisions } from '../services/revisions.js';

function toRevision(row: {
  id: string;
  projectId: string;
  entityType: string;
  entityId: string;
  revision: number;
  summary: string;
  deleted: number;
  createdAt: number;
}): EntityRevision {
  return {
    id: row.id,
    projectId: row.projectId,
    entityType: row.entityType as RevisableEntityTypeT,
    entityId: row.entityId,
    revision: row.revision,
    summary: row.summary,
    deleted: row.deleted === 1,
    createdAt: row.createdAt,
  };
}

function parseSnapshot(raw: string): Record<string, unknown> {
  try {
    const parsed = JSON.parse(raw);
    return typeof parsed === 'object' && parsed !== null ? (parsed as Record<string, unknown>) : {};
  } catch {
    return {};
  }
}

/**
 * Write a historical snapshot back onto the live row. This creates a new
 * revision rather than rewinding history, so the restore is itself undoable.
 */
function restoreSnapshot(db: Db, entityType: RevisableEntityTypeT, entityId: string, snapshot: Record<string, unknown>) {
  const str = (key: string) => (typeof snapshot[key] === 'string' ? (snapshot[key] as string) : null);
  const num = (key: string) => (typeof snapshot[key] === 'number' ? (snapshot[key] as number) : null);
  const now = Date.now();

  switch (entityType) {
    case 'character': {
      const current = db.select().from(characters).where(eq(characters.id, entityId)).get();
      if (!current) throw notFound('Character');
      db.update(characters)
        .set({
          name: str('name') ?? current.name,
          role: str('role') ?? current.role,
          description: str('description'),
          appearance: str('appearance'),
          personality: str('personality'),
          backstory: str('backstory'),
          arcNotes: str('arcNotes'),
          revision: current.revision + 1,
          updatedAt: now,
        })
        .where(eq(characters.id, entityId))
        .run();
      const experiences = snapshot.experiences;
      if (Array.isArray(experiences)) {
        writeExperiences(
          db,
          entityId,
          experiences as Array<{ title: string; whenLabel?: string | null; description?: string | null; impact?: string | null }>,
        );
      }
      return { projectId: current.projectId, revision: current.revision + 1, label: str('name') ?? current.name };
    }
    case 'location': {
      const current = db.select().from(locations).where(eq(locations.id, entityId)).get();
      if (!current) throw notFound('Location');
      db.update(locations)
        .set({
          name: str('name') ?? current.name,
          description: str('description'),
          sensoryDetails: str('sensoryDetails'),
          rulesLore: str('rulesLore'),
          revision: current.revision + 1,
          updatedAt: now,
        })
        .where(eq(locations.id, entityId))
        .run();
      return { projectId: current.projectId, revision: current.revision + 1, label: str('name') ?? current.name };
    }
    case 'plot_line': {
      const current = db.select().from(plotLines).where(eq(plotLines.id, entityId)).get();
      if (!current) throw notFound('Plot line');
      db.update(plotLines)
        .set({
          name: str('name') ?? current.name,
          description: str('description'),
          kind: str('kind') ?? current.kind,
          revision: current.revision + 1,
          updatedAt: now,
        })
        .where(eq(plotLines.id, entityId))
        .run();
      return { projectId: current.projectId, revision: current.revision + 1, label: str('name') ?? current.name };
    }
    case 'plot_point': {
      const current = db.select().from(plotPoints).where(eq(plotPoints.id, entityId)).get();
      if (!current) throw notFound('Plot point');
      db.update(plotPoints)
        .set({
          title: str('title') ?? current.title,
          summary: str('summary'),
          status: str('status') ?? current.status,
          notes: str('notes'),
          revision: current.revision + 1,
          updatedAt: now,
        })
        .where(eq(plotPoints.id, entityId))
        .run();
      const characterIds = Array.isArray(snapshot.characterIds) ? (snapshot.characterIds as string[]) : undefined;
      const locationIds = Array.isArray(snapshot.locationIds) ? (snapshot.locationIds as string[]) : undefined;
      writePlotPointLinks(db, current.projectId, entityId, characterIds, locationIds);
      return { projectId: current.projectId, revision: current.revision + 1, label: str('title') ?? current.title };
    }
    case 'story_parameters': {
      const current = db.select().from(storyParameters).where(eq(storyParameters.id, entityId)).get();
      if (!current) throw notFound('Story parameters');
      const comparable = Array.isArray(snapshot.comparableTitles) ? (snapshot.comparableTitles as string[]) : [];
      db.update(storyParameters)
        .set({
          audience: str('audience'),
          genre: str('genre'),
          tone: str('tone'),
          pov: str('pov'),
          tense: str('tense'),
          styleNotes: str('styleNotes'),
          contentGuidelines: str('contentGuidelines'),
          targetLengthWords: num('targetLengthWords'),
          comparableTitles: JSON.stringify(comparable),
          revision: current.revision + 1,
          updatedAt: now,
        })
        .where(eq(storyParameters.id, entityId))
        .run();
      return { projectId: current.projectId, revision: current.revision + 1, label: 'Story parameters' };
    }
    default:
      throw badRequest(`Restoring a ${entityType} from history is not supported.`);
  }
}

export async function revisionRoutes(app: FastifyInstance) {
  const db = app.db;

  app.get('/entities/:entityType/:entityId/revisions', async (request) => {
    const { entityType, entityId } = request.params as { entityType: string; entityId: string };
    const type = RevisableEntityType.parse(entityType);
    return listRevisions(db, type, entityId).map(toRevision);
  });

  app.get('/revisions/:id', async (request) => {
    const { id } = request.params as { id: string };
    const row = getRevision(db, id);
    if (!row) throw notFound('Revision');

    const previous = getPreviousRevision(db, row.entityType, row.entityId, row.revision);
    const snapshot = parseSnapshot(row.snapshot);
    const previousSnapshot = previous ? parseSnapshot(previous.snapshot) : null;

    const detail: EntityRevisionDetail = {
      ...toRevision(row),
      snapshot,
      previousSnapshot,
      changedFields: diffFields(previousSnapshot, row.deleted === 1 ? null : snapshot),
    };
    return detail;
  });

  /** Bring an old version of an entity back as a new revision. */
  app.post('/revisions/:id/restore', async (request) => {
    const { id } = request.params as { id: string };
    const row = getRevision(db, id);
    if (!row) throw notFound('Revision');
    if (row.deleted === 1) throw badRequest('That entry records a deletion, so there is nothing to restore.');

    const entityType = RevisableEntityType.parse(row.entityType);
    const snapshot = parseSnapshot(row.snapshot);

    return db.transaction((tx) => {
      const txDb = tx as unknown as Db;
      const before = parseSnapshot(
        getPreviousRevision(txDb, row.entityType, row.entityId, Number.MAX_SAFE_INTEGER)?.snapshot ?? '{}',
      );
      const restored = restoreSnapshot(txDb, entityType, row.entityId, snapshot);

      commitChange({
        db: txDb,
        projectId: restored.projectId,
        entityType,
        entityId: row.entityId,
        label: restored.label,
        before,
        after: snapshot,
        revision: restored.revision,
      });

      return { restoredTo: row.revision, newRevision: restored.revision, entityType, entityId: row.entityId };
    });
  });
}
