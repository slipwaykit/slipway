# Contributing to Slipway

Thanks for helping. Slipway lets Stellar applications add fiat on and off ramps
without a bespoke integration per provider, starting with Nigeria, Kenya, Ghana
and South Africa. Contributions reach us through **GitHub**, **Drips Wave** and
**GrantFox**; the workflow below is the same whichever way you arrived.

**Contents**

1. [Before you start](#1-before-you-start)
2. [Finding and claiming an issue](#2-finding-and-claiming-an-issue)
3. [Complexity and rewards](#3-complexity-and-rewards)
4. [Setting up](#4-setting-up)
5. [Branches and commits](#5-branches-and-commits)
6. [The non-negotiables](#6-the-non-negotiables)
7. [Opening a pull request](#7-opening-a-pull-request)
8. [Review, resolution and ratings](#8-review-resolution-and-ratings)
9. [Contribution types](#9-contribution-types)
10. [Conduct and AI use](#10-conduct-and-ai-use)

---

## 1. Before you start

- **Do not start work until you are assigned.** Unassigned pull requests are
  closed, however good, because someone else may already be assigned.
- **One person per issue.** If an issue is assigned, find another one.
- **Ask on the issue, not in private.** Questions and answers in the issue
  thread help the next contributor too.
- Read [section 6](#6-the-non-negotiables) before writing code. Pull requests
  that break those rules are not merged.

## 2. Finding and claiming an issue

Issues open to contributors carry a complexity label (`trivial`, `medium` or
`high`) and an area label: `adapter`, `core`, `ui`, `backend`, `contracts`, `docs`
or `conformance`. `good first issue` marks a gentle entry point. Issues in a Drips
Wave also carry the program label the Drips bot applies, such as `Stellar Wave`.

**Via Drips Wave**

1. Find the issue on the [Stellar Wave issues page](https://www.drips.network/wave/stellar/issues).
2. Apply with a short, specific message: which part of the codebase you would
   change, your approach in two or three sentences, and relevant prior work.
   "I'd like to work on this" on its own is not an application.
3. Wait for assignment on Drips or GitHub.

Drips limits you to **15 pending applications** and **4 assigned issues per
organisation per Wave**. Withdraw applications you no longer want so you free
up the slot for yourself and the issue for others.

**Via GrantFox**

1. Find the issue on [GrantFox](https://contribute.grantfox.xyz/issues).
2. Apply through GrantFox with the same kind of message as above.
3. Wait for assignment.

**Directly on GitHub**

Comment on the issue with your proposed approach and wait for a maintainer to
assign you.

**If you get stuck or stop:** say so on the issue. Unassigning yourself early is
far better than going quiet. Assigned issues with no visible progress or reply
for **7 days** may be reassigned.

## 3. Complexity and rewards

| Label | Scope | Drips Wave points |
| --- | --- | --- |
| `trivial` | Typos, copy changes, small bug fixes, a missing test | 100 |
| `medium` | A standard feature, an involved bug fix, a country guide | 150 |
| `high` | A new adapter, a refactor across packages, a new integration | 200 |

Drips pays out in proportion to your share of the points earned in a Wave, and
Wave organisers may adjust or withhold points for misbehaviour. GrantFox rewards
are set per issue on GrantFox. **Issues must be resolved before a Wave ends to
count toward that Wave**, so claim work you can finish in time.

If an issue turns out to be substantially bigger than its label, say so on the
issue before you finish. We would rather relabel than have you under-rewarded.

## 4. Setting up

**Requirements:** Node.js 20 or later, pnpm 12.4.1 (`corepack enable` picks it
up from `package.json`), and for contract work Rust with the `wasm32v1-none`
target and the [stellar CLI](https://developers.stellar.org/docs/tools/cli).

```bash
# 1. Fork https://github.com/slipwaykit/slipway, then:
git clone https://github.com/YOUR_USERNAME/slipway.git
cd slipway
git remote add upstream https://github.com/slipwaykit/slipway.git

# 2. Install
pnpm install

# 3. Check everything passes before you change anything
pnpm verify        # typecheck, lint, test: offline, no credentials needed
cargo test         # only if you touch contracts/
```

Running the apps locally:

```bash
cp backend/.env.example backend/.env
cp frontend/.env.example frontend/.env.local
pnpm --filter backend dev          # http://localhost:8787
pnpm --filter frontend dev         # http://localhost:3000
```

The backend runs without `SLIPWAY_ATTESTOR_SECRET` in development; attestation
simply switches off. **Never commit a `.env` file or a Stellar secret key.**

> **pnpm refuses a dependency published in the last day.** That is the
> `minimumReleaseAge` supply-chain policy doing its job. Pick a slightly older
> version; do not add an exclusion to `pnpm-workspace.yaml`.

| Path | What it is |
| --- | --- |
| `packages/core` | The adapter contract, `RampError`, exact decimal maths, the registry |
| `packages/adapters/*` | One package per provider or protocol |
| `backend` | Hono API, corridor poller, attestor |
| `frontend` | Next.js demo |
| `contracts/attestations` | Soroban contract |

## 5. Branches and commits

**Branches** are lowercase and named `type/issue-number-short-description`:

```
feat/42-sep6-adapter
fix/57-quote-expiry-rounding
docs/61-kenya-country-guide
```

Use one of: `feat`, `fix`, `docs`, `refactor`, `perf`, `test`, `build`, `ci`,
`style`, `chore`.

**Commits** are atomic and follow [Conventional Commits](https://www.conventionalcommits.org/),
**scoped by package**, lowercase, with a subject under 72 characters:

```
feat(adapter-sep6): map sep-6 withdraw types to payment methods
fix(backend): keep failed snapshots when the attestor is down
docs(countries): add kenya mobile money limits with sources
test(core): cover division by zero in decimal maths
```

Scopes: `core`, `adapter-<name>`, `backend`, `frontend`, `contracts`, `docs`,
`countries`, `ci`. Put the *why* in the commit body when it isn't obvious from
the diff. One logical change per commit; don't mix a refactor into a fix.

Keep your branch current by rebasing on `upstream/main` rather than merging it
in.

## 6. The non-negotiables

These protect the people who will move real money through Slipway. A pull
request that breaks one is not merged, whatever else it does well.

1. **Money is never a JavaScript `number` in a public API.** Amounts are decimal
   strings. Use `decimal` from `@slipwaykit/core` for arithmetic; never
   `parseFloat` a money value, never `toFixed` one.
2. **Slipway never accepts, stores, transmits or derives a secret key.** The
   consuming application obtains its own SEP-10 or SEP-45 token and passes it in
   an `AuthContext`. If an integration seems to need a user's secret key, stop
   and raise it on the issue.
3. **Every error thrown from an adapter is a `RampError`** with a code from the
   `RampErrorCode` union. Raw fetch errors, provider error shapes and thrown
   strings must never escape an adapter.
4. **`landedAmount` is what the recipient actually receives** after every fee
   and spread. If a provider does not disclose enough to compute it honestly,
   throw `QUOTE_INCOMPLETE`. Never estimate. Never return the gross amount.
   Treating "the provider published nothing about fees" as "the provider charges
   nothing" is a guess, and guesses are bugs here.
5. **TypeScript strict.** No `any`. No `@ts-ignore` or `@ts-expect-error`
   without a comment explaining why.
6. **Every exported symbol has a TSDoc comment with at least one `@example`.**
7. **Tests pass offline with no credentials.** Network calls in tests use
   recorded fixtures injected through `fetchImpl`. The test setup replaces the
   global `fetch` with a stub that throws, so a test that reaches the network
   fails. Don't work around it.
8. **Claims carry sources and dates.** An anchor's fees, limits or supported
   corridors, or a country's regulations, are written down with a link and the
   date you checked. Marketing pages are not sources; an anchor's own
   `stellar.toml` and `/info` are.

## 7. Opening a pull request

1. Run `pnpm verify` (and `cargo test` for contract changes). CI runs the same
   checks and a red build is not reviewed.
2. Push to your fork and open a pull request against **`main`**.
3. **Fill in the [pull request template](.github/pull_request_template.md) in
   full. Pull requests that ignore the template are closed without review.**
4. Link the issue in the description with `Closes #123`. This is how Drips and
   GrantFox connect your work to the issue, so a missing link can cost you the
   reward.
5. Keep it focused: one issue, one pull request. Unrelated clean-ups go in a
   separate pull request.

**Evidence.** The template asks for evidence before and after your change:

- **UI changes:** a short [Loom](https://www.loom.com) video or screenshots,
  including a phone-width view at **360px**. Many Slipway users are on low-end
  Android.
- **Adapters, backend and contracts:** the relevant test output and, for an
  adapter, a quote from recorded fixtures showing the landed amount and fee
  breakdown.
- **Docs:** the links you checked and the date you checked them.

## 8. Review, resolution and ratings

- Expect a first review within **3 working days**. If you have heard nothing
  after that, a polite ping on the pull request is welcome.
- Respond to review comments by pushing new commits rather than force-pushing
  over the history under review, so the reviewer can see what changed.
- An issue counts as resolved when its pull request is merged, or when a
  maintainer marks it resolved on Drips or GrantFox. Near the end of a Wave,
  maintainers resolve accepted work promptly even if merging waits for another
  reason.
- **Drips Wave** opens a **14-day** window after an issue closes for anonymous
  two-way reviews. Maintainers rate communication, code quality, timeliness and
  problem solving; you rate our communication, issue clarity, code quality and
  timeliness. Honest reviews of us are genuinely useful.

## 9. Contribution types

### A new adapter

An adapter is a package under `packages/adapters/<name>` implementing
`RampAdapter` from `@slipwaykit/core`. Use `packages/adapters/sep24` as the
reference. Before requesting review, check that:

- [ ] `capabilities()` omits a bound the provider does not publish rather than
      defaulting it to zero.
- [ ] `quote()` returns an honest `landedAmount`, or throws `QUOTE_INCOMPLETE`,
      and `buyAmount − Σfees === landedAmount` holds exactly.
- [ ] Every HTTP failure maps to a `RampErrorCode`, with the raw body kept as
      `providerDetail`, and every request has a timeout.
- [ ] An unrecognised provider status maps to `pending_provider` rather than
      throwing.
- [ ] Fixtures live in `test/fixtures/` with a `README.md` recording which files
      were recorded from a live service (and on what date) and which are
      synthetic.
- [ ] Nothing asks for, stores or derives a secret key.

### A country guide

Country guides live in `docs/countries/<country>.md`. Every factual claim
(currency controls, KYC thresholds, payout rails, transfer limits, which
anchors serve the corridor) has a source link and the date you checked it. Say
plainly when something could not be confirmed.

### An anchor for the seed list

Add it to `backend/src/services/anchors.seed.ts` only after fetching its
`stellar.toml` yourself. Record the `source`, the `checkedAt` date, and what the
domain actually advertises, including anything that stops Slipway from serving
it. An anchor that exists but does not speak SEP-24 is still worth listing,
with the reason.

### Frontend

Test at 360px wide. Keep it keyboard navigable, keep status changes announced
to screen readers, and put every user-facing error through `ERROR_MESSAGES` in
`frontend/src/lib/errors.ts` rather than writing new copy inline.

### Contracts

Amounts are `i128` with 7 decimal places. Add a test for every new failure path,
and run `cargo test` and `stellar contract build` before opening a pull request.

## 10. Conduct and AI use

- Be respectful and assume good faith, in issues, reviews and ratings alike.
- Don't claim issues you can't start soon, don't open duplicate pull requests
  for an issue someone else is assigned, and don't split one change into several
  pull requests to collect more rewards.
- **AI tools are allowed, but you own what you submit.** You must understand
  every line well enough to explain it in review and to fix it when it is wrong.
  Mention significant AI assistance in the pull request's notes. Unreviewed
  generated code, fabricated fixtures, or invented sources for anchor or country
  data will get the pull request closed and may be reported to the Wave or
  GrantFox organisers.

Questions about any of this? Open a discussion on the relevant issue. Thank you
for building Slipway with us.
