#!/usr/bin/env node
/**
 * Keep StoryTime a singleton: before a launch binds its ports, stop whichever
 * earlier StoryTime instance holds them, so launching twice restarts the app
 * instead of leaving two copies running against the same database.
 *
 * Checking the port alone is not enough on Windows, where one copy bound to
 * 0.0.0.0 and another bound to 127.0.0.1 can share a port without an error.
 * So every listener on the port counts, whatever address it is on.
 *
 * Killing only the listener is not enough either: `tsx watch` would restart the
 * server, and the old console window would linger. So it climbs from the
 * listener through the launcher processes that belong to that instance (node,
 * and `cmd /c` shells such as start.bat) and stops the whole tree. The climb
 * stops at anything a person might own: an interactive shell, an editor,
 * Explorer, or this launch's own ancestors.
 *
 * A port held by something that is not StoryTime is never touched.
 *
 * Usage: node scripts/free-ports.mjs [api] [web] [--dry-run]
 *   api  the API port (PORT, default 3001)
 *   web  the Vite dev server port (WEB_PORT, default 5173)
 * With neither, both are freed.
 */
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const isWindows = process.platform === 'win32';

/** PORT may live in .env rather than the environment. */
function envValue(name) {
  if (process.env[name]) return process.env[name];
  const envFile = path.join(repoRoot, '.env');
  if (!existsSync(envFile)) return undefined;
  const match = readFileSync(envFile, 'utf8').match(new RegExp(`^\\s*${name}\\s*=\\s*(\\d+)`, 'm'));
  return match?.[1];
}

const PORTS = {
  api: Number(envValue('PORT') ?? 3001),
  web: Number(envValue('WEB_PORT') ?? 5173),
};

function run(command, args) {
  try {
    return execFileSync(command, args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'], windowsHide: true });
  } catch (error) {
    // netstat/lsof exit non-zero when nothing matches; their output is still usable.
    return error.stdout ?? '';
  }
}

/** Process ids listening on a TCP port, on any address. */
function listeners(port) {
  if (isWindows) {
    const pids = new Set();
    for (const line of run('netstat', ['-ano', '-p', 'tcp']).split(/\r?\n/)) {
      const parts = line.trim().split(/\s+/);
      if (parts[0] === 'TCP' && parts[3] === 'LISTENING' && parts[1]?.endsWith(`:${port}`)) {
        pids.add(Number(parts[4]));
      }
    }
    return [...pids].filter((pid) => pid > 0);
  }
  return run('lsof', ['-nP', '-t', `-iTCP:${port}`, '-sTCP:LISTEN'])
    .split(/\s+/)
    .filter(Boolean)
    .map(Number);
}

/** Every process as { pid, ppid, name, command }. */
function processTable() {
  if (isWindows) {
    const json = run('powershell.exe', [
      '-NoProfile',
      '-NonInteractive',
      '-Command',
      'Get-CimInstance Win32_Process | Select-Object ProcessId,ParentProcessId,Name,CommandLine | ConvertTo-Json -Compress',
    ]);
    const rows = JSON.parse(json || '[]');
    return (Array.isArray(rows) ? rows : [rows]).map((row) => ({
      pid: row.ProcessId,
      ppid: row.ParentProcessId,
      name: String(row.Name ?? '').toLowerCase(),
      command: String(row.CommandLine ?? ''),
    }));
  }
  return run('ps', ['-Ao', 'pid=,ppid=,comm=,args='])
    .split('\n')
    .map((line) => line.trim().match(/^(\d+)\s+(\d+)\s+(\S+)\s+(.*)$/))
    .filter(Boolean)
    .map(([, pid, ppid, comm, args]) => ({
      pid: Number(pid),
      ppid: Number(ppid),
      name: path.basename(comm).toLowerCase(),
      command: args,
    }));
}

const normalise = (text) => text.replace(/\\/g, '/').toLowerCase();
const rootMarker = normalise(repoRoot);

/** Launcher plumbing that belongs to an instance and is safe to stop with it. */
function isLauncher(proc) {
  if (proc.name === 'node.exe' || proc.name === 'node') return true;
  // `cmd /c` runs a batch file or an npm script and exits; a bare cmd is someone's terminal.
  if (proc.name === 'cmd.exe') return /(^|\s)\/c(\s|$)/i.test(proc.command);
  if (proc.name === 'sh') return /(^|\s)-c(\s|$)/.test(proc.command);
  return false;
}

function ancestorsOf(pid, byPid) {
  const chain = new Set();
  let current = byPid.get(pid);
  while (current && !chain.has(current.pid)) {
    chain.add(current.pid);
    current = byPid.get(current.ppid);
  }
  return chain;
}

/** The topmost process of the instance that owns this listener. */
function instanceRoot(pid, byPid, protectedPids) {
  let root = byPid.get(pid);
  for (;;) {
    const parent = root && byPid.get(root.ppid);
    if (!parent || parent.pid === root.pid || protectedPids.has(parent.pid) || !isLauncher(parent)) return root;
    root = parent;
  }
}

function descendantsOf(pid, table) {
  const found = [pid];
  for (let i = 0; i < found.length; i += 1) {
    for (const proc of table) if (proc.ppid === found[i] && !found.includes(proc.pid)) found.push(proc.pid);
  }
  return found;
}

function stopTree(root, table) {
  if (isWindows) {
    run('taskkill', ['/PID', String(root.pid), '/T', '/F']);
    return;
  }
  for (const pid of descendantsOf(root.pid, table).reverse()) {
    try {
      process.kill(pid, 'SIGTERM');
    } catch {
      // Already gone.
    }
  }
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function main() {
  const args = process.argv.slice(2);
  const dryRun = args.includes('--dry-run');
  const names = args.filter((arg) => arg in PORTS);
  const ports = (names.length ? names : Object.keys(PORTS)).map((name) => PORTS[name]);

  const busy = ports.map((port) => ({ port, pids: listeners(port) })).filter((entry) => entry.pids.length);
  if (busy.length === 0) return;

  const table = processTable();
  const byPid = new Map(table.map((proc) => [proc.pid, proc]));
  const protectedPids = ancestorsOf(process.pid, byPid);

  const roots = new Map();
  for (const { port, pids } of busy) {
    for (const pid of pids) {
      const owner = byPid.get(pid);
      if (!owner) continue;
      if (!normalise(owner.command).includes(rootMarker)) {
        console.error(
          `\n  Port ${port} is in use by ${owner.name} (pid ${pid}), which is not StoryTime.` +
            `\n  Close it, or set ${port === PORTS.api ? 'PORT' : 'WEB_PORT'} to a free port in .env.\n`,
        );
        process.exit(1);
      }
      const root = instanceRoot(pid, byPid, protectedPids);
      if (root && !protectedPids.has(root.pid)) roots.set(root.pid, root);
    }
  }

  for (const root of roots.values()) {
    console.log(`  Stopping the StoryTime already running (pid ${root.pid}: ${root.command.slice(0, 80).trim()})`);
    if (!dryRun) stopTree(root, table);
  }
  if (dryRun) return;

  // Wait for the ports to be released before the new copy tries to bind them.
  const deadline = Date.now() + 10_000;
  while (Date.now() < deadline) {
    if (ports.every((port) => listeners(port).length === 0)) return;
    await sleep(250);
  }
  if (!isWindows) {
    for (const root of roots.values()) {
      for (const pid of descendantsOf(root.pid, table)) {
        try {
          process.kill(pid, 'SIGKILL');
        } catch {
          // Already gone.
        }
      }
    }
    await sleep(500);
  }
  const stuck = ports.filter((port) => listeners(port).length > 0);
  if (stuck.length) {
    console.error(`\n  Could not free port ${stuck.join(' and ')}. Close the other StoryTime window and try again.\n`);
    process.exit(1);
  }
}

await main();
