import { describe, expect, it } from 'vitest';
import { RampError, decimal } from '@slipwaykit/core';
import {
  fetchAnchorToml,
  parseInfo,
  priceViaInfo,
  priceViaSep38,
  toSep38FiatAsset,
  toSep38StellarAsset,
  type AnchorToml,
} from '@slipwaykit/adapter-sep24';
import { fixture, harnessFor, json } from './harness.js';

const NOW = 1_757_942_400_000;
const now = (): number => NOW;

async function tomlFor(name: string, domain: string): Promise<AnchorToml> {
  const harness = harnessFor({
    [`https://${domain}/.well-known/stellar.toml`]: { text: fixture(name) },
  });
  return fetchAnchorToml(domain, harness.fetch);
}

/** The invariant every pricing path must hold: the fee breakdown adds up. */
function expectFeesToReconcile(priced: {
  buyAmount: string;
  landedAmount: string;
  fees: readonly { amount: string }[];
}): void {
  const total = decimal.sum(priced.fees.map((fee) => fee.amount));
  expect(decimal.cmp(decimal.sub(priced.buyAmount, total), priced.landedAmount)).toBe(0);
}

describe('SEP-38 asset identifiers', () => {
  it('builds a credit asset identifier', () => {
    expect(toSep38StellarAsset({ code: 'USDC', issuer: 'GBBD47IF' })).toBe(
      'stellar:USDC:GBBD47IF',
    );
  });

  it('builds the native identifier for XLM', () => {
    expect(toSep38StellarAsset({ code: 'XLM' })).toBe('stellar:native');
    expect(toSep38StellarAsset({ code: 'native' })).toBe('stellar:native');
  });

  it('refuses to guess an identifier for a credit asset with no issuer', () => {
    // A malformed asset string comes back as an opaque 400, so it is better to
    // fail here with a message that says what is missing.
    expect(() => toSep38StellarAsset({ code: 'USDC' })).toThrow(RampError);
    expect(() => toSep38StellarAsset({ code: 'USDC' })).toThrow(/lists no issuer/);
  });

  it('builds a fiat identifier and rejects anything that is not ISO 4217', () => {
    expect(toSep38FiatAsset('ngn')).toBe('iso4217:NGN');
    expect(() => toSep38FiatAsset('NAIRA')).toThrow(RampError);
    expect(() => toSep38FiatAsset('')).toThrow(/not an ISO 4217 code/);
  });
});

describe('priceViaSep38', () => {
  const base = {
    quoteServer: 'https://ngn.example.com/sep38',
    sellAsset: 'stellar:USDC:GA5ZSEJY',
    buyAsset: 'iso4217:NGN',
    sellAmount: '100',
    buyCurrency: 'NGN',
    country: 'NG',
    now,
  };

  it('subtracts buy-side fees and reports the rate markup as a spread', async () => {
    const harness = harnessFor({
      'https://ngn.example.com/sep38/price': { body: json('ngn-sep38-price.json') },
    });

    const priced = await priceViaSep38({ ...base, fetchImpl: harness.fetch });

    // Headline rate 0.000625 USDC per NGN, so 100 USDC would gross 160000 NGN.
    expect(priced.buyAmount).toBe('160000');
    // The anchor only offered 158000, so 2000 NGN went to its spread...
    // ...and a further 2000 NGN payout fee comes out of that.
    expect(priced.landedAmount).toBe('156000');
    expect(priced.rate).toBe('1600');
    expect(priced.fees).toEqual([
      {
        kind: 'spread',
        amount: '2000',
        currency: 'NGN',
        description:
          'Difference between the anchor’s headline rate (0.000625) and its effective rate (0.0006329113924)',
      },
      {
        kind: 'provider',
        amount: '2000',
        currency: 'NGN',
        description: 'Payout fee — Bank transfer to a Nigerian account.',
      },
    ]);
    expectFeesToReconcile(priced);
  });

  it('prices the recorded live response from the SDF test anchor', async () => {
    // Recorded 2026-09-15. sell 100 USDC, buy USD, with a 1.00 USDC sell-side
    // fee: (100 - 1.00) / 1.0500001591 = 94.2857, which is what the anchor sent.
    const harness = harnessFor({
      'https://testanchor.stellar.org/sep38/price': {
        body: json('testanchor-sep38-price-usd.json'),
      },
    });

    const priced = await priceViaSep38({
      ...base,
      quoteServer: 'https://testanchor.stellar.org/sep38',
      buyAsset: 'iso4217:USD',
      buyCurrency: 'USD',
      country: 'US',
      fetchImpl: harness.fetch,
    });

    // The fee is denominated in the sell asset, so it is already reflected in
    // buy_amount and must not be subtracted a second time.
    expect(priced.landedAmount).toBe('94.2857');
    // It surfaces instead as the spread: 1.00 USDC is 0.952381 USD at 1.05.
    expect(priced.fees).toHaveLength(1);
    expect(priced.fees[0]?.kind).toBe('spread');
    expect(decimal.round(priced.fees[0]!.amount, 6)).toBe('0.952381');
    expectFeesToReconcile(priced);
  });

  it('sends the SEP-24 context and the corridor country', async () => {
    const harness = harnessFor({
      'https://ngn.example.com/sep38/price': { body: json('ngn-sep38-price.json') },
    });

    await priceViaSep38({ ...base, fetchImpl: harness.fetch });
    const called = harness.calls[0] ?? '';

    expect(called).toContain('context=sep24');
    expect(called).toContain('country_code=NG');
    expect(called).toContain('sell_asset=stellar%3AUSDC%3AGA5ZSEJY');
    expect(called).toContain('buy_asset=iso4217%3ANGN');
    expect(called).toContain('sell_amount=100');
  });

  it('throws QUOTE_INCOMPLETE when the anchor returns no buy_amount', async () => {
    const harness = harnessFor({
      'https://ngn.example.com/sep38/price': {
        body: json('ngn-sep38-price-no-buy-amount.json'),
      },
    });

    await expect(priceViaSep38({ ...base, fetchImpl: harness.fetch })).rejects.toMatchObject({
      code: 'QUOTE_INCOMPLETE',
    });
  });

  it('reports no spread when the anchor charges none', async () => {
    const harness = harnessFor({
      'https://ngn.example.com/sep38/price': {
        body: { price: '0.000625', total_price: '0.000625', sell_amount: '100', buy_amount: '160000' },
      },
    });

    const priced = await priceViaSep38({ ...base, fetchImpl: harness.fetch });

    expect(priced.fees).toEqual([]);
    expect(priced.buyAmount).toBe('160000');
    expect(priced.landedAmount).toBe('160000');
    expectFeesToReconcile(priced);
  });

  it('reports a fee total when the anchor gives no per-detail breakdown', async () => {
    const harness = harnessFor({
      'https://ngn.example.com/sep38/price': {
        body: {
          price: '0.000625',
          sell_amount: '100',
          buy_amount: '160000',
          fee: { total: '1500', asset: 'iso4217:NGN' },
        },
      },
    });

    const priced = await priceViaSep38({ ...base, fetchImpl: harness.fetch });

    expect(priced.fees).toEqual([
      { kind: 'provider', amount: '1500', currency: 'NGN', description: 'Anchor fee' },
    ]);
    expect(priced.landedAmount).toBe('158500');
    expectFeesToReconcile(priced);
  });

  it('uses the anchor expires_at when it sends one', async () => {
    const harness = harnessFor({
      'https://ngn.example.com/sep38/price': {
        body: {
          price: '0.000625',
          sell_amount: '100',
          buy_amount: '160000',
          expires_at: '2026-09-15T13:00:00Z',
          id: 'quote-7f3a',
        },
      },
    });

    const priced = await priceViaSep38({ ...base, fetchImpl: harness.fetch });

    expect(priced.expiresAt).toBe(Date.parse('2026-09-15T13:00:00Z'));
    expect(priced.providerQuoteId).toBe('quote-7f3a');
  });

  it('falls back to a 60 second expiry, and sets no quote id, when the anchor sends neither', async () => {
    const harness = harnessFor({
      'https://ngn.example.com/sep38/price': { body: json('ngn-sep38-price.json') },
    });

    const priced = await priceViaSep38({ ...base, fetchImpl: harness.fetch });

    expect(priced.expiresAt).toBe(NOW + 60_000);
    expect(priced.providerQuoteId).toBeUndefined();
  });

  it('ignores an unparseable expires_at rather than producing NaN', async () => {
    const harness = harnessFor({
      'https://ngn.example.com/sep38/price': {
        body: { price: '0.000625', sell_amount: '100', buy_amount: '160000', expires_at: 'soon' },
      },
    });

    const priced = await priceViaSep38({ ...base, fetchImpl: harness.fetch });

    expect(priced.expiresAt).toBe(NOW + 60_000);
  });

  it('refuses a quote whose buy-side fees exceed what the anchor offered', async () => {
    const harness = harnessFor({
      'https://ngn.example.com/sep38/price': {
        body: {
          price: '0.000625',
          sell_amount: '100',
          buy_amount: '1000',
          fee: { total: '5000', asset: 'iso4217:NGN', details: [{ name: 'Fee', amount: '5000' }] },
        },
      },
    });

    await expect(priceViaSep38({ ...base, fetchImpl: harness.fetch })).rejects.toMatchObject({
      code: 'AMOUNT_OUT_OF_BOUNDS',
    });
  });

  it('maps an anchor 400 through the error table rather than leaking it', async () => {
    const harness = harnessFor({
      'https://ngn.example.com/sep38/price': {
        status: 400,
        body: json('testanchor-sep38-price-unsupported-context.json'),
      },
    });

    await expect(priceViaSep38({ ...base, fetchImpl: harness.fetch })).rejects.toMatchObject({
      code: 'PROVIDER_REJECTED',
      httpStatus: 400,
    });
  });
});

describe('priceViaInfo', () => {
  it('prices a one-to-one pegged asset from published fees', async () => {
    const toml = await tomlFor('pegged-anchor.toml', 'pegged.example.com');
    const info = parseInfo(json('pegged-sep24-info.json'));

    const priced = priceViaInfo({
      asset: info.withdraw.get('NGNC')!,
      toml,
      fiat: 'NGN',
      sellAmount: '100000',
      buyCurrency: 'NGN',
      now,
    });

    // 0.5% of 100000 is 500, plus a flat 100, so 600 is charged.
    expect(priced.buyAmount).toBe('100000');
    expect(priced.rate).toBe('1');
    expect(priced.fees.map((f) => f.amount)).toEqual(['500.0000000', '100']);
    expect(priced.landedAmount).toBe('99400');
    expect(priced.expiresAt).toBe(NOW + 60_000);
    expectFeesToReconcile(priced);
  });

  it('treats fee_minimum as a floor on the total, not another charge on top', async () => {
    const toml = await tomlFor('pegged-anchor.toml', 'pegged.example.com');
    const info = parseInfo(json('pegged-sep24-info.json'));

    // On 1000 NGNC: 0.5% is 5, plus flat 100, so 105 — below the 250 minimum.
    const priced = priceViaInfo({
      asset: info.withdraw.get('NGNC')!,
      toml,
      fiat: 'NGN',
      sellAmount: '1000',
      buyCurrency: 'NGN',
      now,
    });

    expect(decimal.sum(priced.fees.map((f) => f.amount))).toBe('250');
    expect(priced.landedAmount).toBe('750');
    expectFeesToReconcile(priced);
  });

  it('throws QUOTE_INCOMPLETE when the asset is not pegged to the fiat', async () => {
    const toml = await tomlFor('pegged-anchor.toml', 'pegged.example.com');
    const info = parseInfo(json('pegged-sep24-info.json'));

    // USDC against NGN with no quote server: there is simply no rate to use.
    const attempt = (): unknown =>
      priceViaInfo({
        asset: info.withdraw.get('USDC')!,
        toml,
        fiat: 'NGN',
        sellAmount: '100',
        buyCurrency: 'NGN',
        now,
      });

    expect(attempt).toThrow(RampError);
    expect(attempt).toThrow(/not pegged to NGN/);
    expect(attempt).toThrow(/Refusing to guess/);
  });

  it('throws QUOTE_INCOMPLETE when the anchor published no fee fields at all', async () => {
    const toml = await tomlFor('pegged-anchor.toml', 'pegged.example.com');
    const info = parseInfo(json('nofee-sep24-info.json'));

    // Silence about fees is not the same as charging nothing.
    expect(() =>
      priceViaInfo({
        asset: info.withdraw.get('NGNC')!,
        toml,
        fiat: 'NGN',
        sellAmount: '1000',
        buyCurrency: 'NGN',
        now,
      }),
    ).toThrow(/neither fee_fixed nor fee_percent/);
  });

  it('refuses to price from /info when the anchor says fee.enabled', async () => {
    // Recorded from stellar.moneygram.com on 2026-09-15: fee_fixed 0 and
    // fee_percent 0 alongside fee.enabled true, with GET /fee returning a 500.
    // Reading those zeros as "free" would hand back the gross amount as the
    // landed amount, which is the exact failure rule 4 exists to prevent.
    const toml = await tomlFor('pegged-anchor.toml', 'pegged.example.com');
    const info = parseInfo(json('moneygram-sep24-info.json'));

    expect(info.feeEndpointEnabled).toBe(true);
    expect(() =>
      priceViaInfo({
        asset: info.withdraw.get('USDC')!,
        toml,
        fiat: 'USD',
        feeEndpointEnabled: info.feeEndpointEnabled,
        sellAmount: '5',
        buyCurrency: 'USD',
        now,
      }),
    ).toThrow(/fee.enabled/);
  });

  it('still prices normally when the anchor does not advertise a /fee endpoint', async () => {
    const toml = await tomlFor('pegged-anchor.toml', 'pegged.example.com');
    const info = parseInfo(json('pegged-sep24-info.json'));

    const priced = priceViaInfo({
      asset: info.withdraw.get('NGNC')!,
      toml,
      fiat: 'NGN',
      feeEndpointEnabled: false,
      sellAmount: '100000',
      buyCurrency: 'NGN',
      now,
    });

    expect(priced.landedAmount).toBe('99400');
  });

  it('accepts an asset whose code equals the fiat code', async () => {
    const toml = await tomlFor('pegged-anchor.toml', 'pegged.example.com');

    const priced = priceViaInfo({
      asset: { code: 'NGN', enabled: true, feePercent: '1', methods: [], rawTypes: [] },
      toml,
      fiat: 'NGN',
      sellAmount: '1000',
      buyCurrency: 'NGN',
      now,
    });

    expect(priced.landedAmount).toBe('990');
  });

  it('refuses a quote where the fees would consume everything sent', async () => {
    const toml = await tomlFor('pegged-anchor.toml', 'pegged.example.com');

    expect(() =>
      priceViaInfo({
        asset: { code: 'NGN', enabled: true, feeFixed: '5000', methods: [], rawTypes: [] },
        toml,
        fiat: 'NGN',
        sellAmount: '100',
        buyCurrency: 'NGN',
        now,
      }),
    ).toThrow(/nothing would land/);
  });
});
