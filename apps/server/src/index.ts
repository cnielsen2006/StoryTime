import { buildApp } from './app.js';
import { config } from './config.js';

async function main() {
  const app = await buildApp();
  await app.listen({ port: config.PORT, host: config.HOST });

  const shown = config.HOST === '0.0.0.0' ? 'your LAN address' : config.HOST;
  app.log.info(`StoryTime API listening on http://${shown}:${config.PORT}`);
}

main().catch((err) => {
  console.error('Failed to start StoryTime:', err);
  process.exit(1);
});
