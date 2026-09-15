# Slipway backend

A Hono API and a scheduled poller. Not published to npm.

This process exists for the three things a browser cannot do:

1. Fetch an anchor's `stellar.toml` across origins.
2. Poll corridors on a schedule and keep the history.
3. Sign attestation writes to the Soroban contract.

Everything else the frontend could do by calling the adapters itself.

## Running it

```bash
cp .env.example .env          # .env is gitignored
pnpm --filter backend dev
curl "http://localhost:8787/api/quotes?country=NG&fiat=NGN&direction=withdraw&amount=100&method=bank_transfer"
```

## Endpoints

| Route | What it does |
| --- | --- |
| `GET /api/health` | Status and a **redacted** view of the configuration. |
| `GET /api/quotes` | Quote every adapter. `country`, `fiat`, `direction`, `amount`, `method` required; `asset` and `issuer` optional. |
| `GET /api/anchors` | Known anchors with provenance and health. `?live=true` also reads each anchor's `/info`. |
| `GET /api/corridors` | Supported corridors. |
| `GET /api/corridors/:id/history?days=7` | Snapshot history, failures included. |

`GET /api/quotes` returns **200 even when every adapter fails**. Adapter
failures are data, under `errors`, each with a `RampErrorCode`. One failing
anchor never fails the request.

Invalid query parameters return a `400` with a machine-readable body:

```json
{
  "error": {
    "code": "INVALID_REQUEST",
    "message": "One or more query parameters are invalid.",
    "issues": [{ "path": "amount", "message": "must be a decimal string, e.g. \"100.50\"" }]
  }
}
```

## The poller

Every fifteen minutes (`SLIPWAY_POLL_CRON`) it quotes a fixed notional
(`SLIPWAY_POLL_NOTIONAL`, default 100) across every adapter on every corridor
and records what happened — **including the failures**, because a landed-amount
chart that hides the runs where an anchor was down makes an unreliable anchor
look good. Each corridor runs in its own try/catch, so one bad corridor cannot
stop the rest.

Successful snapshots are handed to the attestor. If that fails, it is logged and
the run continues; attestation is best effort and never blocks a quote.

## Attestation

Set `SLIPWAY_ATTESTOR_SECRET` and `SLIPWAY_ATTESTATIONS_CONTRACT` and each
successful snapshot is written to the [attestations contract](../contracts/attestations)
on testnet. Verified end to end on 2026-09-15: one poll of the Kenyan corridor
produced two snapshots, two on-chain attestations, and two rows in the
`attestations` table carrying their ledger numbers.

A row with a `tx_hash` but no `ledger` means the transaction was sent but its
outcome could not be read back. That is recorded rather than dropped, because
the entry may well exist on chain.

## Anchor health

`lastError` records only codes that mean the anchor could not be **reached** —
`PROVIDER_UNAVAILABLE` and `RATE_LIMITED`. An `UNSUPPORTED_ROUTE` means the
anchor answered perfectly well and does not serve that corridor, which is not a
health problem; recording it as one would paint every anchor red the moment it
was asked about somebody else's corridor.

## The secret

`SLIPWAY_ATTESTOR_SECRET` is read in [`src/env.ts`](src/env.ts) and used only by
[`src/services/attestor.ts`](src/services/attestor.ts). It is never logged, never
returned by any endpoint, and **the app refuses to start when `NODE_ENV=production`
without it**. `describeEnv` reports whether it is set, never what it is; that is
what `/api/health` serves and what startup logs print.

## What the seeded anchors actually do

Checked by fetching each `stellar.toml` on **2026-09-15**. The full evidence is
in [`src/services/anchors.seed.ts`](src/services/anchors.seed.ts).

| Anchor | Protocol | State |
| --- | --- | --- |
| `testanchor.stellar.org` | SEP-24 | Reachable. Its SEP-38 rejects `context=sep24`, so quotes return `PROVIDER_REJECTED`. |
| `stellar.moneygram.com` | SEP-24 | Reachable. Publishes `fee_fixed: 0` with `fee.enabled: true`, and serves a 500 on `GET /fee`, so Slipway returns `QUOTE_INCOMPLETE` rather than reporting the transfer as free. |
| `mykobo.co` | SEP-24 | TOML resolves, but the transfer server it points at (`stellar.mykobo.co`) had no DNS record. `PROVIDER_UNAVAILABLE`, retryable. |
| `anclap.com` | SEP-24 | Reachable, serves ARS and PEN. |
| `cowrie.exchange` | **SEP-6** | Nigeria's main Stellar anchor. Advertises `TRANSFER_SERVER` but not `TRANSFER_SERVER_SEP0024`, so `Sep24Adapter` cannot serve it. |

**No live anchor serving NGN, KES, GHS or ZAR advertises SEP-24 as of
2026-09-15.** The African corridors are demonstrated with clearly-labelled mock
adapters whose ids begin `mock:` and which every API response flags with
`isMock: true`. Those rates are illustrative and are not market data.

## Database

SQLite through better-sqlite3 and Drizzle. Four tables, created at startup by
plain `CREATE TABLE IF NOT EXISTS` — four tables do not justify a migration
toolchain. Every money column is `TEXT`, never `REAL`: SQLite's `REAL` is a
double, and rounding a landed amount at the storage layer would undo the
exactness the rest of the library preserves.

## Tests

```bash
pnpm --filter backend test
```

55 tests over an in-memory database and mock adapters. No file is opened, no
cron job is scheduled and no anchor is contacted.
