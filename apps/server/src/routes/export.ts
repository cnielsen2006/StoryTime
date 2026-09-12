import type { FastifyInstance } from 'fastify';
import { badRequest } from '../services/entities.js';
import { assembleManuscript } from '../services/manuscript.js';
import { toMarkdown, toPlainText } from '../export/markdown.js';
import { readProject } from './projects.js';

/** Safe ASCII filename derived from the project title. */
function slugify(title: string): string {
  const slug = title
    .normalize('NFKD')
    .replace(/[^\w\s-]/g, '')
    .trim()
    .replace(/\s+/g, '-')
    .toLowerCase()
    .slice(0, 60);
  return slug || 'manuscript';
}

export async function exportRoutes(app: FastifyInstance) {
  const db = app.db;

  app.get('/projects/:id/export', async (request, reply) => {
    const { id } = request.params as { id: string };
    const { format = 'md', includeTitles } = request.query as { format?: string; includeTitles?: string };
    readProject(db, id);

    if (format !== 'md' && format !== 'txt') {
      throw badRequest('Supported export formats are "md" and "txt".');
    }

    const manuscript = assembleManuscript(db, id);
    if (manuscript.chapters.length === 0 && !manuscript.draft) {
      throw badRequest('There is nothing written yet to export.');
    }

    const options = { includeTitles: includeTitles !== 'false' };
    const body = format === 'md' ? toMarkdown(manuscript, options) : toPlainText(manuscript, options);
    const filename = `${slugify(manuscript.title)}.${format}`;

    return reply
      .header('content-type', format === 'md' ? 'text/markdown; charset=utf-8' : 'text/plain; charset=utf-8')
      .header('content-disposition', `attachment; filename="${filename}"`)
      .send(body);
  });

  /** Same content, as JSON, for the in-app preview. */
  app.get('/projects/:id/manuscript', async (request) => {
    const { id } = request.params as { id: string };
    readProject(db, id);
    return assembleManuscript(db, id);
  });
}
