import type { FastifyInstance } from 'fastify';
import { SeedProjectRequest, STORY_CATEGORIES, AUDIENCE_OPTIONS, SEED_SIZES } from '@storytime/shared';
import { ideateProject } from '../generation/ideate.js';
import { badRequest } from '../services/entities.js';
import { ProviderError } from '../llm/types.js';

export async function ideateRoutes(app: FastifyInstance) {
  const db = app.db;

  /** The choices the wizard offers. Served so the UI has one source of truth. */
  app.get('/ideate/options', async () => ({
    categories: STORY_CATEGORIES,
    audiences: AUDIENCE_OPTIONS,
    sizes: SEED_SIZES,
  }));

  /**
   * Invent a whole project and write it in. Synchronous: it is one structured
   * call, and there is no partial state worth streaming.
   */
  app.post('/ideate', async (request, reply) => {
    const body = SeedProjectRequest.parse(request.body);
    try {
      const result = await ideateProject(db, { request: body });
      return reply.status(201).send(result);
    } catch (err) {
      if (err instanceof ProviderError) {
        // A model that refuses or returns junk is a bad request from the user's
        // point of view, not a server fault.
        throw badRequest(err.message);
      }
      throw err;
    }
  });
}
