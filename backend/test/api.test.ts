import { afterEach, describe, expect, it } from 'vitest';
import { MockAdapter } from '@slipwaykit/adapter-mock';
import { loadEnv } from '../src/env.js';
import { createTestApp, type TestApp } from './harness.js';

let harness: TestApp | undefined;

afterEach(() => {
  harness?.close();
  harness = undefined;
});

const SUMMARY = { corridors: 1, snapshots: 3, successes: 2, attested: 0, failed: [] as string[] };

const QUOTES = '/api/quotes?country=NG&fiat=NGN&direction=withdraw&amount=100&method=bank_transfer';

describe('GET /api/quotes', () => {
  it('answers the request from the build specification', async () => {
    harness = await createTestApp();

    const response = await harness.app.request(QUOTES);
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.request).toEqual({
      country: 'NG',
      fiat: 'NGN',
      asset: { code: 'USDC' },
      direction: 'withdraw',
      amount: '100',
      method: 'bank_transfer',
    });
  });

  it('sorts by landed amount, not by rate', async () => {
    harness = await createTestApp();

    const body = await (await harness.app.request(QUOTES)).json();

    // mock:ng-1 quotes 1650 against mock:ng-0's 1580, and still loses.
    expect(body.quotes.map((q: { adapterId: string }) => q.adapterId)).toEqual([
      'mock:ng-0',
      'mock:ng-1',
    ]);
    expect(body.quotes[0].landedAmount).toBe('157500');
    expect(body.quotes[1].landedAmount).toBe('155000');
    expect(body.quotes[1].rate).toBe('1650');
  });

  it('returns every amount as a string', async () => {
    harness = await createTestApp();

    const body = await (await harness.app.request(QUOTES)).json();
    const quote = body.quotes[0];

    for (const key of ['sellAmount', 'buyAmount', 'landedAmount', 'rate']) {
      expect(typeof quote[key], key).toBe('string');
    }
    for (const fee of quote.fees) expect(typeof fee.amount).toBe('string');
  });

  it('puts adapter failures in the 200 body rather than failing the request', async () => {
    harness = await createTestApp();

    const response = await harness.app.request(QUOTES);
    const body = await response.json();

    expect(response.status).toBe(200);
    // The Kenyan adapter cannot serve this route and says so, in `errors`.
    expect(body.errors).toHaveLength(1);
    expect(body.errors[0]).toMatchObject({
      adapterId: 'mock:ke-0',
      code: 'UNSUPPORTED_ROUTE',
      retryable: false,
    });
  });

  it('still returns 200 when every adapter fails', async () => {
    harness = await createTestApp({
      adapters: [
        new MockAdapter({ id: 'mock:a', country: 'NG', fiat: 'NGN', rate: '1', failWith: 'PROVIDER_UNAVAILABLE' }),
        new MockAdapter({ id: 'mock:b', country: 'NG', fiat: 'NGN', rate: '1', failWith: 'RATE_LIMITED' }),
      ],
    });

    const response = await harness.app.request(QUOTES);
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.quotes).toEqual([]);
    expect(body.errors.map((e: { code: string }) => e.code).sort()).toEqual([
      'PROVIDER_UNAVAILABLE',
      'RATE_LIMITED',
    ]);
  });

  it('marks demo adapters so a mock rate cannot be mistaken for a live one', async () => {
    harness = await createTestApp();

    const body = await (await harness.app.request(QUOTES)).json();

    expect(body.quotes.every((q: { isMock: boolean }) => q.isMock)).toBe(true);
  });

  it('reports latency for successes and failures alike', async () => {
    harness = await createTestApp();

    const body = await (await harness.app.request(QUOTES)).json();

    expect(typeof body.quotes[0].latencyMs).toBe('number');
    expect(typeof body.errors[0].latencyMs).toBe('number');
  });

  it.each([
    ['country=XYZ&fiat=NGN&direction=withdraw&amount=100&method=bank_transfer', 'country'],
    ['country=NG&fiat=N&direction=withdraw&amount=100&method=bank_transfer', 'fiat'],
    ['country=NG&fiat=NGN&direction=sideways&amount=100&method=bank_transfer', 'direction'],
    ['country=NG&fiat=NGN&direction=withdraw&amount=100&method=telepathy', 'method'],
  ])('rejects invalid query %# with a machine-readable 400', async (query, field) => {
    harness = await createTestApp();

    const response = await harness.app.request(`/api/quotes?${query}`);
    const body = await response.json();

    expect(response.status).toBe(400);
    expect(body.error.code).toBe('INVALID_REQUEST');
    expect(body.error.issues.map((i: { path: string }) => i.path)).toContain(field);
  });

  it('rejects an amount that is not a decimal string', async () => {
    harness = await createTestApp();

    for (const amount of ['1,000', '1e3', 'abc', '']) {
      const response = await harness.app.request(
        `/api/quotes?country=NG&fiat=NGN&direction=withdraw&amount=${encodeURIComponent(amount)}&method=bank_transfer`,
      );
      expect(response.status, amount).toBe(400);
    }
  });

  it('never coerces the amount to a number on the way through', async () => {
    harness = await createTestApp();

    const body = await (
      await harness.app.request(
        '/api/quotes?country=NG&fiat=NGN&direction=withdraw&amount=100.10&method=bank_transfer',
      )
    ).json();

    // 100.10 must survive as typed, not come back as 100.1.
    expect(body.request.amount).toBe('100.10');
  });

  it('uppercases country and fiat so a lowercase query still works', async () => {
    harness = await createTestApp();

    const body = await (
      await harness.app.request(
        '/api/quotes?country=ng&fiat=ngn&direction=withdraw&amount=100&method=bank_transfer',
      )
    ).json();

    expect(body.request.country).toBe('NG');
    expect(body.quotes).toHaveLength(2);
  });
});

describe('GET /api/corridors', () => {
  it('lists the seeded corridors', async () => {
    harness = await createTestApp();

    const body = await (await harness.app.request('/api/corridors')).json();
    const ids = body.corridors.map((c: { id: string }) => c.id);

    expect(ids).toContain('NG-NGN-USDC-withdraw');
    expect(ids).toContain('KE-KES-USDC-withdraw');
    expect(ids).toContain('GH-GHS-USDC-withdraw');
    expect(ids).toContain('ZA-ZAR-USDC-withdraw');
  });

  it('reports the method each corridor is polled with', async () => {
    harness = await createTestApp();

    const body = await (await harness.app.request('/api/corridors')).json();
    const kenya = body.corridors.find((c: { id: string }) => c.id === 'KE-KES-USDC-withdraw');

    // Mobile money dominates in Kenya; bank transfer in Nigeria.
    expect(kenya.pollMethod).toBe('mobile_money');
  });
});

describe('GET /api/corridors/:id/history', () => {
  it('returns an empty history before the poller has run', async () => {
    harness = await createTestApp();

    const response = await harness.app.request('/api/corridors/NG-NGN-USDC-withdraw/history');
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.days).toBe(7);
    expect(body.history).toEqual([]);
  });

  it('404s for a corridor that does not exist', async () => {
    harness = await createTestApp();

    const response = await harness.app.request('/api/corridors/NOPE/history');
    const body = await response.json();

    expect(response.status).toBe(404);
    expect(body.error.code).toBe('NOT_FOUND');
  });

  it('rejects an out-of-range days parameter', async () => {
    harness = await createTestApp();

    for (const days of ['0', '366', 'many']) {
      const response = await harness.app.request(
        `/api/corridors/NG-NGN-USDC-withdraw/history?days=${days}`,
      );
      expect(response.status, days).toBe(400);
      expect((await response.json()).error.code).toBe('INVALID_REQUEST');
    }
  });
});

describe('GET /api/anchors', () => {
  it('lists the seeded anchors with their provenance', async () => {
    harness = await createTestApp();

    const body = await (await harness.app.request('/api/anchors')).json();
    const test = body.anchors.find((a: { homeDomain: string }) => a.homeDomain === 'testanchor.stellar.org');

    expect(test.usable).toBe(true);
    expect(test.protocol).toBe('sep24');
    expect(test.checkedAt).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(test.source).toContain('stellar.toml');
  });

  it('always includes the SDF test anchor, so the demo survives every other anchor', async () => {
    harness = await createTestApp();

    const body = await (await harness.app.request('/api/anchors')).json();

    expect(body.anchors.map((a: { homeDomain: string }) => a.homeDomain)).toContain(
      'testanchor.stellar.org',
    );
  });

  it('shows an anchor Slipway cannot serve rather than hiding it', async () => {
    harness = await createTestApp();

    const body = await (await harness.app.request('/api/anchors')).json();
    const cowrie = body.anchors.find((a: { homeDomain: string }) => a.homeDomain === 'cowrie.exchange');

    // Nigeria's main Stellar anchor is real and speaks SEP-6, not SEP-24.
    expect(cowrie).toBeDefined();
    expect(cowrie.protocol).toBe('sep6');
    expect(cowrie.usable).toBe(false);
    expect(cowrie.note).toContain('TRANSFER_SERVER_SEP0024');
  });

  it('reports health as null before anything has been polled', async () => {
    harness = await createTestApp();

    const body = await (await harness.app.request('/api/anchors')).json();

    expect(body.anchors.every((a: { lastSeenAt: null }) => a.lastSeenAt === null)).toBe(true);
  });
});

describe('the app itself', () => {
  it('serves health with a redacted configuration', async () => {
    harness = await createTestApp({ env: { SLIPWAY_ATTESTOR_SECRET: 'S'.padEnd(56, 'A') } });

    const response = await harness.app.request('/api/health');
    const text = await response.text();

    expect(response.status).toBe(200);
    expect(JSON.parse(text).config.attestorConfigured).toBe(true);
    // The secret itself must never appear in a response body.
    expect(text).not.toContain('SAAAAA');
  });

  it('404s an unknown route with a machine-readable body', async () => {
    harness = await createTestApp();

    const response = await harness.app.request('/api/nope');

    expect(response.status).toBe(404);
    expect((await response.json()).error.code).toBe('NOT_FOUND');
  });

  it('sends CORS headers, since the frontend is a different origin', async () => {
    harness = await createTestApp();

    const response = await harness.app.request('/api/corridors', {
      headers: { Origin: 'http://localhost:3000' },
    });

    expect(response.headers.get('access-control-allow-origin')).toBe('*');
  });

  it('honours an explicit CORS allowlist', async () => {
    harness = await createTestApp({ env: { SLIPWAY_CORS_ORIGINS: 'https://slipway.example' } });

    const allowed = await harness.app.request('/api/corridors', {
      headers: { Origin: 'https://slipway.example' },
    });
    const denied = await harness.app.request('/api/corridors', {
      headers: { Origin: 'https://evil.example' },
    });

    expect(allowed.headers.get('access-control-allow-origin')).toBe('https://slipway.example');
    expect(denied.headers.get('access-control-allow-origin')).toBeNull();
  });
});

describe('the registry the API is built on', () => {
  it('keeps one adapter per corridor when an anchor serves several', async () => {
    // Regression: every Sep24Adapter defaulted to `sep24:{domain}` as its id,
    // so a registry keyed by id silently kept only the last corridor built.
    const { buildRegistry } = await import('../src/services/registry.js');
    const registry = buildRegistry({ includeMocks: false });
    const ids = registry.list().map((adapter) => adapter.id);

    expect(new Set(ids).size).toBe(ids.length);
    expect(ids).toContain('sep24:testanchor.stellar.org:US-USD');
    expect(ids).toContain('sep24:testanchor.stellar.org:CA-CAD');
  });

  it('builds no adapter for a seeded anchor that does not speak SEP-24', async () => {
    const { buildRegistry } = await import('../src/services/registry.js');
    const ids = buildRegistry({ includeMocks: false })
      .list()
      .map((adapter) => adapter.id);

    expect(ids.some((id) => id.includes('cowrie'))).toBe(false);
  });
});

describe('POST /api/poll', () => {
  const TOKEN = 'a-long-enough-poll-token';

  it('does not exist unless a token is configured', async () => {
    harness = await createTestApp();

    const response = await harness.app.request('/api/poll', { method: 'POST' });

    expect(response.status).toBe(404);
    expect((await response.json()).error.code).toBe('NOT_FOUND');
  });

  it('refuses a missing or wrong token', async () => {
    harness = await createTestApp({ env: { SLIPWAY_POLL_TOKEN: TOKEN }, poll: async () => SUMMARY });

    const noToken = await harness.app.request('/api/poll', { method: 'POST' });
    const wrong = await harness.app.request('/api/poll', {
      method: 'POST',
      headers: { Authorization: 'Bearer not-the-token-at-all' },
    });

    expect(noToken.status).toBe(401);
    expect(wrong.status).toBe(401);
    expect((await wrong.json()).error.code).toBe('AUTH_INVALID');
  });

  it('runs one pass and reports what it did', async () => {
    let runs = 0;
    harness = await createTestApp({
      env: { SLIPWAY_POLL_TOKEN: TOKEN },
      poll: async () => {
        runs += 1;
        return SUMMARY;
      },
    });

    const response = await harness.app.request('/api/poll', {
      method: 'POST',
      headers: { Authorization: `Bearer ${TOKEN}` },
    });
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(runs).toBe(1);
    expect(body.summary).toEqual(SUMMARY);
    expect(typeof body.durationMs).toBe('number');
  });

  it('refuses a second run while one is in progress', async () => {
    let release: () => void = () => {};
    const started = new Promise<void>((resolve) => {
      release = resolve;
    });
    harness = await createTestApp({
      env: { SLIPWAY_POLL_TOKEN: TOKEN },
      poll: async () => {
        await started;
        return SUMMARY;
      },
    });
    const headers = { Authorization: `Bearer ${TOKEN}` };

    const first = harness.app.request('/api/poll', { method: 'POST', headers });
    const second = await harness.app.request('/api/poll', { method: 'POST', headers });
    release();

    // Overlapping runs would double the load on every anchor and race the
    // attestor's account sequence numbers.
    expect(second.status).toBe(429);
    expect((await second.json()).error.code).toBe('RATE_LIMITED');
    expect((await first).status).toBe(200);
  });

  it('is not reachable with GET', async () => {
    harness = await createTestApp({ env: { SLIPWAY_POLL_TOKEN: TOKEN }, poll: async () => SUMMARY });

    expect((await harness.app.request('/api/poll')).status).toBe(404);
  });

  it('rejects a token too short to be worth having', () => {
    expect(() =>
      loadEnv({ NODE_ENV: 'test', SLIPWAY_POLL_TOKEN: 'short' } as NodeJS.ProcessEnv),
    ).toThrow(/at least 16 characters/);
  });
});
