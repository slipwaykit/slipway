import { afterEach, describe, expect, it } from 'vitest';
import { MockAdapter } from '@slipwaykit/adapter-mock';
import { AdapterRegistry } from '@slipwaykit/core';
import { attestations, snapshots } from '../src/db/schema.js';
import { describeEnv, loadEnv } from '../src/env.js';
import { Attestor, toFixedPoint, toSymbolText } from '../src/services/attestor.js';
import { runPoll } from '../src/services/poller.js';
import type { SeedCorridor } from '../src/services/anchors.seed.js';
import { createTestApp, testAdapters, type TestApp } from './harness.js';

let harness: TestApp | undefined;

afterEach(() => {
  harness?.close();
  harness = undefined;
});

const NOW = 1_757_942_400_000;

const NG_CORRIDOR: SeedCorridor = {
  id: 'NG-NGN-USDC-withdraw',
  country: 'NG',
  fiat: 'NGN',
  assetCode: 'USDC',
  direction: 'withdraw',
  pollMethod: 'bank_transfer',
};

/** An attestor that records what it was asked to write, and never touches a network. */
function stubAttestor(behaviour: 'ok' | 'fail' | 'off'): Attestor & { calls: unknown[] } {
  const calls: unknown[] = [];
  return {
    enabled: behaviour !== 'off',
    calls,
    publicKey: () => 'GTEST',
    attest: async (input: unknown) => {
      calls.push(input);
      if (behaviour === 'fail') return undefined;
      return { txHash: 'abc123', ledger: 42 };
    },
  } as unknown as Attestor & { calls: unknown[] };
}

describe('loadEnv', () => {
  it('refuses to start in production without an attestor secret', () => {
    expect(() => loadEnv({ NODE_ENV: 'production' } as NodeJS.ProcessEnv)).toThrow(
      /SLIPWAY_ATTESTOR_SECRET is required/,
    );
  });

  it('starts in development without one', () => {
    expect(() => loadEnv({ NODE_ENV: 'development' } as NodeJS.ProcessEnv)).not.toThrow();
  });

  it('rejects a secret that is not a Stellar seed', () => {
    expect(() =>
      loadEnv({ NODE_ENV: 'test', SLIPWAY_ATTESTOR_SECRET: 'hunter2' } as NodeJS.ProcessEnv),
    ).toThrow(/not a Stellar secret seed/);
  });

  it('never puts the secret in the description used for logs and /api/health', () => {
    const secret = `S${'A'.repeat(55)}`;
    const env = loadEnv({ NODE_ENV: 'test', SLIPWAY_ATTESTOR_SECRET: secret } as NodeJS.ProcessEnv);

    const described = JSON.stringify(describeEnv(env));

    expect(described).not.toContain(secret);
    expect(described).not.toContain('AAAA');
    expect(describeEnv(env).attestorConfigured).toBe(true);
  });

  it('keeps the poll notional as a string', () => {
    const env = loadEnv({ NODE_ENV: 'test', SLIPWAY_POLL_NOTIONAL: '250.50' } as NodeJS.ProcessEnv);

    expect(env.SLIPWAY_POLL_NOTIONAL).toBe('250.50');
  });

  it('rejects a malformed cron-adjacent value rather than defaulting silently', () => {
    expect(() =>
      loadEnv({ NODE_ENV: 'test', SLIPWAY_POLL_NOTIONAL: 'lots' } as NodeJS.ProcessEnv),
    ).toThrow(/Invalid environment/);
  });
});

describe('attestor encoding', () => {
  it('scales a decimal string to 7dp fixed point without going through a float', () => {
    expect(toFixedPoint('100')).toBe(1_000_000_000n);
    expect(toFixedPoint('156000.25')).toBe(1_560_002_500_000n);
    expect(toFixedPoint('0.0000001')).toBe(1n);
    expect(toFixedPoint('-1.5')).toBe(-15_000_000n);
  });

  it('keeps precision a double would lose', () => {
    // 0.1 + 0.2 as doubles is 0.30000000000000004; this must be exactly 3000000.
    expect(toFixedPoint('0.3')).toBe(3_000_000n);
    expect(toFixedPoint('9007199254740993.0000001')).toBe(90_071_992_547_409_930_000_001n);
  });

  it('rewrites an adapter id into a valid Soroban symbol', () => {
    expect(toSymbolText('sep24:testanchor.stellar.org')).toBe('sep24_testanchor_stellar_org');
    expect(toSymbolText('NG-NGN-USDC-withdraw')).toBe('NG_NGN_USDC_withdraw');
  });

  it('truncates to the 32 character symbol limit', () => {
    const symbol = toSymbolText('sep24:a-very-long-anchor-domain-name.example.com');

    expect(symbol.length).toBe(32);
    expect(symbol).toMatch(/^[A-Za-z0-9_]+$/);
  });
});

describe('Attestor', () => {
  it('is disabled, and silent, without a secret and a contract', () => {
    harness = undefined;
    const env = loadEnv({ NODE_ENV: 'test' } as NodeJS.ProcessEnv);
    const lines: string[] = [];
    const attestor = new Attestor(env, {
      info: (m) => lines.push(m),
      warn: (m) => lines.push(m),
    });

    expect(attestor.enabled).toBe(false);
    expect(attestor.publicKey()).toBeUndefined();
    expect(lines.join(' ')).toContain('disabled');
  });

  it('resolves to undefined rather than throwing when disabled', async () => {
    const env = loadEnv({ NODE_ENV: 'test' } as NodeJS.ProcessEnv);
    const attestor = new Attestor(env, { info: () => {}, warn: () => {} });

    await expect(
      attestor.attest({
        adapterId: 'x',
        corridorId: 'y',
        sellAmount: '100',
        landedAmount: '99',
        latencyMs: 1,
        success: true,
      }),
    ).resolves.toBeUndefined();
  });

  it('swallows a submission failure instead of throwing into the poller', async () => {
    // A contract id that cannot be parsed makes #submit throw immediately, with
    // no network involved. The caller must still see `undefined`.
    const env = loadEnv({
      NODE_ENV: 'test',
      SLIPWAY_ATTESTOR_SECRET: `S${'A'.repeat(55)}`,
      SLIPWAY_ATTESTATIONS_CONTRACT: 'not-a-contract-id',
    } as NodeJS.ProcessEnv);
    const warnings: unknown[] = [];
    const attestor = new Attestor(env, { info: () => {}, warn: (_m, d) => warnings.push(d) });

    const result = await attestor.attest({
      adapterId: 'x',
      corridorId: 'y',
      sellAmount: '100',
      landedAmount: '99',
      latencyMs: 1,
      success: true,
    });

    expect(attestor.enabled).toBe(true);
    expect(result).toBeUndefined();
    expect(warnings).toHaveLength(1);
  });
});

describe('runPoll', () => {
  it('records a snapshot per adapter, successes and failures alike', async () => {
    harness = await createTestApp();
    const attestor = stubAttestor('off');

    const summary = await runPoll({
      db: harness.db,
      registry: harness.registry,
      attestor,
      env: harness.env,
      logger: harness.logger,
      now: () => NOW,
      corridors: [NG_CORRIDOR],
    });

    const rows = await harness.db.select().from(snapshots);

    expect(summary).toMatchObject({ corridors: 1, snapshots: 3, successes: 2, failed: [] });
    expect(rows).toHaveLength(3);
    expect(rows.filter((r) => r.errorCode === null)).toHaveLength(2);
  });

  it('keeps the failure rows, so a chart cannot flatter an unreliable anchor', async () => {
    harness = await createTestApp();

    await runPoll({
      db: harness.db,
      registry: harness.registry,
      attestor: stubAttestor('off'),
      env: harness.env,
      logger: harness.logger,
      now: () => NOW,
      corridors: [NG_CORRIDOR],
    });

    const [failure] = (await harness.db.select().from(snapshots)).filter(
      (row) => row.errorCode !== null,
    );

    expect(failure).toMatchObject({
      adapterId: 'mock:ke-0',
      errorCode: 'UNSUPPORTED_ROUTE',
      landedAmount: null,
      buyAmount: null,
    });
    expect(failure?.latencyMs).toBeTypeOf('number');
  });

  it('stores money as strings, exactly as quoted', async () => {
    harness = await createTestApp();

    await runPoll({
      db: harness.db,
      registry: harness.registry,
      attestor: stubAttestor('off'),
      env: harness.env,
      logger: harness.logger,
      now: () => NOW,
      corridors: [NG_CORRIDOR],
    });

    const [best] = (await harness.db.select().from(snapshots)).filter(
      (row) => row.adapterId === 'mock:ng-0',
    );

    expect(best?.landedAmount).toBe('157500');
    expect(best?.sellAmount).toBe('100');
    expect(typeof best?.rate).toBe('string');
    expect(JSON.parse(best?.feesJson ?? '[]')).toHaveLength(1);
  });

  it('writes an attestation row for each successful snapshot', async () => {
    harness = await createTestApp();
    const attestor = stubAttestor('ok');

    const summary = await runPoll({
      db: harness.db,
      registry: harness.registry,
      attestor,
      env: harness.env,
      logger: harness.logger,
      now: () => NOW,
      corridors: [NG_CORRIDOR],
    });

    const rows = await harness.db.select().from(attestations);

    expect(summary.attested).toBe(2);
    expect(rows).toHaveLength(2);
    expect(rows[0]).toMatchObject({ txHash: 'abc123', ledger: 42 });
    // Only successes are attested; the failed adapter is not.
    expect(attestor.calls).toHaveLength(2);
  });

  it('carries on when the attestor cannot write', async () => {
    harness = await createTestApp();

    const summary = await runPoll({
      db: harness.db,
      registry: harness.registry,
      attestor: stubAttestor('fail'),
      env: harness.env,
      logger: harness.logger,
      now: () => NOW,
      corridors: [NG_CORRIDOR],
    });

    expect(summary.successes).toBe(2);
    expect(summary.attested).toBe(0);
    expect(await harness.db.select().from(snapshots)).toHaveLength(3);
  });

  it('lets one broken corridor fail without stopping the rest', async () => {
    harness = await createTestApp();
    const exploding = {
      quoteAll: async (request: { country: string }) => {
        if (request.country === 'KE') throw new Error('something entirely unexpected');
        return harness!.registry.quoteAll(request as never);
      },
      list: () => harness!.registry.list(),
    } as unknown as AdapterRegistry;

    const summary = await runPoll({
      db: harness.db,
      registry: exploding,
      attestor: stubAttestor('off'),
      env: harness.env,
      logger: harness.logger,
      now: () => NOW,
      corridors: [
        { ...NG_CORRIDOR, id: 'KE-KES-USDC-withdraw', country: 'KE', fiat: 'KES' },
        NG_CORRIDOR,
      ],
    });

    expect(summary.failed).toEqual(['KE-KES-USDC-withdraw']);
    // The Nigerian corridor after it still ran.
    expect(summary.successes).toBe(2);
  });

  it('records anchor health only for real anchors, not for mocks', async () => {
    harness = await createTestApp();

    await runPoll({
      db: harness.db,
      registry: harness.registry,
      attestor: stubAttestor('off'),
      env: harness.env,
      logger: harness.logger,
      now: () => NOW,
      corridors: [NG_CORRIDOR],
    });

    const body = await (await harness.app.request('/api/anchors')).json();

    // Every adapter in this harness is a mock, so no anchor row was touched.
    expect(body.anchors.every((a: { lastSeenAt: null }) => a.lastSeenAt === null)).toBe(true);
  });

  it('feeds the history endpoint it writes for', async () => {
    harness = await createTestApp();

    await runPoll({
      db: harness.db,
      registry: harness.registry,
      attestor: stubAttestor('ok'),
      env: harness.env,
      logger: harness.logger,
      now: () => Date.now(),
      corridors: [NG_CORRIDOR],
    });

    const body = await (
      await harness.app.request('/api/corridors/NG-NGN-USDC-withdraw/history?days=1')
    ).json();

    expect(body.history).toHaveLength(3);
    expect(body.history.some((row: { errorCode: string | null }) => row.errorCode !== null)).toBe(true);
    expect(body.history[0].attestations[0]).toMatchObject({ txHash: 'abc123' });
  });

  it('quotes the configured notional', async () => {
    harness = await createTestApp({ env: { SLIPWAY_POLL_NOTIONAL: '250' } });

    await runPoll({
      db: harness.db,
      registry: new AdapterRegistry(testAdapters(() => NOW)),
      attestor: stubAttestor('off'),
      env: harness.env,
      logger: harness.logger,
      now: () => NOW,
      corridors: [NG_CORRIDOR],
    });

    const rows = await harness.db.select().from(snapshots);

    expect(rows.every((row) => row.sellAmount === '250')).toBe(true);
  });

  it('is idempotent about seeding, so restarts do not duplicate rows', async () => {
    harness = await createTestApp();
    const { seedDatabase } = await import('../src/services/poller.js');

    await seedDatabase(harness.db);
    await seedDatabase(harness.db);

    const body = await (await harness.app.request('/api/corridors')).json();
    const ids = body.corridors.map((c: { id: string }) => c.id);

    expect(new Set(ids).size).toBe(ids.length);
  });
});

describe('MockAdapter in the poller', () => {
  it('produces a deterministic landed amount the snapshot can be trusted to hold', async () => {
    const adapter = new MockAdapter({
      id: 'mock:ng-0',
      country: 'NG',
      fiat: 'NGN',
      rate: '1580',
      feeFixed: '500',
      now: () => NOW,
    });

    const quote = await adapter.quote({
      country: 'NG',
      fiat: 'NGN',
      asset: { code: 'USDC' },
      direction: 'withdraw',
      amount: '100',
      method: 'bank_transfer',
    });

    expect(quote.landedAmount).toBe('157500');
  });
});

describe('anchor health semantics', () => {
  it('treats UNSUPPORTED_ROUTE as the anchor answering, not as a health failure', async () => {
    // An anchor asked about a corridor it never served has not gone down. If
    // that painted it red, every anchor would look broken on every corridor
    // but its own.
    const { anchors } = await import('../src/db/schema.js');
    const { eq } = await import('drizzle-orm');
    const { Sep24Adapter } = await import('@slipwaykit/adapter-sep24');

    harness = await createTestApp();
    const unreachable = new Sep24Adapter({
      homeDomain: 'mykobo.co',
      country: 'DE',
      fiat: 'EUR',
      id: 'sep24:mykobo.co:DE-EUR',
      fetchImpl: (async () => {
        throw new TypeError('fetch failed');
      }) as typeof fetch,
    });
    const wrongRoute = new MockAdapter({ id: 'mock:ke-0', country: 'KE', fiat: 'KES', rate: '1' });

    await runPoll({
      db: harness.db,
      registry: new AdapterRegistry([unreachable, wrongRoute]),
      attestor: stubAttestor('off'),
      env: harness.env,
      logger: harness.logger,
      now: () => NOW,
      corridors: [NG_CORRIDOR],
    });

    const [mykobo] = await harness.db
      .select()
      .from(anchors)
      .where(eq(anchors.homeDomain, 'mykobo.co'));

    // This one genuinely could not be reached.
    expect(mykobo?.lastError).toBe('PROVIDER_UNAVAILABLE');
  });

  it('clears a previous error once the anchor answers again', async () => {
    const { anchors } = await import('../src/db/schema.js');
    const { eq } = await import('drizzle-orm');
    const { Sep24Adapter } = await import('@slipwaykit/adapter-sep24');

    harness = await createTestApp();
    await harness.db
      .update(anchors)
      .set({ lastError: 'PROVIDER_UNAVAILABLE' })
      .where(eq(anchors.homeDomain, 'anclap.com'));

    // An adapter that answers, but cannot serve this route.
    const recovered = new Sep24Adapter({
      homeDomain: 'anclap.com',
      country: 'AR',
      fiat: 'ARS',
      id: 'sep24:anclap.com:AR-ARS',
      fetchImpl: (async (input: string | URL | Request) => {
        const url = typeof input === 'string' ? input : String(input);
        if (url.endsWith('stellar.toml')) {
          return new Response('TRANSFER_SERVER_SEP0024 = "https://api.anclap.com/transfer24"\n');
        }
        return new Response(JSON.stringify({ withdraw: {}, deposit: {} }));
      }) as typeof fetch,
    });

    await runPoll({
      db: harness.db,
      registry: new AdapterRegistry([recovered]),
      attestor: stubAttestor('off'),
      env: harness.env,
      logger: harness.logger,
      now: () => NOW,
      corridors: [NG_CORRIDOR],
    });

    const [anclap] = await harness.db
      .select()
      .from(anchors)
      .where(eq(anchors.homeDomain, 'anclap.com'));

    expect(anclap?.lastError).toBeNull();
    expect(anclap?.lastSeenAt).toBe(NOW);
  });
});
