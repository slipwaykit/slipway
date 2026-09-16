/**
 * `POST /api/poll` — run one polling pass on demand.
 *
 * The in-process cron job assumes a host that keeps the service running. Free
 * tiers that sleep an idle service (Render, Koyeb) break that assumption: the
 * scheduler is asleep exactly when it is supposed to fire. This endpoint lets an
 * external scheduler — a GitHub Actions cron, say — drive the poll instead. The
 * request wakes the service and runs the pass in the same call.
 *
 * The endpoint exists only when `SLIPWAY_POLL_TOKEN` is set. It is a write, and
 * it fans out to every anchor, so it is never open.
 */

import { Hono } from 'hono';
import type { AppDeps, ApiErrorBody } from '../deps.js';

/** The body of a successful `POST /api/poll`. */
export interface PollResponse {
  /** What the run did. */
  readonly summary: {
    readonly corridors: number;
    readonly snapshots: number;
    readonly successes: number;
    readonly attested: number;
    readonly failed: readonly string[];
  };
  /** How long the run took, in milliseconds. */
  readonly durationMs: number;
}

/** Compare two secrets without leaking their relative length through timing. */
function secretsMatch(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let difference = 0;
  for (let index = 0; index < a.length; index += 1) {
    difference |= a.charCodeAt(index) ^ b.charCodeAt(index);
  }
  return difference === 0;
}

/**
 * Build the poll route.
 *
 * Mounted only when a token is configured and a `poll` function was injected.
 *
 * @param deps - Configuration, logger and the poll function.
 * @returns A Hono app to mount under `/api`.
 *
 * @example
 * ```ts
 * app.route('/api', createPollRoute({ ...deps, poll: () => runPoll(pollerDeps) }));
 * // curl -X POST -H "Authorization: Bearer $SLIPWAY_POLL_TOKEN" https://host/api/poll
 * ```
 */
export function createPollRoute(deps: AppDeps): Hono {
  const app = new Hono();
  let running = false;

  app.post('/poll', async (context) => {
    const token = deps.env.SLIPWAY_POLL_TOKEN;
    const poll = deps.poll;
    if (token === undefined || poll === undefined) {
      const body: ApiErrorBody = {
        error: { code: 'NOT_FOUND', message: 'This deployment does not expose a poll endpoint.' },
      };
      return context.json(body, 404);
    }

    const supplied = context.req.header('authorization')?.replace(/^Bearer\s+/i, '') ?? '';
    if (!secretsMatch(supplied, token)) {
      const body: ApiErrorBody = {
        error: { code: 'AUTH_INVALID', message: 'A valid poll token is required.' },
      };
      return context.json(body, 401);
    }

    // A poll fans out to every adapter on every corridor. Two at once would
    // double that load on the anchors and race the attestor's sequence numbers.
    if (running) {
      const body: ApiErrorBody = {
        error: { code: 'RATE_LIMITED', message: 'A polling run is already in progress.' },
      };
      return context.json(body, 429);
    }

    running = true;
    const startedAt = Date.now();
    try {
      const summary = await poll();
      const body: PollResponse = { summary, durationMs: Date.now() - startedAt };
      return context.json(body);
    } finally {
      running = false;
    }
  });

  return app;
}
