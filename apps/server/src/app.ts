import cors from '@fastify/cors';
import fastifyStatic from '@fastify/static';
import Fastify, { type FastifyInstance } from 'fastify';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { ZodError } from 'zod';
import { config } from './config.js';
import { createDb, getDb, type Db, type Sqlite } from './db/client.js';
import { runMigrations } from './db/migrate.js';
import { HttpError } from './services/entities.js';
import { registerRoutes } from './routes/index.js';
import { resetOrphanedRuns } from './generation/runner.js';

declare module 'fastify' {
  interface FastifyInstance {
    db: Db;
    sqlite: Sqlite;
    /** Where backup files are kept. */
    backupDir: string;
  }
}

export interface BuildAppOptions {
  dbPath?: string;
  /** Overrides the backups folder, which otherwise sits beside the database. */
  backupDir?: string;
  logger?: boolean;
  serveStatic?: boolean;
}

/** Backups live in a folder next to the database. An in-memory database has no folder, so it gets a temp one. */
function defaultBackupDir(dbPath: string): string {
  const base = dbPath === ':memory:' ? path.join(os.tmpdir(), 'storytime-memory') : path.dirname(dbPath);
  return path.join(base, 'backups');
}

export async function buildApp(options: BuildAppOptions = {}): Promise<FastifyInstance> {
  const app = Fastify({
    logger: options.logger ?? (!config.isTest && { level: 'info' }),
    bodyLimit: 8 * 1024 * 1024,
  });

  const { db, sqlite } = options.dbPath ? createDb(options.dbPath) : getDb();
  runMigrations(db);
  app.decorate('db', db);
  app.decorate('sqlite', sqlite);
  app.decorate('backupDir', options.backupDir ?? defaultBackupDir(options.dbPath ?? config.dbPath));

  // A run that was in flight when the process died can never resume.
  resetOrphanedRuns(db);

  await app.register(cors, { origin: true });

  app.setErrorHandler((error, request, reply) => {
    if (error instanceof ZodError) {
      return reply.status(400).send({
        error: 'ValidationError',
        message: 'The request body did not match what this endpoint expects.',
        issues: error.issues.map((i) => ({ path: i.path.join('.'), message: i.message })),
      });
    }
    if (error instanceof HttpError) {
      return reply.status(error.statusCode).send({ error: error.constructor.name, message: error.message });
    }
    const withStatus = error as { statusCode?: number; message?: string };
    const status = withStatus.statusCode && withStatus.statusCode >= 400 ? withStatus.statusCode : 500;
    if (status >= 500) request.log.error({ err: error }, 'Unhandled error');
    return reply
      .status(status)
      .send({ error: 'InternalError', message: withStatus.message || 'Something went wrong.' });
  });

  app.setNotFoundHandler((request, reply) => {
    if (request.url.startsWith('/api')) {
      return reply.status(404).send({ error: 'NotFound', message: `No route for ${request.method} ${request.url}` });
    }
    // SPA fallback so deep links work when serving the built front end.
    if (options.serveStatic !== false && fs.existsSync(`${config.webDist}/index.html`)) {
      return reply.type('text/html').send(fs.readFileSync(`${config.webDist}/index.html`));
    }
    return reply.status(404).send({ error: 'NotFound', message: 'Not found.' });
  });

  await app.register(registerRoutes, { prefix: '/api' });

  if (options.serveStatic !== false && fs.existsSync(config.webDist)) {
    await app.register(fastifyStatic, { root: config.webDist, prefix: '/' });
  }

  app.addHook('onClose', async () => {
    if (options.dbPath) sqlite.close();
  });

  return app;
}
