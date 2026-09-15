/**
 * The anchors Slipway starts with.
 *
 * Every entry below was checked by fetching its `stellar.toml` on the date
 * recorded against it. `protocol` is what the domain actually advertises, not
 * what its marketing says, and an anchor that exists but does not speak SEP-24
 * is listed as such rather than omitted — a Nigerian developer looking at this
 * list should be able to see that Cowrie is real and that Slipway cannot serve
 * it yet, rather than concluding that Nigeria has no Stellar anchor.
 *
 * An honest note about the African corridors this project targets: as of
 * 2026-09-15 no live anchor serving NGN, KES, GHS or ZAR advertises
 * `TRANSFER_SERVER_SEP0024`. The SEP-24 adapter is exercised against the SDF
 * test anchor and against the live non-African SEP-24 anchors below, and the
 * African corridors are demonstrated with the mock adapter until a SEP-24
 * anchor appears on one. Claiming otherwise would be the kind of overstatement
 * this project exists to make harder.
 *
 * Of the four live SEP-24 anchors seeded below, exactly one returned a
 * computable quote when this list was assembled, and the reasons the other
 * three did not are recorded against them. That is the honest state of SEP-24
 * on 2026-09-15, and it is worth showing rather than hiding.
 */

/** What an anchor's home domain advertises. */
export type AnchorProtocol = 'sep24' | 'sep6' | 'unknown';

/** One seeded anchor, with the evidence for why it is in the list. */
export interface SeedAnchor {
  /** Home domain, with no scheme. */
  readonly homeDomain: string;
  /** Display name, as `ORG_NAME` gives it. */
  readonly name: string;
  /** What the domain advertises. Only `sep24` entries get a `Sep24Adapter`. */
  readonly protocol: AnchorProtocol;
  /** ISO 3166-1 alpha-2 codes this anchor is understood to serve. */
  readonly countries: readonly string[];
  /** ISO 4217 codes this anchor is understood to serve. */
  readonly fiats: readonly string[];
  /** Where this entry came from, and when it was last verified. */
  readonly source: string;
  /** `YYYY-MM-DD` the home domain was last fetched. */
  readonly checkedAt: string;
  /** Why it is not usable, when `protocol` is not `sep24`. */
  readonly note?: string;
}

/**
 * The seed list.
 *
 * `testanchor.stellar.org` must always be present. It is the only anchor
 * guaranteed to answer, so the demo keeps working when every production anchor
 * is unreachable.
 *
 * @example
 * ```ts
 * import { SEED_ANCHORS } from './anchors.seed.js';
 *
 * const usable = SEED_ANCHORS.filter((anchor) => anchor.protocol === 'sep24');
 * ```
 */
export const SEED_ANCHORS: readonly SeedAnchor[] = [
  {
    homeDomain: 'testanchor.stellar.org',
    name: 'SDF Test Anchor',
    protocol: 'sep24',
    countries: ['US', 'CA'],
    fiats: ['USD', 'CAD'],
    // Required to be present so the demo survives every other anchor being down.
    source:
      'Stellar Development Foundation reference anchor. Verified by fetching https://testanchor.stellar.org/.well-known/stellar.toml, which advertises TRANSFER_SERVER_SEP0024, ANCHOR_QUOTE_SERVER and KYC_SERVER.',
    checkedAt: '2026-09-15',
    note:
      'Its SEP-38 server rejects context=sep24, answering "Unsupported context. Should be one of [sep6, sep31]". Quotes against it will return PROVIDER_REJECTED until that is fixed upstream.',
  },
  {
    homeDomain: 'stellar.moneygram.com',
    name: 'MoneyGram',
    protocol: 'sep24',
    // MoneyGram Access settles as cash pickup across a large agent network,
    // which is the closest thing in this list to an African corridor today.
    countries: ['US', 'GH', 'KE'],
    fiats: ['USD'],
    source:
      'Verified by fetching https://stellar.moneygram.com/.well-known/stellar.toml, which advertises TRANSFER_SERVER_SEP0024 = https://stellar.moneygram.com/stellaradapterservice/sep24 and USDC anchored to USD.',
    checkedAt: '2026-09-15',
    note:
      'Reachable and SEP-24 compliant, but not quotable. Its /info publishes fee_fixed: 0 and fee_percent: 0 alongside fee.enabled: true, meaning the real fee comes from GET /fee — which answers 500 "No static resource sep24/fee". Slipway therefore returns QUOTE_INCOMPLETE rather than reporting the transfer as free. Country coverage here is the agent network Slipway assumes, not a field the anchor publishes.',
  },
  {
    homeDomain: 'mykobo.co',
    name: 'MYKOBO',
    protocol: 'sep24',
    countries: ['DE', 'FR', 'ES'],
    fiats: ['EUR'],
    source:
      'Verified by fetching https://mykobo.co/.well-known/stellar.toml, which advertises TRANSFER_SERVER_SEP0024 = https://stellar.mykobo.co/sep24 and EURC anchored to EUR.',
    checkedAt: '2026-09-15',
    note:
      'The stellar.toml resolves, but the transfer server it points at does not: stellar.mykobo.co had no DNS A record on 2026-09-15, so every call returns a retryable PROVIDER_UNAVAILABLE. Kept in the list because the failure is the anchor\u2019s and may be temporary.',
  },
  {
    homeDomain: 'anclap.com',
    name: 'Grupo Anchor S.A. (Anclap)',
    protocol: 'sep24',
    countries: ['AR', 'PE'],
    fiats: ['ARS', 'PEN'],
    source:
      'Verified by fetching https://anclap.com/.well-known/stellar.toml, which advertises TRANSFER_SERVER_SEP0024 = https://api.anclap.com/transfer24 and ARS and PEN anchored assets.',
    checkedAt: '2026-09-15',
  },
  {
    homeDomain: 'cowrie.exchange',
    name: 'Cowrie Integrated Systems',
    protocol: 'sep6',
    countries: ['NG'],
    fiats: ['NGN'],
    source:
      'Verified by fetching https://cowrie.exchange/.well-known/stellar.toml. Lagos-based, issues NGNT anchored to the naira.',
    checkedAt: '2026-09-15',
    note:
      'Advertises TRANSFER_SERVER (SEP-6) and KYC_SERVER but NOT TRANSFER_SERVER_SEP0024, so Sep24Adapter cannot serve it. Listed because it is the most significant Nigerian anchor on Stellar and a SEP-6 adapter is the obvious next one to write.',
  },
];

/**
 * The corridors the poller tracks.
 *
 * Kept separate from the anchor list because a corridor is a question Slipway
 * asks, not a claim any one anchor makes.
 *
 * @example
 * ```ts
 * for (const corridor of SEED_CORRIDORS) console.log(corridor.id);
 * ```
 */
export interface SeedCorridor {
  /** `{country}-{fiat}-{assetCode}-{direction}`. */
  readonly id: string;
  /** ISO 3166-1 alpha-2. */
  readonly country: string;
  /** ISO 4217. */
  readonly fiat: string;
  /** Stellar asset code sold or bought. */
  readonly assetCode: string;
  /** Issuing account, when the corridor pins one. */
  readonly assetIssuer?: string;
  /** Which way value moves. */
  readonly direction: 'deposit' | 'withdraw';
  /**
   * The payment method the poller quotes with.
   *
   * Not a column on the `corridors` table, because a corridor is identified by
   * country, currency, asset and direction. It lives here because the poller
   * has to pick one method to compare on, and the right one differs by market:
   * mobile money dominates in Kenya and Ghana, bank transfer in Nigeria and
   * South Africa.
   */
  readonly pollMethod: 'bank_transfer' | 'mobile_money' | 'card' | 'cash_pickup' | 'ussd';
}

const USDC_ISSUER = 'GA5ZSEJYB37JRC5AVCIA5MOP4RHTM335X2KGX3IHOJAPP5RE34K4KZVN';

/** The four target African corridors, plus the one the test anchor can serve. */
export const SEED_CORRIDORS: readonly SeedCorridor[] = [
  { id: 'NG-NGN-USDC-withdraw', country: 'NG', fiat: 'NGN', assetCode: 'USDC', assetIssuer: USDC_ISSUER, direction: 'withdraw', pollMethod: 'bank_transfer' },
  { id: 'NG-NGN-USDC-deposit', country: 'NG', fiat: 'NGN', assetCode: 'USDC', assetIssuer: USDC_ISSUER, direction: 'deposit', pollMethod: 'bank_transfer' },
  { id: 'KE-KES-USDC-withdraw', country: 'KE', fiat: 'KES', assetCode: 'USDC', assetIssuer: USDC_ISSUER, direction: 'withdraw', pollMethod: 'mobile_money' },
  { id: 'GH-GHS-USDC-withdraw', country: 'GH', fiat: 'GHS', assetCode: 'USDC', assetIssuer: USDC_ISSUER, direction: 'withdraw', pollMethod: 'mobile_money' },
  { id: 'ZA-ZAR-USDC-withdraw', country: 'ZA', fiat: 'ZAR', assetCode: 'USDC', assetIssuer: USDC_ISSUER, direction: 'withdraw', pollMethod: 'bank_transfer' },
  // The corridor the SDF test anchor actually serves, so the demo has one live
  // SEP-24 route rather than only mock ones.
  { id: 'US-USD-USDC-withdraw', country: 'US', fiat: 'USD', assetCode: 'USDC', assetIssuer: USDC_ISSUER, direction: 'withdraw', pollMethod: 'bank_transfer' },
];
