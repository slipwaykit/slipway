/**
 * SEP-24 transaction status to {@link TxStatus}.
 *
 * The table below is the whole of the mapping. It is exhaustive over the
 * statuses SEP-24 defines today, and total over every string an anchor could
 * possibly send: an unrecognised status maps to `pending_provider` rather than
 * throwing, because a poller that crashes on a status it has not seen before is
 * worse than one that says "still working" for a few seconds too long.
 */

import type { TxStatus } from '@slipwaykit/core';

/**
 * Every SEP-24 status Slipway recognises, and what it means to a caller.
 *
 * Grouping choices worth knowing about: `no_market`, `too_small` and `too_large`
 * all become `expired`, because from the user's point of view the outcome is
 * the same — this transaction will not complete and a new quote is needed.
 */
const STATUS_MAP: Readonly<Record<string, TxStatus>> = {
  incomplete: 'incomplete',

  pending_user_transfer_start: 'pending_user',
  pending_user_transfer_complete: 'pending_user',
  pending_user: 'pending_user',

  pending_customer_info_update: 'pending_kyc',

  pending_anchor: 'pending_provider',
  pending_external: 'pending_provider',
  pending_trust: 'pending_provider',
  pending_receiver: 'pending_provider',
  pending_sender: 'pending_provider',

  pending_stellar: 'pending_stellar',

  completed: 'completed',
  refunded: 'refunded',

  expired: 'expired',
  no_market: 'expired',
  too_small: 'expired',
  too_large: 'expired',

  error: 'error',
};

/**
 * Map a SEP-24 status string onto a Slipway {@link TxStatus}.
 *
 * Total: never throws, never returns `undefined`. Matching is case-insensitive
 * and tolerates surrounding whitespace, both of which anchors have been known
 * to produce.
 *
 * @param status - Whatever the anchor put in the `status` field.
 * @returns The mapped status, defaulting to `pending_provider`.
 *
 * @example
 * ```ts
 * mapStatus('pending_user_transfer_start');  // 'pending_user'
 * mapStatus('completed');                    // 'completed'
 * mapStatus('something_new_in_sep24_v3');    // 'pending_provider'
 * ```
 */
export function mapStatus(status: unknown): TxStatus {
  if (typeof status !== 'string') return 'pending_provider';
  return STATUS_MAP[status.trim().toLowerCase()] ?? 'pending_provider';
}

/**
 * Whether a status means the transaction will not change again.
 *
 * Useful for stopping a poll loop.
 *
 * @param status - A Slipway status.
 * @returns Whether polling can stop.
 *
 * @example
 * ```ts
 * while (!isTerminal(tx.status)) tx = await adapter.getTransaction(ref);
 * ```
 */
export function isTerminal(status: TxStatus): boolean {
  return (
    status === 'completed' || status === 'refunded' || status === 'expired' || status === 'error'
  );
}

/**
 * Every SEP-24 status string this module recognises.
 *
 * Exported so the test suite can assert that the table stays complete rather
 * than checking a handful of rows and hoping.
 *
 * @example
 * ```ts
 * for (const status of knownSep24Statuses()) expect(mapStatus(status)).toBeDefined();
 * ```
 */
export function knownSep24Statuses(): readonly string[] {
  return Object.keys(STATUS_MAP);
}
