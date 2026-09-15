# Slipway

A TypeScript adapter kit that lets Stellar applications add fiat on and off
ramps without writing a bespoke integration per provider. African corridors
first: Nigeria (NGN), Kenya (KES), Ghana (GHS), South Africa (ZAR).

> **Status:** core interface, mock and SEP-24 adapters, backend API and poller,
> an attestations contract on testnet, and a frontend that builds and runs
> against them. Not yet deployed. No live anchor serving NGN, KES, GHS or ZAR
> advertises SEP-24 as of 2026-09-15, so those corridors run on labelled mock
> adapters.

## Packages

| Path | What it is |
| --- | --- |
| [`packages/core`](packages/core) | The adapter contract, `RampError`, exact decimal maths, `AdapterRegistry` |
| [`packages/adapters/mock`](packages/adapters/mock) | Deterministic offline adapter |
| [`packages/adapters/sep24`](packages/adapters/sep24) | One adapter for every SEP-24 anchor, driven by home domain |
| [`backend`](backend) | Hono API, corridor poller, attestor |
| [`frontend`](frontend) | Next.js demo: comparison, anchors, corridor history |
| [`contracts/attestations`](contracts/attestations) | Soroban contract recording quote snapshots |

## Attestations contract (testnet)

[`CBPHQB7YKLPLM7CZWCWUW6QQOBF77QMOTAHHO3PMP25AW4IXUMMSDFMT`](https://stellar.expert/explorer/testnet/contract/CBPHQB7YKLPLM7CZWCWUW6QQOBF77QMOTAHHO3PMP25AW4IXUMMSDFMT)

## Deploying

Backend on Railway, frontend on Vercel. See [DEPLOY.md](DEPLOY.md).

## Contributing

Issues are open through Drips Wave and GrantFox. Read [CONTRIBUTING.md](CONTRIBUTING.md) before claiming one.

## Development

```bash
pnpm install
pnpm verify        # typecheck, lint, test — offline, no credentials
cargo test         # contract tests
```
