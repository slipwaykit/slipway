/**
 * Pricing: SEP-38 first, SEP-24 `/info` fees second, `QUOTE_INCOMPLETE` third.
 *
 * The whole point of this module is rule 4. `landedAmount` is what the
 * recipient actually receives, and if an anchor has not disclosed enough to
 * work that out, the honest answer is to refuse to quote. A comparison built on
 * gross amounts ranks the least forthcoming provider first, which is the exact
 * opposite of what Slipway is for.
 */

import { RampError, decimal, type Fee, type StellarAsset } from '@slipwaykit/core';
import { requestJson, type FetchLike } from './errors.js';
import { asArray, asDecimalString, asRecord, asString } from './json.js';
import type { AssetInfo } from './info.js';
import type { AnchorToml } from './toml.js';

/** How long a quote is valid when the anchor does not say. */
const DEFAULT_QUOTE_TTL_MS = 60_000;

/**
 * The priced part of a quote, before the adapter wraps it with request context.
 *
 * The invariant that matters: `buyAmount` minus the sum of `fees` equals
 * `landedAmount`, exactly, in the buy currency. Every code path here maintains
 * it, which is what makes a fee breakdown in the UI add up.
 *
 * @example
 * ```ts
 * const priced: PricedQuote = {
 *   buyAmount: '158000',
 *   landedAmount: '156500',
 *   rate: '1580',
 *   fees: [{ kind: 'fixed', amount: '1500', currency: 'NGN' }],
 *   expiresAt: 1757942400000,
 * };
 * ```
 */
export interface PricedQuote {
  /** Gross amount in the buy currency, at the anchor's headline rate. */
  readonly buyAmount: string;
  /** What the recipient receives, after every entry in {@link PricedQuote.fees}. */
  readonly landedAmount: string;
  /** Headline rate, buy units per sell unit. */
  readonly rate: string;
  /** Every deduction between `buyAmount` and `landedAmount`. */
  readonly fees: readonly Fee[];
  /** Unix epoch milliseconds after which the quote must not be acted on. */
  readonly expiresAt: number;
  /** The anchor's own quote id, when SEP-38 issued one. */
  readonly providerQuoteId?: string;
}

/**
 * Build a SEP-38 asset identifier for a Stellar asset.
 *
 * A malformed asset string is the most common way a SEP-38 integration fails,
 * and it fails as an opaque 400 from the anchor. So this refuses to build one it
 * is not sure about rather than sending a guess.
 *
 * @param asset - The Stellar asset.
 * @returns `stellar:CODE:ISSUER`, or `stellar:native` for XLM.
 * @throws A `RampError` with `QUOTE_INCOMPLETE` when a non-native asset has no issuer.
 *
 * @example
 * ```ts
 * toSep38StellarAsset({ code: 'USDC', issuer: 'GBBD47IF6LWK...' });
 * // 'stellar:USDC:GBBD47IF6LWK...'
 * toSep38StellarAsset({ code: 'XLM' });
 * // 'stellar:native'
 * ```
 */
export function toSep38StellarAsset(asset: StellarAsset): string {
  const isNative = asset.code === 'XLM' || asset.code.toLowerCase() === 'native';
  if (asset.issuer === undefined) {
    if (isNative) return 'stellar:native';
    throw new RampError(
      'QUOTE_INCOMPLETE',
      `Cannot build a SEP-38 asset identifier for ${asset.code}: the anchor's stellar.toml lists no issuer for it.`,
    );
  }
  return `stellar:${asset.code}:${asset.issuer}`;
}

/**
 * Build a SEP-38 asset identifier for a fiat currency.
 *
 * @param fiat - An ISO 4217 code.
 * @returns `iso4217:CODE`.
 * @throws A `RampError` with `QUOTE_INCOMPLETE` when the code is not three letters.
 *
 * @example
 * ```ts
 * toSep38FiatAsset('NGN');  // 'iso4217:NGN'
 * ```
 */
export function toSep38FiatAsset(fiat: string): string {
  const code = fiat.trim().toUpperCase();
  if (!/^[A-Z]{3}$/.test(code)) {
    throw new RampError(
      'QUOTE_INCOMPLETE',
      `Cannot build a SEP-38 asset identifier for ${JSON.stringify(fiat)}: not an ISO 4217 code.`,
    );
  }
  return `iso4217:${code}`;
}

/** Read the `fee` object of a SEP-38 response into per-detail amounts. */
function readSep38Fees(
  raw: unknown,
  buyAsset: string,
  buyCurrency: string,
): { readonly fees: readonly Fee[]; readonly total: string } {
  const fee = asRecord(raw);
  if (fee === undefined) return { fees: [], total: '0' };

  // `fee.asset` says which side the fee is charged on. Only fees denominated in
  // the buy asset come out of what the recipient receives; a fee on the sell
  // side is already reflected in the anchor's buy_amount.
  const feeAsset = asString(fee['asset']);
  if (feeAsset !== undefined && feeAsset !== buyAsset) return { fees: [], total: '0' };

  const details = asArray(fee['details']);
  const fees: Fee[] = [];

  if (details !== undefined && details.length > 0) {
    for (const entry of details) {
      const record = asRecord(entry);
      if (record === undefined) continue;
      const amount = asDecimalString(record['amount']);
      if (amount === undefined || decimal.cmp(amount, '0') === 0) continue;
      const name = asString(record['name']);
      const description = asString(record['description']);
      const label = [name, description].filter((part) => part !== undefined).join(' — ');
      fees.push({
        kind: 'provider',
        amount,
        currency: buyCurrency,
        ...(label === '' ? {} : { description: label }),
      });
    }
  } else {
    // No breakdown, only a total. Still a real deduction, so still reported.
    const total = asDecimalString(fee['total']);
    if (total !== undefined && decimal.cmp(total, '0') > 0) {
      fees.push({
        kind: 'provider',
        amount: total,
        currency: buyCurrency,
        description: 'Anchor fee',
      });
    }
  }

  return { fees, total: decimal.sum(fees.map((entry) => entry.amount)) };
}

/** What {@link priceViaSep38} needs. */
export interface Sep38PriceOptions {
  /** The anchor's `ANCHOR_QUOTE_SERVER`, trailing slash stripped. */
  readonly quoteServer: string;
  /** SEP-38 identifier of the asset being sold. */
  readonly sellAsset: string;
  /** SEP-38 identifier of the asset being bought. */
  readonly buyAsset: string;
  /** Amount being sold, as a decimal string. */
  readonly sellAmount: string;
  /** Display currency for fees: the fiat code or the Stellar asset code. */
  readonly buyCurrency: string;
  /** ISO 3166-1 alpha-2 country, sent as `country_code`. */
  readonly country: string;
  /** The `fetch` to use. */
  readonly fetchImpl: FetchLike;
  /** Clock, for the fallback expiry. */
  readonly now: () => number;
  /** A SEP-10 token, when the anchor requires one on `/price`. */
  readonly token?: string;
}

/**
 * Price a route with SEP-38 `GET /price`.
 *
 * `landedAmount` is the anchor's `buy_amount` less every fee detail denominated
 * in the buy asset. The gap between the anchor's `price` (its rate before fees)
 * and `total_price` (its rate after them) is reported as a `spread` fee, so a
 * user can see the cost that an anchor advertising "no fees" has folded into
 * its rate.
 *
 * @param options - Endpoint, assets, amount and injected dependencies.
 * @returns The priced quote.
 * @throws A `RampError` with `QUOTE_INCOMPLETE` when the response lacks a
 * `buy_amount`, or a transport code from {@link requestJson}.
 *
 * @example
 * ```ts
 * const priced = await priceViaSep38({
 *   quoteServer: 'https://testanchor.stellar.org/sep38',
 *   sellAsset: 'stellar:USDC:GBBD47IF6LWK...',
 *   buyAsset: 'iso4217:NGN',
 *   sellAmount: '100',
 *   buyCurrency: 'NGN',
 *   country: 'NG',
 *   fetchImpl: fetch,
 *   now: () => Date.now(),
 * });
 * ```
 */
export async function priceViaSep38(options: Sep38PriceOptions): Promise<PricedQuote> {
  const query = new URLSearchParams({
    sell_asset: options.sellAsset,
    buy_asset: options.buyAsset,
    sell_amount: options.sellAmount,
    context: 'sep24',
    country_code: options.country,
  });
  const url = `${options.quoteServer}/price?${query.toString()}`;

  const body = await requestJson({
    url,
    context: 'SEP-38 GET /price',
    fetchImpl: options.fetchImpl,
    ...(options.token === undefined ? {} : { token: options.token }),
  });

  const record = asRecord(body);
  const buyAmount = record === undefined ? undefined : asDecimalString(record['buy_amount']);
  if (record === undefined || buyAmount === undefined) {
    throw new RampError(
      'QUOTE_INCOMPLETE',
      'SEP-38 /price returned no buy_amount, so the landed amount cannot be computed.',
      { providerDetail: body },
    );
  }

  const price = asDecimalString(record['price']);
  const totalPrice = asDecimalString(record['total_price']);
  const sellAmount = asDecimalString(record['sell_amount']) ?? options.sellAmount;

  const { fees: buyFees, total: buyFeeTotal } = readSep38Fees(
    record['fee'],
    options.buyAsset,
    options.buyCurrency,
  );

  // Rule 4: what the recipient receives.
  const landedAmount = decimal.sub(buyAmount, buyFeeTotal);
  if (decimal.isNegative(landedAmount)) {
    throw new RampError(
      'AMOUNT_OUT_OF_BOUNDS',
      `Anchor fees of ${buyFeeTotal} ${options.buyCurrency} exceed the ${buyAmount} ${options.buyCurrency} it offered.`,
      { providerDetail: body },
    );
  }

  // The gross is what the headline rate alone would have produced. Anything
  // between that and buy_amount is the anchor's spread.
  const gross =
    price !== undefined && decimal.cmp(price, '0') > 0
      ? decimal.div(sellAmount, price, 10)
      : buyAmount;
  const spread = decimal.sub(gross, buyAmount);
  const hasSpread = decimal.cmp(spread, '0') > 0;

  const fees: Fee[] = [];
  if (hasSpread) {
    fees.push({
      kind: 'spread',
      amount: spread,
      currency: options.buyCurrency,
      description:
        totalPrice === undefined
          ? 'Difference between the anchor’s headline rate and the rate it offered'
          : `Difference between the anchor’s headline rate (${price}) and its effective rate (${totalPrice})`,
    });
  }
  fees.push(...buyFees);

  // buyAmount − Σfees === landedAmount, by construction.
  const buyAmountGross = hasSpread ? gross : buyAmount;

  const expiresAt = readExpiry(record['expires_at']) ?? options.now() + DEFAULT_QUOTE_TTL_MS;
  const providerQuoteId = asString(record['id']);

  return {
    buyAmount: buyAmountGross,
    landedAmount,
    rate: decimal.div(buyAmountGross, sellAmount, 10),
    fees,
    expiresAt,
    ...(providerQuoteId === undefined ? {} : { providerQuoteId }),
  };
}

/** Read a SEP-38 ISO 8601 `expires_at`, ignoring anything unparseable. */
function readExpiry(raw: unknown): number | undefined {
  const value = asString(raw);
  if (value === undefined) return undefined;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : undefined;
}

/** What {@link priceViaInfo} needs. */
export interface InfoPriceOptions {
  /** The `/info` entry for the asset on the relevant side. */
  readonly asset: AssetInfo;
  /** The anchor's resolved `stellar.toml`, used to check the asset's peg. */
  readonly toml: AnchorToml;
  /** The fiat currency configured for this adapter. */
  readonly fiat: string;
  /** Amount being sold, as a decimal string. */
  readonly sellAmount: string;
  /** Display currency for fees. */
  readonly buyCurrency: string;
  /** Clock, for the expiry. */
  readonly now: () => number;
}

/**
 * Whether a `/info`-only price is even possible for this asset.
 *
 * `/info` publishes fees but no exchange rate, so this path can only price a
 * route where the rate is known to be one: an anchor's own fiat-backed token
 * against the fiat it is backed by. For USDC to NGN with no quote server there
 * is no honest number to return.
 */
function isPeggedToFiat(asset: AssetInfo, toml: AnchorToml, fiat: string): boolean {
  if (asset.code.toUpperCase() === fiat.toUpperCase()) return true;
  const currency = toml.currencies.find((entry) => entry.code === asset.code);
  return (
    currency?.isAssetAnchored === true &&
    currency.anchorAsset?.toUpperCase() === fiat.toUpperCase()
  );
}

/**
 * Price a route from SEP-24 `/info` fees alone.
 *
 * Only usable when the Stellar asset is pegged one-to-one to the fiat, because
 * `/info` carries no rate. Throws `QUOTE_INCOMPLETE` rather than assuming a
 * rate, and throws it again when the anchor published no fee fields at all —
 * treating "the anchor said nothing about fees" as "the anchor charges nothing"
 * is exactly the guess rule 4 forbids.
 *
 * @param options - Asset info, peg context, amount and clock.
 * @returns The priced quote.
 * @throws A `RampError` with `QUOTE_INCOMPLETE` or `AMOUNT_OUT_OF_BOUNDS`.
 *
 * @example
 * ```ts
 * const priced = priceViaInfo({
 *   asset: info.withdraw.get('NGNC')!,
 *   toml,
 *   fiat: 'NGN',
 *   sellAmount: '100',
 *   buyCurrency: 'NGN',
 *   now: () => Date.now(),
 * });
 * ```
 */
export function priceViaInfo(options: InfoPriceOptions): PricedQuote {
  const { asset, toml, fiat, sellAmount, buyCurrency } = options;

  if (!isPeggedToFiat(asset, toml, fiat)) {
    throw new RampError(
      'QUOTE_INCOMPLETE',
      `${toml.homeDomain} runs no SEP-38 quote server, and ${asset.code} is not pegged to ${fiat}, so there is no rate to price this with. Refusing to guess.`,
    );
  }

  const hasAnyFeeField =
    asset.feeFixed !== undefined ||
    asset.feePercent !== undefined ||
    asset.feeMinimum !== undefined;
  if (!hasAnyFeeField) {
    throw new RampError(
      'QUOTE_INCOMPLETE',
      `${toml.homeDomain} published neither fee_fixed nor fee_percent for ${asset.code} and runs no SEP-38 quote server, so the landed amount cannot be computed honestly.`,
    );
  }

  // Pegged one to one, so the gross in the buy currency is the sell amount.
  const buyAmount = sellAmount;
  const fees: Fee[] = [];

  if (asset.feePercent !== undefined && decimal.cmp(asset.feePercent, '0') > 0) {
    fees.push({
      kind: 'percent',
      amount: decimal.round(
        decimal.mul(buyAmount, decimal.div(asset.feePercent, '100', 12)),
        7,
      ),
      currency: buyCurrency,
      description: `${asset.feePercent}% anchor fee`,
    });
  }
  if (asset.feeFixed !== undefined && decimal.cmp(asset.feeFixed, '0') > 0) {
    fees.push({
      kind: 'fixed',
      amount: asset.feeFixed,
      currency: buyCurrency,
      description: 'Flat anchor fee',
    });
  }

  // fee_minimum is a floor on the total, not another charge on top of it.
  if (asset.feeMinimum !== undefined) {
    const charged = decimal.sum(fees.map((fee) => fee.amount));
    if (decimal.cmp(charged, asset.feeMinimum) < 0) {
      fees.push({
        kind: 'fixed',
        amount: decimal.sub(asset.feeMinimum, charged),
        currency: buyCurrency,
        description: `Top up to the anchor’s ${asset.feeMinimum} ${buyCurrency} minimum fee`,
      });
    }
  }

  const landedAmount = decimal.sub(buyAmount, decimal.sum(fees.map((fee) => fee.amount)));
  if (decimal.isNegative(landedAmount)) {
    throw new RampError(
      'AMOUNT_OUT_OF_BOUNDS',
      `Anchor fees exceed the ${sellAmount} ${buyCurrency} being sent, so nothing would land.`,
    );
  }

  return {
    buyAmount: decimal.normalise(buyAmount),
    landedAmount,
    rate: '1',
    fees,
    expiresAt: options.now() + DEFAULT_QUOTE_TTL_MS,
  };
}
