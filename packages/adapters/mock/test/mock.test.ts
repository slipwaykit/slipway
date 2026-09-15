import { describe, expect, it } from 'vitest';
import { RampError, type QuoteRequest } from '@slipwaykit/core';
import { MockAdapter } from '@slipwaykit/adapter-mock';

const request: QuoteRequest = {
  country: 'NG',
  fiat: 'NGN',
  asset: { code: 'USDC' },
  direction: 'withdraw',
  amount: '100',
  method: 'bank_transfer',
};

const auth = { token: 'a-sep10-token' };

describe('MockAdapter', () => {
  it('computes a landed amount net of both fees', async () => {
    const adapter = new MockAdapter({
      id: 'mock-ng',
      country: 'NG',
      fiat: 'NGN',
      rate: '1580',
      feePercent: '1',
      feeFixed: '500',
      now: () => 1_000_000,
    });

    const quote = await adapter.quote(request);

    expect(quote.buyAmount).toBe('158000.00');
    expect(quote.fees).toEqual([
      { kind: 'percent', amount: '1580.00', currency: 'NGN', description: '1% provider fee' },
      { kind: 'fixed', amount: '500', currency: 'NGN', description: 'Flat provider fee' },
    ]);
    expect(quote.landedAmount).toBe('155920');
    expect(quote.expiresAt).toBe(1_060_000);
  });

  it('returns every amount as a string, never a number', async () => {
    const adapter = new MockAdapter({ id: 'm', country: 'NG', fiat: 'NGN', rate: '1580' });
    const quote = await adapter.quote(request);

    for (const value of [quote.sellAmount, quote.buyAmount, quote.landedAmount, quote.rate]) {
      expect(typeof value).toBe('string');
    }
  });

  it('inverts the rate for a deposit', async () => {
    const adapter = new MockAdapter({ id: 'm', country: 'NG', fiat: 'NGN', rate: '1600' });
    const quote = await adapter.quote({ ...request, direction: 'deposit', amount: '160000' });

    expect(quote.rate).toBe('0.000625');
    expect(quote.buyAmount).toBe('100.0000000');
    // Landed amounts come back normalised, so '100' rather than '100.0000000'.
    expect(quote.landedAmount).toBe('100');
  });

  it('rejects a route it does not serve', async () => {
    const adapter = new MockAdapter({ id: 'm', country: 'NG', fiat: 'NGN', rate: '1580' });

    await expect(adapter.quote({ ...request, method: 'mobile_money' })).rejects.toMatchObject({
      code: 'UNSUPPORTED_ROUTE',
    });
  });

  it('enforces both bounds', async () => {
    const adapter = new MockAdapter({
      id: 'm',
      country: 'NG',
      fiat: 'NGN',
      rate: '1580',
      minAmount: '10',
      maxAmount: '1000',
    });

    await expect(adapter.quote({ ...request, amount: '9.99' })).rejects.toMatchObject({
      code: 'AMOUNT_OUT_OF_BOUNDS',
    });
    await expect(adapter.quote({ ...request, amount: '1000.01' })).rejects.toMatchObject({
      code: 'AMOUNT_OUT_OF_BOUNDS',
    });
    await expect(adapter.quote({ ...request, amount: '1000' })).resolves.toBeDefined();
  });

  it('omits bounds it was not configured with, rather than reporting zero', async () => {
    const adapter = new MockAdapter({ id: 'm', country: 'NG', fiat: 'NGN', rate: '1580' });
    const [capability] = await adapter.capabilities();

    expect(capability).toBeDefined();
    expect('minAmount' in capability!).toBe(false);
    expect('maxAmount' in capability!).toBe(false);
  });

  it('requires a token for every authenticated call', async () => {
    const adapter = new MockAdapter({ id: 'm', country: 'NG', fiat: 'NGN', rate: '1580' });
    const quote = await adapter.quote(request);

    await expect(adapter.initiate({ quote, auth: { token: '' } })).rejects.toMatchObject({
      code: 'AUTH_REQUIRED',
    });
    await expect(adapter.getTransaction({ id: 'x', auth: { token: '' } })).rejects.toMatchObject({
      code: 'AUTH_REQUIRED',
    });
  });

  it('refuses to initiate against an expired quote', async () => {
    let now = 1_000_000;
    const adapter = new MockAdapter({
      id: 'm',
      country: 'NG',
      fiat: 'NGN',
      rate: '1580',
      quoteTtlMs: 60_000,
      now: () => now,
    });
    const quote = await adapter.quote(request);
    now += 60_001;

    await expect(adapter.initiate({ quote, auth })).rejects.toMatchObject({
      code: 'QUOTE_EXPIRED',
    });
  });

  it('walks a transaction to completion across polls', async () => {
    const adapter = new MockAdapter({ id: 'm', country: 'NG', fiat: 'NGN', rate: '1580' });
    const quote = await adapter.quote(request);
    const started = await adapter.initiate({ quote, auth });

    expect(started.status).toBe('pending_user');
    expect(started.interactiveUrl).toContain(started.id);

    const statuses = [];
    for (let i = 0; i < 5; i += 1) {
      statuses.push((await adapter.getTransaction({ id: started.id, auth })).status);
    }

    expect(statuses).toEqual([
      'pending_user',
      'pending_provider',
      'pending_stellar',
      'completed',
      'completed',
    ]);
  });

  it('reports a 64 character Stellar hash once settlement starts', async () => {
    const adapter = new MockAdapter({ id: 'm', country: 'NG', fiat: 'NGN', rate: '1580' });
    const quote = await adapter.quote(request);
    const started = await adapter.initiate({ quote, auth });

    await adapter.getTransaction({ id: started.id, auth });
    await adapter.getTransaction({ id: started.id, auth });
    const settling = await adapter.getTransaction({ id: started.id, auth });

    expect(settling.status).toBe('pending_stellar');
    expect(settling.stellarTxHash).toHaveLength(64);
  });

  it('reports NOT_FOUND for an unknown transaction', async () => {
    const adapter = new MockAdapter({ id: 'm', country: 'NG', fiat: 'NGN', rate: '1580' });

    await expect(adapter.getTransaction({ id: 'nope', auth })).rejects.toMatchObject({
      code: 'NOT_FOUND',
    });
  });

  it('reports outstanding KYC fields only when configured to require KYC', async () => {
    const open = new MockAdapter({ id: 'a', country: 'NG', fiat: 'NGN', rate: '1' });
    const gated = new MockAdapter({
      id: 'b',
      country: 'NG',
      fiat: 'NGN',
      rate: '1',
      kycRequired: true,
    });

    expect(await open.customerStatus({ auth })).toEqual({ state: 'approved', fields: [] });
    const status = await gated.customerStatus({ auth });
    expect(status.state).toBe('not_started');
    expect(status.fields.map((f) => f.name)).toEqual(['first_name', 'last_name']);
  });

  it('throws a RampError, never a raw error, when configured to fail', async () => {
    const adapter = new MockAdapter({
      id: 'm',
      country: 'NG',
      fiat: 'NGN',
      rate: '1',
      failWith: 'RATE_LIMITED',
    });

    await expect(adapter.capabilities()).rejects.toBeInstanceOf(RampError);
  });
});
