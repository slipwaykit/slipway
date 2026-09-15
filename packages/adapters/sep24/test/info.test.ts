import { describe, expect, it } from 'vitest';
import { mapPaymentMethod, parseInfo, toCapabilities, fetchAnchorToml } from '@slipwaykit/adapter-sep24';
import type { AnchorToml } from '@slipwaykit/adapter-sep24';
import { fixture, harnessFor, json } from './harness.js';

async function tomlFor(name: string, domain: string): Promise<AnchorToml> {
  const harness = harnessFor({
    [`https://${domain}/.well-known/stellar.toml`]: { text: fixture(name) },
  });
  return fetchAnchorToml(domain, harness.fetch);
}

describe('mapPaymentMethod', () => {
  it.each([
    ['bank_account', 'bank_transfer'],
    ['BANK_TRANSFER', 'bank_transfer'],
    ['sepa_bank', 'bank_transfer'],
    ['mobile_money', 'mobile_money'],
    ['mpesa', 'mobile_money'],
    ['MTN_MOMO', 'mobile_money'],
    ['mobile', 'mobile_money'],
    ['debit_card', 'card'],
    ['cash_pickup', 'cash_pickup'],
    ['cash', 'cash_pickup'],
    ['ussd', 'ussd'],
  ])('maps %s to %s', (raw, expected) => {
    expect(mapPaymentMethod(raw)).toBe(expected);
  });

  it('prefers mobile money over a bank substring, so M-Pesa is never called a wire', () => {
    expect(mapPaymentMethod('mpesa_bank_deposit')).toBe('mobile_money');
    expect(mapPaymentMethod('mobile money via bank')).toBe('mobile_money');
  });

  it('drops an unknown type rather than coercing it to the nearest member', () => {
    expect(mapPaymentMethod('carrier_pigeon')).toBeUndefined();
    expect(mapPaymentMethod('swift')).toBeUndefined();
    expect(mapPaymentMethod('')).toBeUndefined();
  });
});

describe('parseInfo', () => {
  it('parses the recorded SDF test anchor, which publishes no fees and no types', async () => {
    const info = parseInfo(json('testanchor-sep24-info.json'));

    expect([...info.withdraw.keys()].sort()).toEqual(['SRT', 'USDC', 'native']);
    const usdc = info.withdraw.get('USDC');
    expect(usdc).toMatchObject({ enabled: true, minAmount: '1', maxAmount: '10' });
    // Recorded 2026-09-15: the test anchor genuinely publishes no fee fields.
    expect(usdc?.feeFixed).toBeUndefined();
    expect(usdc?.feePercent).toBeUndefined();
    expect(usdc?.methods).toEqual([]);
    expect(info.feeEndpointEnabled).toBe(false);
  });

  it('reads amounts as strings, never as numbers', () => {
    const info = parseInfo(json('ngn-sep24-info.json'));
    const usdc = info.withdraw.get('USDC');

    expect(usdc?.minAmount).toBe('5');
    expect(usdc?.maxAmount).toBe('50000');
    expect(usdc?.feePercent).toBe('1');
    expect(typeof usdc?.minAmount).toBe('string');
  });

  it('expands a fee that JSON.parse turned into exponent notation', () => {
    const info = parseInfo({ withdraw: { X: { enabled: true, fee_fixed: 1e-7, min_amount: 1e21 } } });

    expect(info.withdraw.get('X')?.feeFixed).toBe('0.0000001');
    expect(info.withdraw.get('X')?.minAmount).toBe('1000000000000000000000');
  });

  it('keeps unknown types in rawTypes while dropping them from methods', () => {
    const info = parseInfo(json('ngn-sep24-info.json'));
    const usdc = info.withdraw.get('USDC');

    expect(usdc?.rawTypes).toEqual(['bank_account', 'cash_pickup', 'ussd', 'carrier_pigeon']);
    expect(usdc?.methods).toEqual(['bank_transfer', 'cash_pickup', 'ussd']);
  });

  it('accepts types as an array as well as an object', () => {
    const info = parseInfo({ withdraw: { X: { types: ['mpesa', 'bank_account'] } } });

    expect(info.withdraw.get('X')?.methods).toEqual(['mobile_money', 'bank_transfer']);
  });

  it('de-duplicates methods when several raw types map to one', () => {
    const info = parseInfo({ withdraw: { X: { types: { bank_account: {}, bank_wire: {} } } } });

    expect(info.withdraw.get('X')?.methods).toEqual(['bank_transfer']);
  });

  it('treats a missing enabled flag as enabled, per SEP-24', () => {
    const info = parseInfo({ withdraw: { X: { min_amount: 1 } } });

    expect(info.withdraw.get('X')?.enabled).toBe(true);
  });

  it('survives a malformed body rather than failing the whole anchor', () => {
    expect(parseInfo(undefined).withdraw.size).toBe(0);
    expect(parseInfo('nonsense').deposit.size).toBe(0);
    expect(parseInfo({ withdraw: { X: 'not an object' } }).withdraw.size).toBe(0);
  });
});

describe('toCapabilities', () => {
  it('produces one capability per enabled asset per direction', async () => {
    const toml = await tomlFor('ngn-anchor.toml', 'ngn.example.com');
    const capabilities = toCapabilities(parseInfo(json('ngn-sep24-info.json')), toml, 'NG', 'NGN');

    expect(capabilities.map((c) => `${c.direction}:${c.asset.code}`)).toEqual([
      'deposit:USDC',
      'withdraw:USDC',
    ]);
  });

  it('drops a disabled asset', async () => {
    const toml = await tomlFor('ngn-anchor.toml', 'ngn.example.com');
    const capabilities = toCapabilities(parseInfo(json('ngn-sep24-info.json')), toml, 'NG', 'NGN');

    expect(capabilities.some((c) => c.asset.code === 'DEADCOIN')).toBe(false);
  });

  it('fills the issuer in from the stellar.toml CURRENCIES array', async () => {
    const toml = await tomlFor('ngn-anchor.toml', 'ngn.example.com');
    const capabilities = toCapabilities(parseInfo(json('ngn-sep24-info.json')), toml, 'NG', 'NGN');

    expect(capabilities[0]?.asset.issuer).toBe(
      'GA5ZSEJYB37JRC5AVCIA5MOP4RHTM335X2KGX3IHOJAPP5RE34K4KZVN',
    );
  });

  it('omits bounds the anchor did not publish rather than defaulting them to zero', async () => {
    const toml = await tomlFor('pegged-anchor.toml', 'pegged.example.com');
    const capabilities = toCapabilities(
      parseInfo(json('pegged-sep24-info.json')),
      toml,
      'NG',
      'NGN',
    );
    const usdc = capabilities.find((c) => c.asset.code === 'USDC' && c.direction === 'withdraw');
    const ngnc = capabilities.find((c) => c.asset.code === 'NGNC' && c.direction === 'withdraw');

    expect(usdc).toBeDefined();
    expect('minAmount' in usdc!).toBe(false);
    expect('maxAmount' in usdc!).toBe(false);
    expect(ngnc?.minAmount).toBe('100');
    expect(ngnc?.maxAmount).toBe('5000000');
  });

  it('sets kycRequired only when the anchor advertises a SEP-12 server', async () => {
    const withKyc = await tomlFor('ngn-anchor.toml', 'ngn.example.com');
    const withoutKyc = await tomlFor('pegged-anchor.toml', 'pegged.example.com');
    const info = parseInfo(json('ngn-sep24-info.json'));

    expect(toCapabilities(info, withKyc, 'NG', 'NGN')[0]?.kycRequired).toBe(true);
    expect(toCapabilities(info, withoutKyc, 'NG', 'NGN')[0]?.kycRequired).toBe(false);
  });

  it('carries the configured corridor through, since SEP-24 has no field for it', async () => {
    const toml = await tomlFor('ngn-anchor.toml', 'ngn.example.com');
    const capabilities = toCapabilities(parseInfo(json('ngn-sep24-info.json')), toml, 'KE', 'KES');

    expect(capabilities.every((c) => c.country === 'KE' && c.fiat === 'KES')).toBe(true);
  });
});
