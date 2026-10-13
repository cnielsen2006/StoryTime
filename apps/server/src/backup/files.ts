import { nanoid } from 'nanoid';
import fs from 'node:fs';
import path from 'node:path';
import readline from 'node:readline';
import { fileURLToPath } from 'node:url';
import zlib from 'node:zlib';
import type { Readable } from 'node:stream';
import { BackupManifest, type BackupKind, type BackupSummary } from '@storytime/shared';
import { HttpError, badRequest, notFound } from '../services/entities.js';

export const BACKUP_EXT = '.backup.gz';
export const FORMAT = 'storytime-backup';
export const FORMAT_VERSION = 1;

/** Backups of these kinds are made by the app itself, so only the newest few are kept. */
export const AUTO_KINDS: readonly BackupKind[] = ['automatic', 'pre-restore'];
export const MAX_AUTO_BACKUPS = 20;

/** A backup's rows are written this many to a line, so no single line is huge. */
const ROWS_PER_LINE = 500;
const BYTES_PER_LINE = 4 * 1024 * 1024;
/** Compress in blocks about this big; the manifest always sits alone in the first block. */
const BYTES_PER_BLOCK = 1024 * 1024;
/** The manifest is a few hundred bytes per story; anything past this is not one. */
const MAX_MANIFEST_BYTES = 8 * 1024 * 1024;
/** What an uploaded file may expand to before it is rejected. */
const MAX_UNCOMPRESSED_CHARS = 1024 * 1024 * 1024;

export type Row = Record<string, unknown>;

// --- Ids and paths ----------------------------------------------------------

const ID_PATTERN = /^[A-Za-z0-9_-]+$/;

/** Ids end up in file paths, so this is the guard against `..` and friends. */
export function assertBackupId(id: string): string {
  if (!ID_PATTERN.test(id) || id.length > 128) throw badRequest('That is not a valid backup id.');
  return id;
}

export function backupPath(dir: string, id: string): string {
  return path.join(dir, assertBackupId(id) + BACKUP_EXT);
}

const pad = (n: number) => String(n).padStart(2, '0');

/** `storytime-20261012-153045-k3x9`: sorts by time, and the random tail keeps same-second backups apart. */
export function newBackupId(dir: string, now = new Date()): string {
  const stamp =
    `${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}` +
    `-${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}`;
  for (;;) {
    const id = `storytime-${stamp}-${randomTail()}`;
    if (!fs.existsSync(path.join(dir, id + BACKUP_EXT))) return id;
  }
}

function randomTail(): string {
  // nanoid's alphabet includes - and _, which read badly in a filename.
  return nanoid(8).replace(/[^A-Za-z0-9]/g, '').padEnd(4, 'x').slice(0, 4).toLowerCase();
}

/** How many migrations this build knows about; tells a restore whether a file is from a newer app. */
let appSchema: number | null = null;
export function currentAppSchema(): number {
  if (appSchema === null) {
    const journal = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../drizzle/meta/_journal.json');
    appSchema = (JSON.parse(fs.readFileSync(journal, 'utf8')) as { entries: unknown[] }).entries.length;
  }
  return appSchema;
}

// --- Writing ----------------------------------------------------------------

/**
 * Writes the gzip as a series of members (which is still one valid .gz file)
 * so it can be done synchronously inside a read transaction, in bounded memory.
 * The file only appears under its real name once it is complete.
 */
export class BackupWriter {
  private readonly tmp: string;
  private readonly fd: number;
  private pending: string[] = [];
  private pendingBytes = 0;

  constructor(private readonly finalPath: string) {
    fs.mkdirSync(path.dirname(finalPath), { recursive: true });
    this.tmp = `${finalPath}.tmp-${nanoid(6)}`;
    this.fd = fs.openSync(this.tmp, 'wx');
  }

  /** The manifest, alone in its own block so listing only ever inflates a few hundred bytes. */
  writeManifest(manifest: BackupManifest) {
    this.pending.push(JSON.stringify(manifest) + '\n');
    this.flush();
  }

  /** Rows go out in lines of bounded size; `encodedRows` are already JSON. */
  writeRows(table: string, encodedRows: string[]) {
    const head = `{"table":${JSON.stringify(table)},"rows":[`;
    let start = 0;
    while (start < encodedRows.length) {
      let end = start;
      let bytes = 0;
      while (end < encodedRows.length && end - start < ROWS_PER_LINE && bytes < BYTES_PER_LINE) {
        bytes += encodedRows[end]!.length;
        end += 1;
      }
      this.push(`${head}${encodedRows.slice(start, end).join(',')}]}\n`);
      start = end;
    }
  }

  private push(line: string) {
    this.pending.push(line);
    this.pendingBytes += line.length;
    if (this.pendingBytes >= BYTES_PER_BLOCK) this.flush();
  }

  private flush() {
    if (this.pending.length === 0) return;
    fs.writeSync(this.fd, zlib.gzipSync(this.pending.join('')));
    this.pending = [];
    this.pendingBytes = 0;
  }

  commit() {
    this.flush();
    fs.closeSync(this.fd);
    fs.renameSync(this.tmp, this.finalPath);
  }

  abort() {
    try {
      fs.closeSync(this.fd);
    } catch {
      // Already closed.
    }
    fs.rmSync(this.tmp, { force: true });
  }
}

/** Blobs cannot be JSON, so they travel as base64 in a tagged object. No current column holds one. */
export function encodeRow(row: Row): string {
  for (const key of Object.keys(row)) {
    const value = row[key];
    if (Buffer.isBuffer(value)) row[key] = { $blob: value.toString('base64') };
  }
  return JSON.stringify(row);
}

// --- Reading ----------------------------------------------------------------

function parseManifestLine(line: string): BackupManifest {
  let raw: unknown;
  try {
    raw = JSON.parse(line);
  } catch {
    throw badRequest('That is not a StoryTime backup file.');
  }
  const header = raw as { format?: unknown; formatVersion?: unknown } | null;
  if (!header || typeof header !== 'object' || header.format !== FORMAT) {
    throw badRequest('That is not a StoryTime backup file.');
  }
  if (header.formatVersion !== FORMAT_VERSION) {
    throw badRequest(
      `This backup uses format version ${String(header.formatVersion)}, which this version of StoryTime cannot read.`,
    );
  }
  const parsed = BackupManifest.safeParse(raw);
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    throw badRequest(`The backup's header is damaged (${issue?.path.join('.') || 'manifest'}: ${issue?.message}).`);
  }
  return parsed.data;
}

function gunzipFrom(input: Readable) {
  const gunzip = zlib.createGunzip();
  input.on('error', (err) => gunzip.destroy(err));
  return input.pipe(gunzip);
}

/** Reads only up to the first newline of the decompressed stream, however big the file is. */
export async function readManifest(file: string): Promise<BackupManifest> {
  const input = fs.createReadStream(file);
  const gunzip = gunzipFrom(input);
  const chunks: Buffer[] = [];
  let size = 0;
  try {
    for await (const chunk of gunzip as AsyncIterable<Buffer>) {
      const newline = chunk.indexOf(0x0a);
      const part = newline === -1 ? chunk : chunk.subarray(0, newline);
      chunks.push(part);
      size += part.length;
      if (newline !== -1) break;
      if (size > MAX_MANIFEST_BYTES) throw badRequest('That is not a StoryTime backup file.');
    }
    return parseManifestLine(Buffer.concat(chunks).toString('utf8'));
  } catch (err) {
    if (err instanceof HttpError) throw err;
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') throw notFound('Backup');
    throw badRequest('That file is not a readable StoryTime backup.');
  } finally {
    gunzip.destroy();
    input.destroy();
  }
}

export interface BackupContents {
  manifest: BackupManifest;
  /** Table name -> its rows, in file order. Names are not checked here; whoever uses them whitelists them. */
  tables: Map<string, Row[]>;
}

function decodeValue(value: unknown): unknown {
  if (value === null || typeof value === 'string' || typeof value === 'number') return value;
  if (typeof value === 'object' && !Array.isArray(value)) {
    const blob = (value as { $blob?: unknown }).$blob;
    if (typeof blob === 'string') return Buffer.from(blob, 'base64');
  }
  throw badRequest('The backup contains a value that is not valid data.');
}

/** Reads and checks the whole file. An uploaded file is untrusted, so every line is validated. */
export async function readBackup(input: Readable): Promise<BackupContents> {
  const gunzip = gunzipFrom(input);
  const lines = readline.createInterface({ input: gunzip, crlfDelay: Infinity });
  let manifest: BackupManifest | null = null;
  const tables = new Map<string, Row[]>();
  let chars = 0;
  try {
    for await (const line of lines) {
      if (!line.trim()) continue;
      chars += line.length;
      if (chars > MAX_UNCOMPRESSED_CHARS) throw badRequest('That backup is too large to read.');
      if (!manifest) {
        manifest = parseManifestLine(line);
        continue;
      }
      const entry = JSON.parse(line) as { table?: unknown; rows?: unknown };
      if (typeof entry?.table !== 'string' || !Array.isArray(entry.rows)) {
        throw badRequest('The backup contains a line that is not table data.');
      }
      const rows = tables.get(entry.table) ?? [];
      for (const raw of entry.rows) {
        if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) {
          throw badRequest('The backup contains a row that is not valid data.');
        }
        const row: Row = {};
        for (const [column, value] of Object.entries(raw)) row[column] = decodeValue(value);
        rows.push(row);
      }
      tables.set(entry.table, rows);
    }
  } catch (err) {
    if (err instanceof HttpError) throw err;
    throw badRequest(`That file could not be read as a StoryTime backup (${(err as Error).message}).`);
  } finally {
    lines.close();
    gunzip.destroy();
    input.destroy();
  }
  if (!manifest) throw badRequest('That file is empty.');
  return { manifest, tables };
}

// --- Listing and housekeeping -----------------------------------------------

/** Every readable backup in the directory, newest first. Files that are not backups are skipped. */
export async function listBackups(dir: string): Promise<BackupSummary[]> {
  let names: string[];
  try {
    names = await fs.promises.readdir(dir);
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return [];
    throw err;
  }
  const found = await Promise.all(
    names
      .filter((name) => name.endsWith(BACKUP_EXT) && ID_PATTERN.test(name.slice(0, -BACKUP_EXT.length)))
      .map(async (name): Promise<BackupSummary | null> => {
        const id = name.slice(0, -BACKUP_EXT.length);
        try {
          const file = path.join(dir, name);
          const [manifest, stat] = await Promise.all([readManifest(file), fs.promises.stat(file)]);
          // The filename is what the API addresses, so it wins if someone renamed the file.
          return { ...manifest, id, bytes: stat.size };
        } catch {
          return null;
        }
      }),
  );
  return found
    .filter((b): b is BackupSummary => b !== null)
    .sort((a, b) => b.createdAt - a.createdAt || (a.id < b.id ? 1 : -1));
}

export async function getBackup(dir: string, id: string): Promise<BackupSummary> {
  const file = backupPath(dir, id);
  const manifest = await readManifest(file);
  return { ...manifest, id, bytes: (await fs.promises.stat(file)).size };
}

export function deleteBackup(dir: string, id: string) {
  try {
    fs.unlinkSync(backupPath(dir, id));
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') throw notFound('Backup');
    throw err;
  }
}

/** Keeps the newest `keep` automatic and pre-restore backups; manual and imported ones are never touched. */
export async function pruneBackups(dir: string, keep = MAX_AUTO_BACKUPS): Promise<string[]> {
  const stale = (await listBackups(dir)).filter((b) => AUTO_KINDS.includes(b.kind)).slice(keep);
  for (const backup of stale) fs.rmSync(backupPath(dir, backup.id), { force: true });
  return stale.map((b) => b.id);
}
