import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { OutlineResult, RunEvent } from '@storytime/shared';
import { buildApp } from '../src/app.js';
import { seed } from '../src/db/seed.js';
import { resetEvents } from '../src/generation/events.js';

let app: FastifyInstance;
let dbPath: string;
let projectId: string;

/** Poll the run row until it leaves a non-terminal state. */
async function waitForRun(runId: string, timeoutMs = 20_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const res = await app.inject({ method: 'GET', url: `/api/runs/${runId}` });
    const run = res.json() as { status: string; error: string | null };
    if (['succeeded', 'failed', 'cancelled'].includes(run.status)) return run;
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  throw new Error(`Run ${runId} did not finish within ${timeoutMs}ms`);
}

/** Read the buffered SSE stream for a finished run. */
async function readEvents(runId: string): Promise<RunEvent[]> {
  const res = await app.inject({ method: 'GET', url: `/api/runs/${runId}/events` });
  return res.payload
    .split('\n')
    .filter((line) => line.startsWith('data: '))
    .map((line) => JSON.parse(line.slice(6)) as RunEvent);
}

async function startRun(body: Record<string, unknown>): Promise<string> {
  const res = await app.inject({ method: 'POST', url: `/api/projects/${projectId}/runs`, payload: body });
  expect(res.statusCode, res.payload).toBe(202);
  return (res.json() as { runId: string }).runId;
}

beforeAll(async () => {
  dbPath = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'storytime-test-')), 'test.db');
  app = await buildApp({ dbPath, logger: false, serveStatic: false });
  const result = seed(app.db);
  projectId = result.projectId;
});

afterAll(async () => {
  await app.close();
  resetEvents();
  fs.rmSync(path.dirname(dbPath), { recursive: true, force: true });
});

describe('project setup', () => {
  it('seeds a project with its full bible and change history', async () => {
    const res = await app.inject({ method: 'GET', url: `/api/projects/${projectId}/graph` });
    expect(res.statusCode).toBe(200);
    const graph = res.json();

    expect(graph.counts.characters).toBe(3);
    expect(graph.counts.locations).toBe(3);
    expect(graph.counts.plotPoints).toBe(8);
    expect(graph.counts.ideasInbox).toBe(3);
    expect(graph.characters[0].experiences.length).toBeGreaterThan(0);
    expect(graph.storyParameters.comparableTitles).toHaveLength(3);
  });

  it('records a revision entry whenever a character changes', async () => {
    const list = (await app.inject({ method: 'GET', url: `/api/projects/${projectId}/characters` })).json();
    const isolde = list.find((c: { name: string }) => c.name === 'Isolde Vance');

    await app.inject({
      method: 'PATCH',
      url: `/api/characters/${isolde.id}`,
      payload: { arcNotes: 'Revised arc for the revision test.' },
    });

    const revisions = (
      await app.inject({ method: 'GET', url: `/api/entities/character/${isolde.id}/revisions` })
    ).json();
    expect(revisions.length).toBeGreaterThanOrEqual(2);
    expect(revisions[0].summary).toContain('arcNotes');
  });
});

describe('inbox and triage', () => {
  it('captures a loose idea and files it against a character', async () => {
    const created = await app.inject({
      method: 'POST',
      url: `/api/projects/${projectId}/ideas`,
      payload: { text: 'Isolde hums the gear rhythm without noticing she is doing it.' },
    });
    expect(created.statusCode).toBe(201);
    const idea = created.json();
    expect(idea.status).toBe('inbox');

    const characters = (await app.inject({ method: 'GET', url: `/api/projects/${projectId}/characters` })).json();
    const isolde = characters.find((c: { name: string }) => c.name === 'Isolde Vance');

    const linked = await app.inject({
      method: 'POST',
      url: `/api/ideas/${idea.id}/links`,
      payload: { entityType: 'character', entityId: isolde.id, note: 'A tic to use in quiet scenes.' },
    });
    expect(linked.statusCode).toBe(201);
    expect(linked.json().status).toBe('triaged');
    expect(linked.json().links[0].entityLabel).toBe('Isolde Vance');

    const reverse = (
      await app.inject({ method: 'GET', url: `/api/entities/character/${isolde.id}/ideas` })
    ).json();
    expect(reverse.some((r: { id: string }) => r.id === idea.id)).toBe(true);
  });

  it('promotes an idea straight into a new location', async () => {
    const idea = (
      await app.inject({
        method: 'POST',
        url: `/api/projects/${projectId}/ideas`,
        payload: { text: 'A flooded boathouse where the tide never fully leaves.' },
      })
    ).json();

    const promoted = await app.inject({
      method: 'POST',
      url: `/api/ideas/${idea.id}/promote`,
      payload: { entityType: 'location', name: 'The boathouse' },
    });
    expect(promoted.statusCode).toBe(201);

    const location = (
      await app.inject({ method: 'GET', url: `/api/locations/${promoted.json().entityId}` })
    ).json();
    expect(location.name).toBe('The boathouse');
    expect(location.description).toContain('flooded boathouse');
  });
});

describe('generation: outline then chapters', () => {
  let chapterIds: string[] = [];

  it('produces a valid outline and materialises it into chapters', async () => {
    const runId = await startRun({ mode: 'chapters', kind: 'outline' });
    const run = await waitForRun(runId);
    expect(run.status, run.error ?? '').toBe('succeeded');

    const events = await readEvents(runId);
    const outlineEvent = events.find((e) => e.type === 'outline');
    expect(outlineEvent).toBeDefined();

    const outline = (outlineEvent as { outline: OutlineResult }).outline;
    expect(outline.chapters.length).toBeGreaterThan(0);

    const applied = await app.inject({
      method: 'PUT',
      url: `/api/projects/${projectId}/outline`,
      payload: outline,
    });
    expect(applied.statusCode).toBe(200);
    expect(applied.json().chaptersCreated).toBe(outline.chapters.length);

    const chapters = (await app.inject({ method: 'GET', url: `/api/projects/${projectId}/chapters` })).json();
    chapterIds = chapters.map((c: { id: string }) => c.id);
    expect(chapterIds.length).toBe(outline.chapters.length);
    // The outline referenced real plot point ids from the bible.
    expect(chapters[0].plotPointIds.length).toBeGreaterThan(0);
  });

  it('writes a chapter, streams the text, and records what the prompt contained', async () => {
    const runId = await startRun({ mode: 'chapters', kind: 'generate', targetIds: [chapterIds[0]] });
    const run = await waitForRun(runId);
    expect(run.status, run.error ?? '').toBe('succeeded');

    const events = await readEvents(runId);
    expect(events.filter((e) => e.type === 'text').length).toBeGreaterThan(0);

    const doneEvent = events.find((e) => e.type === 'target_done');
    expect(doneEvent).toBeDefined();

    const chapter = (await app.inject({ method: 'GET', url: `/api/chapters/${chapterIds[0]}` })).json();
    expect(chapter.currentVersionId).toBeTruthy();
    expect(chapter.wordCount).toBeGreaterThan(0);

    const version = (
      await app.inject({ method: 'GET', url: `/api/versions/${chapter.currentVersionId}` })
    ).json();
    expect(version.content).toContain('[MOCK');
    // Proof the story bible actually reached the provider.
    expect(version.content).toContain('Isolde Vance');
    expect(version.isCurrent).toBe(true);
  });

  it('marks the chapter hard stale when a focus character changes', async () => {
    const characters = (await app.inject({ method: 'GET', url: `/api/projects/${projectId}/characters` })).json();
    const isolde = characters.find((c: { name: string }) => c.name === 'Isolde Vance');

    await app.inject({
      method: 'PATCH',
      url: `/api/characters/${isolde.id}`,
      payload: { backstory: 'Rewritten backstory that invalidates the written chapter.' },
    });

    const chapter = (await app.inject({ method: 'GET', url: `/api/chapters/${chapterIds[0]}` })).json();
    expect(chapter.staleLevel).toBe('hard');
    expect(chapter.staleReasons[0].label).toBe('Isolde Vance');
    expect(chapter.staleReasons[0].field).toContain('backstory');
  });

  it('never downgrades a hard stale chapter to soft', async () => {
    const locations = (await app.inject({ method: 'GET', url: `/api/projects/${projectId}/locations` })).json();
    const village = locations.find((l: { name: string }) => l.name === 'Saltmere');

    await app.inject({
      method: 'PATCH',
      url: `/api/locations/${village.id}`,
      payload: { sensoryDetails: 'Changed background detail.' },
    });

    const chapter = (await app.inject({ method: 'GET', url: `/api/chapters/${chapterIds[0]}` })).json();
    expect(chapter.staleLevel).toBe('hard');
  });

  it('clears staleness when the author marks the chapter reviewed', async () => {
    const res = await app.inject({ method: 'POST', url: `/api/chapters/${chapterIds[0]}/mark-reviewed` });
    expect(res.json().staleLevel).toBe('none');
  });

  it('revises a chapter with instructions and can roll back', async () => {
    const before = (await app.inject({ method: 'GET', url: `/api/chapters/${chapterIds[0]}` })).json();
    const originalVersionId = before.currentVersionId;

    const runId = await startRun({
      mode: 'chapters',
      kind: 'update',
      targetType: 'chapter',
      targetId: chapterIds[0],
      instructions: 'Make the opening colder and cut the second paragraph.',
    });
    const run = await waitForRun(runId);
    expect(run.status, run.error ?? '').toBe('succeeded');

    const versions = (
      await app.inject({ method: 'GET', url: `/api/versions?targetType=chapter&targetId=${chapterIds[0]}` })
    ).json();
    expect(versions.length).toBe(2);

    const newest = versions[0];
    expect(newest.versionNo).toBe(2);
    expect(newest.parentVersionId).toBe(originalVersionId);
    expect(newest.instructions).toContain('colder');
    expect(newest.isCurrent).toBe(true);

    const rolledBack = await app.inject({ method: 'POST', url: `/api/versions/${originalVersionId}/make-current` });
    expect(rolledBack.json().isCurrent).toBe(true);

    const diff = (
      await app.inject({ method: 'GET', url: `/api/versions/${originalVersionId}/diff/${newest.id}` })
    ).json();
    expect(diff.lines.length).toBeGreaterThan(0);
  });

  it('rejects a second run while one is already in flight', async () => {
    const first = await app.inject({
      method: 'POST',
      url: `/api/projects/${projectId}/runs`,
      payload: { mode: 'chapters', kind: 'generate', targetIds: [chapterIds[0]] },
    });
    expect(first.statusCode).toBe(202);

    const second = await app.inject({
      method: 'POST',
      url: `/api/projects/${projectId}/runs`,
      payload: { mode: 'chapters', kind: 'generate', targetIds: [chapterIds[0]] },
    });
    expect(second.statusCode).toBe(409);

    await waitForRun((first.json() as { runId: string }).runId);
  });
});

describe('run preview and cancellation', () => {
  it('reports cost and warnings without calling a model', async () => {
    const res = await app.inject({
      method: 'POST',
      url: `/api/projects/${projectId}/runs/preview`,
      payload: { mode: 'chapters', kind: 'generate' },
    });
    expect(res.statusCode).toBe(200);
    const preview = res.json();

    expect(preview.provider).toBe('mock');
    expect(preview.systemPrompt).toContain('STORY BIBLE');
    expect(preview.systemPrompt).toContain('Isolde Vance');
    expect(preview.trim.estimatedTokens).toBeGreaterThan(0);
    expect(preview.trim.level).toBe('full');
    // The seed has loose "idea" plot points, which should be flagged.
    expect(preview.warnings.some((w: string) => w.includes('loose ideas'))).toBe(true);
  });

  it('cancels a slow run without saving a version', async () => {
    await app.inject({ method: 'PATCH', url: `/api/projects/${projectId}`, payload: { model: 'mock-slow' } });

    const chapters = (await app.inject({ method: 'GET', url: `/api/projects/${projectId}/chapters` })).json();
    const target = chapters[chapters.length - 1];
    const before = (
      await app.inject({ method: 'GET', url: `/api/versions?targetType=chapter&targetId=${target.id}` })
    ).json();

    const runId = await startRun({ mode: 'chapters', kind: 'generate', targetIds: [target.id] });
    await new Promise((resolve) => setTimeout(resolve, 150));

    const cancelled = await app.inject({ method: 'POST', url: `/api/runs/${runId}/cancel` });
    expect(cancelled.json().cancelled).toBe(true);

    const run = await waitForRun(runId);
    expect(run.status).toBe('cancelled');

    const after = (
      await app.inject({ method: 'GET', url: `/api/versions?targetType=chapter&targetId=${target.id}` })
    ).json();
    expect(after.length).toBe(before.length);

    await app.inject({ method: 'PATCH', url: `/api/projects/${projectId}`, payload: { model: 'mock-fast' } });
  });
});

describe('export', () => {
  it('exports the manuscript as markdown in chapter order', async () => {
    const res = await app.inject({ method: 'GET', url: `/api/projects/${projectId}/export?format=md` });
    expect(res.statusCode).toBe(200);
    expect(res.headers['content-type']).toContain('text/markdown');

    const body = res.payload;
    expect(body).toContain('# The Lantern Keeper');
    expect(body).toContain('## Chapter 1:');

    const firstIndex = body.indexOf('## Chapter 1:');
    const secondIndex = body.indexOf('## Chapter 2:');
    if (secondIndex !== -1) expect(firstIndex).toBeLessThan(secondIndex);
  });

  it('exports plain text without markdown markers', async () => {
    const res = await app.inject({ method: 'GET', url: `/api/projects/${projectId}/export?format=txt` });
    expect(res.statusCode).toBe(200);
    expect(res.payload).not.toContain('## Chapter');
    expect(res.payload).toContain('The Lantern Keeper');
  });
});

describe('whole-draft and scene modes', () => {
  it('writes a whole draft and splits it into chapters', async () => {
    const fresh = (
      await app.inject({
        method: 'POST',
        url: '/api/projects',
        payload: { title: 'Draft Mode Project', provider: 'mock', model: 'mock-fast' },
      })
    ).json();

    await app.inject({
      method: 'POST',
      url: `/api/projects/${fresh.id}/characters`,
      payload: { name: 'Test Character', description: 'Exists so the bible is not empty.' },
    });

    const runRes = await app.inject({
      method: 'POST',
      url: `/api/projects/${fresh.id}/runs`,
      payload: { mode: 'draft', kind: 'generate', targetLengthWords: 300 },
    });
    expect(runRes.statusCode).toBe(202);
    const run = await waitForRun((runRes.json() as { runId: string }).runId);
    expect(run.status, run.error ?? '').toBe('succeeded');

    const manuscript = (await app.inject({ method: 'GET', url: `/api/projects/${fresh.id}/manuscript` })).json();
    expect(manuscript.draft).toBeTruthy();
    expect(manuscript.draft).toContain('[MOCK');
  });

  it('writes scenes when the outline is generated in scene mode', async () => {
    const fresh = (
      await app.inject({
        method: 'POST',
        url: '/api/projects',
        payload: { title: 'Scene Mode Project', provider: 'mock', model: 'mock-fast' },
      })
    ).json();

    const character = (
      await app.inject({
        method: 'POST',
        url: `/api/projects/${fresh.id}/characters`,
        payload: { name: 'Scene Lead', description: 'Point of view character.' },
      })
    ).json();
    await app.inject({
      method: 'POST',
      url: `/api/projects/${fresh.id}/locations`,
      payload: { name: 'Scene Place', description: 'Where it happens.' },
    });
    const line = (
      await app.inject({
        method: 'POST',
        url: `/api/projects/${fresh.id}/plot-lines`,
        payload: { name: 'Scene Line' },
      })
    ).json();
    await app.inject({
      method: 'POST',
      url: `/api/plot-lines/${line.id}/plot-points`,
      payload: { title: 'Something happens', status: 'confirmed', characterIds: [character.id] },
    });

    const outlineRun = await app.inject({
      method: 'POST',
      url: `/api/projects/${fresh.id}/runs`,
      payload: { mode: 'scenes', kind: 'outline' },
    });
    const outlineDone = await waitForRun((outlineRun.json() as { runId: string }).runId);
    expect(outlineDone.status, outlineDone.error ?? '').toBe('succeeded');

    const events = await readEvents((outlineRun.json() as { runId: string }).runId);
    const outline = (events.find((e) => e.type === 'outline') as { outline: OutlineResult }).outline;
    expect(outline.chapters[0]?.scenes.length).toBeGreaterThan(0);

    await app.inject({ method: 'PUT', url: `/api/projects/${fresh.id}/outline`, payload: outline });

    const chapters = (await app.inject({ method: 'GET', url: `/api/projects/${fresh.id}/chapters` })).json();
    const scenes = (await app.inject({ method: 'GET', url: `/api/chapters/${chapters[0].id}/scenes` })).json();
    expect(scenes.length).toBeGreaterThan(0);

    const sceneRun = await app.inject({
      method: 'POST',
      url: `/api/projects/${fresh.id}/runs`,
      payload: { mode: 'scenes', kind: 'generate', targetIds: [scenes[0].id] },
    });
    const sceneDone = await waitForRun((sceneRun.json() as { runId: string }).runId);
    expect(sceneDone.status, sceneDone.error ?? '').toBe('succeeded');

    const scene = (await app.inject({ method: 'GET', url: `/api/chapters/${chapters[0].id}/scenes` })).json()[0];
    expect(scene.currentVersionId).toBeTruthy();
    expect(scene.wordCount).toBeGreaterThan(0);
  });
});
