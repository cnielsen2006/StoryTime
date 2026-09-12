import { useEffect, useState } from 'react';
import { Link } from 'react-router';
import {
  useClaudeAuth,
  useClaudeLogin,
  useClaudeLogout,
  useModels,
  useProviders,
  useSaveSettings,
  useSettings,
  useTestProvider,
} from '../api/hooks.js';
import { ErrorNote, Select, Spinner, TextInput } from '../components/ui.js';

/** What the server found when it looked for a Claude credential. */
const CREDENTIAL_LABELS: Record<string, string> = {
  'api-key': 'Using an API key from your .env file',
  'auth-token': 'Using ANTHROPIC_AUTH_TOKEN from your environment',
  membership: 'Signed in with a Claude membership',
  none: 'Not signed in',
};

export function SettingsPage() {
  const { data: settings, isLoading } = useSettings();
  const { data: providers } = useProviders();
  const save = useSaveSettings();
  const test = useTestProvider();
  const { data: claudeAuth } = useClaudeAuth();
  const claudeLogin = useClaudeLogin();
  const claudeLogout = useClaudeLogout();
  const [authMessage, setAuthMessage] = useState<{ ok: boolean; message: string } | null>(null);

  const [provider, setProvider] = useState('');
  const [model, setModel] = useState('');
  const [effort, setEffort] = useState('');
  const [ollamaUrl, setOllamaUrl] = useState('');
  const [testResult, setTestResult] = useState<{ ok: boolean; message: string } | null>(null);

  useEffect(() => {
    if (!settings) return;
    setProvider(settings.defaultProvider);
    setModel(settings.defaultModel);
    setEffort(settings.defaultEffort);
    setOllamaUrl(settings.ollamaBaseUrl);
  }, [settings]);

  const { data: models } = useModels(provider || undefined);

  if (isLoading) return <div className="mx-auto max-w-2xl px-6 py-10"><Spinner /></div>;

  return (
    <div className="mx-auto max-w-2xl px-6 py-10">
      <div className="mb-8 flex items-center gap-3">
        <Link to="/" className="text-sm text-ink-400 hover:text-ink-700">
          ← Books
        </Link>
        <h1 className="text-xl font-semibold text-ink-900">Settings</h1>
      </div>

      <section className="space-y-4">
        <div>
          <h2 className="text-base font-semibold text-ink-900">Default model</h2>
          <p className="mt-1 text-sm text-ink-500">
            Used by any book that does not set its own. Each book can override this in its Parameters.
          </p>
        </div>

        <Select
          label="Provider"
          value={provider}
          onChange={(value) => {
            setProvider(value);
            setModel('');
            setTestResult(null);
          }}
          options={(providers ?? []).map((p) => ({
            value: p.id,
            label: p.configured ? p.label : `${p.label} (needs setup)`,
          }))}
        />

        {models && models.length > 0 ? (
          <Select
            label="Model"
            value={model}
            onChange={setModel}
            options={models.map((m) => ({ value: m.id, label: m.displayName }))}
          />
        ) : (
          <TextInput label="Model" value={model} onChange={setModel} placeholder="claude-opus-5" />
        )}

        <Select
          label="Effort"
          hint="How hard the model works on each request."
          value={effort}
          onChange={setEffort}
          options={[
            { value: 'low', label: 'Low, fastest and cheapest' },
            { value: 'medium', label: 'Medium' },
            { value: 'high', label: 'High' },
            { value: 'xhigh', label: 'Very high' },
            { value: 'max', label: 'Maximum, slowest' },
          ]}
        />

        {provider === 'ollama' ? (
          <TextInput label="Ollama address" value={ollamaUrl} onChange={setOllamaUrl} />
        ) : null}

        <ErrorNote error={save.error} />

        <div className="flex items-center gap-2">
          <button
            className="btn-primary"
            disabled={save.isPending}
            onClick={() =>
              save.mutate({
                defaultProvider: provider as never,
                defaultModel: model,
                defaultEffort: effort as never,
                ollamaBaseUrl: ollamaUrl,
              })
            }
          >
            {save.isPending ? 'Saving…' : 'Save'}
          </button>
          <button
            className="btn-secondary"
            disabled={!provider || test.isPending}
            onClick={async () => setTestResult(await test.mutateAsync(provider))}
          >
            {test.isPending ? 'Testing…' : 'Test connection'}
          </button>
        </div>

        {testResult ? (
          <p className={`text-sm ${testResult.ok ? 'text-emerald-700' : 'text-red-600'}`}>{testResult.message}</p>
        ) : null}
      </section>

      <section className="mt-10 space-y-3 border-t border-ink-200 pt-8">
        <h2 className="text-base font-semibold text-ink-900">Claude sign-in</h2>
        <p className="text-sm text-ink-500">
          {claudeAuth?.signedIn
            ? 'Claude is ready to use. No API key needed while you stay signed in.'
            : 'Sign in with a Claude membership to use Claude without pasting an API key.'}
        </p>

        {claudeAuth ? (
          <div className="card space-y-3 p-4">
            <div className="flex items-center gap-3">
              <span
                className={`inline-block h-2 w-2 shrink-0 rounded-full ${
                  claudeAuth.signedIn ? 'bg-emerald-500' : 'bg-ink-300'
                }`}
              />
              <div className="text-sm font-medium text-ink-800">{CREDENTIAL_LABELS[claudeAuth.credential]}</div>
            </div>

            {claudeAuth.antInstalled ? (
              <div className="flex items-center gap-2">
                {claudeAuth.credential === 'membership' ? (
                  <button
                    className="btn-secondary"
                    disabled={claudeLogout.isPending}
                    onClick={async () => setAuthMessage(await claudeLogout.mutateAsync())}
                  >
                    {claudeLogout.isPending ? 'Signing out…' : 'Sign out'}
                  </button>
                ) : (
                  <button
                    className="btn-secondary"
                    disabled={claudeLogin.isPending}
                    onClick={async () => setAuthMessage(await claudeLogin.mutateAsync())}
                  >
                    {claudeLogin.isPending ? 'Waiting for your browser…' : 'Sign in with Claude'}
                  </button>
                )}
              </div>
            ) : (
              <p className="text-xs text-ink-500">
                Browser sign-in needs the ant command line tool, which is not installed. Install it, or set
                ANTHROPIC_API_KEY in your .env file instead.
              </p>
            )}

            {claudeLogin.isPending ? (
              <p className="text-xs text-ink-500">A browser window has opened. Finish signing in there.</p>
            ) : null}

            {authMessage ? (
              <p className={`text-sm ${authMessage.ok ? 'text-emerald-700' : 'text-red-600'}`}>{authMessage.message}</p>
            ) : null}
          </div>
        ) : null}
      </section>

      <section className="mt-10 space-y-3 border-t border-ink-200 pt-8">
        <h2 className="text-base font-semibold text-ink-900">Providers</h2>
        <p className="text-sm text-ink-500">
          API keys are read from the .env file in the project folder. They are never sent to the browser.
        </p>
        <ul className="space-y-2">
          {providers?.map((p) => (
            <li key={p.id} className="card flex items-start gap-3 p-4">
              <span
                className={`mt-1 inline-block h-2 w-2 shrink-0 rounded-full ${
                  p.configured ? 'bg-emerald-500' : 'bg-ink-300'
                }`}
              />
              <div>
                <div className="text-sm font-medium text-ink-800">{p.label}</div>
                <p className="mt-0.5 text-xs text-ink-500">{p.detail}</p>
              </div>
            </li>
          ))}
        </ul>
      </section>
    </div>
  );
}
