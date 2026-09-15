# Slipway frontend

The demo: pick a corridor, see every provider ranked by what the recipient
actually receives. Next.js App Router, Tailwind v4, shadcn/ui, TanStack Query,
Recharts.

```bash
cp .env.example .env.local
pnpm --filter backend dev          # the frontend reads only from the backend
pnpm --filter frontend dev         # http://localhost:3000
pnpm --filter frontend build
```

## Pages

| Route | What it shows |
| --- | --- |
| `/` | Corridor picker and the live comparison |
| `/anchors` | Every known anchor, its health, corridors, and where the entry came from |
| `/corridors/[id]` | Landed amount over time, plus on-chain attestations linked to stellar.expert |

## Decisions worth knowing

- **Ranked by landed amount, never rate.** The landed amount is the headline
  figure on every card; the rate sits beneath it, labelled "before fees".
- **Amounts are never overstated.** Decimal strings go straight into
  `Intl.NumberFormat` with `roundingMode: 'trunc'`, so `156,243.756` shows as
  `156,243.75`, not `.76`. Only the chart converts to numbers, for pixels.
- **Nothing is hidden.** Providers that didn't quote appear in a muted section.
  Identical failures from one anchor across several corridors are said once with
  a count, and "doesn't offer this route" is collapsed into one expandable line,
  because on any corridor most providers legitimately don't serve it.
- **Demo rates are labelled** on every card, and in the footer.
- **Quotes expire visibly.** Each counts down; at zero it can't be selected, an
  alert says why, and the live region announces it. Quotes do not refetch on
  window focus: silently swapping a quote someone was about to pick is worse.
- **Chart gaps are outages.** A poll where a provider failed breaks its line
  rather than being bridged, which would draw it as steady while it was down.
  Colours come from the validated reference palette, follow the provider rather
  than its rank, and ship with a legend and a table view because two slots sit
  below 3:1 contrast.
- **Built for low-end Android.** System fonts (nothing to download), native
  selects (the platform picker is faster and works with TalkBack), 44px touch
  targets, 16px inputs so the browser doesn't zoom, and the amount waits for
  typing to pause before requesting.
- **One error vocabulary.** [`src/lib/errors.ts`](src/lib/errors.ts) exports
  `ERROR_MESSAGES`, the only place a code becomes words. It is exhaustive over
  `RampErrorCode` at compile time, so it can be overridden or translated whole.
- **The API contract is imported, not copied.** Response types come from
  `backend/src/api-types.ts` as type-only imports, so a changed route shape is a
  type error here.

## Verified

On the production build (`next start`), in headless Chromium at 360px with
mobile emulation, against the real backend with real poll data and 13 on-chain
attestations:

- No horizontal overflow on any page (`scrollWidth` 360); the chart surface
  stays inside the 16px page padding.
- Tab order: skip link, nav, picker fields, refresh, then the quotes; every stop
  has a visible focus outline.
- Space selects a quote, arrow keys move between quotes, Enter opens a fee
  breakdown, and the live region announces the result count.
- After 60 seconds every quote is disabled, an alert explains why, and the
  selection panel is withdrawn.

## Not done

- **Not deployed.** A Vercel deployment needs a reachable backend, and the
  backend uses SQLite and a cron poller, which Vercel's serverless runtime does
  not support. See the root README.
- **No automated accessibility audit** (axe) and no component render tests; the
  checks above were scripted against a running browser, and the logic is unit
  tested in [`src/lib/logic.test.ts`](src/lib/logic.test.ts).
- **No dark mode, no wallet.** Both deliberate for the MVP.
