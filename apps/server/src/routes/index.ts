import type { FastifyInstance } from 'fastify';
import { characterRoutes } from './characters.js';
import { chapterRoutes } from './chapters.js';
import { exportRoutes } from './export.js';
import { ideaRoutes } from './ideas.js';
import { ideateRoutes } from './ideate.js';
import { locationRoutes } from './locations.js';
import { plotRoutes } from './plot.js';
import { projectRoutes } from './projects.js';
import { revisionRoutes } from './revisions.js';
import { runRoutes } from './runs.js';
import { settingsRoutes } from './settings.js';
import { versionRoutes } from './versions.js';

export async function registerRoutes(app: FastifyInstance) {
  app.get('/health', async () => ({ status: 'ok', now: Date.now() }));

  await app.register(projectRoutes);
  await app.register(characterRoutes);
  await app.register(locationRoutes);
  await app.register(plotRoutes);
  await app.register(ideaRoutes);
  await app.register(ideateRoutes);
  await app.register(chapterRoutes);
  await app.register(versionRoutes);
  await app.register(revisionRoutes);
  await app.register(runRoutes);
  await app.register(exportRoutes);
  await app.register(settingsRoutes);
}
