/**
 * Configuration, validated once at startup.
 *
 * The rule that shapes this file: the attestor's Stellar secret is read here
 * and nowhere else, it is never logged, it is never returned by any endpoint,
 * and in production the process refuses to start without it. {@link describeEnv}
 * exists so that startup logging and the `/api/health` endpoint have something
 * safe to print.
 */

import { z } from 'zod';

const schema = z.object({
  /** `production` turns on the checks that must not be skipped in a deployment. */
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),

  /** Port the API listens on. */
  PORT: z.coerce.number().int().positive().default(8787),

  /** Where the SQLite file lives. `:memory:` is used by the test suite. */
  SLIPWAY_DB_PATH: z.string().default('./slipway.db'),

  /** Comma-separated list of allowed browser origins, or `*`. */
  SLIPWAY_CORS_ORIGINS: z.string().default('*'),

  /**
   * The service Stellar account's secret seed, used only to sign attestation
   * writes. Required in production. Never logged, never served.
   */
  SLIPWAY_ATTESTOR_SECRET: z.string().regex(/^S[A-Z2-7]{55}$/, 'not a Stellar secret seed').optional(),

  /** Contract id of the deployed attestations contract. Attestation is off without it. */
  SLIPWAY_ATTESTATIONS_CONTRACT: z.string().optional(),

  /** Soroban RPC endpoint. */
  SLIPWAY_SOROBAN_RPC: z.string().url().default('https://soroban-testnet.stellar.org'),

  /** Network passphrase matching the RPC above. */
  SLIPWAY_NETWORK_PASSPHRASE: z.string().default('Test SDF Network ; September 2015'),

  /** Cron expression for the corridor poller. Defaults to every fifteen minutes. */
  SLIPWAY_POLL_CRON: z.string().default('*/15 * * * *'),

  /** Set to `false` to run the API without the scheduled poller. */
  SLIPWAY_POLL_ENABLED: z
    .enum(['true', 'false'])
    .default('true')
    .transform((value) => value === 'true'),

  /** Notional amount the poller quotes on every corridor, in the sell asset. */
  SLIPWAY_POLL_NOTIONAL: z.string().regex(/^\d+(\.\d+)?$/).default('100'),
});

/** Validated configuration. */
export type Env = z.infer<typeof schema>;

/**
 * Parse and validate the environment.
 *
 * @param source - Where to read from. Defaults to `process.env`.
 * @returns The validated configuration.
 * @throws An `Error` listing every invalid variable, so a misconfigured deploy
 * fails at startup rather than on the first request that needs the value.
 *
 * @example
 * ```ts
 * const env = loadEnv();
 * console.log(`listening on ${env.PORT}`);
 * ```
 */
export function loadEnv(source: NodeJS.ProcessEnv = process.env): Env {
  const parsed = schema.safeParse(source);
  if (!parsed.success) {
    const problems = parsed.error.issues
      .map((issue) => `  ${issue.path.join('.')}: ${issue.message}`)
      .join('\n');
    throw new Error(`Invalid environment:\n${problems}`);
  }

  const env = parsed.data;

  // Refuse to start a production deployment that cannot attest. Failing here is
  // loud; discovering it on the first poller run fifteen minutes later is not.
  if (env.NODE_ENV === 'production' && env.SLIPWAY_ATTESTOR_SECRET === undefined) {
    throw new Error(
      'SLIPWAY_ATTESTOR_SECRET is required when NODE_ENV=production. ' +
        'Generate one with `stellar keys generate` and set it in the deployment environment, never in the repository.',
    );
  }

  return env;
}

/**
 * A description of the configuration that is safe to log or serve.
 *
 * Reports whether the attestor secret is set, never what it is. Nothing else in
 * the codebase should ever render `SLIPWAY_ATTESTOR_SECRET`.
 *
 * @param env - Validated configuration.
 * @returns A redacted summary.
 *
 * @example
 * ```ts
 * console.log(describeEnv(env));
 * // { nodeEnv: 'production', attestorConfigured: true, ... }
 * ```
 */
export function describeEnv(env: Env): Record<string, unknown> {
  return {
    nodeEnv: env.NODE_ENV,
    port: env.PORT,
    database: env.SLIPWAY_DB_PATH,
    attestorConfigured: env.SLIPWAY_ATTESTOR_SECRET !== undefined,
    attestationsContract: env.SLIPWAY_ATTESTATIONS_CONTRACT ?? null,
    sorobanRpc: env.SLIPWAY_SOROBAN_RPC,
    pollEnabled: env.SLIPWAY_POLL_ENABLED,
    pollCron: env.SLIPWAY_POLL_CRON,
    pollNotional: env.SLIPWAY_POLL_NOTIONAL,
  };
}
