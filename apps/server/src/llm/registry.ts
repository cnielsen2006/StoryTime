import { eq } from 'drizzle-orm';
import type { AppSettings, Effort, ProviderId, ProviderStatus } from '@storytime/shared';
import { DEFAULT_MODELS, config } from '../config.js';
import type { Db } from '../db/client.js';
import { appSettings, projects } from '../db/schema.js';
import { AnthropicProvider } from './providers/anthropic.js';
import { MockProvider } from './providers/mock.js';
import { OllamaProvider } from './providers/ollama.js';
import { OpenAIProvider } from './providers/openai.js';
import { ProviderError, type LlmProvider } from './types.js';

const SETTINGS_KEY = 'app';

export function readSettings(db: Db): AppSettings {
  const row = db.select().from(appSettings).where(eq(appSettings.key, SETTINGS_KEY)).get();
  const defaults: AppSettings = {
    defaultProvider: config.DEFAULT_PROVIDER,
    defaultModel: config.DEFAULT_MODEL || DEFAULT_MODELS[config.DEFAULT_PROVIDER],
    defaultEffort: config.DEFAULT_EFFORT,
    ollamaBaseUrl: config.OLLAMA_BASE_URL,
  };
  if (!row) return defaults;
  try {
    return { ...defaults, ...(JSON.parse(row.value) as Partial<AppSettings>) };
  } catch {
    return defaults;
  }
}

export function writeSettings(db: Db, patch: Partial<AppSettings>): AppSettings {
  const next = { ...readSettings(db), ...patch };
  db.insert(appSettings)
    .values({ key: SETTINGS_KEY, value: JSON.stringify(next), updatedAt: Date.now() })
    .onConflictDoUpdate({
      target: appSettings.key,
      set: { value: JSON.stringify(next), updatedAt: Date.now() },
    })
    .run();
  return next;
}

export interface ResolvedProvider {
  provider: LlmProvider;
  providerId: ProviderId;
  model: string;
  effort: Effort;
}

/** Per-project overrides win, then saved settings, then the environment. */
export function resolveProviderConfig(
  db: Db,
  projectId: string,
  overrides: { effort?: Effort } = {},
): Omit<ResolvedProvider, 'provider'> {
  const settings = readSettings(db);
  const project = db.select().from(projects).where(eq(projects.id, projectId)).get();

  const providerId = (project?.provider as ProviderId | null) ?? settings.defaultProvider;
  const model = project?.model || (providerId === settings.defaultProvider ? settings.defaultModel : '') || DEFAULT_MODELS[providerId];
  const effort = overrides.effort ?? (project?.effort as Effort | null) ?? settings.defaultEffort;

  return { providerId, model, effort };
}

const cache = new Map<string, LlmProvider>();

export function createProvider(db: Db, providerId: ProviderId): LlmProvider {
  const settings = readSettings(db);
  const cacheKey = providerId === 'ollama' ? `ollama:${settings.ollamaBaseUrl}` : providerId;
  const cached = cache.get(cacheKey);
  if (cached) return cached;

  const provider: LlmProvider = (() => {
    switch (providerId) {
      case 'anthropic':
        return new AnthropicProvider();
      case 'openai':
        return new OpenAIProvider();
      case 'ollama':
        return new OllamaProvider(settings.ollamaBaseUrl);
      case 'mock':
        return new MockProvider();
      default:
        throw new ProviderError(`Unknown provider "${providerId as string}".`, false);
    }
  })();

  cache.set(cacheKey, provider);
  return provider;
}

export function getProvider(db: Db, projectId: string, overrides: { effort?: Effort } = {}): ResolvedProvider {
  const resolved = resolveProviderConfig(db, projectId, overrides);
  return { ...resolved, provider: createProvider(db, resolved.providerId) };
}

/** Settings changes can invalidate a constructed client (e.g. a new Ollama URL). */
export function clearProviderCache() {
  cache.clear();
}

export function providerStatuses(db: Db): ProviderStatus[] {
  const settings = readSettings(db);
  return [
    {
      id: 'anthropic',
      label: 'Claude (Anthropic)',
      configured: Boolean(config.ANTHROPIC_API_KEY),
      detail: config.ANTHROPIC_API_KEY ? 'API key found in environment.' : 'Set ANTHROPIC_API_KEY in your .env file.',
    },
    {
      id: 'openai',
      label: 'OpenAI',
      configured: Boolean(config.OPENAI_API_KEY),
      detail: config.OPENAI_API_KEY ? 'API key found in environment.' : 'Set OPENAI_API_KEY in your .env file.',
    },
    {
      id: 'ollama',
      label: 'Ollama (local)',
      configured: true,
      detail: `Will connect to ${settings.ollamaBaseUrl}. Needs Ollama running locally.`,
    },
    {
      id: 'mock',
      label: 'Mock (offline)',
      configured: true,
      detail: 'Generates placeholder prose. No network, no cost. Good for trying the app out.',
    },
  ];
}
