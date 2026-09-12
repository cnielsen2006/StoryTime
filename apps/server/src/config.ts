import { config as loadEnv } from 'dotenv';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { z } from 'zod';
import { Effort, ProviderId } from '@storytime/shared';

const here = path.dirname(fileURLToPath(import.meta.url));
export const repoRoot = path.resolve(here, '../../..');

loadEnv({ path: path.join(repoRoot, '.env'), quiet: true });

const EnvSchema = z.object({
  PORT: z.coerce.number().int().min(1).max(65535).default(3001),
  HOST: z.string().default('127.0.0.1'),
  DB_PATH: z.string().default('./data/storytime.db'),
  DEFAULT_PROVIDER: ProviderId.default('mock'),
  DEFAULT_MODEL: z.string().default(''),
  DEFAULT_EFFORT: Effort.default('high'),
  ANTHROPIC_API_KEY: z.string().default(''),
  ANTHROPIC_FALLBACKS: z.enum(['default', 'off']).default('default'),
  OPENAI_API_KEY: z.string().default(''),
  OPENAI_BASE_URL: z.string().default(''),
  OLLAMA_BASE_URL: z.string().default('http://127.0.0.1:11434'),
  NODE_ENV: z.string().default('development'),
});

const parsed = EnvSchema.safeParse(process.env);
if (!parsed.success) {
  const detail = parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('\n  ');
  throw new Error(`Invalid environment configuration:\n  ${detail}`);
}

const env = parsed.data;

export const config = {
  ...env,
  dbPath: path.isAbsolute(env.DB_PATH) ? env.DB_PATH : path.join(repoRoot, env.DB_PATH),
  webDist: path.join(repoRoot, 'apps/web/dist'),
  isTest: process.env.NODE_ENV === 'test' || process.env.VITEST === 'true',
};

/** Model used when a provider is selected but no model is pinned anywhere. */
export const DEFAULT_MODELS: Record<z.infer<typeof ProviderId>, string> = {
  anthropic: 'claude-opus-5',
  openai: 'gpt-4o',
  ollama: 'llama3.1',
  mock: 'mock-fast',
};
