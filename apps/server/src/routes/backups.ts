import fs from 'node:fs';
import { Readable } from 'node:stream';
import type { FastifyInstance } from 'fastify';
import { BackupCreate, BackupRestore } from '@storytime/shared';
import { createBackupAndPrune } from '../backup/export.js';
import { BACKUP_EXT, assertBackupId, backupPath, deleteBackup, getBackup, listBackups } from '../backup/files.js';
import { importBackup, restoreBackup } from '../backup/restore.js';
import { badRequest, notFound } from '../services/entities.js';

/** An uploaded backup is the whole file; this is the most one may be. */
const UPLOAD_LIMIT = 1024 * 1024 * 1024;

export async function backupRoutes(app: FastifyInstance) {
  const target = { sqlite: app.sqlite, backupDir: app.backupDir };

  // Registered here, not on the app, so the larger limit and raw body apply to this plugin only.
  app.addContentTypeParser('application/octet-stream', { parseAs: 'buffer', bodyLimit: UPLOAD_LIMIT }, (_request, body, done) =>
    done(null, body),
  );

  app.get('/backups', async () => ({ backups: await listBackups(app.backupDir), dir: app.backupDir }));

  app.post('/backups', async (request, reply) => {
    const body = BackupCreate.parse(request.body ?? {});
    const summary = await createBackupAndPrune(target, { projectIds: body.projectIds, label: body.label, kind: 'manual' });
    return reply.status(201).send(summary);
  });

  // Declared before /backups/:id so "import" is never read as an id.
  app.post('/backups/import', { bodyLimit: UPLOAD_LIMIT }, async (request, reply) => {
    const body = request.body;
    if (!Buffer.isBuffer(body) || body.length === 0) throw badRequest('Send the backup file as the request body.');
    const summary = await importBackup(app.backupDir, Readable.from([body]));
    return reply.status(201).send(summary);
  });

  app.get('/backups/:id', async (request) => {
    const { id } = request.params as { id: string };
    return getBackup(app.backupDir, assertBackupId(id));
  });

  app.get('/backups/:id/download', async (request, reply) => {
    const { id } = request.params as { id: string };
    const file = backupPath(app.backupDir, id);
    let size: number;
    try {
      size = fs.statSync(file).size;
    } catch {
      throw notFound('Backup');
    }
    return reply
      .header('content-type', 'application/gzip')
      .header('content-length', size)
      .header('content-disposition', `attachment; filename="${id}${BACKUP_EXT}"`)
      .send(fs.createReadStream(file));
  });

  app.delete('/backups/:id', async (request, reply) => {
    const { id } = request.params as { id: string };
    deleteBackup(app.backupDir, id);
    return reply.status(204).send();
  });

  app.post('/backups/:id/restore', async (request) => {
    const { id } = request.params as { id: string };
    assertBackupId(id);
    return restoreBackup(target, id, BackupRestore.parse(request.body ?? {}));
  });
}
