import type { RunEvent } from '@storytime/shared';

type Listener = (event: RunEvent) => void;

/**
 * Distributes over the union so each variant keeps its own fields. A plain
 * Omit<RunEvent, 'seq'> would collapse them to their common keys.
 */
export type RunEventInput = RunEvent extends infer T ? (T extends { seq: number } ? Omit<T, 'seq'> : never) : never;

const MAX_BUFFERED = 20_000;
/** How long a finished run's events stay replayable after it ends. */
const RETAIN_AFTER_FINISH_MS = 10 * 60 * 1000;

interface Channel {
  events: RunEvent[];
  listeners: Set<Listener>;
  seq: number;
  finished: boolean;
  expiresAt: number | null;
}

const channels = new Map<string, Channel>();

function channelFor(runId: string): Channel {
  let channel = channels.get(runId);
  if (!channel) {
    channel = { events: [], listeners: new Set(), seq: 0, finished: false, expiresAt: null };
    channels.set(runId, channel);
  }
  return channel;
}

function sweep() {
  const now = Date.now();
  for (const [runId, channel] of channels) {
    if (channel.expiresAt !== null && channel.expiresAt < now && channel.listeners.size === 0) {
      channels.delete(runId);
    }
  }
}

/**
 * Push an event to every live listener and keep it for replay, so a browser that
 * reconnects mid-run (or opens the run page late) sees the whole stream.
 */
export function emit(runId: string, event: RunEventInput): RunEvent {
  const channel = channelFor(runId);
  channel.seq += 1;
  const full = { ...event, seq: channel.seq } as RunEvent;

  channel.events.push(full);
  if (channel.events.length > MAX_BUFFERED) {
    channel.events.splice(0, channel.events.length - MAX_BUFFERED);
  }

  for (const listener of channel.listeners) {
    try {
      listener(full);
    } catch {
      // A broken listener must never take down a run.
    }
  }

  if (full.type === 'done' || full.type === 'error') {
    channel.finished = true;
    channel.expiresAt = Date.now() + RETAIN_AFTER_FINISH_MS;
    sweep();
  }
  return full;
}

/** Events after `afterSeq`, for a client resuming from Last-Event-ID. */
export function replay(runId: string, afterSeq = 0): RunEvent[] {
  const channel = channels.get(runId);
  if (!channel) return [];
  return channel.events.filter((event) => event.seq > afterSeq);
}

export function isFinished(runId: string): boolean {
  return channels.get(runId)?.finished ?? false;
}

export function subscribe(runId: string, listener: Listener): () => void {
  const channel = channelFor(runId);
  channel.listeners.add(listener);
  return () => {
    channel.listeners.delete(listener);
    sweep();
  };
}

/** Test hook: drop all buffered runs. */
export function resetEvents() {
  channels.clear();
}
