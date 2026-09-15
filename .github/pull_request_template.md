# Pull Request | Slipway

<!-- Fill in every section. Pull requests that ignore this template are closed
without review. See CONTRIBUTING.md. -->

## 1. Issue link

<!-- Required. Drips Wave and GrantFox use this link to credit your work. -->

- Closes #

---

## 2. Brief description of the issue

<!-- What problem does this solve, in one or two sentences? -->

---

## 3. Type of change

Mark every box that applies with an `x`, like `[x]`.

- [ ] 📝 Documentation (README, docs, country guide, comments)
- [ ] 🐛 Bug fix (non-breaking change that fixes an issue)
- [ ] 👌 Enhancement (non-breaking change that adds functionality)
- [ ] 🔌 New adapter
- [ ] 💥 Breaking change (changes existing behaviour or a public type)

**Area:** `core` / `adapter-<name>` / `backend` / `frontend` / `contracts` / `docs`

---

## 4. Changes made

<!-- The main changes, clearly and concisely. -->

-
-

---

## 5. Evidence before the change

<!-- UI: a Loom video or screenshots, including 360px width.
     Adapters, backend, contracts: failing test output or the incorrect result.
     Docs: what was missing or wrong. -->

---

## 6. Evidence after the change

<!-- UI: a Loom video or screenshots, including 360px width.
     Adapters: a quote from recorded fixtures showing landedAmount and the fee breakdown.
     Backend and contracts: passing test output.
     Docs: the sources you checked and the date you checked them. -->

---

## 7. Checklist

- [ ] I was assigned to the linked issue before starting
- [ ] `pnpm verify` passes locally (and `cargo test` for contract changes)
- [ ] No money value is a JavaScript `number` in a public API
- [ ] No secret key is accepted, stored, transmitted or derived
- [ ] Every error thrown from an adapter is a `RampError`
- [ ] `landedAmount` is honest, or the adapter throws `QUOTE_INCOMPLETE`
- [ ] New exports have TSDoc with an `@example`
- [ ] Tests run offline, using recorded fixtures with documented provenance
- [ ] New factual claims about anchors or countries carry a source link and a date
- [ ] Commits follow Conventional Commits, scoped by package

---

## 8. Important notes

<!-- Anything reviewers should know: follow-up work, trade-offs, setup steps,
and any significant AI assistance you used. -->

-
