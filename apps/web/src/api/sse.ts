import { useEffect, useMemo, useRef, useState } from 'react';
import type { OutlineResult, RunEvent, StopReason, VersionTargetType } from '@storytime/shared';

export interface TargetProgress {
  targetType: VersionTargetType;
  targetId: string;
  label: string;
  text: string;
  done: boolean;
  wordCount: number;
}

export interface RunStreamState {
  connected: boolean;
  status: string | null;
  targets: TargetProgress[];
  outline: OutlineResult | null;
  usage: { inputTokens: number; outputTokens: number; cacheReadTokens: number } | null;
  finished: boolean;
  outcome: 'succeeded' | 'cancelled' | null;
  stopReason: StopReason | null;
  error: { message: string; retryable: boolean } | null;
}

const initialState: RunStreamState = {
  connected: false,
  status: null,
  targets: [],
  outline: null,
  usage: null,
  finished: false,
  outcome: null,
  stopReason: null,
  error: null,
};

/**
 * Subscribe to a run's server-sent events.
 *
 * The server replays everything buffered before streaming live, so opening this
 * late (or after a refresh) still shows the whole run. EventSource sends
 * Last-Event-ID on its own reconnects.
 */
export function useRunStream(runId: string | undefined): RunStreamState {
  const [state, setState] = useState<RunStreamState>(initialState);
  const sourceRef = useRef<EventSource | null>(null);

  useEffect(() => {
    if (!runId) {
      setState(initialState);
      return;
    }

    setState({ ...initialState });
    const source = new EventSource(`/api/runs/${runId}/events`);
    sourceRef.current = source;

    source.onopen = () => setState((prev) => ({ ...prev, connected: true }));

    const handle = (event: MessageEvent<string>) => {
      let parsed: RunEvent;
      try {
        parsed = JSON.parse(event.data) as RunEvent;
      } catch {
        return;
      }

      setState((prev) => {
        switch (parsed.type) {
          case 'status':
            return { ...prev, status: parsed.message };

          case 'target_started':
            if (prev.targets.some((t) => t.targetId === parsed.targetId)) return prev;
            return {
              ...prev,
              targets: [
                ...prev.targets,
                {
                  targetType: parsed.targetType,
                  targetId: parsed.targetId,
                  label: parsed.label,
                  text: '',
                  done: false,
                  wordCount: 0,
                },
              ],
            };

          case 'text':
            return {
              ...prev,
              targets: prev.targets.map((target) =>
                target.targetId === parsed.targetId ? { ...target, text: target.text + parsed.delta } : target,
              ),
            };

          case 'target_done':
            return {
              ...prev,
              targets: prev.targets.map((target) =>
                target.targetId === parsed.targetId
                  ? { ...target, done: true, wordCount: parsed.wordCount }
                  : target,
              ),
            };

          case 'outline':
            return { ...prev, outline: parsed.outline };

          case 'usage':
            return {
              ...prev,
              usage: {
                inputTokens: parsed.inputTokens,
                outputTokens: parsed.outputTokens,
                cacheReadTokens: parsed.cacheReadTokens,
              },
            };

          case 'done':
            return { ...prev, finished: true, outcome: parsed.status, stopReason: parsed.stopReason, status: null };

          case 'error':
            return {
              ...prev,
              finished: true,
              error: { message: parsed.message, retryable: parsed.retryable },
              status: null,
            };

          default:
            return prev;
        }
      });
    };

    // The server names each event, so listen per type plus the default channel.
    const types = ['status', 'target_started', 'text', 'target_done', 'outline', 'usage', 'done', 'error'];
    for (const type of types) source.addEventListener(type, handle as EventListener);
    source.onmessage = handle;

    source.onerror = () => {
      // EventSource retries on its own; only report a hard close.
      if (source.readyState === EventSource.CLOSED) {
        setState((prev) => (prev.finished ? prev : { ...prev, connected: false }));
      }
    };

    return () => {
      for (const type of types) source.removeEventListener(type, handle as EventListener);
      source.close();
      sourceRef.current = null;
    };
  }, [runId]);

  // Close the stream once the run reports it is over.
  useEffect(() => {
    if (state.finished) sourceRef.current?.close();
  }, [state.finished]);

  return state;
}

/** All streamed text so far, for a single-target run. */
export function useStreamedText(state: RunStreamState): string {
  return useMemo(() => state.targets.map((t) => t.text).join('\n\n'), [state.targets]);
}
