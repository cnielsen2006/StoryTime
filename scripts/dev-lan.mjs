#!/usr/bin/env node
/**
 * Start StoryTime in LAN mode: both the API and the Vite dev server bind to all
 * interfaces so other devices on the network can reach them.
 *
 * This exists instead of an inline `HOST=0.0.0.0 npm run dev` because that
 * syntax does not work in cmd.exe or PowerShell, and it prints the addresses
 * to actually type on the other device.
 */
import { spawn } from 'node:child_process';
import { networkInterfaces } from 'node:os';

const WEB_PORT = process.env.WEB_PORT ?? '5173';

/** Every non-internal IPv4 address on this machine. */
function localAddresses() {
  return Object.values(networkInterfaces())
    .flat()
    .filter((entry) => entry && entry.family === 'IPv4' && !entry.internal)
    .map((entry) => entry.address);
}

const addresses = localAddresses();

console.log('');
console.log('  StoryTime, LAN mode');
console.log('  ───────────────────');
if (addresses.length === 0) {
  console.log('  No network address found. This machine may be offline.');
} else {
  console.log('  Open one of these from another device on the same network:');
  for (const address of addresses) {
    console.log(`    http://${address}:${WEB_PORT}`);
  }
}
console.log('');
console.log('  There is no password on this app. Only do this on a network you trust.');
console.log('  Press Ctrl+C to stop.');
console.log('');

const child = spawn('npm', ['run', 'dev'], {
  stdio: 'inherit',
  shell: true,
  env: { ...process.env, HOST: '0.0.0.0', BROWSER: 'none' },
});

// Pass signals through so Ctrl+C stops both dev servers, not just this wrapper.
for (const signal of ['SIGINT', 'SIGTERM']) {
  process.on(signal, () => child.kill(signal));
}

child.on('exit', (code) => process.exit(code ?? 0));
