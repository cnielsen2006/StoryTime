import { networkInterfaces } from 'node:os';
import { buildApp } from './app.js';
import { config } from './config.js';

/** Every non-internal IPv4 address this machine answers on. */
function localAddresses(): string[] {
  return Object.values(networkInterfaces())
    .flat()
    .filter((entry): entry is NonNullable<typeof entry> => Boolean(entry))
    .filter((entry) => entry.family === 'IPv4' && !entry.internal)
    .map((entry) => entry.address);
}

async function main() {
  const app = await buildApp();
  await app.listen({ port: config.PORT, host: config.HOST });

  if (config.HOST === '0.0.0.0') {
    // Bound to every interface, so name the addresses another device can use
    // rather than making the reader go and look them up.
    app.log.info(`StoryTime API listening on http://127.0.0.1:${config.PORT} (this machine)`);
    for (const address of localAddresses()) {
      app.log.info(`StoryTime API also reachable on http://${address}:${config.PORT}`);
    }
    app.log.warn('This app has no password. Only expose it on a network you trust.');
  } else {
    app.log.info(`StoryTime API listening on http://${config.HOST}:${config.PORT}`);
  }
}

main().catch((err) => {
  console.error('Failed to start StoryTime:', err);
  process.exit(1);
});
