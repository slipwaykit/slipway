/**
 * SEP-24 `/info` to {@link Capability}.
 *
 * `/info` is the anchor's own description of what it will do. It is also the
 * fallback source of fee data when the anchor runs no SEP-38 quote server, so
 * this module keeps the raw fee fields alongside the mapped capability.
 */

import type { Capability, Direction, PaymentMethod, StellarAsset } from '@slipwaykit/core';
import { asArray, asBoolean, asDecimalString, asRecord, asString } from './json.js';
import type { AnchorToml } from './toml.js';

/**
 * One asset on one side of an anchor, as `/info` describes it.
 *
 * Every amount is a decimal string or absent. Absent means the anchor did not
 * publish the value, which is not the same as zero and must not become zero.
 *
 * @example
 * ```ts
 * const asset: AssetInfo = {
 *   code: 'SRT',
 *   enabled: true,
 *   minAmount: '0.1',
 *   maxAmount: '1000',
 *   feeFixed: '5',
 *   feePercent: '1',
 *   methods: ['bank_transfer'],
 *   rawTypes: ['bank_account'],
 * };
 * ```
 */
export interface AssetInfo {
  /** The asset code as `/info` keys it. */
  readonly code: string;
  /** Whether the anchor currently serves this asset on this side. */
  readonly enabled: boolean;
  /** `min_amount`, as a string, when published. */
  readonly minAmount?: string;
  /** `max_amount`, as a string, when published. */
  readonly maxAmount?: string;
  /** `fee_fixed`, as a string, when published. */
  readonly feeFixed?: string;
  /** `fee_percent`, e.g. `'1.5'` for 1.5%, when published. */
  readonly feePercent?: string;
  /** `fee_minimum`, as a string, when published. */
  readonly feeMinimum?: string;
  /** Recognised payment methods. Empty means the anchor did not constrain the method. */
  readonly methods: readonly PaymentMethod[];
  /** Every `types` key verbatim, including ones that mapped to nothing. */
  readonly rawTypes: readonly string[];
}

/**
 * A parsed SEP-24 `/info` response.
 *
 * @example
 * ```ts
 * const info = parseInfo(body);
 * info.withdraw.get('SRT')?.feePercent;  // '1'
 * ```
 */
export interface AnchorInfo {
  /** Assets the anchor will take fiat for and pay out on Stellar. */
  readonly deposit: ReadonlyMap<string, AssetInfo>;
  /** Assets the anchor will take on Stellar and pay out in fiat. */
  readonly withdraw: ReadonlyMap<string, AssetInfo>;
  /** Whether the anchor advertises its own `/fee` endpoint. */
  readonly feeEndpointEnabled: boolean;
}

/**
 * Map one anchor `types` key onto the closed {@link PaymentMethod} union.
 *
 * Returns `undefined` for anything unrecognised, and the caller drops it.
 * Coercing an unknown method into the nearest member is how a Kenyan user ends
 * up being told to make a bank transfer when the anchor meant M-Pesa.
 *
 * Mobile money is matched before `bank`, so an explicit `mobile_money` is never
 * shadowed by a substring match.
 *
 * @param type - The raw key from `/info`, e.g. `bank_account`.
 * @returns The mapped method, or `undefined` when unrecognised.
 *
 * @example
 * ```ts
 * mapPaymentMethod('bank_account');  // 'bank_transfer'
 * mapPaymentMethod('mpesa');         // 'mobile_money'
 * mapPaymentMethod('carrier_pigeon') // undefined
 * ```
 */
export function mapPaymentMethod(type: string): PaymentMethod | undefined {
  const value = type.toLowerCase();
  if (/momo|mpesa|mobile[\s_-]?money/.test(value)) return 'mobile_money';
  if (value.includes('bank')) return 'bank_transfer';
  if (value.includes('mobile')) return 'mobile_money';
  if (value.includes('card')) return 'card';
  if (value.includes('cash')) return 'cash_pickup';
  if (value.includes('ussd')) return 'ussd';
  return undefined;
}

/** Read `types`, which anchors express as an object of specs or a plain array. */
function readTypes(raw: unknown): readonly string[] {
  const record = asRecord(raw);
  if (record !== undefined) return Object.keys(record);
  const array = asArray(raw);
  if (array !== undefined) {
    return array.map((entry) => asString(entry)).filter((entry): entry is string => entry !== undefined);
  }
  return [];
}

function readAsset(code: string, raw: unknown): AssetInfo | undefined {
  const record = asRecord(raw);
  if (record === undefined) return undefined;

  const rawTypes = readTypes(record['types']);
  const methods = [
    ...new Set(
      rawTypes
        .map(mapPaymentMethod)
        .filter((method): method is PaymentMethod => method !== undefined),
    ),
  ];

  const minAmount = asDecimalString(record['min_amount']);
  const maxAmount = asDecimalString(record['max_amount']);
  const feeFixed = asDecimalString(record['fee_fixed']);
  const feePercent = asDecimalString(record['fee_percent']);
  const feeMinimum = asDecimalString(record['fee_minimum']);

  return {
    code,
    // SEP-24 treats a missing `enabled` as enabled.
    enabled: asBoolean(record['enabled']) ?? true,
    ...(minAmount === undefined ? {} : { minAmount }),
    ...(maxAmount === undefined ? {} : { maxAmount }),
    ...(feeFixed === undefined ? {} : { feeFixed }),
    ...(feePercent === undefined ? {} : { feePercent }),
    ...(feeMinimum === undefined ? {} : { feeMinimum }),
    methods,
    rawTypes,
  };
}

function readSide(raw: unknown): ReadonlyMap<string, AssetInfo> {
  const record = asRecord(raw);
  const assets = new Map<string, AssetInfo>();
  if (record === undefined) return assets;

  for (const [code, value] of Object.entries(record)) {
    const asset = readAsset(code, value);
    if (asset !== undefined) assets.set(code, asset);
  }
  return assets;
}

/**
 * Parse a SEP-24 `/info` body.
 *
 * Tolerant by design: a malformed asset entry is skipped rather than failing
 * the whole anchor, because one broken currency should not hide the other four.
 *
 * @param body - The parsed JSON body of `GET /info`.
 * @returns The deposit and withdraw sides.
 *
 * @example
 * ```ts
 * const info = parseInfo(await response.json());
 * ```
 */
export function parseInfo(body: unknown): AnchorInfo {
  const record = asRecord(body) ?? {};
  const fee = asRecord(record['fee']);
  return {
    deposit: readSide(record['deposit']),
    withdraw: readSide(record['withdraw']),
    feeEndpointEnabled: (fee === undefined ? undefined : asBoolean(fee['enabled'])) ?? false,
  };
}

/**
 * Turn a parsed `/info` into {@link Capability} values for one country and fiat.
 *
 * The country and fiat come from the adapter's configuration rather than from
 * the anchor, because SEP-24 has no field that states which corridor an asset
 * serves. That is a genuine gap in the protocol, not an oversight here.
 *
 * @param info - The parsed `/info`.
 * @param toml - The anchor's resolved `stellar.toml`, for issuer lookup.
 * @param country - The country this adapter was configured for.
 * @param fiat - The fiat currency this adapter was configured for.
 * @returns One capability per enabled asset per direction.
 *
 * @example
 * ```ts
 * const capabilities = toCapabilities(info, toml, 'NG', 'NGN');
 * capabilities.filter((c) => c.direction === 'withdraw');
 * ```
 */
export function toCapabilities(
  info: AnchorInfo,
  toml: AnchorToml,
  country: string,
  fiat: string,
): readonly Capability[] {
  const kycRequired = toml.kycServer !== undefined;
  const capabilities: Capability[] = [];

  const sides: readonly (readonly [Direction, ReadonlyMap<string, AssetInfo>])[] = [
    ['deposit', info.deposit],
    ['withdraw', info.withdraw],
  ];

  for (const [direction, assets] of sides) {
    for (const asset of assets.values()) {
      if (!asset.enabled) continue;

      const issuer = toml.currencies.find((currency) => currency.code === asset.code)?.issuer;
      const stellarAsset: StellarAsset = {
        code: asset.code,
        ...(issuer === undefined ? {} : { issuer }),
      };

      capabilities.push({
        country,
        fiat,
        asset: stellarAsset,
        direction,
        methods: asset.methods,
        // Absent bounds stay absent. A missing min_amount is not a min of zero.
        ...(asset.minAmount === undefined ? {} : { minAmount: asset.minAmount }),
        ...(asset.maxAmount === undefined ? {} : { maxAmount: asset.maxAmount }),
        kycRequired,
      });
    }
  }
  return capabilities;
}
