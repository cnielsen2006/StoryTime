import type { FastifyInstance } from 'fastify';
import { AppSettingsUpdate, ProviderId } from '@storytime/shared';
import { badRequest } from '../services/entities.js';
import { clearProviderCache, createProvider, providerStatuses, readSettings, writeSettings } from '../llm/registry.js';
import { claudeLogin, claudeLogout, claudeStatus } from '../llm/providers/anthropic-auth.js';
import { AnthropicProvider } from '../llm/providers/anthropic.js';
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
      const instance = createProvider(db, providerId);
      // Claude gets a real round trip against a backend-chosen model: listing
      // models proves the credential reads, not that a generation would run.
      if (instance instanceof AnthropicProvider) {
        const result = await instance.probe();
        if (!result.ok) return { ok: false, message: result.error ?? 'Could not connect.', models: [] };
        const { models, source } = await instance.listModelsWithSource();
        const note = source === 'fallback' ? ' Showing known model ids; the live list was unavailable.' : '';
        return {
          ok: true,
          message: `Connected in ${result.latencyMs}ms. ${models.length} model(s) available.${note}`,
          models: models.slice(0, 10),
        };
      }
      const models = await instance.listModels();
      return { ok: true, message: `Connected. ${models.length} model(s) available.`, models: models.slice(0, 10) };
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Could not connect.';
      return { ok: false, message, models: [] };
    }
  });

  /** Whether a Claude membership or other ambient credential is in place. */
  app.get('/providers/anthropic/auth', async () => claudeStatus());

  /**
   * Opens a browser via the ant CLI and blocks on the callback, so it is allowed
   * a long request timeout. A client built while signed out must not linger.
   */
  app.post('/providers/anthropic/login', async (_request, reply) => {
    reply.raw.setTimeout(310_000);
    const result = await claudeLogin();
    if (result.signedIn) clearProviderCache();
    return result;
  });

  app.post('/providers/anthropic/logout', async () => {
    const result = await claudeLogout();
    clearProviderCache();
    return result;
  });
}
