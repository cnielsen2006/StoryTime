#!/usr/bin/env node
/**
 * Poll a URL until it answers, then exit.
 *
 * Used as a preLaunchTask so a Chrome launch config in a compound does not open
 * before Vite is listening and land on a connection error.
 *
 * Usage: node scripts/wait-for.mjs <url> [timeoutSeconds]
 */
const url = process.argv[2] ?? 'http://localhost:5173';
const timeoutSeconds = Number(process.argv[3] ?? 60);

const deadline = Date.now() + timeoutSeconds * 1000;

async function reachable() {
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 2000);
    const response = await fetch(url, { signal: controller.signal });
    clearTimeout(timer);
    return response.ok || response.status < 500;
  } catch {
    return false;
  }
}

process.stdout.write(`Waiting for ${url} `);

while (Date.now() < deadline) {
  if (await reachable()) {
    console.log('\nReady.');
    process.exit(0);
  }
  process.stdout.write('.');
  await new Promise((resolve) => setTimeout(resolve, 500));
}

// Do not fail the launch: the server may simply be slow, and a browser that
// opens early only needs a refresh.
console.log(`\nStill not answering after ${timeoutSeconds}s. Opening anyway.`);
process.exit(0);
