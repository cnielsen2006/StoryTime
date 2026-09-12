import { execFile } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';
import { config } from '../../config.js';

const run = promisify(execFile);

/**
 * How an Anthropic client will authenticate. Ported from SystemGen's
 * `anthropic_membership_available` and the client-build gate: an endpoint with no
 * pasted key is deliberate, not broken, when an ambient credential exists.
 */
export type AnthropicCredential =
  | { kind: 'api-key'; apiKey: string; detail: string }
  | { kind: 'auth-token'; authToken: string; detail: string }
  | { kind: 'membership'; detail: string }
  | { kind: 'none'; detail: string };

/** Values that look like a key but are placeholders, never real secrets. */
const PLACEHOLDER_KEYS = new Set(['', 'lm-studio']);

function isRealKey(value: string | undefined | null): boolean {
  return Boolean(value) && !PLACEHOLDER_KEYS.has(value!.trim());
}

/**
 * Where `ant auth login` stores its OAuth profile. Checked directly so sign-in
 * state is known even when the CLI is not on PATH.
 */
export function credentialsDir(): string {
  const override = process.env.ANTHROPIC_CONFIG_DIR;
  if (override) return path.join(override, 'credentials');
  if (process.platform === 'win32') {
    return path.join(process.env.APPDATA ?? path.join(os.homedir(), 'AppData', 'Roaming'), 'Anthropic', 'credentials');
  }
  return path.join(os.homedir(), '.config', 'anthropic', 'credentials');
}

function hasStoredProfile(): boolean {
  try {
    return fs.readdirSync(credentialsDir()).some((name) => name.endsWith('.json'));
  } catch {
    return false;
  }
}

/**
 * The single detector, in SystemGen's order: an explicit key, then the ambient
 * env vars the SDK reads, then the OAuth profile from `ant auth login`.
 *
 * Deliberately synchronous and non-throwing: it sits on the UI path, and a slow
 * or missing CLI must never be the reason a settings page hangs.
 */
export function detectCredential(apiKey: string = config.ANTHROPIC_API_KEY): AnthropicCredential {
  if (isRealKey(apiKey)) {
    return { kind: 'api-key', apiKey: apiKey.trim(), detail: 'API key found in environment.' };
  }
  if (isRealKey(process.env.ANTHROPIC_AUTH_TOKEN)) {
    return {
      kind: 'auth-token',
      authToken: process.env.ANTHROPIC_AUTH_TOKEN!.trim(),
      detail: 'Using ANTHROPIC_AUTH_TOKEN from the environment.',
    };
  }
  if (hasStoredProfile()) {
    return { kind: 'membership', detail: 'Signed in with a Claude membership.' };
  }
  return {
    kind: 'none',
    detail: 'Sign in with Claude, or set ANTHROPIC_API_KEY in your .env file.',
  };
}

export function isConfigured(credential: AnthropicCredential): boolean {
  return credential.kind !== 'none';
}

/**
 * The error the client-build gate raises. SystemGen distinguishes the two failure
 * modes, and so do we: "no credential at all" and "a key that was rejected" send
 * you to different places.
 */
export const NO_CREDENTIAL_MESSAGE =
  'No Claude credential found. Click Sign in with Claude on the Settings page, ' +
  'or set ANTHROPIC_API_KEY in your .env file.';

/**
 * Client options for the detected credential. An API key and an auth token are
 * passed explicitly; a membership gets a bare client so the SDK resolves and
 * refreshes the OAuth profile itself.
 */
export function clientOptions(credential: AnthropicCredential): { apiKey?: string; authToken?: string } {
  switch (credential.kind) {
    case 'api-key':
      return { apiKey: credential.apiKey };
    case 'auth-token':
      return { authToken: credential.authToken };
    default:
      return {};
  }
}

/**
 * A base URL override is only honoured when it looks like a real Anthropic host.
 * SystemGen learned this the hard way: a leftover OpenAI/LM-Studio URL points the
 * client at an unreachable host and the user sees a bare "Connection error".
 */
export function resolveBaseUrl(raw: string | undefined): string | undefined {
  const url = (raw ?? '').trim();
  if (!url) return undefined;
  if (/localhost:1234|127\.0\.0\.1:1234/.test(url)) return undefined;
  if (/\/v1\/?$/.test(url)) return undefined;
  return url.replace(/\/+$/, '');
}

// ── Claude membership sign-in, via the `ant` CLI ─────────────────────────────

/**
 * The CLI is not bundled. When it is missing the UI must say so and point at
 * pasting a key instead, rather than offering a button that cannot work.
 */
async function findAnt(): Promise<string | null> {
  const command = process.platform === 'win32' ? 'where' : 'which';
  try {
    const { stdout } = await run(command, ['ant'], { timeout: 5_000 });
    const first = stdout.split(/\r?\n/).find((line) => line.trim());
    return first ? first.trim() : null;
  } catch {
    return null;
  }
}

export interface ClaudeAuthStatus {
  signedIn: boolean;
  antInstalled: boolean;
  /** Which credential the provider will actually use right now. */
  credential: AnthropicCredential['kind'];
  detail: string;
}

export async function claudeStatus(): Promise<ClaudeAuthStatus> {
  const antPath = await findAnt();
  const credential = detectCredential();
  let detail = credential.detail;

  if (antPath) {
    try {
      const { stdout, stderr } = await run(antPath, ['auth', 'status'], { timeout: 5_000 });
      const output = (stdout || stderr || '').trim();
      if (output) detail = output.slice(0, 400);
    } catch (err) {
      // `ant auth status` exits non-zero when signed out; that is not an error here.
      const output = err instanceof Error ? err.message : '';
      if (output) detail = output.slice(0, 400);
    }
  }

  return {
    signedIn: isConfigured(credential),
    antInstalled: Boolean(antPath),
    credential: credential.kind,
    detail,
  };
}

export interface ClaudeAuthResult {
  ok: boolean;
  signedIn: boolean;
  message: string;
}

/**
 * Runs `ant auth login`, which opens a browser and blocks on the callback. The
 * five-minute timeout is the user's, not the network's.
 */
export async function claudeLogin(): Promise<ClaudeAuthResult> {
  const antPath = await findAnt();
  if (!antPath) {
    return {
      ok: false,
      signedIn: isConfigured(detectCredential()),
      message:
        'The ant CLI is not installed, so browser sign-in is unavailable. ' +
        'Install it from the Anthropic CLI docs, then try again, or set ANTHROPIC_API_KEY in your .env file instead.',
    };
  }

  try {
    await run(antPath, ['auth', 'login'], { timeout: 300_000 });
  } catch (err) {
    const detail = err instanceof Error ? err.message : 'unknown error';
    const timedOut = /ETIMEDOUT|timed out/i.test(detail);
    return {
      ok: false,
      signedIn: isConfigured(detectCredential()),
      message: timedOut ? 'Sign-in timed out after 5 minutes. Please try again.' : `Sign-in did not complete: ${detail.slice(0, 300)}`,
    };
  }

  const signedIn = isConfigured(detectCredential());
  return {
    ok: signedIn,
    signedIn,
    message: signedIn ? 'Signed in with Claude.' : 'Sign-in finished but no credential was detected.',
  };
}

export async function claudeLogout(): Promise<ClaudeAuthResult> {
  const antPath = await findAnt();
  if (!antPath) {
    return { ok: false, signedIn: isConfigured(detectCredential()), message: 'The ant CLI is not installed.' };
  }
  try {
    await run(antPath, ['auth', 'logout'], { timeout: 30_000 });
  } catch (err) {
    const detail = err instanceof Error ? err.message : 'unknown error';
    return { ok: false, signedIn: isConfigured(detectCredential()), message: `Sign-out failed: ${detail.slice(0, 300)}` };
  }
  const signedIn = isConfigured(detectCredential());
  return { ok: true, signedIn, message: signedIn ? 'Signed out, but another credential is still configured.' : 'Signed out.' };
}
