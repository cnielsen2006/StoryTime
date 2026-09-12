import type { FastifyInstance } from 'fastify';
import { AppSettingsUpdate, ProviderId } from '@storytime/shared';
import { badRequest } from '../services/entities.js';
import { clearProviderCache, createProvider, providerStatuses, readSettings, writeSettings } from '../llm/registry.js';
import { ProviderError } from '../llm/types.js';

export async function settingsRoutes(app: FastifyInstance) {
  const db = app.db;

  app.get('/settings', async () => readSettings(db));

  app.put('/settings', async (request) => {
    const body = AppSettingsUpdate.parse(request.body);
    const next = writeSettings(db, body);
    // A changed Ollama URL invalidates the cached client.
    clearProviderCache();
    return next;
  });

  app.get('/providers', async () => providerStatuses(db));

  /** Models a provider offers right now. Surfaces setup errors as 400s. */
  app.get('/models', async (request) => {
    const { provider } = request.query as { provider?: string };
    if (!provider) throw badRequest('Pass ?provider= to list models.');
    const providerId = ProviderId.parse(provider);
    try {
      return await createProvider(db, providerId).listModels();
    } catch (err) {
      if (err instanceof ProviderError) throw badRequest(err.message);
      throw err;
    }
  });

  /** One cheap call to prove credentials work before a real run. */
  app.post('/providers/:provider/test', async (request) => {
    const { provider } = request.params as { provider: string };
    const providerId = ProviderId.parse(provider);
    try {
      const models = await createProvider(db, providerId).listModels();
      return { ok: true, message: `Connected. ${models.length} model(s) available.`, models: models.slice(0, 10) };
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Could not connect.';
      return { ok: false, message, models: [] };
    }
  });
}
