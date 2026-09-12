import type { FastifyInstance } from 'fastify';
import { diffLines } from 'diff';
import { ManualVersionCreate, VersionTargetType, type VersionDiffLine } from '@storytime/shared';
import { badRequest, notFound } from '../services/entities.js';
import { readVersion, readVersions, saveVersion, setCurrentVersion } from '../services/manuscript.js';
import { readProject } from './projects.js';

export async function versionRoutes(app: FastifyInstance) {
  const db = app.db;

  app.get('/versions', async (request) => {
    const query = request.query as { targetType?: string; targetId?: string };
    if (!query.targetType || !query.targetId) {
      throw badRequest('Listing versions needs both targetType and targetId.');
    }
    const targetType = VersionTargetType.parse(query.targetType);
    return readVersions(db, targetType, query.targetId);
  });

  app.get('/versions/:id', async (request) => {
    const { id } = request.params as { id: string };
    return readVersion(db, id);
  });

  /** Roll back: point the chapter or scene at an earlier version. */
  app.post('/versions/:id/make-current', async (request) => {
    const { id } = request.params as { id: string };
    const version = readVersion(db, id);
    if (version.targetType === 'outline' || version.targetType === 'draft') {
      throw badRequest('Only chapters and scenes track a current version.');
    }
    setCurrentVersion(db, version.targetType, version.targetId, id);
    return readVersion(db, id);
  });

  /** Save a hand-written or hand-edited version without calling a model. */
  app.post('/versions', async (request, reply) => {
    const body = ManualVersionCreate.parse(request.body);
    const existing = readVersions(db, body.targetType, body.targetId);
    const projectId = existing[0]?.projectId;
    if (!projectId) {
      throw badRequest('Save a generated version first so the target is known, or generate this piece.');
    }
    readProject(db, projectId);

    const version = saveVersion({
      db,
      projectId,
      targetType: body.targetType,
      targetId: body.targetId,
      runId: null,
      content: body.content,
      instructions: body.instructions ?? null,
      makeCurrent: body.targetType === 'chapter' || body.targetType === 'scene',
    });
    return reply.status(201).send(version);
  });

  /** Line diff between any two versions, for the compare view. */
  app.get('/versions/:a/diff/:b', async (request) => {
    const { a, b } = request.params as { a: string; b: string };
    const left = readVersion(db, a);
    const right = readVersion(db, b);
    if (left.targetType !== right.targetType || left.targetId !== right.targetId) {
      throw badRequest('Those versions belong to different pieces of the manuscript.');
    }

    const lines: VersionDiffLine[] = diffLines(left.content, right.content).map((part) => ({
      type: part.added ? 'added' : part.removed ? 'removed' : 'unchanged',
      value: part.value,
    }));

    return {
      left: { id: left.id, versionNo: left.versionNo, createdAt: left.createdAt, wordCount: left.wordCount },
      right: { id: right.id, versionNo: right.versionNo, createdAt: right.createdAt, wordCount: right.wordCount },
      lines,
    };
  });
}

