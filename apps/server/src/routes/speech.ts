import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { HttpError } from '../services/entities.js';
import { DEFAULT_VOICE, SpeechError, getSpeechService, type SpeechService } from '../speech/kokoro.js';

const SpeakBody = z.object({
  text: z.string().trim().min(1).max(1000),
  voice: z.string().default(DEFAULT_VOICE),
});

export async function speechRoutes(app: FastifyInstance, options: { speech?: SpeechService }) {
  const speech = options.speech ?? getSpeechService();

  /** Kokoro's voices and whether the model is loaded yet. Listing voices also starts the model loading. */
  app.get('/speech', async () => {
    speech.warm();
    return { ...speech.status(), voices: await speech.voices() };
  });

  app.post('/speech', async (request, reply) => {
    const { text, voice } = SpeakBody.parse(request.body);
    try {
      const wav = await speech.synthesize(text, voice);
      return reply.type('audio/wav').header('cache-control', 'private, max-age=86400').send(wav);
    } catch (err) {
      if (err instanceof SpeechError) throw new HttpError(err.statusCode, err.message);
      throw err;
    }
  });
}
