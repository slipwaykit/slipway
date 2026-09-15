/**
 * The Hono application, assembled from its routes.
 *
 * Kept separate from `index.ts` so the test suite can build an app over an
 * in-memory database and a fixture-backed registry without starting a server,
 * opening a file or scheduling a cron job.
 */

import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { RampError } from '@slipwaykit/core';
import { describeEnv } from './env.js';
import type { AppDeps, ApiErrorBody } from './deps.js';
import { createAnchorsRoute } from './routes/anchors.js';
import { createCorridorsRoute } from './routes/corridors.js';
import { createQuotesRoute } from './routes/quotes.js';

/**
 * Build the API.
 *
 * @param deps - Database, registry, configuration and logger.
 * @returns The Hono app.
 *
 * @example
 * ```ts
 * const app = createApp({ db, registry, env, logger });
 * const response = await app.request('/api/corridors');
 * ```
 */
export function createApp(deps: AppDeps): Hono {
  const app = new Hono();

  const origins = deps.env.SLIPWAY_CORS_ORIGINS;
  app.use(
    '*',
    cors({
      origin: origins === '*' ? '*' : origins.split(',').map((value) => value.trim()),
      allowMethods: ['GET', 'OPTIONS'],
    }),
  );

  /**
   * Health, and a redacted view of the configuration.
   *
   * `describeEnv` reports whether the attestor secret is set, never what it is.
   */
  app.get('/api/health', (context) =>
    context.json({ status: 'ok', config: describeEnv(deps.env) }),
  );

  app.route('/api', createQuotesRoute(deps));
  app.route('/api', createAnchorsRoute(deps));
  app.route('/api', createCorridorsRoute(deps));

  app.notFound((context) => {
    const body: ApiErrorBody = {
      error: { code: 'NOT_FOUND', message: `No route for ${context.req.method} ${context.req.path}.` },
    };
    return context.json(body, 404);
  });

  app.onError((error, context) => {
    // Nothing below this point gets to leak a stack trace or a provider body to
    // a browser. The full error goes to the log; the caller gets a code.
    deps.logger.warn('[api] unhandled error', {
      path: context.req.path,
      reason: error instanceof Error ? error.message : String(error),
    });

    const code = RampError.is(error) ? error.code : 'INTERNAL_ERROR';
    const body: ApiErrorBody = {
      error: { code, message: 'The request could not be completed.' },
    };
    return context.json(body, 500);
  });

  return app;
}
