# feat: slipway mvp — sep-24 adapter, backend, soroban attestations and demo frontend

No linked issue: this is the initial implementation that later issues will build on.

## 1. Summary

Slipway lets a Stellar application add fiat on and off ramps without writing a
bespoke integration per provider. This change delivers the first working slice,
aimed at African corridors (NGN, KES, GHS, ZAR):

- **One SEP-24 adapter for every anchor**, driven only by a home domain through
  SEP-1, pricing through SEP-38, and refusing to quote rather than guess when an
  anchor doesn't disclose its fees.
- **A backend** that compares every provider on a corridor, polls corridors every
  15 minutes, and records the results, failures included.
- **A Soroban contract on testnet** that attests those results on-chain, so no
  one has to trust Slipway's database.
- **A demo frontend** ranking providers by what the recipient actually receives,
  never by the rate they advertise.

---

## 2. Type of change

- [x] 🔌 New adapter (`@slipwaykit/adapter-sep24`, `@slipwaykit/adapter-mock`)
- [x] 👌 Enhancement (core contract, backend, contract, frontend)
- [x] 📝 Documentation (README, DEPLOY, CONTRIBUTING, fixture provenance)
- [ ] 🐛 Bug fix
- [ ] 💥 Breaking change: nothing existed before this

**Areas:** `core` · `adapter-sep24` · `adapter-mock` · `backend` · `contracts` · `frontend` · `docs`

---

## 3. What changed

### `packages/core`: the adapter contract

- `RampAdapter`, `Capability`, `Quote`, `Transaction` and a closed `RampErrorCode` union.
- **Money is a decimal string at every boundary**, with exact bigint-backed
  arithmetic (`decimal.add`, `sub`, `mul`, `div`, `cmp`, `round`), so rate maths
  on a 1,580 NGN/USD corridor cannot accumulate floating point error.
- **Authentication is an `AuthContext` bearer token** from the application's own
  SEP-10 or SEP-45 flow. No code path accepts a secret key.
- `AdapterRegistry.quoteAll` quotes every adapter concurrently, returns failures
  as data, and **sorts by `landedAmount`, not rate**.

### `packages/adapters/sep24`: every SEP-24 anchor from a home domain

| Stellar standard | Used for |
| --- | --- |
| SEP-1 `stellar.toml` | Discovering `TRANSFER_SERVER_SEP0024`, `ANCHOR_QUOTE_SERVER`, `KYC_SERVER`, `WEB_AUTH_ENDPOINT`, `[[CURRENCIES]]` |
| SEP-24 `/info` | Capabilities, bounds, payment methods, fallback fee data |
| SEP-38 `GET /price` | Rates, fees and spread, using `stellar:CODE:ISSUER` and `iso4217:XXX` asset identifiers |
| SEP-24 interactive and `/transaction` | Starting a ramp and polling it |
| SEP-12 `/customer` | Verification state and outstanding fields |

- **Honest landed amounts.** A fee in the buy asset is subtracted; a fee in the
  sell asset is already inside `buy_amount` and is not subtracted twice. The gap
  between `price` and `total_price` surfaces as a `spread` fee. On every path,
  `buyAmount − Σfees === landedAmount` exactly.
- **`QUOTE_INCOMPLETE` instead of a guess** when there is no quote server and no
  one-to-one peg, when `/info` publishes no fee fields, or when it advertises
  `fee.enabled: true`.
- Every HTTP status maps through one table; a SEP-12 `403` is told apart from a
  SEP-10 `403`; every request has a 10-second timeout; an unknown transaction
  status maps to `pending_provider` rather than crashing a poll loop.

### `backend`: Hono API, poller, attestor

- `GET /api/quotes` returns **200 even when every adapter fails**, with failures
  under `errors`. One unreachable anchor never fails a request.
- `GET /api/anchors`, `GET /api/corridors`, `GET /api/corridors/:id/history`.
- Zod-validated queries with machine-readable `400` bodies.
- A `node-cron` poller that records successes **and** failures, with each
  corridor isolated in its own try/catch.
- **The seed list was verified by fetching each anchor's `stellar.toml`**, and
  every entry records its source and the date checked.
- `SLIPWAY_ATTESTOR_SECRET` is read in one place, never logged, never served,
  and **the app refuses to start in production without it**.

### `contracts/attestations`: Soroban

- `initialize`, admin-only `attest`, and open `history` and `latest` reads.
- `i128` amounts with 7 decimal places; the most recent 100 entries per corridor.
- **The ledger sets each timestamp**, so an entry cannot be backdated.
- Persistent and instance TTL extended to the network maximum on every write.
- `#[contractevent]` topics `("attest", corridor)`, per soroban-sdk 27.

### `frontend`: Next.js demo

- `/` corridor picker and live comparison, `/anchors`, `/corridors/[id]`.
- Landed amount is the headline figure; amounts are truncated, never rounded up.
- Quotes count down and cannot be selected once expired.
- Providers that didn't quote stay visible in a muted section; demo rates are
  labelled on every card.
- Chart gaps mark outages rather than bridging them; a legend and a table view
  are included; a single exported `ERROR_MESSAGES` map holds all user-facing copy.
- Built for low-end Android: system fonts, native selects, 44px touch targets.

### Deployment and contribution

- `backend/Dockerfile` and `railway.toml` (Railway, with a volume at `/data`) and
  `frontend/vercel.json` (Vercel, filtered install); steps in `DEPLOY.md`.
- `CONTRIBUTING.md` aligned with Drips Wave and GrantFox, plus
  `.github/pull_request_template.md`.
- CI runs `pnpm verify` on every push.

---

## 4. Evidence before

The repository was empty: no commits, an empty `origin`, and `@slipwaykit/core`
unpublished.

---

## 5. Evidence after

### Tests

```text
pnpm verify    259 passed   typecheck, lint and tests; offline, no credentials
cargo test      14 passed   contracts/attestations
```

- The suite replaces the global `fetch` with a stub that throws, so a test that
  reaches the network fails rather than quietly passing.
- CI on GitHub: [run 35027437435](https://github.com/slipwaykit/slipway/actions/runs/35027437435), **success**.

### Stellar testnet (protocol 28)

| What | Link |
| --- | --- |
| Attestations contract | [`CBPHQB7Y…SDFMT`](https://stellar.expert/explorer/testnet/contract/CBPHQB7YKLPLM7CZWCWUW6QQOBF77QMOTAHHO3PMP25AW4IXUMMSDFMT) |
| Deploy | [tx `5d6d3a6b…`](https://stellar.expert/explorer/testnet/tx/5d6d3a6b8d1701c61e9d9f1698472815153141bfa9ff37301580a1984dd9ac8e), ledger 4,695,229 |
| First attestation written by the backend | [tx `cc93fbc7…`](https://stellar.expert/explorer/testnet/tx/cc93fbc70d0a35c57d53bff1f8c1e613fe9207f1dd8133a34311b2f4a5eb35b6), ledger 4,695,269 |
| Attestation after the SDK upgrade | [tx `b232ac11…`](https://stellar.expert/explorer/testnet/tx/b232ac11087960dbd010586fd1a9a7912549b0637ee6ffa3b37518e4e2534a3c), ledger 4,695,661 |

- End to end: one poll of the Kenyan corridor produced two quotes, two on-chain
  attestations, and two database rows carrying their ledger numbers.
- Reading them back from the contract returned the exact fixed-point amounts.

### SEP-38 maths against a live anchor

A recorded response from `testanchor.stellar.org`: selling 100 USDC with a
1.00 USDC sell-side fee at `price` 1.0500001591 gives
`(100 − 1.00) / 1.0500001591 = 94.2857`, which matches the anchor's
`buy_amount` exactly and confirms the fee is not double-counted.

### Frontend

On the production build, in headless Chromium at **360px** with mobile emulation,
against real poll data:

- No horizontal overflow on any page.
- Tab order is sensible and every stop has a visible focus outline.
- Keyboard selection and fee disclosure both work.
- After 60 seconds, expired quotes are disabled and the change is announced.

### What live SEP-24 anchors actually return (checked 2026-09-15)

| Anchor | Result | Why |
| --- | --- | --- |
| `testanchor.stellar.org` | `PROVIDER_REJECTED` | Its SEP-38 rejects `context=sep24` (only `sep6` and `sep31` are accepted) |
| `stellar.moneygram.com` | `QUOTE_INCOMPLETE` | Publishes `fee_fixed: 0` with `fee.enabled: true`, and `GET /fee` answers 500 |
| `mykobo.co` | `PROVIDER_UNAVAILABLE` | Its TOML points at `stellar.mykobo.co`, which has no DNS record |
| `anclap.com` | Answers | Serves ARS and PEN |
| `cowrie.exchange` | Not served | Nigeria's main Stellar anchor speaks SEP-6, not SEP-24 |

---

## 6. How to verify

```bash
pnpm install
pnpm verify                                  # 259 tests, offline
cargo test                                   # 14 contract tests

pnpm --filter backend dev
curl "http://localhost:8787/api/quotes?country=NG&fiat=NGN&direction=withdraw&amount=100&method=bank_transfer"
# Expect 200, quotes sorted by landedAmount, failed providers under "errors"

stellar contract invoke --id CBPHQB7YKLPLM7CZWCWUW6QQOBF77QMOTAHHO3PMP25AW4IXUMMSDFMT \
  --network testnet --source <any-funded-identity> -- history --corridor NG_NGN_USDC_withdraw

pnpm --filter frontend build && pnpm --filter frontend dev
# Open http://localhost:3000 at 360px wide
```

---

## 7. Definition of Done

- [x] Money is never a JavaScript `number` in a public API
- [x] No secret key is accepted, stored, transmitted or derived by the library
- [x] Every error thrown from an adapter is a `RampError`
- [x] `landedAmount` is honest, or the adapter throws `QUOTE_INCOMPLETE`
- [x] TypeScript strict; no `any`
- [x] Every exported symbol has TSDoc with an `@example`
- [x] Tests pass offline with no credentials, using recorded fixtures with documented provenance
- [x] Conventional commits, scoped by package
- [x] Contract deployed and initialised on testnet; attestations written and read back
- [x] Frontend builds and passes the 360px keyboard and expiry checks
- [x] CI green on GitHub
- [ ] Live demo deployed (Railway and Vercel; steps in `DEPLOY.md`)
- [ ] `docs/countries/nigeria.md`, the CI `cargo test` job, labels, and branch protection

---

## 8. Important notes

- **No live anchor serving NGN, KES, GHS or ZAR advertises SEP-24 as of
  2026-09-15.** Those corridors run on mock adapters, which are labelled
  `isMock` in the API and "Demo rate" in the UI. Their rates are illustrative
  and are not market data. A SEP-6 adapter, which would reach Cowrie, is the
  clearest next step.
- **`initialize` can be front-run** between deploy and initialise. The testnet
  deployment was initialised in the very next transaction. A `__constructor`
  would close the gap; `initialize` was kept because the specification calls
  for it.
- **The Stellar SDK is pinned to `~17.0.1`.** `^13` could not decode protocol 28
  responses. `17.1.0` was inside pnpm's `minimumReleaseAge` quarantine, and the
  exclusion pnpm added for it was deliberately not committed.
- **Not yet verified:** the backend Docker image has not been built (no daemon
  was available), and nothing has run on Railway or Vercel. Both deploy builds
  were rehearsed in clean copies of the repository with the hosts' exact
  install and build commands.
