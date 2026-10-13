import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { DialogueAttribution, OutlineResult, RevisionChatMessage, RunEvent } from '@storytime/shared';
import { buildApp } from '../src/app.js';
import { seed } from '../src/db/seed.js';
import { resetEvents } from '../src/generation/events.js';

let app: FastifyInstance;
let dbPath: string;
let projectId: string;
let chapterIds: string[] = [];
let castIds: string[] = [];

const json = <T = any>(res: { json: () => unknown }) => res.json() as T;

async function waitForRun(runId: string, timeoutMs = 20_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const run = json<{ status: string; error: string | null }>(await app.inject({ method: 'GET', url: `/api/runs/${runId}` }));
    if (['succeeded', 'failed', 'cancelled'].includes(run.status)) return run;
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
  throw new Error(`Run ${runId} did not finish within ${timeoutMs}ms`);
}

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
  return json<{ runId: string }>(res).runId;
}

async function chapter(id: string) {
  return json(await app.inject({ method: 'GET', url: `/api/chapters/${id}` }));
}

async function dialogue(versionId: string): Promise<DialogueAttribution | null> {
  const res = await app.inject({ method: 'GET', url: `/api/versions/${versionId}/dialogue` });
  expect(res.statusCode).toBe(200);
  return json<{ attribution: DialogueAttribution | null }>(res).attribution;
}

async function sendChat(scope: { scopeType: string; scopeId: string }, message: string, extra: Record<string, unknown> = {}) {
  return app.inject({
    method: 'POST',
    url: `/api/projects/${projectId}/revision-chat`,
    payload: { ...scope, message, ...extra },
  });
}

async function chat(scope: { scopeType: string; scopeId: string }) {
  const res = await app.inject({
    method: 'GET',
    url: `/api/projects/${projectId}/revision-chat?scopeType=${scope.scopeType}&scopeId=${scope.scopeId}`,
  });
  expect(res.statusCode, res.payload).toBe(200);
  return json<{ chat: { id: string } | null; messages: RevisionChatMessage[] }>(res);
}

/** Send a chat message and wait for the whole turn to land. */
async function converse(scope: { scopeType: string; scopeId: string }, message: string, extra: Record<string, unknown> = {}) {
  const res = await sendChat(scope, message, extra);
  expect(res.statusCode, res.payload).toBe(202);
  const { runId } = json<{ runId: string }>(res);
  const run = await waitForRun(runId);
  expect(run.status, run.error ?? '').toBe('succeeded');
  const history = await chat(scope);
  return { runId, events: await readEvents(runId), messages: history.messages, last: history.messages.at(-1)! };
}

const DIALOGUE_TEXT = [
  'Isolde looked up from the gears. "Get down," she said.',
  '"No," said the boy. "Not yet."',
  '"We cannot stay here," Isolde whispered.',
].join('\n\n');

beforeAll(async () => {
  dbPath = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'storytime-voices-')), 'test.db');
  app = await buildApp({ dbPath, logger: false, serveStatic: false });
  projectId = seed(app.db).projectId;

  // Keep the mock prose short so every run finishes quickly, and the narration third person until a test says otherwise.
  await app.inject({ method: 'PUT', url: `/api/projects/${projectId}/story-parameters`, payload: { targetLengthWords: 300, pov: 'Third person limited' } });
  castIds = json<Array<{ id: string }>>(await app.inject({ method: 'GET', url: `/api/projects/${projectId}/characters` })).map((c) => c.id);

  const outlineRun = await startRun({ mode: 'chapters', kind: 'outline' });
  expect((await waitForRun(outlineRun)).status).toBe('succeeded');
  const outline = (await readEvents(outlineRun)).find((e) => e.type === 'outline') as { outline: OutlineResult };
  await app.inject({ method: 'PUT', url: `/api/projects/${projectId}/outline`, payload: outline.outline });
  chapterIds = json<Array<{ id: string }>>(await app.inject({ method: 'GET', url: `/api/projects/${projectId}/chapters` })).map((c) => c.id);

  // Chapter one is written without voices, so attribution can be exercised separately.
  const written = await startRun({ mode: 'chapters', kind: 'generate', targetIds: [chapterIds[0]], attributeDialogue: false });
  expect((await waitForRun(written)).status).toBe('succeeded');
});

afterAll(async () => {
  await app.close();
  resetEvents();
  fs.rmSync(path.dirname(dbPath), { recursive: true, force: true });
});

describe('character voices', () => {
  it('stores a voice without touching the story history or flagging chapters as stale', async () => {
    const id = castIds[0]!;
    const revisionsBefore = json<unknown[]>(await app.inject({ method: 'GET', url: `/api/entities/character/${id}/revisions` })).length;
    const before = json(await app.inject({ method: 'GET', url: `/api/characters/${id}` }));

    const res = await app.inject({ method: 'PATCH', url: `/api/characters/${id}`, payload: { voice: 'bf_emma' } });
    expect(res.statusCode).toBe(200);
    expect(json(res).voice).toBe('bf_emma');
    expect(json(res).revision).toBe(before.revision);

    const revisionsAfter = json<unknown[]>(await app.inject({ method: 'GET', url: `/api/entities/character/${id}/revisions` })).length;
    expect(revisionsAfter).toBe(revisionsBefore);
    expect((await chapter(chapterIds[0]!)).staleLevel).toBe('none');

    // A story edit alongside it still records history, and leaves the voice alone.
    const edited = json(await app.inject({ method: 'PATCH', url: `/api/characters/${id}`, payload: { arcNotes: 'New arc.' } }));
    expect(edited.voice).toBe('bf_emma');
    expect(edited.revision).toBe(before.revision + 1);
  });

  it('clears a voice with an empty value', async () => {
    const id = castIds[1]!;
    await app.inject({ method: 'PATCH', url: `/api/characters/${id}`, payload: { voice: 'am_michael' } });
    const cleared = json(await app.inject({ method: 'PATCH', url: `/api/characters/${id}`, payload: { voice: '' } }));
    expect(cleared.voice).toBeNull();
  });

  it('suggests distinct voices for the characters that have none and keeps the ones that are set', async () => {
    const keep = castIds[0]!;
    const res = await app.inject({ method: 'POST', url: `/api/projects/${projectId}/characters/suggest-voices`, payload: {} });
    expect(res.statusCode, res.payload).toBe(200);
    const cast = json<Array<{ id: string; voice: string | null }>>(res);

    expect(cast.find((c) => c.id === keep)!.voice).toBe('bf_emma');
    expect(cast.every((c) => c.voice)).toBe(true);
    expect(new Set(cast.map((c) => c.voice)).size).toBe(cast.length);
    expect(cast.map((c) => c.voice)).not.toContain('af_heart');
  });
});

describe('dialogue attribution', () => {
  let versionId: string;

  it('has nothing for a version that was never attributed', async () => {
    versionId = (await chapter(chapterIds[0]!)).currentVersionId;
    expect(await dialogue(versionId)).toBeNull();
  });

  it('finds each quote in a chapter and says who speaks it', async () => {
    const saved = await app.inject({
      method: 'POST',
      url: '/api/versions',
      payload: { targetType: 'chapter', targetId: chapterIds[0], content: DIALOGUE_TEXT },
    });
    expect(saved.statusCode, saved.payload).toBe(201);
    versionId = json(saved).id;

    const runId = await startRun({ mode: 'chapters', kind: 'attribute', targetIds: [chapterIds[0]] });
    const run = await waitForRun(runId);
    expect(run.status, run.error ?? '').toBe('succeeded');
    expect((await readEvents(runId)).some((e) => e.type === 'target_done')).toBe(true);

    const attribution = (await dialogue(versionId))!;
    expect(attribution.source).toBe('model');
    expect(attribution.narratorId).toBeNull();
    expect(attribution.quotes).toHaveLength(4);
    // The mock alternates the first two cast members.
    expect(attribution.quotes.map((q) => q.speaker)).toEqual([castIds[0], castIds[1], castIds[0], castIds[1]]);

    const paragraphs = DIALOGUE_TEXT.split('\n\n');
    const [first] = attribution.quotes;
    expect(paragraphs[first!.paragraph]!.slice(first!.start, first!.end)).toBe('"Get down,"');
  });

  it('leaves voices the author corrected alone unless asked to start over', async () => {
    const quotes = (await dialogue(versionId))!.quotes;
    const corrected = await app.inject({
      method: 'PUT',
      url: `/api/versions/${versionId}/dialogue`,
      payload: { narratorId: castIds[0], speakers: quotes.map((_, i) => (i === 3 ? null : castIds[0])) },
    });
    expect(corrected.statusCode, corrected.payload).toBe(200);
    const manual = (await dialogue(versionId))!;
    expect(manual.source).toBe('manual');
    expect(manual.narratorId).toBe(castIds[0]);
    expect(manual.quotes.map((q) => q.speaker)).toEqual([castIds[0], castIds[0], castIds[0], null]);

    const again = await startRun({ mode: 'chapters', kind: 'attribute', targetIds: [chapterIds[0]] });
    expect((await waitForRun(again)).status).toBe('succeeded');
    expect((await dialogue(versionId))!.source).toBe('manual');

    const forced = await startRun({ mode: 'chapters', kind: 'attribute', targetIds: [chapterIds[0]], reattribute: true });
    expect((await waitForRun(forced)).status).toBe('succeeded');
    expect((await dialogue(versionId))!.source).toBe('model');
  });

  it('names the narrator when the story is told in the first person', async () => {
    await app.inject({ method: 'PUT', url: `/api/projects/${projectId}/story-parameters`, payload: { pov: 'First person, past tense' } });
    const runId = await startRun({ mode: 'chapters', kind: 'attribute', targetIds: [chapterIds[0]], reattribute: true });
    expect((await waitForRun(runId)).status).toBe('succeeded');
    expect((await dialogue(versionId))!.narratorId).toBe(castIds[0]);
    await app.inject({ method: 'PUT', url: `/api/projects/${projectId}/story-parameters`, payload: { pov: 'Third person limited' } });
  });

  it('rejects corrections that do not fit the quotes or the cast', async () => {
    const short = await app.inject({ method: 'PUT', url: `/api/versions/${versionId}/dialogue`, payload: { narratorId: null, speakers: [null] } });
    expect(short.statusCode).toBe(400);

    const stranger = await app.inject({
      method: 'PUT',
      url: `/api/versions/${versionId}/dialogue`,
      payload: { narratorId: 'not-a-character', speakers: [null, null, null, null] },
    });
    expect(stranger.statusCode).toBe(400);
  });

  it('reports which written chapters have voices', async () => {
    const status = json<{ versions: Array<{ chapterId: string; assigned: boolean }> }>(
      await app.inject({ method: 'GET', url: `/api/projects/${projectId}/dialogue` }),
    );
    expect(status.versions.find((v) => v.chapterId === chapterIds[0])?.assigned).toBe(true);
  });

  it('assigns voices to a chapter as part of writing it, unless told not to', async () => {
    const runId = await startRun({ mode: 'chapters', kind: 'generate', targetIds: [chapterIds[1]] });
    expect((await waitForRun(runId)).status).toBe('succeeded');
    const attribution = await dialogue((await chapter(chapterIds[1]!)).currentVersionId);
    expect(attribution).not.toBeNull();

    const quiet = await startRun({ mode: 'chapters', kind: 'update', targetType: 'chapter', targetId: chapterIds[1], instructions: 'Colder.', attributeDialogue: false });
    expect((await waitForRun(quiet)).status).toBe('succeeded');
    expect(await dialogue((await chapter(chapterIds[1]!)).currentVersionId)).toBeNull();
  });

  it('refuses to assign voices when the book has no text or no cast', async () => {
    const empty = await app.inject({ method: 'POST', url: '/api/projects', payload: { title: 'Empty' } });
    const emptyId = json(empty).id;
    const res = await app.inject({
      method: 'POST',
      url: `/api/projects/${emptyId}/runs`,
      payload: { mode: 'chapters', kind: 'attribute' },
    });
    expect(res.statusCode).toBe(202);
    const run = await waitForRun(json(res).runId);
    expect(run.status).toBe('failed');
    expect(run.error).toMatch(/no characters/i);
  });
});

describe('revision chat', () => {
  const scope = () => ({ scopeType: 'chapter', scopeId: chapterIds[0]! });

  it('will not start on a chapter with nothing written', async () => {
    expect(chapterIds.length).toBeGreaterThan(2);
    const res = await sendChat({ scopeType: 'chapter', scopeId: chapterIds[2]! }, 'Tighten the opening.');
    expect(res.statusCode).toBe(400);
    expect(res.json().message).toMatch(/nothing is written/i);
  });

  it('will not carry more text than the token budget allows', async () => {
    await app.inject({ method: 'PATCH', url: `/api/projects/${projectId}`, payload: { tokenBudget: 14_000 } });
    try {
      // Roughly 20k tokens of prose in the second chapter, against a limit of about 8k.
      const big = Array.from({ length: 2000 }, (_, i) => `Sentence number ${i} of a very long chapter that goes on.`).join(' ');
      const saved = await app.inject({
        method: 'POST',
        url: '/api/versions',
        payload: { targetType: 'chapter', targetId: chapterIds[1], content: big },
      });
      expect(saved.statusCode).toBe(201);
      const res = await sendChat({ scopeType: 'chapter', scopeId: chapterIds[1]! }, 'Tighten it.');
      expect(res.statusCode).toBe(400);
      expect(res.json().message).toMatch(/token budget/i);
    } finally {
      await app.inject({ method: 'PATCH', url: `/api/projects/${projectId}`, payload: { tokenBudget: null } });
    }
  });

  it('rejects a scope that does not belong to the project', async () => {
    expect((await sendChat({ scopeType: 'chapter', scopeId: 'nope' }, 'Hi')).statusCode).toBe(404);
    expect((await sendChat({ scopeType: 'book', scopeId: 'someone-else' }, 'Hi')).statusCode).toBe(400);
    expect((await app.inject({ method: 'POST', url: `/api/projects/${projectId}/revision-chat`, payload: { ...scope(), message: '   ' } })).statusCode).toBe(400);
  });

  it('starts empty', async () => {
    const history = await chat(scope());
    expect(history.chat).toBeNull();
    expect(history.messages).toEqual([]);
  });

  it('answers a question without touching the text', async () => {
    const versionsBefore = json<unknown[]>(await app.inject({ method: 'GET', url: `/api/versions?targetType=chapter&targetId=${chapterIds[0]}` })).length;
    const turn = await converse(scope(), 'What do you think of the pacing here?');

    expect(turn.messages.map((m) => m.role)).toEqual(['user', 'assistant']);
    expect(turn.last.applied).toEqual([]);
    expect(turn.last.content).toContain('pacing');
    expect(turn.last.error).toBeNull();

    // What streamed to the browser is the conversation, in order, and nothing else.
    const streamed = turn.events.filter((e): e is Extract<RunEvent, { type: 'reply' }> => e.type === 'reply').map((e) => e.delta).join('');
    expect(streamed.trim()).toBe(turn.last.content);

    const versionsAfter = json<unknown[]>(await app.inject({ method: 'GET', url: `/api/versions?targetType=chapter&targetId=${chapterIds[0]}` })).length;
    expect(versionsAfter).toBe(versionsBefore);
  });

  it('rewrites the chapter when asked, keeps the old version, and can be undone', async () => {
    const before = await chapter(chapterIds[0]!);
    const turn = await converse(scope(), 'Please tighten the opening and cut the second paragraph.');

    expect(turn.messages).toHaveLength(4);
    const [applied] = turn.last.applied;
    expect(turn.last.applied).toHaveLength(1);
    expect(applied!.targetType).toBe('chapter');
    expect(applied!.targetId).toBe(chapterIds[0]);
    expect(applied!.previousVersionId).toBe(before.currentVersionId);
    // The revised text itself stays out of the chat; the author reads the reply.
    expect(turn.last.content).not.toContain('<revised_section');
    expect(turn.last.content).not.toContain('MOCK REVISED');

    const after = await chapter(chapterIds[0]!);
    expect(after.currentVersionId).toBe(applied!.versionId);
    const version = json(await app.inject({ method: 'GET', url: `/api/versions/${applied!.versionId}` }));
    expect(version.content).toContain('[MOCK REVISED] Please tighten the opening');
    expect(version.instructions).toBe('Please tighten the opening and cut the second paragraph.');
    expect(version.parentVersionId).toBe(before.currentVersionId);

    expect(turn.events.some((e) => e.type === 'revised')).toBe(true);
    // The new text was given voices too.
    expect(await dialogue(applied!.versionId)).not.toBeNull();

    const undone = await app.inject({ method: 'POST', url: `/api/versions/${applied!.previousVersionId}/make-current` });
    expect(undone.statusCode).toBe(200);
    expect((await chapter(chapterIds[0]!)).currentVersionId).toBe(before.currentVersionId);
  });

  it('skips voice assignment when the author turns it off', async () => {
    const turn = await converse(scope(), 'Rewrite the ending.', { attributeDialogue: false });
    const [applied] = turn.last.applied;
    expect(applied).toBeDefined();
    expect(await dialogue(applied!.versionId)).toBeNull();
  });

  it('works across the whole book', async () => {
    const book = { scopeType: 'book', scopeId: projectId };
    const turn = await converse(book, 'Revise the first chapter so it opens colder.');
    expect(turn.last.applied.map((a) => a.targetId)).toEqual([chapterIds[0]]);
  });

  it('keeps conversations separate and can clear one', async () => {
    const bookHistory = await chat({ scopeType: 'book', scopeId: projectId });
    expect(bookHistory.messages).toHaveLength(2);

    const versionsBefore = json<unknown[]>(await app.inject({ method: 'GET', url: `/api/versions?targetType=chapter&targetId=${chapterIds[0]}` })).length;
    const cleared = await app.inject({ method: 'DELETE', url: `/api/projects/${projectId}/revision-chat?scopeType=book&scopeId=${projectId}` });
    expect(cleared.statusCode).toBe(204);
    expect((await chat({ scopeType: 'book', scopeId: projectId })).messages).toEqual([]);
    expect((await chat(scope())).messages.length).toBeGreaterThan(0);

    const versionsAfter = json<unknown[]>(await app.inject({ method: 'GET', url: `/api/versions?targetType=chapter&targetId=${chapterIds[0]}` })).length;
    expect(versionsAfter).toBe(versionsBefore);
  });

  it('refuses a second message while the book is busy', async () => {
    await app.inject({ method: 'PATCH', url: `/api/projects/${projectId}`, payload: { model: 'mock-slow' } });
    try {
      const first = await sendChat(scope(), 'Tell me about the opening.');
      expect(first.statusCode).toBe(202);
      const second = await sendChat(scope(), 'And the ending?');
      expect(second.statusCode).toBe(409);
      expect((await chat(scope())).messages.filter((m) => m.content === 'And the ending?')).toHaveLength(0);
      await waitForRun(json(first).runId);
    } finally {
      await app.inject({ method: 'PATCH', url: `/api/projects/${projectId}`, payload: { model: null } });
    }
  });

  it('records a failed turn as a message the author can see', async () => {
    await app.inject({ method: 'PATCH', url: `/api/projects/${projectId}`, payload: { model: 'mock-error' } });
    try {
      const res = await sendChat(scope(), 'Rewrite the whole thing.');
      expect(res.statusCode).toBe(202);
      const run = await waitForRun(json(res).runId);
      expect(run.status).toBe('failed');

      const last = (await chat(scope())).messages.at(-1)!;
      expect(last.role).toBe('assistant');
      expect(last.error).toMatch(/fail/i);
      expect(last.applied).toEqual([]);
    } finally {
      await app.inject({ method: 'PATCH', url: `/api/projects/${projectId}`, payload: { model: null } });
    }
  });

  it('cannot be started as a plain run', async () => {
    const res = await app.inject({ method: 'POST', url: `/api/projects/${projectId}/runs`, payload: { mode: 'chapters', kind: 'chat' } });
    expect(res.statusCode).toBe(400);
  });
});
