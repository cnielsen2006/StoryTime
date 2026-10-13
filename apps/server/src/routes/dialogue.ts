import { eq } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import { DialogueUpdate } from '@storytime/shared';
import { z } from 'zod';
import type { Db } from '../db/client.js';
import { characters } from '../db/schema.js';
import { attributableVersions } from '../dialogue/targets.js';
import { correctAttribution, readAttribution } from '../dialogue/store.js';
import { readCharacters } from '../services/entities.js';
import { readChapters, readScenes, readVersion } from '../services/manuscript.js';
import { DEFAULT_VOICE, getSpeechService, type SpeechService } from '../speech/kokoro.js';
import { suggestVoices } from '../speech/casting.js';
import { readProject } from './projects.js';

const SuggestBody = z.object({
  /** Replace voices characters already have. */
  overwrite: z.boolean().optional(),
  /** The voice used for narration, kept free so no character sounds like the narrator. */
  narratorVoice: z.string().max(64).optional(),
});

export async function dialogueRoutes(app: FastifyInstance, options: { speech?: SpeechService } = {}) {
  const db: Db = app.db;
  const speech = options.speech ?? getSpeechService();

  /** Who speaks each quote in a version of the text, or null when voices have not been assigned. */
  app.get('/versions/:id/dialogue', async (request) => {
    const { id } = request.params as { id: string };
    readVersion(db, id);
    return { attribution: readAttribution(db, id) };
  });

  /** The author's corrections. Marks the attribution as theirs, so a later automatic pass leaves it alone. */
  app.put('/versions/:id/dialogue', async (request) => {
    const { id } = request.params as { id: string };
    const body = DialogueUpdate.parse(request.body);
    const version = readVersion(db, id);
    return { attribution: correctAttribution(db, version.projectId, id, body) };
  });

  /** Which written chapters and scenes have dialogue voices, for deciding what still needs assigning. */
  app.get('/projects/:projectId/dialogue', async (request) => {
    const { projectId } = request.params as { projectId: string };
    readProject(db, projectId);
    const versions = attributableVersions(db, readChapters(db, projectId), readScenes(db, projectId));
    return {
      versions: versions.map((v) => {
        const attribution = readAttribution(db, v.versionId);
        return {
          versionId: v.versionId,
          targetType: v.targetType,
          targetId: v.targetId,
          chapterId: v.chapterId,
          label: v.label,
          assigned: attribution !== null,
          source: attribution?.source ?? null,
        };
      }),
    };
  });

  /** Hand out distinct voices to characters that have none. */
  app.post('/projects/:projectId/characters/suggest-voices', async (request) => {
    const { projectId } = request.params as { projectId: string };
    const body = SuggestBody.parse(request.body ?? {});
    readProject(db, projectId);

    const cast = readCharacters(db, projectId);
    const chosen = suggestVoices(cast, await speech.voices(), {
      overwrite: body.overwrite,
      exclude: [body.narratorVoice ?? DEFAULT_VOICE],
    });

    db.transaction((tx) => {
      for (const [characterId, voice] of chosen) {
        tx.update(characters).set({ voice, updatedAt: Date.now() }).where(eq(characters.id, characterId)).run();
      }
    });
    return readCharacters(db, projectId);
  });
}
