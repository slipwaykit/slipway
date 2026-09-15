/**
 * An app wired over an in-memory database and mock adapters.
 *
 * No file is opened, no cron job is scheduled and no anchor is contacted, so
 * the backend suite runs offline exactly like the adapter suite does.
 */

import { AdapterRegistry } from '@slipwaykit/core';
import { MockAdapter } from '@slipwaykit/adapter-mock';
import { createApp } from '../src/app.js';
import { createDb, type Connection, type Db } from '../src/db/index.js';
import { loadEnv, type Env } from '../src/env.js';
import type { AppDeps } from '../src/deps.js';
import type { Logger } from '../src/services/attestor.js';
import { seedDatabase } from '../src/services/poller.js';

/** A logger that records instead of printing. */
export interface TestLogger extends Logger {
  /** Everything logged, newest last. */
  readonly lines: { level: 'info' | 'warn'; message: string; detail?: unknown }[];
}

/** Build a logger that captures rather than prints. */
export function testLogger(): TestLogger {
  const lines: TestLogger['lines'] = [];
  return {
    lines,
    info: (message, detail) => lines.push({ level: 'info', message, detail }),
    warn: (message, detail) => lines.push({ level: 'warn', message, detail }),
  };
}

/** A fully wired test app. */
export interface TestApp {
  /** Call it with `app.request('/api/...')`. */
  readonly app: ReturnType<typeof createApp>;
  /** The in-memory database. */
  readonly db: Db;
  /** The adapters behind it. */
  readonly registry: AdapterRegistry;
  /** Validated configuration. */
  readonly env: Env;
  /** Captured log output. */
  readonly logger: TestLogger;
  /** Everything the app needs, for calling services directly. */
  readonly deps: AppDeps;
  /** Close the database. */
  readonly close: Connection['close'];
}

/** Two deterministic NGN adapters, so comparisons have something to order. */
export function testAdapters(now: () => number): MockAdapter[] {
  return [
    new MockAdapter({
      id: 'mock:ng-0',
      name: 'Demo NGN Ramp 1',
      country: 'NG',
      fiat: 'NGN',
      rate: '1580',
      feeFixed: '500',
      methods: ['bank_transfer'],
      now,
    }),
    new MockAdapter({
      id: 'mock:ng-1',
      name: 'Demo NGN Ramp 2',
      country: 'NG',
      fiat: 'NGN',
      // A better rate that is entirely taken back in fees.
      rate: '1650',
      feeFixed: '10000',
      methods: ['bank_transfer'],
      now,
    }),
    new MockAdapter({
      id: 'mock:ke-0',
      name: 'Demo KES Ramp',
      country: 'KE',
      fiat: 'KES',
      rate: '129.40',
      methods: ['mobile_money'],
      now,
    }),
  ];
}

/**
 * Build an app over `:memory:`.
 *
 * @param options - Adapter overrides and environment overrides.
 * @returns The app and everything behind it.
 *
 * @example
 * ```ts
 * const harness = await createTestApp();
 * const response = await harness.app.request('/api/corridors');
 * harness.close();
 * ```
 */
export async function createTestApp(
  options: {
    readonly adapters?: readonly MockAdapter[];
    readonly env?: Record<string, string>;
    readonly now?: () => number;
  } = {},
): Promise<TestApp> {
  const now = options.now ?? ((): number => 1_757_942_400_000);
  const env = loadEnv({
    NODE_ENV: 'test',
    SLIPWAY_DB_PATH: ':memory:',
    SLIPWAY_POLL_ENABLED: 'false',
    ...options.env,
  } as NodeJS.ProcessEnv);

  const { db, close } = createDb(':memory:');
  await seedDatabase(db);

  const registry = new AdapterRegistry(options.adapters ?? testAdapters(now), { now });
  const logger = testLogger();
  const deps: AppDeps = { db, registry, env, logger };

  return { app: createApp(deps), db, registry, env, logger, deps, close };
}
