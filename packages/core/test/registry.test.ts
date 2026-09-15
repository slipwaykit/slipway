import { describe, expect, it } from 'vitest';
import { AdapterRegistry, RampError, type QuoteRequest } from '@slipwaykit/core';
import { MockAdapter } from '@slipwaykit/adapter-mock';

const request: QuoteRequest = {
  country: 'NG',
  fiat: 'NGN',
  asset: { code: 'USDC' },
  direction: 'withdraw',
  amount: '100',
  method: 'bank_transfer',
};

const adapter = (id: string, rate: string, feeFixed = '0'): MockAdapter =>
  new MockAdapter({ id, country: 'NG', fiat: 'NGN', rate, feeFixed });

describe('AdapterRegistry', () => {
  it('sorts by landed amount, not by rate', async () => {
    // `flashy` quotes the better rate but takes it all back in fees, so the
    // recipient is worse off. Sorting on rate would rank it first.
    const registry = new AdapterRegistry([
      adapter('flashy', '1600', '5000'), // gross 160000, lands 155000
      adapter('honest', '1580', '0'), //    gross 158000, lands 158000
    ]);

    const { quotes, errors } = await registry.quoteAll(request);

    expect(errors).toHaveLength(0);
    expect(quotes.map((q) => q.quote.adapterId)).toEqual(['honest', 'flashy']);
    expect(quotes[0]?.quote.landedAmount).toBe('158000');
    expect(quotes[1]?.quote.landedAmount).toBe('155000');
    // The loser genuinely advertised the better rate.
    expect(quotes[1]?.quote.rate).toBe('1600');
  });

  it('reports a failing adapter as data instead of rejecting the batch', async () => {
    const registry = new AdapterRegistry([
      adapter('good', '1580'),
      new MockAdapter({
        id: 'broken',
        country: 'NG',
        fiat: 'NGN',
        rate: '1580',
        failWith: 'PROVIDER_UNAVAILABLE',
      }),
    ]);

    const { quotes, errors } = await registry.quoteAll(request);

    expect(quotes).toHaveLength(1);
    expect(errors).toHaveLength(1);
    expect(errors[0]?.adapterId).toBe('broken');
    expect(errors[0]?.error).toBeInstanceOf(RampError);
    expect(errors[0]?.error.code).toBe('PROVIDER_UNAVAILABLE');
    expect(errors[0]?.error.retryable).toBe(true);
  });

  it('resolves even when every adapter fails', async () => {
    const registry = new AdapterRegistry([
      new MockAdapter({ id: 'a', country: 'NG', fiat: 'NGN', rate: '1', failWith: 'NOT_FOUND' }),
      new MockAdapter({ id: 'b', country: 'NG', fiat: 'NGN', rate: '1', failWith: 'RATE_LIMITED' }),
    ]);

    const { quotes, errors } = await registry.quoteAll(request);

    expect(quotes).toEqual([]);
    expect(errors.map((e) => e.error.code).sort()).toEqual(['NOT_FOUND', 'RATE_LIMITED']);
  });

  it('records an unsupported route as an error rather than omitting the adapter', async () => {
    const registry = new AdapterRegistry([
      adapter('ng', '1580'),
      new MockAdapter({ id: 'ke', country: 'KE', fiat: 'KES', rate: '129' }),
    ]);

    const { quotes, errors } = await registry.quoteAll(request);

    expect(quotes.map((q) => q.quote.adapterId)).toEqual(['ng']);
    expect(errors[0]?.adapterId).toBe('ke');
    expect(errors[0]?.error.code).toBe('UNSUPPORTED_ROUTE');
  });

  it('measures latency with the injected clock', async () => {
    let clock = 1_000;
    const registry = new AdapterRegistry([adapter('ng', '1580')], {
      now: () => (clock += 250),
    });

    const { quotes } = await registry.quoteAll(request);

    expect(quotes[0]?.latencyMs).toBe(250);
  });

  it('replaces an adapter registered under a duplicate id', () => {
    const registry = new AdapterRegistry([adapter('dup', '1'), adapter('dup', '2')]);
    expect(registry.list()).toHaveLength(1);
    expect(registry.get('dup')).toBeDefined();
    expect(registry.get('missing')).toBeUndefined();
  });

  it('collects capabilities and survives an adapter that cannot list them', async () => {
    const registry = new AdapterRegistry([
      adapter('ng', '1580'),
      new MockAdapter({
        id: 'down',
        country: 'NG',
        fiat: 'NGN',
        rate: '1',
        failWith: 'PROVIDER_UNAVAILABLE',
      }),
    ]);

    const results = await registry.capabilities();
    const down = results.find((entry) => entry.adapterId === 'down');

    expect(results).toHaveLength(2);
    expect(down?.capabilities).toEqual([]);
    expect(down?.error?.code).toBe('PROVIDER_UNAVAILABLE');
  });
});
