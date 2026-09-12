import { z } from 'zod';
import { Effort, ProviderId } from '../enums.js';

export const AppSettings = z.object({
  defaultProvider: ProviderId,
  defaultModel: z.string(),
  defaultEffort: Effort,
  ollamaBaseUrl: z.string(),
});
export type AppSettings = z.infer<typeof AppSettings>;

export const AppSettingsUpdate = AppSettings.partial();
export type AppSettingsUpdate = z.infer<typeof AppSettingsUpdate>;

export const ProviderStatus = z.object({
  id: ProviderId,
  label: z.string(),
  configured: z.boolean(),
  detail: z.string(),
});
export type ProviderStatus = z.infer<typeof ProviderStatus>;

export const ModelInfo = z.object({
  id: z.string(),
  displayName: z.string(),
  contextWindow: z.number().int().nullable(),
  maxOutput: z.number().int().nullable(),
});
export type ModelInfo = z.infer<typeof ModelInfo>;
