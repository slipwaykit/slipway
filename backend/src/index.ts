/**
 * Slipway backend entry point.
 *
 * This process exists for the three things a browser cannot do: fetch an
 * anchor's `stellar.toml` across origins, poll corridors on a schedule, and
 * sign attestation writes. Everything else the frontend could do itself.
 */

import { serve } from '@hono/node-server';
import { createApp } from './app.js';
import { createDb } from './db/index.js';
import { describeEnv, loadEnv } from './env.js';
import { Attestor } from './services/attestor.js';
import { runPoll, seedDatabase, startPoller } from './services/poller.js';
import { buildRegistry } from './services/registry.js';

const logger = {
  info: (message: string, detail?: unknown): void => console.log(message, detail ?? ''),
  warn: (message: string, detail?: unknown): void => console.warn(message, detail ?? ''),
};

async function main(): Promise<void> {
  // Throws, loudly, on a misconfigured production deployment.
  const env = loadEnv();
  logger.info('[slipway] starting', describeEnv(env));

  const { db, close } = createDb(env.SLIPWAY_DB_PATH);
  await seedDatabase(db);

  const registry = buildRegistry();
  const attestor = new Attestor(env, logger);
  const deps = { db, registry, env, logger };

  if (attestor.enabled) {
    logger.info('[attestor] enabled', { account: attestor.publicKey() });
  }

  const pollerDeps = { db, registry, attestor, env, logger };
  const app = createApp({ ...deps, poll: () => runPoll(pollerDeps) });
  const poller = env.SLIPWAY_POLL_ENABLED ? startPoller(pollerDeps) : undefined;

  if (env.SLIPWAY_POLL_TOKEN !== undefined) {
    logger.info('[slipway] POST /api/poll is enabled for an external scheduler');
  }

  const server = serve({ fetch: app.fetch, port: env.PORT }, (info) => {
    logger.info(`[slipway] listening on http://localhost:${info.port}`);
  });

  const shutdown = (signal: string): void => {
    logger.info(`[slipway] ${signal} received, shutting down`);
    poller?.stop();
    server.close();
    close();
    process.exit(0);
  };
  process.on('SIGINT', () => shutdown('SIGINT'));
  process.on('SIGTERM', () => shutdown('SIGTERM'));
}

main().catch((error: unknown) => {
  console.error('[slipway] failed to start:', error instanceof Error ? error.message : error);
  process.exit(1);
});
