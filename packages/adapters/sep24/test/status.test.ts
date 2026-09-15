import { describe, expect, it } from 'vitest';
import type { TxStatus } from '@slipwaykit/core';
import { isTerminal, knownSep24Statuses, mapStatus } from '@slipwaykit/adapter-sep24';

/** Every row of the mapping table in the build specification. */
const TABLE: readonly (readonly [string, TxStatus])[] = [
  ['incomplete', 'incomplete'],
  ['pending_user_transfer_start', 'pending_user'],
  ['pending_user_transfer_complete', 'pending_user'],
  ['pending_customer_info_update', 'pending_kyc'],
  ['pending_anchor', 'pending_provider'],
  ['pending_external', 'pending_provider'],
  ['pending_trust', 'pending_provider'],
  ['pending_stellar', 'pending_stellar'],
  ['completed', 'completed'],
  ['refunded', 'refunded'],
  ['expired', 'expired'],
  ['no_market', 'expired'],
  ['too_small', 'expired'],
  ['too_large', 'expired'],
  ['error', 'error'],
];

describe('mapStatus', () => {
  it.each(TABLE)('maps %s to %s', (sep24, slipway) => {
    expect(mapStatus(sep24)).toBe(slipway);
  });

  it('maps every status it claims to know', () => {
    for (const status of knownSep24Statuses()) {
      expect(mapStatus(status)).toBeTypeOf('string');
    }
  });

  it('covers every row of the specification table', () => {
    const known = new Set(knownSep24Statuses());
    for (const [sep24] of TABLE) expect(known.has(sep24), sep24).toBe(true);
  });

  it('maps an unrecognised status to pending_provider instead of crashing', () => {
    expect(mapStatus('something_new_in_a_future_sep24')).toBe('pending_provider');
    expect(mapStatus('')).toBe('pending_provider');
  });

  it('never crashes on a non-string, which is what a poller depends on', () => {
    for (const value of [undefined, null, 42, {}, [], true]) {
      expect(mapStatus(value)).toBe('pending_provider');
    }
  });

  it('tolerates case and whitespace from a sloppy anchor', () => {
    expect(mapStatus('  COMPLETED ')).toBe('completed');
    expect(mapStatus('Pending_Anchor')).toBe('pending_provider');
  });

  it('knows which statuses end a poll loop', () => {
    expect(['completed', 'refunded', 'expired', 'error'].every(isTerminal as never)).toBe(true);
    expect(isTerminal('pending_user')).toBe(false);
    expect(isTerminal('pending_stellar')).toBe(false);
    expect(isTerminal('incomplete')).toBe(false);
  });
});
