import { describe, expect, it } from 'vitest';
import { SpeechError, SpeechService, type SpeechEngine } from './kokoro.js';

const VOICES = {
  af_heart: { name: 'Heart', language: 'en-us', gender: 'Female', overallGrade: 'A' },
  bm_george: { name: 'George', language: 'en-gb', gender: 'Male', overallGrade: 'C' },
};

function fakeEngine(options: { failLoads?: number } = {}) {
  const calls: string[] = [];
  let loads = 0;
  let failures = options.failLoads ?? 0;
  const engine: SpeechEngine = {
    async loadVoices() {
      return VOICES;
    },
    async loadModel() {
      loads += 1;
      if (failures > 0) {
        failures -= 1;
        throw new Error('offline');
      }
      return {
        async generate(text, { voice }) {
          calls.push(`${voice}:${text}`);
          await new Promise((resolve) => setTimeout(resolve, 5));
          return { toWav: () => new TextEncoder().encode(`${voice}:${text}`).buffer as ArrayBuffer };
        },
      };
    },
  };
  return { engine, calls, loads: () => loads };
}

describe('SpeechService', () => {
  it('lists voices with their grades', async () => {
    const service = new SpeechService(fakeEngine().engine);
    expect(await service.voices()).toEqual([
      { id: 'af_heart', name: 'Heart', language: 'en-us', gender: 'Female', grade: 'A' },
      { id: 'bm_george', name: 'George', language: 'en-gb', gender: 'Male', grade: 'C' },
    ]);
  });

  it('caches audio and shares a request already in flight', async () => {
    const fake = fakeEngine();
    const service = new SpeechService(fake.engine);

    const [a, b] = await Promise.all([service.synthesize('Hello.', 'af_heart'), service.synthesize('Hello.', 'af_heart')]);
    await service.synthesize('Hello.', 'af_heart');
    await service.synthesize('Hello.', 'bm_george');

    expect(a.toString()).toBe('af_heart:Hello.');
    expect(b).toBe(a);
    expect(fake.calls).toEqual(['af_heart:Hello.', 'bm_george:Hello.']);
    expect(fake.loads()).toBe(1);
    expect(service.status().status).toBe('ready');
  });

  it('evicts the least recently used audio once over budget', async () => {
    const fake = fakeEngine();
    // Each clip is 'af_heart:X.' = 11 bytes, so two fit.
    const service = new SpeechService(fake.engine, 22);
    await service.synthesize('A.', 'af_heart');
    await service.synthesize('B.', 'af_heart');
    await service.synthesize('A.', 'af_heart');
    await service.synthesize('C.', 'af_heart');
    await service.synthesize('A.', 'af_heart');
    await service.synthesize('B.', 'af_heart');

    expect(fake.calls).toEqual(['af_heart:A.', 'af_heart:B.', 'af_heart:C.', 'af_heart:B.']);
  });

  it('rejects unknown voices without loading the model', async () => {
    const fake = fakeEngine();
    const service = new SpeechService(fake.engine);
    await expect(service.synthesize('Hi.', 'nobody')).rejects.toMatchObject({ statusCode: 400 });
    expect(fake.loads()).toBe(0);
  });

  it('reports a failed load and retries on the next request', async () => {
    const fake = fakeEngine({ failLoads: 1 });
    const service = new SpeechService(fake.engine);

    const failed = service.synthesize('Hi.', 'af_heart');
    await expect(failed).rejects.toBeInstanceOf(SpeechError);
    await expect(failed).rejects.toMatchObject({ statusCode: 503 });
    expect(service.status()).toEqual({ status: 'error', error: 'offline' });

    expect((await service.synthesize('Hi.', 'af_heart')).toString()).toBe('af_heart:Hi.');
    expect(fake.loads()).toBe(2);
  });
});
