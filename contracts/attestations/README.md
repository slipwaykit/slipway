# `slipway-attestations`

A Soroban contract that keeps the most recent 100 quote snapshots per corridor,
so anyone can check what an adapter actually quoted without trusting Slipway's
database.

## Testnet deployment

| | |
| --- | --- |
| Contract | [`CBPHQB7YKLPLM7CZWCWUW6QQOBF77QMOTAHHO3PMP25AW4IXUMMSDFMT`](https://stellar.expert/explorer/testnet/contract/CBPHQB7YKLPLM7CZWCWUW6QQOBF77QMOTAHHO3PMP25AW4IXUMMSDFMT) |
| Admin | `GB3KU5JCMVJOJTL2LITLGJJ3BWEMBXFJS2SLDKMPOM7JWGPKBFA6TEKC` |
| Deployed | 2026-09-15, [tx `5d6d3a6b…`](https://stellar.expert/explorer/testnet/tx/5d6d3a6b8d1701c61e9d9f1698472815153141bfa9ff37301580a1984dd9ac8e) |
| Initialised | [tx `113adc28…`](https://stellar.expert/explorer/testnet/tx/113adc28efc40174bf0075a25869ca766c7fd9a58180febb98e502a3ec7e9579) |
| Network | Testnet, protocol 28 |
| Wasm | 5,420 bytes, soroban-sdk 27.0.6 |

Testnet is reset periodically. If the contract above stops resolving, redeploy
with the steps below and update `SLIPWAY_ATTESTATIONS_CONTRACT`.

## Interface

```rust
initialize(admin: Address)                                   // once; panics with #1 after
attest(admin: Address, a: Attestation)                       // admin only
history(corridor: Symbol) -> Vec<Attestation>                // oldest first, at most 100
latest(corridor: Symbol, adapter_id: Symbol) -> Option<Attestation>
```

Every `attest` publishes an event with topics `("attest", corridor)` and the
attestation as its data.

| Error | Code |
| --- | --- |
| `AlreadyInitialized` | 1 |
| `NotInitialized` | 2 |
| `Unauthorized` — the named admin is not the stored one | 3 |
| `InvalidAmount` — negative amount, or nothing sold | 4 |

Amounts are `i128` fixed point with 7 decimal places: `1000000000` is `100`.

## Decisions worth knowing

- **The ledger sets `timestamp`.** Whatever the caller sends is overwritten
  with `env.ledger().timestamp()`, so an attestation cannot be backdated.
- **Symbols are the corridor id, not a short code.** The backend writes
  `NG_NGN_USDC_withdraw` rather than `NG_NGN`, because collapsing to country and
  currency would merge deposit and withdraw histories into one list.
- **TTL is extended to the network maximum on every write**, for both the
  corridor's entry and the contract instance, so an active corridor is never
  archived.
- **`initialize` can be front-run.** Between `deploy` and `initialize` anyone
  may call `initialize` first and become admin. The testnet deployment above was
  initialised in the next transaction. A `__constructor` taking the admin would
  close this window by setting it atomically at deploy time; `initialize` is
  kept here because the build specification calls for it.

## Build, test, deploy

```bash
cargo test                       # 14 tests
stellar contract build           # target/wasm32v1-none/release/slipway_attestations.wasm

stellar keys generate slipway --network testnet --fund
stellar contract deploy \
  --wasm target/wasm32v1-none/release/slipway_attestations.wasm \
  --source slipway --network testnet
stellar contract invoke --id <CONTRACT_ID> --source slipway --network testnet \
  -- initialize --admin slipway

stellar contract invoke --id <CONTRACT_ID> --source slipway --network testnet \
  -- history --corridor NG_NGN_USDC_withdraw
```

`stellar keys generate --global` no longer exists as of stellar CLI 27; keys
are global by default.
