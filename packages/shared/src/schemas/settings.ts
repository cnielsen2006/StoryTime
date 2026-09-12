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

/** Which credential the Anthropic provider is actually authenticating with. */
export const ANTHROPIC_CREDENTIAL_KINDS = ['api-key', 'auth-token', 'membership', 'none'] as const;
export const AnthropicCredentialKind = z.enum(ANTHROPIC_CREDENTIAL_KINDS);
export type AnthropicCredentialKind = z.infer<typeof AnthropicCredentialKind>;

/**
 * State of the Claude membership sign-in. `antInstalled` is false when the ant
 * CLI is missing, in which case the UI must offer pasting a key instead of a
 * sign-in button that cannot work.
 */
export const ClaudeAuthStatus = z.object({
  signedIn: z.boolean(),
  antInstalled: z.boolean(),
  credential: AnthropicCredentialKind,
  detail: z.string(),
});
export type ClaudeAuthStatus = z.infer<typeof ClaudeAuthStatus>;

export const ClaudeAuthResult = z.object({
  ok: z.boolean(),
  signedIn: z.boolean(),
  message: z.string(),
});
export type ClaudeAuthResult = z.infer<typeof ClaudeAuthResult>;
