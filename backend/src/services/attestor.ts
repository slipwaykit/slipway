/**
 * Writing snapshots to the Soroban attestations contract.
 *
 * Attestation is best effort and always has been. If the RPC is down, if the
 * contract is not deployed, or if the service account has no funds, the poller
 * must still record its snapshot and the API must still answer quotes. Nothing
 * in this file throws into its caller: every failure is logged and swallowed.
 *
 * The service secret is read from configuration, used to sign, and never
 * logged or returned.
 */

import {
  Contract,
  Keypair,
  TransactionBuilder,
  nativeToScVal,
  rpc,
  xdr,
} from '@stellar/stellar-sdk';
import { decimal } from '@slipwaykit/core';
import type { Env } from '../env.js';

/** Fixed point scale for on-chain amounts: 7 decimal places, Stellar convention. */
const SCALE = 7;

/** Soroban `Symbol` holds at most 32 characters. */
const SYMBOL_MAX = 32;

/** What the contract records for one snapshot. */
export interface AttestInput {
  /** Which adapter produced the snapshot. */
  readonly adapterId: string;
  /** Which corridor it was quoting. */
  readonly corridorId: string;
  /** Notional sold, as a decimal string. */
  readonly sellAmount: string;
  /** What would have landed, as a decimal string. `'0'` for a failure. */
  readonly landedAmount: string;
  /** How long the quote took. */
  readonly latencyMs: number;
  /** Whether the adapter answered. */
  readonly success: boolean;
}

/** What came back from a successful write. */
export interface AttestResult {
  /** Hash of the Soroban transaction. */
  readonly txHash: string;
  /** Ledger it was included in, when the RPC reported one. */
  readonly ledger?: number;
}

/** Somewhere to send diagnostics. Swapped out in tests. */
export interface Logger {
  info(message: string, detail?: unknown): void;
  warn(message: string, detail?: unknown): void;
}

/** The subset of `rpc.Server` the attestor calls. Injected in tests. */
export type RpcLike = Pick<
  rpc.Server,
  'getAccount' | 'prepareTransaction' | 'sendTransaction' | 'getTransaction'
>;

const consoleLogger: Logger = {
  info: (message, detail) => console.log(message, detail ?? ''),
  warn: (message, detail) => console.warn(message, detail ?? ''),
};

/**
 * Convert a decimal string into the contract's 7dp fixed point `i128`.
 *
 * Goes through the exact decimal helpers rather than `Number`, so a large
 * naira amount does not lose its last kobo on the way to the ledger.
 *
 * @param value - A decimal string.
 * @returns The value scaled by 10^7.
 *
 * @example
 * ```ts
 * toFixedPoint('156000.25');  // 1560002500000n
 * ```
 */
export function toFixedPoint(value: string): bigint {
  const rounded = decimal.round(value, SCALE);
  const negative = rounded.startsWith('-');
  const digits = (negative ? rounded.slice(1) : rounded).replace('.', '');
  const units = BigInt(digits);
  return negative ? -units : units;
}

/**
 * Make a string safe to use as a Soroban `Symbol`.
 *
 * Symbols allow only `a-z`, `A-Z`, `0-9` and `_`, up to 32 characters, so
 * `sep24:testanchor.stellar.org` has to be rewritten before it can be stored.
 *
 * @param value - Any identifier.
 * @returns A valid symbol, truncated to 32 characters.
 *
 * @example
 * ```ts
 * toSymbolText('sep24:testanchor.stellar.org');  // 'sep24_testanchor_stellar_org'
 * toSymbolText('NG-NGN-USDC-withdraw');          // 'NG_NGN_USDC_withdraw'
 * ```
 */
export function toSymbolText(value: string): string {
  return value.replace(/[^a-zA-Z0-9_]/g, '_').slice(0, SYMBOL_MAX);
}

/**
 * Writes attestations, or does nothing when it is not configured to.
 *
 * @example
 * ```ts
 * const attestor = new Attestor(env);
 * if (attestor.enabled) {
 *   const result = await attestor.attest({ ... });  // undefined on any failure
 * }
 * ```
 */
export class Attestor {
  /** Whether a secret and a contract id were both configured. */
  public readonly enabled: boolean;

  readonly #env: Env;
  readonly #logger: Logger;
  #server: RpcLike | undefined;
  readonly #confirmDelayMs: number;
  #keypair: Keypair | undefined;

  /**
   * @param env - Validated configuration. The secret is read here and nowhere else.
   * @param logger - Where to send diagnostics.
   * @param options - An RPC client and poll delay to inject; tests only.
   *
   * @example
   * ```ts
   * const attestor = new Attestor(loadEnv());
   * ```
   */
  public constructor(
    env: Env,
    logger: Logger = consoleLogger,
    options: { readonly server?: RpcLike; readonly confirmDelayMs?: number } = {},
  ) {
    this.#env = env;
    this.#logger = logger;
    this.#server = options.server;
    this.#confirmDelayMs = options.confirmDelayMs ?? 1000;
    this.enabled =
      env.SLIPWAY_ATTESTOR_SECRET !== undefined &&
      env.SLIPWAY_ATTESTATIONS_CONTRACT !== undefined;

    if (!this.enabled) {
      this.#logger.info(
        '[attestor] disabled: set SLIPWAY_ATTESTOR_SECRET and SLIPWAY_ATTESTATIONS_CONTRACT to turn on on-chain attestation.',
      );
    }
  }

  /**
   * The public key of the service account, for funding and for the contract's
   * `initialize`. Safe to log; the secret it derives from is not.
   *
   * @returns The `G...` address, or `undefined` when no secret is configured.
   *
   * @example
   * ```ts
   * console.log(`fund ${attestor.publicKey()} on testnet`);
   * ```
   */
  public publicKey(): string | undefined {
    const secret = this.#env.SLIPWAY_ATTESTOR_SECRET;
    if (secret === undefined) return undefined;
    this.#keypair ??= Keypair.fromSecret(secret);
    return this.#keypair.publicKey();
  }

  /**
   * Write one attestation, returning `undefined` rather than throwing on any
   * failure.
   *
   * @param input - The snapshot to record.
   * @returns The transaction hash and ledger, or `undefined` if anything failed.
   *
   * @example
   * ```ts
   * const result = await attestor.attest({
   *   adapterId: 'sep24:testanchor.stellar.org',
   *   corridorId: 'US-USD-USDC-withdraw',
   *   sellAmount: '100',
   *   landedAmount: '94.2857',
   *   latencyMs: 412,
   *   success: true,
   * });
   * ```
   */
  public async attest(input: AttestInput): Promise<AttestResult | undefined> {
    if (!this.enabled) return undefined;

    try {
      return await this.#submit(input);
    } catch (error) {
      // Best effort, always. A failed attestation must never cost a snapshot.
      this.#logger.warn('[attestor] attestation failed, continuing', {
        adapterId: input.adapterId,
        corridorId: input.corridorId,
        reason: error instanceof Error ? error.message : String(error),
      });
      return undefined;
    }
  }

  async #submit(input: AttestInput): Promise<AttestResult | undefined> {
    const secret = this.#env.SLIPWAY_ATTESTOR_SECRET;
    const contractId = this.#env.SLIPWAY_ATTESTATIONS_CONTRACT;
    if (secret === undefined || contractId === undefined) return undefined;

    this.#keypair ??= Keypair.fromSecret(secret);
    this.#server ??= new rpc.Server(this.#env.SLIPWAY_SOROBAN_RPC);

    const keypair = this.#keypair;
    const server = this.#server;
    const source = await server.getAccount(keypair.publicKey());

    const attestation = xdr.ScVal.scvMap(
      [
        ['adapter_id', nativeToScVal(toSymbolText(input.adapterId), { type: 'symbol' })],
        ['corridor', nativeToScVal(toSymbolText(input.corridorId), { type: 'symbol' })],
        ['sell_amount', nativeToScVal(toFixedPoint(input.sellAmount), { type: 'i128' })],
        ['landed_amount', nativeToScVal(toFixedPoint(input.landedAmount), { type: 'i128' })],
        ['latency_ms', nativeToScVal(Math.max(0, Math.round(input.latencyMs)), { type: 'u32' })],
        ['success', xdr.ScVal.scvBool(input.success)],
        ['timestamp', nativeToScVal(0n, { type: 'u64' })],
      ]
        // Soroban requires map keys in byte order. `localeCompare` is not byte
        // order: it can reorder punctuation such as `_` by locale.
        .sort(([a], [b]) => (String(a) < String(b) ? -1 : String(a) > String(b) ? 1 : 0))
        .map(
          ([key, value]) =>
            new xdr.ScMapEntry({
              key: xdr.ScVal.scvSymbol(String(key)),
              val: value as xdr.ScVal,
            }),
        ),
    );

    const contract = new Contract(contractId);
    const built = new TransactionBuilder(source, {
      fee: '1000000',
      networkPassphrase: this.#env.SLIPWAY_NETWORK_PASSPHRASE,
    })
      .addOperation(
        contract.call(
          'attest',
          nativeToScVal(keypair.publicKey(), { type: 'address' }),
          attestation,
        ),
      )
      .setTimeout(30)
      .build();

    const prepared = await server.prepareTransaction(built);
    prepared.sign(keypair);

    const sent = await server.sendTransaction(prepared);
    if (sent.status === 'ERROR') {
      throw new Error(`Soroban rejected the transaction: ${JSON.stringify(sent.errorResult)}`);
    }

    // From here the transaction exists on the network whether or not we can
    // read its outcome. Losing the hash would leave an on-chain entry with no
    // local record of it, so a confirmation failure returns the hash with no
    // ledger, which the attestations table already reads as "unconfirmed".
    try {
      const ledger = await this.#awaitConfirmation(server, sent.hash);
      return ledger === undefined ? { txHash: sent.hash } : { txHash: sent.hash, ledger };
    } catch (error) {
      if (error instanceof LedgerFailure) throw error;
      this.#logger.warn('[attestor] sent, but could not confirm; recording as unconfirmed', {
        hash: sent.hash,
        reason: error instanceof Error ? error.message : String(error),
      });
      return { txHash: sent.hash };
    }
  }

  /** Poll for inclusion, giving up rather than blocking the poller indefinitely. */
  async #awaitConfirmation(server: RpcLike, hash: string): Promise<number | undefined> {
    for (let attempt = 0; attempt < 10; attempt += 1) {
      await new Promise((resolve) => setTimeout(resolve, this.#confirmDelayMs));
      const result = await server.getTransaction(hash);
      if (result.status === rpc.Api.GetTransactionStatus.SUCCESS) return result.ledger;
      if (result.status === rpc.Api.GetTransactionStatus.FAILED) {
        // Definitively failed: nothing was written, so there is nothing to record.
        throw new LedgerFailure(`Soroban transaction ${hash} failed on ledger.`);
      }
    }
    this.#logger.warn('[attestor] transaction not confirmed within 10s', { hash });
    return undefined;
  }
}

/** A transaction the network included and rejected, as opposed to one we could not read. */
class LedgerFailure extends Error {}
