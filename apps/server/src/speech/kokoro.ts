import path from 'node:path';
import { repoRoot } from '../config.js';

/**
 * Kokoro text-to-speech, run on the server so every device on the LAN hears the
 * same natural voice regardless of what voices its browser ships with.
 *
 * The model (~90 MB) downloads from Hugging Face on first use and is cached in
 * data/models. Synthesis runs about twice as fast as real time on a CPU, so
 * requests are queued one at a time: running several at once only makes each
 * one slower, and the reader always wants the segment it is about to play.
 */

export const MODEL_ID = 'onnx-community/Kokoro-82M-v1.0-ONNX';
export const DEFAULT_VOICE = 'af_heart';
const MODEL_CACHE_DIR = path.join(repoRoot, 'data/models');
const LOAD_TIMEOUT_MS = 10 * 60_000;
const CACHE_BYTES = 96 * 1024 * 1024;

export interface SpeechVoice {
  id: string;
  name: string;
  /** BCP 47 tag, en-us or en-gb. */
  language: string;
  gender: string;
  /** Kokoro's own quality grade, A (best) to F. */
  grade: string;
}

export type SpeechStatus = 'idle' | 'loading' | 'ready' | 'error';

/** The slice of KokoroTTS this service uses, so tests can substitute a fake. */
export interface SpeechModel {
  generate(text: string, options: { voice: string }): Promise<{ toWav(): ArrayBuffer }>;
}

interface VoiceInfo {
  name: string;
  language: string;
  gender: string;
  overallGrade: string;
}

export interface SpeechEngine {
  loadModel(): Promise<SpeechModel>;
  loadVoices(): Promise<Record<string, VoiceInfo>>;
}

const kokoroEngine: SpeechEngine = {
  async loadModel() {
    const [{ KokoroTTS }, { env }] = await Promise.all([import('kokoro-js'), import('@huggingface/transformers')]);
    env.cacheDir = MODEL_CACHE_DIR;
    return KokoroTTS.from_pretrained(MODEL_ID, { dtype: 'q8', device: 'cpu' }) as Promise<SpeechModel>;
  },
  async loadVoices() {
    const { KokoroTTS } = await import('kokoro-js');
    // The catalogue is static but only exposed as an instance getter; reading it
    // off the prototype avoids loading the model just to list voices.
    return Reflect.get(KokoroTTS.prototype, 'voices') as Record<string, VoiceInfo>;
  },
};

export class SpeechError extends Error {
  constructor(
    message: string,
    /** 400 for a bad request, 503 when the model itself is unavailable. */
    readonly statusCode = 503,
  ) {
    super(message);
  }
}

export class SpeechService {
  private model: Promise<SpeechModel> | null = null;
  private state: SpeechStatus = 'idle';
  private lastError: string | null = null;
  private voiceList: SpeechVoice[] | null = null;
  private queue: Promise<unknown> = Promise.resolve();
  /** Finished audio by voice and text, oldest first so eviction is a Map walk. */
  private cache = new Map<string, Buffer>();
  private cacheBytes = 0;
  private inFlight = new Map<string, Promise<Buffer>>();

  constructor(
    private readonly engine: SpeechEngine = kokoroEngine,
    private readonly maxCacheBytes = CACHE_BYTES,
  ) {}

  status(): { status: SpeechStatus; error: string | null } {
    return { status: this.state, error: this.lastError };
  }

  async voices(): Promise<SpeechVoice[]> {
    if (!this.voiceList) {
      const voices = await this.engine.loadVoices();
      this.voiceList = Object.entries(voices).map(([id, v]) => ({
        id,
        name: v.name,
        language: v.language,
        gender: v.gender,
        grade: v.overallGrade,
      }));
    }
    return this.voiceList;
  }

  /** Starts loading the model without waiting for it, so the first segment is not the slow one. */
  warm() {
    this.loadModel().catch(() => {
      // Surfaced through status() and the next synthesize().
    });
  }

  /** WAV audio for the text, from the cache when this exact line was spoken before. */
  async synthesize(text: string, voice: string): Promise<Buffer> {
    const voices = await this.voices();
    if (!voices.some((v) => v.id === voice)) throw new SpeechError(`Unknown Kokoro voice "${voice}".`, 400);

    const key = `${voice}\n${text}`;
    const cached = this.cache.get(key);
    if (cached) {
      // Re-insert to mark it recently used.
      this.cache.delete(key);
      this.cache.set(key, cached);
      return cached;
    }
    const pending = this.inFlight.get(key);
    if (pending) return pending;

    const job = this.enqueue(async () => {
      const model = await this.loadModel();
      const audio = await model.generate(text, { voice });
      return Buffer.from(audio.toWav());
    });
    this.inFlight.set(key, job);
    try {
      const wav = await job;
      this.remember(key, wav);
      return wav;
    } finally {
      this.inFlight.delete(key);
    }
  }

  private enqueue<T>(task: () => Promise<T>): Promise<T> {
    const run = this.queue.then(task, task);
    this.queue = run.catch(() => undefined);
    return run;
  }

  private loadModel(): Promise<SpeechModel> {
    if (this.model) return this.model;
    this.state = 'loading';
    this.lastError = null;
    let timer: NodeJS.Timeout | undefined;
    const timeout = new Promise<never>((_, reject) => {
      timer = setTimeout(
        () => reject(new SpeechError('Downloading the Kokoro voice model timed out. Check the connection and try again.')),
        LOAD_TIMEOUT_MS,
      );
    });
    this.model = Promise.race([this.engine.loadModel(), timeout]).then(
      (model) => {
        clearTimeout(timer);
        this.state = 'ready';
        return model;
      },
      (err: unknown) => {
        clearTimeout(timer);
        // Forget the failed attempt so the next request tries again.
        this.model = null;
        this.state = 'error';
        this.lastError = err instanceof Error ? err.message : String(err);
        throw err instanceof SpeechError ? err : new SpeechError(`Could not load the Kokoro voice model: ${this.lastError}`);
      },
    );
    return this.model;
  }

  private remember(key: string, wav: Buffer) {
    if (wav.byteLength > this.maxCacheBytes) return;
    this.cache.set(key, wav);
    this.cacheBytes += wav.byteLength;
    for (const [oldKey, oldWav] of this.cache) {
      if (this.cacheBytes <= this.maxCacheBytes) break;
      this.cache.delete(oldKey);
      this.cacheBytes -= oldWav.byteLength;
    }
  }
}

let shared: SpeechService | null = null;

export function getSpeechService(): SpeechService {
  shared ??= new SpeechService();
  return shared;
}
