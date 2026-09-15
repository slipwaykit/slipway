# Fixtures

Every test in this package runs against one of these files. Nothing here
reaches the network: `test/no-network.setup.ts` replaces the global `fetch`
with a stub that throws, so a test that forgets to inject a `fetchImpl` fails
loudly instead of quietly depending on an anchor being up.

## Recorded from the SDF test anchor

Captured from `https://testanchor.stellar.org` on **2026-09-15**. These are
verbatim responses, reformatted only by `python3 -m json.tool`.

| File | Source | Notes |
| --- | --- | --- |
| `testanchor.stellar.org.toml` | `GET /.well-known/stellar.toml` | Real SEP-1. Publishes SEP-6, SEP-24, SEP-31, SEP-38, SEP-12 and SEP-45 endpoints. |
| `testanchor-sep24-info.json` | `GET /sep24/info` | Publishes **no** `fee_fixed`, **no** `fee_percent` and **no** `types`. This is what makes it a genuine `QUOTE_INCOMPLETE` case for the fallback path. |
| `testanchor-sep38-price-usd.json` | `GET /sep38/price` | Sell 100 USDC, buy USD, `context=sep6`. |
| `testanchor-sep38-price-unsupported-context.json` | `GET /sep38/price` | The 400 this anchor returns for `context=sep24`. |
| `testanchor-sep24-forbidden.json` | `GET /sep24/transaction` with no token | The 403 shape, used for the error mapping table. |

Two facts worth recording, both checked 2026-09-15:

1. **`testanchor.stellar.org` does not support `context=sep24` on SEP-38.** It
   answers `{"error":"Unsupported context. Should be one of [sep6, sep31]."}`.
   The adapter sends `context=sep24` because that is what SEP-38 specifies for a
   SEP-24 flow; the price fixture above was therefore captured with
   `context=sep6`, which returns an identical body. If you point the adapter at
   the live test anchor you will get a `PROVIDER_REJECTED`, and that is the
   anchor's gap rather than the adapter's.

2. **The SEP-38 fee is denominated in the sell asset here**, and
   `(100 − 1.00) / 1.0500001591 = 94.2857` reproduces the anchor's `buy_amount`
   exactly. That confirms the pricing model in `src/quote.ts`: a sell-side fee is
   already reflected in `buy_amount` and must not be subtracted from it a second
   time. It surfaces instead as the `spread` entry, worth `1.00 / 1.05 =
   0.952381` USD.

## Synthetic

Hand-written, because no live anchor serves an NGN corridor on testnet. Each
file is shaped to match the protocol, and each carries a comment saying so.
They exist to cover paths the test anchor cannot reach.

| File | What it covers |
| --- | --- |
| `ngn-anchor.toml` | An anchor with a SEP-38 quote server and a SEP-12 KYC server. Publishes `TRANSFER_SERVER_SEP0024` with a trailing slash, to prove it gets stripped. |
| `ngn-sep24-info.json` | `types` including one unmappable entry (`carrier_pigeon`) and one disabled asset (`DEADCOIN`). |
| `ngn-sep38-price.json` | A buy-side fee **and** a rate markup, so both fee kinds appear in one breakdown. |
| `ngn-sep38-price-no-buy-amount.json` | A response that cannot yield a landed amount. |
| `pegged-anchor.toml` | A naira-backed token with `is_asset_anchored` and `anchor_asset`, and **no** quote server. |
| `pegged-sep24-info.json` | `fee_fixed`, `fee_percent` and `fee_minimum` together. |
| `nofee-sep24-info.json` | An anchor that publishes no fee fields at all. |
| `sep24-interactive.json` | The interactive handoff response. |
| `sep24-transaction-pending-stellar.json` | A transaction carrying `stellar_transaction_id`. |
| `sep12-customer-needs-info.json` | Every SEP-12 field type, plus an unrecognised one. |
| `sep12-customer-rejected.json` | A rejection with a reason. |

## Re-recording

```bash
cd packages/adapters/sep24/test/fixtures
curl -sS https://testanchor.stellar.org/.well-known/stellar.toml -o testanchor.stellar.org.toml
curl -sS https://testanchor.stellar.org/sep24/info | python3 -m json.tool > testanchor-sep24-info.json
```

If a recorded file changes, update the date at the top of this section in the
same commit.
