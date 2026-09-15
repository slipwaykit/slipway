# `@slipwaykit/adapter-sep24`

One adapter class for every SEP-24 Stellar anchor. Nothing about a particular
anchor is compiled in: give it a home domain and it discovers the transfer
server, the quote server, the KYC server and the assets on offer through SEP-1.

```ts
import { Sep24Adapter } from '@slipwaykit/adapter-sep24';

const adapter = new Sep24Adapter({
  homeDomain: 'testanchor.stellar.org',
  country: 'NG',
  fiat: 'NGN',
});

const quote = await adapter.quote({
  country: 'NG',
  fiat: 'NGN',
  asset: { code: 'USDC' },
  direction: 'withdraw',
  amount: '100',
  method: 'bank_transfer',
});

quote.landedAmount; // what actually reaches the bank account
```

## What it reads

| Source | Used for |
| --- | --- |
| SEP-1 `stellar.toml` | `TRANSFER_SERVER_SEP0024`, `ANCHOR_QUOTE_SERVER`, `KYC_SERVER`, `WEB_AUTH_ENDPOINT`, `[[CURRENCIES]]` |
| SEP-24 `/info` | Capabilities, bounds, payment methods, fallback fee data |
| SEP-38 `/price` | Rates, fees and the spread |
| SEP-24 `/transactions/…/interactive` | Starting a ramp |
| SEP-24 `/transaction` | Polling |
| SEP-12 `/customer` | Verification state |

## Pricing, and when it refuses to price

`landedAmount` is what the recipient receives after every fee and every spread.
The adapter computes it one of two ways and refuses rather than guessing:

1. **SEP-38** when the anchor advertises `ANCHOR_QUOTE_SERVER`. The landed
   amount is `buy_amount` less every fee detail denominated in the buy asset. A
   fee denominated in the sell asset is already reflected in `buy_amount`, so it
   is not subtracted twice — it surfaces as the `spread` entry, which also
   captures any gap between the anchor's `price` and its `total_price`. This is
   how an anchor advertising "no fees" still shows a cost in the breakdown.

2. **`/info` fees** when there is no quote server. `/info` carries no exchange
   rate, so this path only works when the Stellar asset is pegged one-to-one to
   the fiat — the anchor's own fiat-backed token against the fiat backing it.

3. **`QUOTE_INCOMPLETE`** otherwise. USDC against NGN with no quote server has
   no honest answer, and neither does an anchor that published no fee fields at
   all. Silence about fees is not the same as charging nothing.

Across every path the fee breakdown reconciles exactly:
`buyAmount − Σfees === landedAmount`.

## Authentication

The adapter never performs SEP-10 and has no code path that accepts a secret
key. Your application obtains its own token from `WEB_AUTH_ENDPOINT` and passes
it in an `AuthContext`:

```ts
await adapter.initiate({ quote, auth: { token: sep10Jwt } });
```

`capabilities()` and `quote()` need no token. `initiate()`,
`getTransaction()` and `customerStatus()` throw `AUTH_REQUIRED` without one.

## Errors

Every failure is a `RampError` with a code from `@slipwaykit/core`. Raw fetch
rejections, anchor error envelopes and thrown strings never escape.

| Condition | Code | Retryable |
| --- | --- | --- |
| `400` | `PROVIDER_REJECTED` | no |
| `401`, `403` | `AUTH_INVALID` | no |
| `403` with a SEP-12 body | `KYC_REQUIRED` | no |
| `404` | `NOT_FOUND` | no |
| `429` | `RATE_LIMITED` | yes |
| `5xx`, network failure, timeout | `PROVIDER_UNAVAILABLE` | yes |

The raw body is always attached as `providerDetail`. Every request carries a 10
second `AbortController` timeout.

## Known anchor gaps

- **`testanchor.stellar.org` rejects `context=sep24` on SEP-38**, answering
  `Unsupported context. Should be one of [sep6, sep31]` as of 2026-09-15. The
  adapter sends `sep24` because that is what SEP-38 specifies for this flow.
- **SEP-24 has no field stating which fiat corridor an asset serves**, so
  `country` and `fiat` are adapter configuration rather than discovery.
- **SEP-24 defines no standard browser return URL.** `returnUrl` is sent as
  `return_url` on a best-effort basis; anchors ignore unknown fields.

## Tests

```bash
pnpm --filter @slipwaykit/adapter-sep24 test
```

181 tests, no network, no credentials. See [`test/fixtures/README.md`](test/fixtures/README.md)
for what was recorded from the live SDF test anchor and what is synthetic.
