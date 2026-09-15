import { describe, expect, it } from 'vitest';
import { AdapterRegistry, RampError, type QuoteRequest } from '@slipwaykit/core';
import { Sep24Adapter } from '@slipwaykit/adapter-sep24';
import { MockAdapter } from '@slipwaykit/adapter-mock';
import type { Route } from './harness.js';
import { fixture, harnessFor, json, ngnAnchorRoutes, testAnchorRoutes } from './harness.js';

const NOW = 1_757_942_400_000;
const auth = { token: 'a-sep10-jwt', account: 'GDUY7J7A33TQWOSOQGDO776GGLM3UQERL4J3SPT56F6YS4ID7MLDERI4' };

const withdrawRequest: QuoteRequest = {
  country: 'NG',
  fiat: 'NGN',
  asset: { code: 'USDC' },
  direction: 'withdraw',
  amount: '100',
  method: 'bank_transfer',
};

function ngnAdapter(overrides: Record<string, Route> = {}): {
  adapter: Sep24Adapter;
  calls: string[];
} {
  const harness = harnessFor({ ...ngnAnchorRoutes(), ...overrides });
  const adapter = new Sep24Adapter({
    homeDomain: 'ngn.example.com',
    country: 'NG',
    fiat: 'NGN',
    fetchImpl: harness.fetch,
    now: () => NOW,
  });
  return { adapter, calls: harness.calls };
}

describe('Sep24Adapter construction', () => {
  it('performs no I/O in the constructor', () => {
    const harness = harnessFor({});

    const adapter = new Sep24Adapter({
      homeDomain: 'ngn.example.com',
      country: 'NG',
      fiat: 'NGN',
      fetchImpl: harness.fetch,
    });

    expect(harness.calls).toEqual([]);
    expect(adapter.id).toBe('sep24:ngn.example.com');
  });

  it('uses the home domain as its name until the TOML supplies ORG_NAME', async () => {
    const { adapter } = ngnAdapter();

    expect(adapter.name).toBe('ngn.example.com');
    await adapter.capabilities();
    expect(adapter.name).toBe('Example Naira Anchor');
  });
});

describe('Sep24Adapter.capabilities', () => {
  it('maps the anchor to capabilities for the configured corridor', async () => {
    const { adapter } = ngnAdapter();

    const capabilities = await adapter.capabilities();
    const withdraw = capabilities.find((c) => c.direction === 'withdraw');

    expect(withdraw).toMatchObject({
      country: 'NG',
      fiat: 'NGN',
      direction: 'withdraw',
      methods: ['bank_transfer', 'cash_pickup', 'ussd'],
      minAmount: '5',
      maxAmount: '50000',
      kycRequired: true,
    });
    expect(withdraw?.asset.issuer).toBe('GA5ZSEJYB37JRC5AVCIA5MOP4RHTM335X2KGX3IHOJAPP5RE34K4KZVN');
  });

  it('fetches the TOML and /info once, however many times it is asked', async () => {
    const { adapter, calls } = ngnAdapter();

    await adapter.capabilities();
    await adapter.capabilities();
    await adapter.capabilities();

    expect(calls.filter((url) => url.endsWith('stellar.toml'))).toHaveLength(1);
    expect(calls.filter((url) => url.endsWith('/sep24/info'))).toHaveLength(1);
  });

  it('does not cache a failure, so an anchor can come back up', async () => {
    let attempts = 0;
    const harness = harnessFor({
      'https://ngn.example.com/.well-known/stellar.toml': { text: fixture('ngn-anchor.toml') },
      'https://ngn.example.com/sep24/info': { body: json('ngn-sep24-info.json') },
    });
    const flaky = (async (input: string | URL | Request, init?: RequestInit) => {
      const url = typeof input === 'string' ? input : String(input);
      if (url.endsWith('stellar.toml') && (attempts += 1) === 1) throw new TypeError('fetch failed');
      return harness.fetch(url, init);
    }) as typeof fetch;

    const adapter = new Sep24Adapter({
      homeDomain: 'ngn.example.com',
      country: 'NG',
      fiat: 'NGN',
      fetchImpl: flaky,
    });

    await expect(adapter.capabilities()).rejects.toMatchObject({ code: 'PROVIDER_UNAVAILABLE' });
    await expect(adapter.capabilities()).resolves.toHaveLength(2);
  });

  it('reports an unreachable anchor as a retryable RampError', async () => {
    const { adapter } = ngnAdapter({
      'https://ngn.example.com/.well-known/stellar.toml': { throws: new TypeError('fetch failed') },
    });

    await expect(adapter.capabilities()).rejects.toMatchObject({
      code: 'PROVIDER_UNAVAILABLE',
      retryable: true,
    });
  });
});

describe('Sep24Adapter.quote', () => {
  it('prices a withdraw through SEP-38 with an honest landed amount', async () => {
    const { adapter } = ngnAdapter();

    const quote = await adapter.quote(withdrawRequest);

    expect(quote.adapterId).toBe('sep24:ngn.example.com');
    expect(quote.sellAmount).toBe('100');
    expect(quote.buyAmount).toBe('160000');
    expect(quote.landedAmount).toBe('156000');
    expect(quote.rate).toBe('1600');
    expect(quote.fees.map((f) => f.kind)).toEqual(['spread', 'provider']);
    expect(quote.expiresAt).toBe(NOW + 60_000);
    expect(quote.request).toEqual(withdrawRequest);
  });

  it('returns every amount as a string', async () => {
    const { adapter } = ngnAdapter();

    const quote = await adapter.quote(withdrawRequest);

    for (const value of [quote.sellAmount, quote.buyAmount, quote.landedAmount, quote.rate]) {
      expect(typeof value).toBe('string');
    }
    for (const fee of quote.fees) expect(typeof fee.amount).toBe('string');
  });

  it('inverts the assets for a deposit', async () => {
    const { adapter, calls } = ngnAdapter();

    await adapter.quote({ ...withdrawRequest, direction: 'deposit', method: 'mobile_money' });
    const priceCall = calls.find((url) => url.includes('/sep38/price')) ?? '';

    expect(priceCall).toContain('sell_asset=iso4217%3ANGN');
    expect(priceCall).toContain('buy_asset=stellar%3AUSDC%3AGA5ZSEJY');
  });

  it('rejects a route the anchor does not serve', async () => {
    const { adapter } = ngnAdapter();

    // The anchor's withdraw types are bank_account, cash_pickup and ussd.
    await expect(adapter.quote({ ...withdrawRequest, method: 'mobile_money' })).rejects.toMatchObject(
      { code: 'UNSUPPORTED_ROUTE' },
    );
    await expect(adapter.quote({ ...withdrawRequest, fiat: 'KES' })).rejects.toMatchObject({
      code: 'UNSUPPORTED_ROUTE',
    });
    await expect(adapter.quote({ ...withdrawRequest, asset: { code: 'XLM' } })).rejects.toMatchObject(
      { code: 'UNSUPPORTED_ROUTE' },
    );
  });

  it('rejects a route whose issuer does not match the anchor', async () => {
    const { adapter } = ngnAdapter();

    await expect(
      adapter.quote({ ...withdrawRequest, asset: { code: 'USDC', issuer: 'GSOMEONEELSE' } }),
    ).rejects.toMatchObject({ code: 'UNSUPPORTED_ROUTE' });
  });

  it('enforces both published bounds before calling the anchor', async () => {
    const { adapter, calls } = ngnAdapter();

    await expect(adapter.quote({ ...withdrawRequest, amount: '4.99' })).rejects.toMatchObject({
      code: 'AMOUNT_OUT_OF_BOUNDS',
    });
    await expect(adapter.quote({ ...withdrawRequest, amount: '50000.01' })).rejects.toMatchObject({
      code: 'AMOUNT_OUT_OF_BOUNDS',
    });
    expect(calls.some((url) => url.includes('/sep38/price'))).toBe(false);
  });

  it('falls back to /info fees when the anchor runs no quote server', async () => {
    const harness = harnessFor({
      'https://pegged.example.com/.well-known/stellar.toml': {
        text: fixture('pegged-anchor.toml'),
      },
      'https://pegged.example.com/sep24/info': { body: json('pegged-sep24-info.json') },
    });
    const adapter = new Sep24Adapter({
      homeDomain: 'pegged.example.com',
      country: 'NG',
      fiat: 'NGN',
      fetchImpl: harness.fetch,
      now: () => NOW,
    });

    const quote = await adapter.quote({
      ...withdrawRequest,
      asset: { code: 'NGNC' },
      amount: '100000',
    });

    expect(quote.landedAmount).toBe('99400');
    expect(quote.rate).toBe('1');
    expect(harness.calls.some((url) => url.includes('sep38'))).toBe(false);
  });

  it('throws QUOTE_INCOMPLETE rather than guessing, on the real SDF test anchor', async () => {
    // Recorded 2026-09-15: testanchor publishes no fee fields at all. With the
    // quote server stripped there is genuinely nothing to compute a landed
    // amount from, and the only honest answer is to refuse.
    const routes = testAnchorRoutes();
    const tomlWithoutQuoteServer = fixture('testanchor.stellar.org.toml')
      .split('\n')
      .filter((line) => !line.startsWith('ANCHOR_QUOTE_SERVER'))
      .join('\n');
    const harness = harnessFor({
      ...routes,
      'https://testanchor.stellar.org/.well-known/stellar.toml': { text: tomlWithoutQuoteServer },
    });
    const adapter = new Sep24Adapter({
      homeDomain: 'testanchor.stellar.org',
      country: 'US',
      fiat: 'USD',
      fetchImpl: harness.fetch,
      now: () => NOW,
    });

    await expect(
      adapter.quote({
        country: 'US',
        fiat: 'USD',
        asset: { code: 'USDC' },
        direction: 'withdraw',
        amount: '5',
        method: 'bank_transfer',
      }),
    ).rejects.toMatchObject({ code: 'QUOTE_INCOMPLETE' });
  });

  it('quotes the real SDF test anchor, whose /info constrains no payment method', async () => {
    const harness = harnessFor(testAnchorRoutes());
    const adapter = new Sep24Adapter({
      homeDomain: 'testanchor.stellar.org',
      country: 'US',
      fiat: 'USD',
      fetchImpl: harness.fetch,
      now: () => NOW,
    });

    const quote = await adapter.quote({
      country: 'US',
      fiat: 'USD',
      asset: { code: 'USDC' },
      direction: 'withdraw',
      amount: '5',
      method: 'bank_transfer',
    });

    expect(quote.landedAmount).toBe('94.2857');
    expect(quote.fees[0]?.kind).toBe('spread');
  });
});

describe('Sep24Adapter.initiate', () => {
  it('requires a SEP-10 token and never tries to obtain one', async () => {
    const { adapter, calls } = ngnAdapter();
    const quote = await adapter.quote(withdrawRequest);
    const before = calls.length;

    await expect(adapter.initiate({ quote, auth: { token: '' } })).rejects.toMatchObject({
      code: 'AUTH_REQUIRED',
    });
    // Nothing was attempted, and in particular no SEP-10 challenge was fetched.
    expect(calls.slice(before)).toEqual([]);
  });

  it('posts to the interactive endpoint and returns the hosted URL', async () => {
    const sent: { url?: string; body?: unknown; authorization?: string | null } = {};
    const routes = ngnAnchorRoutes();
    const harness = harnessFor(routes);
    const recording = (async (input: string | URL | Request, init?: RequestInit) => {
      const url = typeof input === 'string' ? input : String(input);
      if (url.includes('/interactive')) {
        sent.url = url;
        sent.authorization = new Headers(init?.headers).get('authorization');
        sent.body = JSON.parse(String(init?.body));
      }
      return harness.fetch(url, init);
    }) as typeof fetch;

    const adapter = new Sep24Adapter({
      homeDomain: 'ngn.example.com',
      country: 'NG',
      fiat: 'NGN',
      fetchImpl: recording,
      now: () => NOW,
    });
    const quote = await adapter.quote(withdrawRequest);
    const started = await adapter.initiate({ quote, auth, returnUrl: 'https://app.example/done' });

    expect(started).toEqual({
      id: '82fhs729f63dh0v4',
      adapterId: 'sep24:ngn.example.com',
      status: 'pending_user',
      interactiveUrl:
        'https://ngn.example.com/sep24/interactive?transaction_id=82fhs729f63dh0v4&token=eyJhbGciOi',
    });
    expect(sent.url).toBe('https://ngn.example.com/sep24/transactions/withdraw/interactive');
    expect(sent.authorization).toBe('Bearer a-sep10-jwt');
    expect(sent.body).toMatchObject({
      asset_code: 'USDC',
      asset_issuer: 'GA5ZSEJYB37JRC5AVCIA5MOP4RHTM335X2KGX3IHOJAPP5RE34K4KZVN',
      account: auth.account,
      amount: '100',
      // The anchor's own vocabulary is sent back, not Slipway's name for it.
      type: 'bank_account',
      return_url: 'https://app.example/done',
    });
  });

  it('forwards a SEP-38 quote id when the anchor issued one', async () => {
    let body: Record<string, unknown> = {};
    const harness = harnessFor({
      ...ngnAnchorRoutes(),
      'https://ngn.example.com/sep38/price': {
        body: { price: '0.000625', sell_amount: '100', buy_amount: '160000', id: 'q-991' },
      },
    });
    const recording = (async (input: string | URL | Request, init?: RequestInit) => {
      const url = typeof input === 'string' ? input : String(input);
      if (url.includes('/interactive')) body = JSON.parse(String(init?.body));
      return harness.fetch(url, init);
    }) as typeof fetch;

    const adapter = new Sep24Adapter({
      homeDomain: 'ngn.example.com',
      country: 'NG',
      fiat: 'NGN',
      fetchImpl: recording,
      now: () => NOW,
    });
    const quote = await adapter.quote(withdrawRequest);
    await adapter.initiate({ quote, auth });

    expect(quote.providerQuoteId).toBe('q-991');
    expect(body['quote_id']).toBe('q-991');
  });

  it('maps a 403 from the interactive endpoint through the error table', async () => {
    const { adapter } = ngnAdapter({
      'https://ngn.example.com/sep24/transactions/withdraw/interactive': {
        status: 403,
        body: { type: 'customer_info_status', status: 'NEEDS_INFO' },
      },
    });
    const quote = await adapter.quote(withdrawRequest);

    await expect(adapter.initiate({ quote, auth })).rejects.toMatchObject({
      code: 'KYC_REQUIRED',
      httpStatus: 403,
    });
  });

  it('rejects a response with no transaction id', async () => {
    const { adapter } = ngnAdapter({
      'https://ngn.example.com/sep24/transactions/withdraw/interactive': {
        body: { url: 'https://ngn.example.com/interactive' },
      },
    });
    const quote = await adapter.quote(withdrawRequest);

    await expect(adapter.initiate({ quote, auth })).rejects.toMatchObject({
      code: 'PROVIDER_REJECTED',
    });
  });
});

describe('Sep24Adapter.getTransaction', () => {
  it('maps a transaction and its Stellar hash', async () => {
    const { adapter } = ngnAdapter();

    const tx = await adapter.getTransaction({ id: '82fhs729f63dh0v4', auth });

    expect(tx).toEqual({
      id: '82fhs729f63dh0v4',
      adapterId: 'sep24:ngn.example.com',
      status: 'pending_stellar',
      interactiveUrl: 'https://ngn.example.com/sep24/transaction/82fhs729f63dh0v4/more_info',
      stellarTxHash: '17a670bc424ff5ce3b386dbfaae9990b66a2a37b4fbe51547e8794962a3f9e6a',
      amountIn: '100',
      amountOut: '156000',
      providerStatus: 'pending_stellar',
      updatedAt: Date.parse('2026-09-15T12:04:30Z'),
    });
  });

  it('is a side-effect-free GET, safe to call on a five second timer', async () => {
    const methods: (string | undefined)[] = [];
    const harness = harnessFor(ngnAnchorRoutes());
    const recording = (async (input: string | URL | Request, init?: RequestInit) => {
      const url = typeof input === 'string' ? input : String(input);
      if (url.includes('/transaction?')) methods.push(init?.method);
      return harness.fetch(url, init);
    }) as typeof fetch;

    const adapter = new Sep24Adapter({
      homeDomain: 'ngn.example.com',
      country: 'NG',
      fiat: 'NGN',
      fetchImpl: recording,
    });

    const first = await adapter.getTransaction({ id: '82fhs729f63dh0v4', auth });
    const second = await adapter.getTransaction({ id: '82fhs729f63dh0v4', auth });

    expect(methods).toEqual(['GET', 'GET']);
    expect(first).toEqual(second);
  });

  it('requires a token', async () => {
    const { adapter } = ngnAdapter();

    await expect(
      adapter.getTransaction({ id: 'x', auth: { token: '' } }),
    ).rejects.toMatchObject({ code: 'AUTH_REQUIRED' });
  });

  it('url-encodes the transaction id', async () => {
    const { adapter, calls } = ngnAdapter();

    await adapter.getTransaction({ id: 'a b&c=d', auth });

    expect(calls.at(-1)).toBe('https://ngn.example.com/sep24/transaction?id=a%20b%26c%3Dd');
  });

  it('reports a missing transaction envelope as NOT_FOUND', async () => {
    const { adapter } = ngnAdapter({
      'https://ngn.example.com/sep24/transaction': { body: { nothing: true } },
    });

    await expect(adapter.getTransaction({ id: 'x', auth })).rejects.toMatchObject({
      code: 'NOT_FOUND',
    });
  });

  it('maps an unknown anchor status to pending_provider instead of failing', async () => {
    const { adapter } = ngnAdapter({
      'https://ngn.example.com/sep24/transaction': {
        body: { transaction: { id: 'x', status: 'doing_something_new' } },
      },
    });

    const tx = await adapter.getTransaction({ id: 'x', auth });

    expect(tx.status).toBe('pending_provider');
    expect(tx.providerStatus).toBe('doing_something_new');
  });

  it('falls back to the injected clock when the anchor sends no updated_at', async () => {
    const { adapter } = ngnAdapter({
      'https://ngn.example.com/sep24/transaction': {
        body: { transaction: { id: 'x', status: 'completed' } },
      },
    });

    const tx = await adapter.getTransaction({ id: 'x', auth });

    expect(tx.updatedAt).toBe(NOW);
  });
});

describe('Sep24Adapter.customerStatus', () => {
  it('maps SEP-12 fields into FieldSpec values', async () => {
    const { adapter } = ngnAdapter();

    const status = await adapter.customerStatus({ auth });

    expect(status.state).toBe('not_started');
    expect(status.fields).toContainEqual({
      name: 'bank_account_number',
      type: 'string',
      description: '10 digit NUBAN account number',
      optional: false,
    });
    expect(status.fields).toContainEqual({
      name: 'photo_id_front',
      type: 'binary',
      description: 'A photo of the front of your ID',
      optional: false,
    });
    expect(status.fields.find((f) => f.name === 'birth_date')).toMatchObject({
      type: 'date',
      optional: true,
    });
    expect(status.fields.find((f) => f.name === 'id_type')?.choices).toEqual([
      'NIN',
      'BVN',
      'passport',
    ]);
    // An unrecognised SEP-12 type falls back to string rather than being dropped.
    expect(status.fields.find((f) => f.name === 'occupation')?.type).toBe('string');
  });

  it.each([
    ['NEEDS_INFO', 'not_started'],
    ['PROCESSING', 'pending'],
    ['ACCEPTED', 'approved'],
    ['REJECTED', 'rejected'],
  ])('maps SEP-12 %s to %s', async (sep12, expected) => {
    const { adapter } = ngnAdapter({
      'https://ngn.example.com/sep12/customer': { body: { status: sep12, fields: {} } },
    });

    expect((await adapter.customerStatus({ auth })).state).toBe(expected);
  });

  it('carries a rejection reason', async () => {
    const { adapter } = ngnAdapter({
      'https://ngn.example.com/sep12/customer': { body: json('sep12-customer-rejected.json') },
    });

    const status = await adapter.customerStatus({ auth });

    expect(status.state).toBe('rejected');
    expect(status.reason).toBe('The document supplied could not be verified.');
  });

  it('refuses when the anchor advertises no KYC server', async () => {
    const harness = harnessFor({
      'https://pegged.example.com/.well-known/stellar.toml': {
        text: fixture('pegged-anchor.toml'),
      },
    });
    const adapter = new Sep24Adapter({
      homeDomain: 'pegged.example.com',
      country: 'NG',
      fiat: 'NGN',
      fetchImpl: harness.fetch,
    });

    await expect(adapter.customerStatus({ auth })).rejects.toMatchObject({
      code: 'UNSUPPORTED_ROUTE',
    });
  });

  it('requires a token', async () => {
    const { adapter } = ngnAdapter();

    await expect(adapter.customerStatus({ auth: { token: '' } })).rejects.toMatchObject({
      code: 'AUTH_REQUIRED',
    });
  });
});

describe('Sep24Adapter in a registry', () => {
  it('is comparable against other adapters and ranks on the landed amount', async () => {
    const { adapter } = ngnAdapter();
    const registry = new AdapterRegistry([
      adapter,
      // Quotes a better rate than the anchor's 1600, but charges 10000 NGN.
      new MockAdapter({ id: 'mock-ng', country: 'NG', fiat: 'NGN', rate: '1650', feeFixed: '10000' }),
    ]);

    const { quotes, errors } = await registry.quoteAll(withdrawRequest);

    expect(errors).toEqual([]);
    expect(quotes.map((q) => q.quote.adapterId)).toEqual(['sep24:ngn.example.com', 'mock-ng']);
    expect(quotes[0]?.quote.landedAmount).toBe('156000');
    expect(quotes[1]?.quote.landedAmount).toBe('155000');
  });

  it('does not take the batch down when the anchor is unreachable', async () => {
    const { adapter } = ngnAdapter({
      'https://ngn.example.com/.well-known/stellar.toml': { throws: new TypeError('fetch failed') },
    });
    const registry = new AdapterRegistry([
      adapter,
      new MockAdapter({ id: 'mock-ng', country: 'NG', fiat: 'NGN', rate: '1580' }),
    ]);

    const { quotes, errors } = await registry.quoteAll(withdrawRequest);

    expect(quotes).toHaveLength(1);
    expect(errors[0]).toMatchObject({
      adapterId: 'sep24:ngn.example.com',
      error: expect.any(RampError),
    });
    expect(errors[0]?.error.retryable).toBe(true);
  });
});
