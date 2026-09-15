/**
 * SEP-1 resolution: turn a home domain into the endpoints an anchor exposes.
 *
 * This is what lets one `Sep24Adapter` class serve every SEP-24 anchor. The
 * only thing a caller configures is a domain; everything else is discovered.
 */

import { RampError } from '@slipwaykit/core';
import { parse as parseToml } from 'smol-toml';
import { requestJson, type FetchLike } from './errors.js';
import { asArray, asBoolean, asRecord, asString } from './json.js';

/** One entry from the `[[CURRENCIES]]` array of a `stellar.toml`. */
export interface TomlCurrency {
  /** Asset code, e.g. `USDC`. */
  readonly code: string;
  /** Issuing account. Absent for the native asset. */
  readonly issuer?: string;
  /** The anchor's own lifecycle marker: `live`, `test`, `private` or `dead`. */
  readonly status?: string;
  /** Whether the anchor claims the asset is backed by an off-chain reserve. */
  readonly isAssetAnchored?: boolean;
  /** What it is anchored to, e.g. `NGN`, when the anchor says. */
  readonly anchorAsset?: string;
}

/**
 * The parts of a `stellar.toml` that Slipway acts on.
 *
 * @example
 * ```ts
 * const toml: AnchorToml = {
 *   homeDomain: 'testanchor.stellar.org',
 *   transferServer: 'https://testanchor.stellar.org/sep24',
 *   webAuthEndpoint: 'https://testanchor.stellar.org/auth',
 *   quoteServer: 'https://testanchor.stellar.org/sep38',
 *   kycServer: 'https://testanchor.stellar.org/sep12',
 *   currencies: [{ code: 'SRT', issuer: 'GCDN...' }],
 *   orgName: 'Stellar Development Foundation',
 * };
 * ```
 */
export interface AnchorToml {
  /** The domain this was resolved from. */
  readonly homeDomain: string;
  /** `TRANSFER_SERVER_SEP0024`, trailing slash stripped. */
  readonly transferServer: string;
  /** `WEB_AUTH_ENDPOINT`, where the consuming application gets its SEP-10 token. */
  readonly webAuthEndpoint?: string;
  /** `ANCHOR_QUOTE_SERVER`, the SEP-38 base URL, when the anchor runs one. */
  readonly quoteServer?: string;
  /** `KYC_SERVER`, the SEP-12 base URL, when the anchor runs one. */
  readonly kycServer?: string;
  /** Every `[[CURRENCIES]]` entry that named a code. */
  readonly currencies: readonly TomlCurrency[];
  /** `DOCUMENTATION.ORG_NAME`, used as the adapter's display name. */
  readonly orgName?: string;
}

/** Strip a trailing slash so `${base}/info` never becomes `${base}//info`. */
function trimSlash(url: string): string {
  return url.replace(/\/+$/, '');
}

/**
 * A TOML problem is always the same error: this anchor cannot be used right
 * now. Only `retryable` differs, and it differs for a reason — see
 * {@link fetchAnchorToml}.
 */
function tomlError(message: string, retryable: boolean, detail?: unknown): RampError {
  return new RampError('PROVIDER_UNAVAILABLE', message, {
    retryable,
    ...(detail === undefined ? {} : { providerDetail: detail }),
  });
}

function readCurrencies(raw: unknown): readonly TomlCurrency[] {
  const entries = asArray(raw) ?? [];
  const currencies: TomlCurrency[] = [];

  for (const entry of entries) {
    const record = asRecord(entry);
    const code = record === undefined ? undefined : asString(record['code']);
    if (record === undefined || code === undefined) continue;

    const issuer = asString(record['issuer']);
    const status = asString(record['status']);
    const isAssetAnchored = asBoolean(record['is_asset_anchored']);
    const anchorAsset = asString(record['anchor_asset']);

    currencies.push({
      code,
      ...(issuer === undefined ? {} : { issuer }),
      ...(status === undefined ? {} : { status }),
      ...(isAssetAnchored === undefined ? {} : { isAssetAnchored }),
      ...(anchorAsset === undefined ? {} : { anchorAsset }),
    });
  }
  return currencies;
}

/**
 * Fetch and parse `https://{homeDomain}/.well-known/stellar.toml`.
 *
 * Three failures are possible and they are not equally worth retrying. An
 * unreachable or unparseable TOML is transient, so it is `retryable`. A TOML
 * that parses but advertises no SEP-24 transfer server is a permanent fact
 * about that domain, so it is not — a poller that retries it every fifteen
 * minutes forever is just noise.
 *
 * @param homeDomain - The anchor's home domain, with no scheme, e.g. `testanchor.stellar.org`.
 * @param fetchImpl - The `fetch` to use. Tests inject a fixture here.
 * @returns The fields Slipway acts on.
 * @throws A `RampError` with `PROVIDER_UNAVAILABLE`.
 *
 * @example
 * ```ts
 * const toml = await fetchAnchorToml('testanchor.stellar.org', fetch);
 * toml.transferServer;  // 'https://testanchor.stellar.org/sep24'
 * ```
 */
export async function fetchAnchorToml(
  homeDomain: string,
  fetchImpl: FetchLike,
): Promise<AnchorToml> {
  const domain = trimSlash(homeDomain.trim()).replace(/^https?:\/\//, '');
  if (domain === '') {
    throw tomlError('No home domain was configured for this anchor.', false);
  }

  const url = `https://${domain}/.well-known/stellar.toml`;
  const text = await requestJson({
    url,
    context: `GET ${url}`,
    fetchImpl,
    as: 'text',
  });

  if (typeof text !== 'string' || text.trim() === '') {
    throw tomlError(`${domain} served an empty stellar.toml.`, true, text);
  }

  let parsed: Record<string, unknown>;
  try {
    parsed = parseToml(text) as Record<string, unknown>;
  } catch (error) {
    throw tomlError(
      `${domain} served a stellar.toml that is not valid TOML.`,
      true,
      error instanceof Error ? error.message : String(error),
    );
  }

  const transferServer = asString(parsed['TRANSFER_SERVER_SEP0024']);
  if (transferServer === undefined) {
    // Not retryable: the domain is reachable and simply does not do SEP-24.
    throw tomlError(
      `${domain} publishes a stellar.toml but no TRANSFER_SERVER_SEP0024, so it does not support SEP-24.`,
      false,
      Object.keys(parsed),
    );
  }

  const webAuthEndpoint = asString(parsed['WEB_AUTH_ENDPOINT']);
  const quoteServer = asString(parsed['ANCHOR_QUOTE_SERVER']);
  const kycServer = asString(parsed['KYC_SERVER']);
  const documentation = asRecord(parsed['DOCUMENTATION']);
  const orgName = documentation === undefined ? undefined : asString(documentation['ORG_NAME']);

  return {
    homeDomain: domain,
    transferServer: trimSlash(transferServer),
    ...(webAuthEndpoint === undefined ? {} : { webAuthEndpoint: trimSlash(webAuthEndpoint) }),
    ...(quoteServer === undefined ? {} : { quoteServer: trimSlash(quoteServer) }),
    ...(kycServer === undefined ? {} : { kycServer: trimSlash(kycServer) }),
    currencies: readCurrencies(parsed['CURRENCIES']),
    ...(orgName === undefined ? {} : { orgName }),
  };
}
