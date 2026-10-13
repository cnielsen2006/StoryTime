import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { nanoid } from 'nanoid';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import zlib from 'node:zlib';
import type { BackupManifest, BackupRestoreResult, BackupSummary } from '@storytime/shared';
import { buildApp } from '../src/app.js';
import { seed } from '../src/db/seed.js';
import { BACKUP_TABLES, EXCLUDED_TABLES, schemaTables, scope, tableName } from '../src/backup/tables.js';
import { MAX_AUTO_BACKUPS, listBackups, pruneBackups } from '../src/backup/files.js';
import { createBackup } from '../src/backup/export.js';

const hoisted = vi.hoisted(() => ({ busy: new Set<string>() }));
vi.mock('../src/generation/runner.js', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../src/generation/runner.js')>()),
  isProjectBusy: (projectId: string) => hoisted.busy.has(projectId),
}));

let app: FastifyInstance;
let root: string;
let backupDir: string;
let p1: string; // the seeded story, with a manuscript added
let p2: string; // a second story, so a backup of one can be checked for leaks

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
const sql = (text: string, ...params: unknown[]) => app.sqlite.prepare(text).all(...params) as Array<Record<string, any>>;

function insert(table: string, row: Record<string, unknown>) {
  const names = Object.keys(row);
  app.sqlite
    .prepare(`INSERT INTO ${table} (${names.join(',')}) VALUES (${names.map(() => '?').join(',')})`)
    .run(...names.map((n) => row[n]));
}

/** Gives a story a manuscript: runs, versions, chapters and everything that points at other rows by id. */
function addManuscript(projectId: string, tag: string) {
  const now = Date.now();
  const id = (what: string) => `${tag}-${what}-${nanoid(6)}`;
  const character = id('char');
  const line = id('line');
  const points = [id('pp'), id('pp')];
  const run = id('run');
  const chapter = id('chap');
  const versions = [id('ver'), id('ver')];
  const idea = id('idea');

  insert('characters', { id: character, project_id: projectId, name: `Hero of ${tag}`, created_at: now, updated_at: now });
  insert('plot_lines', { id: line, project_id: projectId, name: 'Main', created_at: now, updated_at: now });
  points.forEach((pid, i) =>
    insert('plot_points', { id: pid, plot_line_id: line, project_id: projectId, title: `Beat ${i}`, sort_order: i, created_at: now, updated_at: now }),
  );
  insert('plot_point_characters', { plot_point_id: points[0], character_id: character });
  insert('generation_runs', {
    id: run, project_id: projectId, mode: 'chapter', kind: 'write', provider: 'mock', model: 'mock-fast', effort: 'high',
    status: 'succeeded', bible_markdown: `# Bible\n[C:${character}] Hero`, created_at: now,
  });
  versions.forEach((vid, i) =>
    insert('generated_versions', {
      id: vid, project_id: projectId, target_type: 'chapter', target_id: chapter, run_id: run, version_no: i + 1,
      content: `Version ${i + 1} of the chapter, written for ${tag}.`, word_count: 9 + i,
      parent_version_id: i > 0 ? versions[0] : null, created_at: now + i,
    }),
  );
  insert('version_entity_refs', { version_id: versions[1], entity_type: 'character', entity_id: character, entity_revision: 1 });
  insert('chapters', {
    id: chapter, project_id: projectId, title: `Chapter of ${tag}`, plot_point_ids: JSON.stringify(points),
    current_version_id: versions[1], created_at: now, updated_at: now,
  });
  insert('scenes', {
    id: id('scene'), chapter_id: chapter, project_id: projectId, title: 'Opening', pov_character_id: character,
    plot_point_ids: JSON.stringify([points[0]]), current_version_id: versions[0], created_at: now, updated_at: now,
  });
  insert('ideas', { id: idea, project_id: projectId, text: 'An idea', created_at: now, updated_at: now });
  insert('idea_links', { id: id('link'), idea_id: idea, entity_type: 'character', entity_id: character, created_at: now });
  insert('entity_revisions', {
    id: id('rev'), project_id: projectId, entity_type: 'character', entity_id: character, revision: 1,
    snapshot: JSON.stringify({ id: character, name: 'Hero' }), created_at: now,
  });
  insert('dialogue_attributions', {
    version_id: versions[1], project_id: projectId, narrator_id: character,
    quotes: JSON.stringify([{ text: 'Hello', speakerId: character }]), created_at: now, updated_at: now,
  });
  const chat = id('chat');
  insert('revision_chats', { id: chat, project_id: projectId, scope_type: 'chapter', scope_id: chapter, created_at: now, updated_at: now });
  insert('revision_chat_messages', { id: id('msg'), chat_id: chat, role: 'user', content: 'Tighten it', run_id: run, created_at: now });
  return { character, chapter, versions, points, run };
}

/** Every row of one story, in a stable order, for before/after comparison. */
function dump(projectId: string) {
  const out: Record<string, string[]> = {};
  for (const { table, where } of BACKUP_TABLES) {
    const { sql: clause, params } = scope(where, [projectId]);
    out[tableName(table)] = sql(`SELECT * FROM ${tableName(table)} WHERE ${clause}`, ...params)
      .map((row) => JSON.stringify(row))
      .sort();
  }
  return out;
}

const count = (table: string, where = '1=1', ...params: unknown[]) =>
  (sql(`SELECT COUNT(*) AS n FROM ${table} WHERE ${where}`, ...params)[0] as { n: number }).n;

/** The file as the format describes it: gunzip, then one JSON document per line. */
function readFile(id: string) {
  const text = zlib.gunzipSync(fs.readFileSync(path.join(backupDir, `${id}.backup.gz`))).toString('utf8');
  const [first, ...rest] = text.split('\n').filter(Boolean);
  return {
    manifest: JSON.parse(first!) as BackupManifest,
    lines: rest.map((line) => JSON.parse(line) as { table: string; rows: Array<Record<string, unknown>> }),
  };
}

/** Hand-made backup file, for the cases a real export cannot produce. */
function makeFile(
  tables: Array<{ table: string; rows: Array<Record<string, unknown>> }>,
  manifest: Partial<BackupManifest> & Record<string, unknown> = {},
) {
  const projects = tables.find((t) => t.table === 'projects')?.rows ?? [];
  const head = {
    format: 'storytime-backup', formatVersion: 1, id: 'handmade', label: 'Handmade', kind: 'manual', createdAt: Date.now(),
    appSchema: 1, tableCounts: {},
    projects: projects.map((p) => ({ id: p.id, title: p.title, wordCount: 0, chapters: 0, characters: 0, updatedAt: 0 })),
    ...manifest,
  };
  return zlib.gzipSync([head, ...tables].map((l) => JSON.stringify(l)).join('\n') + '\n');
}

async function createViaApi(payload: Record<string, unknown> = {}) {
  const res = await app.inject({ method: 'POST', url: '/api/backups', payload });
  expect(res.statusCode, res.payload).toBe(201);
  return res.json() as BackupSummary;
}

async function restoreViaApi(id: string, payload?: Record<string, unknown>, expected = 200) {
  const res = await app.inject({ method: 'POST', url: `/api/backups/${id}/restore`, payload });
  expect(res.statusCode, res.payload).toBe(expected);
  return res.json() as BackupRestoreResult;
}

const upload = (payload: Buffer | string) =>
  app.inject({ method: 'POST', url: '/api/backups/import', headers: { 'content-type': 'application/octet-stream' }, payload });

beforeEach(async () => {
  hoisted.busy.clear();
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'storytime-backup-'));
  backupDir = path.join(root, 'backups');
  app = await buildApp({ dbPath: path.join(root, 'test.db'), backupDir, logger: false, serveStatic: false });
  p1 = seed(app.db).projectId;
  addManuscript(p1, 'one');
  const created = await app.inject({ method: 'POST', url: '/api/projects', payload: { title: 'Second Tale' } });
  p2 = created.json().id;
  addManuscript(p2, 'two');
});

afterEach(async () => {
  await app.close();
  fs.rmSync(root, { recursive: true, force: true });
});

describe('schema coverage', () => {
  it('knows what to do with every table in the schema', () => {
    const listed = new Set(BACKUP_TABLES.map((entry) => tableName(entry.table)));
    const excluded = new Set(EXCLUDED_TABLES.map(tableName));
    const unhandled = schemaTables()
      .map(tableName)
      .filter((name) => !listed.has(name) && !excluded.has(name));
    // A new table needs an entry in backup/tables.ts, or a deliberate place in EXCLUDED_TABLES.
    expect(unhandled).toEqual([]);
    expect([...listed].filter((name) => excluded.has(name))).toEqual([]);
  });

  it('lists no table twice', () => {
    const names = BACKUP_TABLES.map((entry) => tableName(entry.table));
    expect(names.filter((name, i) => names.indexOf(name) !== i)).toEqual([]);
  });

  it('lists parents before children', () => {
    const order = BACKUP_TABLES.map((entry) => tableName(entry.table));
    expect(order[0]).toBe('projects');
    expect(order.indexOf('characters')).toBeLessThan(order.indexOf('character_experiences'));
    expect(order.indexOf('generated_versions')).toBeLessThan(order.indexOf('version_entity_refs'));
  });
});

describe('creating backups', () => {
  it('backs up one story and nothing of the other', async () => {
    const summary = await createViaApi({ projectIds: [p1], label: 'Just the first' });
    expect(summary.kind).toBe('manual');
    expect(summary.label).toBe('Just the first');
    expect(summary.projects.map((p) => p.id)).toEqual([p1]);
    expect(summary.projects[0]).toMatchObject({ title: 'The Lantern Keeper', chapters: 1, characters: 4, wordCount: 10 });
    expect(summary.bytes).toBeGreaterThan(0);

    const { manifest, lines } = readFile(summary.id);
    expect(manifest.id).toBe(summary.id);
    expect(manifest.formatVersion).toBe(1);
    expect(manifest.tableCounts.chapters).toBe(1);
    expect(lines.every((l) => l.rows.length <= 500)).toBe(true);

    const rows = lines.filter((l) => l.table === 'projects').flatMap((l) => l.rows);
    expect(rows.map((r) => r.id)).toEqual([p1]);
    const text = zlib.gunzipSync(fs.readFileSync(path.join(backupDir, `${summary.id}.backup.gz`))).toString('utf8');
    expect(text).not.toContain(p2);
    expect(text).not.toContain('Second Tale');
    // Every table the manifest counts is really in the file.
    for (const [table, n] of Object.entries(manifest.tableCounts)) {
      expect(lines.filter((l) => l.table === table).reduce((sum, l) => sum + l.rows.length, 0)).toBe(n);
    }
  });

  it('backs up every story when none are named', async () => {
    const summary = await createViaApi({});
    expect(summary.projects.map((p) => p.id).sort()).toEqual([p1, p2].sort());
    expect(readFile(summary.id).manifest.tableCounts.projects).toBe(2);
  });

  it('rejects stories that do not exist', async () => {
    const res = await app.inject({ method: 'POST', url: '/api/backups', payload: { projectIds: ['nope'] } });
    expect(res.statusCode).toBe(404);
    expect(fs.existsSync(backupDir) ? fs.readdirSync(backupDir) : []).toEqual([]);
  });

  it('splits big tables over several lines', async () => {
    for (let i = 0; i < 1200; i++) insert('ideas', { id: `bulk-${i}`, project_id: p1, text: `Idea ${i}`, created_at: 1, updated_at: 1 });
    const { id } = await createViaApi({ projectIds: [p1] });
    const ideaLines = readFile(id).lines.filter((l) => l.table === 'ideas');
    expect(ideaLines.length).toBeGreaterThan(2);
    expect(ideaLines.every((l) => l.rows.length <= 500)).toBe(true);
    expect(ideaLines.reduce((n, l) => n + l.rows.length, 0)).toBe(1200 + 5 + 1);
  });

  it('never includes app settings', async () => {
    insert('app_settings', { key: 'anthropicKey', value: 'sk-secret-value', updated_at: 1 });
    const { id } = await createViaApi({});
    const text = zlib.gunzipSync(fs.readFileSync(path.join(backupDir, `${id}.backup.gz`))).toString('utf8');
    expect(text).not.toContain('sk-secret-value');
    expect(text).not.toContain('app_settings');
  });
});

describe('listing', () => {
  it('shows manifests newest first, with story titles, sizes and the folder', async () => {
    const first = await createViaApi({ projectIds: [p1], label: 'first' });
    await sleep(5);
    const second = await createViaApi({ projectIds: [p2], label: 'second' });
    await sleep(5);
    const third = await createViaApi({ label: 'third' });

    const res = await app.inject({ method: 'GET', url: '/api/backups' });
    const body = res.json() as { backups: BackupSummary[]; dir: string };
    expect(body.dir).toBe(backupDir);
    expect(body.backups.map((b) => b.id)).toEqual([third.id, second.id, first.id]);
    expect(body.backups[1]!.projects.map((p) => p.title)).toEqual(['Second Tale']);
    expect(body.backups[0]!.projects.map((p) => p.title).sort()).toEqual(['Second Tale', 'The Lantern Keeper']);
    expect(body.backups[0]!.bytes).toBe(fs.statSync(path.join(backupDir, `${third.id}.backup.gz`)).size);

    const one = await app.inject({ method: 'GET', url: `/api/backups/${first.id}` });
    expect(one.json().label).toBe('first');
  });

  it('is empty before any backup exists', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/backups' });
    expect(res.json()).toEqual({ backups: [], dir: backupDir });
  });

  it('reads only the manifest, never the body', async () => {
    const manifest = { format: 'storytime-backup', formatVersion: 1, id: 'x', label: 'lazy', kind: 'manual', createdAt: 1, appSchema: 1, projects: [], tableCounts: {} };
    // A valid header followed by a body that is not JSON at all: only a full read would notice.
    fs.mkdirSync(backupDir, { recursive: true });
    fs.writeFileSync(path.join(backupDir, 'lazy.backup.gz'), zlib.gzipSync(`${JSON.stringify(manifest)}\n{{{ not json\n`));
    fs.writeFileSync(path.join(backupDir, 'junk.backup.gz'), 'not a gzip');
    fs.writeFileSync(path.join(backupDir, 'notes.txt'), 'ignored');
    const listed = await listBackups(backupDir);
    expect(listed.map((b) => b.id)).toEqual(['lazy']);
  });
});

describe('restoring', () => {
  it('replaces a story with exactly what was backed up, after a safety backup', async () => {
    const original = dump(p1);
    const otherStory = dump(p2);
    const { id } = await createViaApi({ projectIds: [p1] });

    // Wreck it: delete rows, change fields, add junk.
    app.sqlite.prepare('DELETE FROM chapters WHERE project_id = ?').run(p1);
    app.sqlite.prepare('DELETE FROM generated_versions WHERE project_id = ?').run(p1);
    app.sqlite.prepare("UPDATE characters SET name = 'Vandalised' WHERE project_id = ?").run(p1);
    insert('ideas', { id: 'junk', project_id: p1, text: 'junk', created_at: 1, updated_at: 1 });
    const wrecked = dump(p1);
    expect(wrecked).not.toEqual(original);

    await sleep(5);
    const result = await restoreViaApi(id, { projects: [{ id: p1, mode: 'replace' }] });
    expect(result.restored).toEqual([{ sourceId: p1, projectId: p1, title: 'The Lantern Keeper', mode: 'replace' }]);
    expect(result.warnings).toEqual([]);

    expect(dump(p1)).toEqual(original);
    expect(count('chapters', 'project_id = ?', p1)).toBe(1);
    expect(sql('SELECT name FROM characters WHERE project_id = ? ORDER BY name', p1).map((r) => r.name)).not.toContain('Vandalised');
    expect(dump(p2)).toEqual(otherStory);

    // The pre-restore backup holds the state that was just overwritten.
    expect(result.safetyBackupId).toBeTruthy();
    const safety = (await app.inject({ method: 'GET', url: `/api/backups/${result.safetyBackupId}` })).json() as BackupSummary;
    expect(safety.kind).toBe('pre-restore');
    expect(safety.label).toBe('Before restoring "The Lantern Keeper"');
    expect(readFile(safety.id).manifest.tableCounts.chapters).toBe(0);
  });

  it('restores everything in the backup when no stories are named', async () => {
    const before = [dump(p1), dump(p2)];
    const { id } = await createViaApi({});
    app.sqlite.prepare('DELETE FROM chapters').run();
    const result = await restoreViaApi(id);
    expect(result.restored.map((r) => r.mode)).toEqual(['replace', 'replace']);
    expect([dump(p1), dump(p2)]).toEqual(before);
  });

  it('restores only the stories asked for', async () => {
    const { id } = await createViaApi({});
    app.sqlite.prepare('DELETE FROM chapters').run();
    await restoreViaApi(id, { projects: [{ id: p2, mode: 'replace' }] });
    expect(count('chapters', 'project_id = ?', p2)).toBe(1);
    expect(count('chapters', 'project_id = ?', p1)).toBe(0);
  });

  it('restores a story whose project was deleted, with its original ids, and takes no safety backup', async () => {
    const original = dump(p1);
    const { id } = await createViaApi({ projectIds: [p1] });
    app.sqlite.prepare('DELETE FROM projects WHERE id = ?').run(p1);
    expect(count('chapters', 'project_id = ?', p1)).toBe(0);

    // Asking for "replace" on something that is gone just restores it.
    const result = await restoreViaApi(id, { projects: [{ id: p1, mode: 'replace' }] });
    expect(result.restored[0]).toMatchObject({ sourceId: p1, projectId: p1, mode: 'restore' });
    expect(result.safetyBackupId).toBeNull();
    expect(dump(p1)).toEqual(original);
    expect((await listBackups(backupDir)).map((b) => b.kind)).toEqual(['manual']);
  });

  it('restores a copy beside the original with new ids and intact references', async () => {
    const original = dump(p1);
    const { id } = await createViaApi({ projectIds: [p1] });

    const result = await restoreViaApi(id, { projects: [{ id: p1, mode: 'copy' }] });
    expect(result.safetyBackupId).toBeNull();
    const copy = result.restored[0]!;
    expect(copy.mode).toBe('copy');
    expect(copy.projectId).not.toBe(p1);
    expect(copy.title).toMatch(/^The Lantern Keeper \(restored \d{4}-\d{2}-\d{2}\)$/);
    expect(count('projects')).toBe(3);
    expect(dump(p1)).toEqual(original);

    const np = copy.projectId;
    // Not one id of the original appears anywhere in the copy, however deeply it is embedded.
    const oldIds = Object.values(original).flat().map((row) => JSON.parse(row).id).filter((v): v is string => typeof v === 'string');
    expect(oldIds.length).toBeGreaterThan(40);
    const copied = JSON.stringify(dump(np));
    for (const oldId of oldIds) expect(copied, oldId).not.toContain(oldId);
    expect(count('chapters', 'project_id = ?', np)).toBe(1);
    expect(count('characters', 'project_id = ?', np)).toBe(4);

    // Every internal reference points inside the copy.
    const chapter = sql('SELECT * FROM chapters WHERE project_id = ?', np)[0]!;
    const version = sql('SELECT * FROM generated_versions WHERE id = ?', chapter.current_version_id)[0]!;
    expect(version.project_id).toBe(np);
    expect(version.target_id).toBe(chapter.id);
    const pointIds = JSON.parse(chapter.plot_point_ids) as string[];
    expect(pointIds).toHaveLength(2);
    for (const pid of pointIds) expect(sql('SELECT project_id FROM plot_points WHERE id = ?', pid)[0]?.project_id).toBe(np);

    const scene = sql('SELECT * FROM scenes WHERE project_id = ?', np)[0]!;
    expect(scene.chapter_id).toBe(chapter.id);
    expect(sql('SELECT project_id FROM characters WHERE id = ?', scene.pov_character_id)[0]?.project_id).toBe(np);
    expect(JSON.parse(scene.plot_point_ids)[0]).toBe(pointIds[0]);

    const run = sql('SELECT * FROM generation_runs WHERE project_id = ?', np)[0]!;
    expect(version.run_id).toBe(run.id);
    const character = sql("SELECT id FROM characters WHERE project_id = ? AND name = 'Hero of one'", np)[0]!;
    expect(run.bible_markdown).toBe(`# Bible\n[C:${character.id}] Hero`);
    const ref = sql('SELECT * FROM version_entity_refs WHERE version_id = ?', chapter.current_version_id)[0]!;
    expect(ref.entity_id).toBe(character.id);
    expect(sql('SELECT entity_id FROM idea_links WHERE idea_id IN (SELECT id FROM ideas WHERE project_id = ?)', np).map((r) => r.entity_id)).toContain(character.id);
    expect(sql('SELECT snapshot FROM entity_revisions WHERE entity_id = ?', character.id)[0]!.snapshot).toContain(character.id);
    const attribution = sql('SELECT * FROM dialogue_attributions WHERE project_id = ?', np)[0]!;
    expect(attribution.version_id).toBe(chapter.current_version_id);
    expect(attribution.narrator_id).toBe(character.id);
    expect(JSON.parse(attribution.quotes)[0].speakerId).toBe(character.id);
    const chat = sql('SELECT * FROM revision_chats WHERE project_id = ?', np)[0]!;
    expect(chat.scope_id).toBe(chapter.id);
    expect(sql('SELECT run_id FROM revision_chat_messages WHERE chat_id = ?', chat.id)[0]!.run_id).toBe(run.id);
    expect(sql('SELECT parent_version_id FROM generated_versions WHERE project_id = ? AND version_no = 2', np)[0]!.parent_version_id).toBe(
      sql('SELECT id FROM generated_versions WHERE project_id = ? AND version_no = 1', np)[0]!.id,
    );

    // Restoring the same copy again makes another one rather than colliding.
    await restoreViaApi(id, { projects: [{ id: p1, mode: 'copy' }] });
    expect(count('projects')).toBe(4);
  });

  it('marks runs that were in flight as failed', async () => {
    const now = Date.now();
    insert('generation_runs', { id: 'inflight', project_id: p1, mode: 'chapter', kind: 'write', provider: 'mock', model: 'm', effort: 'high', status: 'running', created_at: now });
    insert('generation_runs', { id: 'waiting', project_id: p1, mode: 'chapter', kind: 'write', provider: 'mock', model: 'm', effort: 'high', status: 'queued', created_at: now });
    const { id } = await createViaApi({ projectIds: [p1] });
    await restoreViaApi(id, { projects: [{ id: p1, mode: 'replace' }] });
    const runs = sql("SELECT status, error FROM generation_runs WHERE id IN ('inflight','waiting')");
    expect(runs).toEqual([
      { status: 'failed', error: 'Backed up while this run was in progress.' },
      { status: 'failed', error: 'Backed up while this run was in progress.' },
    ]);
  });

  it('refuses to replace a story that is being written to', async () => {
    const { id } = await createViaApi({ projectIds: [p1] });
    app.sqlite.prepare("UPDATE characters SET name = 'Changed' WHERE project_id = ?").run(p1);
    hoisted.busy.add(p1);
    const res = await app.inject({ method: 'POST', url: `/api/backups/${id}/restore`, payload: { projects: [{ id: p1, mode: 'replace' }] } });
    expect(res.statusCode).toBe(409);
    expect(count('characters', "name = 'Changed'")).toBe(4);
    expect((await listBackups(backupDir)).map((b) => b.kind)).toEqual(['manual']);
    // A copy touches nothing, so it is fine.
    await restoreViaApi(id, { projects: [{ id: p1, mode: 'copy' }] });
  });

  it('asks for a story the backup does not hold', async () => {
    const { id } = await createViaApi({ projectIds: [p1] });
    const res = await app.inject({ method: 'POST', url: `/api/backups/${id}/restore`, payload: { projects: [{ id: p2, mode: 'copy' }] } });
    expect(res.statusCode).toBe(400);
  });

  it('keeps the old story when a restore fails halfway', async () => {
    const original = dump(p1);
    const good = (await createViaApi({ projectIds: [p1] })).id;
    const { lines } = readFile(good);
    const tables = lines.map((l) => ({ ...l, rows: l.rows.map((r) => ({ ...r })) }));
    // Damage a late table so the failure happens after earlier tables were already written.
    delete tables.find((t) => t.table === 'entity_revisions')!.rows[0]!.snapshot;
    const bad = await upload(makeFile(tables));
    expect(bad.statusCode).toBe(201);

    const res = await app.inject({ method: 'POST', url: `/api/backups/${bad.json().id}/restore`, payload: { projects: [{ id: p1, mode: 'replace' }] } });
    expect(res.statusCode).toBe(400);
    expect(dump(p1)).toEqual(original);
    // The safety backup of an operation that changed nothing is not kept.
    expect((await listBackups(backupDir)).map((b) => b.kind).sort()).toEqual(['imported', 'manual']);
  });

  it('skips unknown tables and columns, never touches app settings, and fills columns an old backup lacks', async () => {
    insert('app_settings', { key: 'defaultProvider', value: 'mock', updated_at: 1 });
    const file = makeFile([
      { table: 'app_settings', rows: [{ key: 'defaultProvider', value: 'evil', updated_at: 2 }] },
      { table: 'made_up_table', rows: [{ id: 'z' }] },
      { table: 'projects', rows: [{ id: 'oldie', title: 'From An Old Backup', bogus_column: 'x', created_at: 5, updated_at: 5 }] },
      // No sort_order, revision or stamps: the first two have DB defaults, the stamps are filled by the app.
      { table: 'characters', rows: [{ id: 'oldie-c', project_id: 'oldie', name: 'Old Hand' }] },
    ]);
    const imported = await upload(file);
    expect(imported.statusCode, imported.payload).toBe(201);

    const result = await restoreViaApi(imported.json().id);
    expect(result.restored[0]).toMatchObject({ projectId: 'oldie', mode: 'restore' });
    expect(result.warnings.join('\n')).toMatch(/unknown table "app_settings"/);
    expect(result.warnings.join('\n')).toMatch(/unknown table "made_up_table"/);
    expect(result.warnings.join('\n')).toMatch(/unknown columns in "projects": bogus_column/);
    expect(sql("SELECT value FROM app_settings WHERE key = 'defaultProvider'")[0]!.value).toBe('mock');
    const hand = sql("SELECT * FROM characters WHERE id = 'oldie-c'")[0]!;
    expect(hand).toMatchObject({ role: 'supporting', sort_order: 0, revision: 1 });
    expect(hand.created_at).toBeGreaterThan(0);
  });

  it('only restores rows that belong to the chosen story', async () => {
    const { id } = await createViaApi({});
    const result = await restoreViaApi(id, { projects: [{ id: p1, mode: 'copy' }] });
    const np = result.restored[0]!.projectId;
    expect(count('chapters', 'project_id = ?', np)).toBe(1);
    expect(sql('SELECT COUNT(*) AS n FROM characters WHERE project_id = ? AND name LIKE ?', np, '%two%')[0]!.n).toBe(0);
  });
});

describe('download and import', () => {
  it('round-trips a downloaded file through import', async () => {
    const original = dump(p1);
    const { id } = await createViaApi({ projectIds: [p1], label: 'travelling' });

    const download = await app.inject({ method: 'GET', url: `/api/backups/${id}/download` });
    expect(download.statusCode).toBe(200);
    expect(download.headers['content-type']).toBe('application/gzip');
    expect(download.headers['content-disposition']).toBe(`attachment; filename="${id}.backup.gz"`);
    expect(download.rawPayload.equals(fs.readFileSync(path.join(backupDir, `${id}.backup.gz`)))).toBe(true);

    const imported = await upload(download.rawPayload);
    expect(imported.statusCode, imported.payload).toBe(201);
    const manifest = imported.json() as BackupSummary;
    expect(manifest.kind).toBe('imported');
    expect(manifest.id).not.toBe(id);
    expect(manifest.label).toBe('travelling');
    expect(manifest.projects.map((p) => p.id)).toEqual([p1]);

    // Move the story out of the way, then bring it back from the imported copy.
    app.sqlite.prepare('DELETE FROM projects WHERE id = ?').run(p1);
    const result = await restoreViaApi(manifest.id);
    expect(result.restored[0]!.mode).toBe('restore');
    expect(dump(p1)).toEqual(original);
    expect((await listBackups(backupDir)).map((b) => b.kind).sort()).toEqual(['imported', 'manual']);
  });

  it.each([
    ['empty body', Buffer.alloc(0)],
    ['not gzip', Buffer.from('definitely not a backup')],
    ['gzip of something else', zlib.gzipSync('hello\nworld\n')],
    ['gzip of JSON without the format marker', zlib.gzipSync(JSON.stringify({ hello: 'world' }) + '\n')],
    ['a newer format version', makeFile([], { formatVersion: 2 } as never)],
    ['a manifest that is damaged', makeFile([], { createdAt: 'yesterday' } as never)],
    ['a body line that is not table data', zlib.gzipSync(zlib.gunzipSync(makeFile([])).toString() + '[1,2]\n')],
    ['a body line that is not JSON', zlib.gzipSync(zlib.gunzipSync(makeFile([])).toString() + '{{{\n')],
    ['a row that is not an object', makeFile([{ table: 'projects', rows: [7 as never] }])],
    ['a manifest that lies about the stories', makeFile([{ table: 'projects', rows: [{ id: 'a', title: 'A' }] }], { projects: [] })],
    ['a truncated file', makeFile([{ table: 'projects', rows: [{ id: 'a', title: 'A' }] }]).subarray(0, 40)],
  ])('rejects an upload that is %s', async (_name, payload) => {
    const res = await upload(payload);
    expect(res.statusCode, res.payload).toBe(400);
    expect(res.json().message).toBeTruthy();
    // Nothing was stored.
    expect(fs.existsSync(backupDir) ? fs.readdirSync(backupDir) : []).toEqual([]);
  });

  it('only accepts a raw upload', async () => {
    const res = await app.inject({ method: 'POST', url: '/api/backups/import', payload: { not: 'a file' } });
    expect(res.statusCode).toBeGreaterThanOrEqual(400);
    expect(res.statusCode).toBeLessThan(500);
  });

  it('leaves no temporary files behind', async () => {
    await createViaApi({});
    await upload(makeFile([{ table: 'projects', rows: [{ id: 'a', title: 'A' }] }]));
    expect(fs.readdirSync(backupDir).every((name) => name.endsWith('.backup.gz'))).toBe(true);
  });
});

describe('deleting', () => {
  it('removes the file and then 404s', async () => {
    const { id } = await createViaApi({});
    expect((await app.inject({ method: 'DELETE', url: `/api/backups/${id}` })).statusCode).toBe(204);
    expect(fs.existsSync(path.join(backupDir, `${id}.backup.gz`))).toBe(false);
    expect((await app.inject({ method: 'DELETE', url: `/api/backups/${id}` })).statusCode).toBe(404);
    expect((await app.inject({ method: 'GET', url: `/api/backups/${id}` })).statusCode).toBe(404);
    expect((await app.inject({ method: 'GET', url: `/api/backups/${id}/download` })).statusCode).toBe(404);
    expect((await app.inject({ method: 'POST', url: `/api/backups/${id}/restore`, payload: {} })).statusCode).toBe(404);
  });
});

describe('ids are not paths', () => {
  it.each(['..%2F..%2Fx', '..%2Fx', '%2E%2E%2Fx', 'a%5Cb', 'x.y', '..'])('refuses %s everywhere', async (bad) => {
    // A look-alike file outside the backups folder that must survive.
    const outside = path.join(root, 'x.backup.gz');
    fs.writeFileSync(outside, makeFile([{ table: 'projects', rows: [{ id: 'a', title: 'A' }] }]));
    fs.mkdirSync(backupDir, { recursive: true });

    const calls = [
      { method: 'GET', url: `/api/backups/${bad}` },
      { method: 'GET', url: `/api/backups/${bad}/download` },
      { method: 'DELETE', url: `/api/backups/${bad}` },
      { method: 'POST', url: `/api/backups/${bad}/restore`, payload: {} },
    ] as const;
    for (const call of calls) {
      const res = await app.inject(call);
      expect([400, 404], `${call.method} ${call.url} -> ${res.statusCode}`).toContain(res.statusCode);
      expect(res.rawPayload.length < 500 || res.statusCode >= 400).toBe(true);
    }
    expect(fs.existsSync(outside)).toBe(true);
    expect(count('projects')).toBe(2);
  });
});

describe('retention', () => {
  it('prunes automatic and pre-restore backups but never manual or imported ones', async () => {
    const make = async (kind: 'manual' | 'automatic' | 'pre-restore') => {
      await sleep(3);
      return createBackup({ sqlite: app.sqlite, backupDir }, { projectIds: [p1], kind, label: kind });
    };
    const manual = await make('manual');
    const auto = [await make('automatic'), await make('pre-restore'), await make('automatic'), await make('pre-restore')];
    const imported = (await upload(fs.readFileSync(path.join(backupDir, `${manual.id}.backup.gz`)))).json() as BackupSummary;

    const removed = await pruneBackups(backupDir, 2);
    expect(removed.sort()).toEqual([auto[0]!.id, auto[1]!.id].sort());
    const left = (await listBackups(backupDir)).map((b) => b.id);
    expect(left).toContain(manual.id);
    expect(left).toContain(imported.id);
    expect(left).toContain(auto[2]!.id);
    expect(left).toContain(auto[3]!.id);
    expect(left).toHaveLength(4);
  });

  it('keeps the limit when restores keep making safety backups', async () => {
    const { id } = await createViaApi({ projectIds: [p1] });
    for (let i = 0; i < MAX_AUTO_BACKUPS + 2; i++) {
      await sleep(2);
      await restoreViaApi(id, { projects: [{ id: p1, mode: 'replace' }] });
    }
    const kinds = (await listBackups(backupDir)).map((b) => b.kind);
    expect(kinds.filter((k) => k === 'pre-restore')).toHaveLength(MAX_AUTO_BACKUPS);
    expect(kinds.filter((k) => k === 'manual')).toHaveLength(1);
  });
});
