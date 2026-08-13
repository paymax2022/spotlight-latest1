# ADR-029 — Orchestration ledger: double-entry balances PER CURRENCY

**Date:** 2026-08-13
**Status:** Accepted
**Deciders:** FX/Orchestration
**Scope:** `backend/internal/orchestration/repository.go` (`sqlStore.ApplyConversion`,
`sqlStore.ApplyTransfer`), two live-DB invariant suites, and one INSERT-only backfill migration
for historical rows (`20261205000000`, see "Historical backfill" below). **No API contract change,
no balance/projection change, no DDL on any existing table.** Does not touch the main finance
ledger (`backend/internal/finance/ledger`) — that plane's own single-sided-writer problem is
ADR-030.

## Context

`orch_ledger_entries` is the orchestration module's own ledger — distinct from the main finance
`ledger_entries`. CLAUDE.md's money-path iron rule requires every money mutation to *"post
balanced double-entry ledger entries."* Two of its three writers did not.

**`ApplyConversion`** posted exactly two legs for an FX conversion:

```
INSERT ... VALUES ('customer_balance', <source currency>, 'DEBIT',  sourceTotal, ref, idem+':src')
INSERT ... VALUES ('customer_balance', <dest currency>,   'CREDIT', destAmount,  ref, idem+':dst')
```

Both legs hit the **same account in different currencies**, so *within each currency* the entry
was single-sided — no counter-leg anywhere. **`ApplyTransfer`** was worse: a lone `DEBIT` leg with
no counter-leg at all.

This is pre-existing (not introduced by a recent merge). Observed on the local DB after QA
conversions:

```
 account          | currency | type   | count |     sum
------------------+----------+--------+-------+-------------
 customer_balance | NGN      | CREDIT |     4 | 106,669,225   ← no NGN debits at all
 customer_balance | USD      | DEBIT  |     4 |      67,668   ← no offsetting USD credit
```

Destination currency was being created from nothing, and the source debit vanished into nowhere.
A single conversion (`PMX-CV-C357E2DF`) produced `USD DEBIT 2506` + `NGN CREDIT 3950712` and
nothing else.

The correct pattern already existed in the same module: `cards_store.go` (card funding, card
termination refund) posts `DEBIT customer_balance` / `CREDIT card_balance` in the **same**
currency — balanced, using the same `:src`/`:dst` idem-suffix convention.

**Why this was never caught.** The one existing assertion (`cards_funding_live_db_test.go`)
checks `SUM(DEBIT) == SUM(CREDIT)` across the *whole* customer ledger, currency-blind. That check
cannot see this bug: the old two-leg conversion has one debit and one credit, so it only ever
looks wrong by *amount* — and at a 1:1 rate it passes outright. **Currency must be in the
`GROUP BY`.**

## Decision

**Double-entry in `orch_ledger_entries` balances per `(currency)`, not merely in aggregate.**
Each money move posts a full debit/credit set within every currency it touches, using the account
vocabulary already documented in the table's own schema comment
(`customer_balance | paymax_spread | provider_clearing` —
`20260621000000_fx_orchestration.sql:19`). No new accounts, so no migration.

### Conversion — five legs, both currencies balanced

A conversion moves between two **Paymax-held customer balances**, so both currencies get legs:

| Currency | Account             | Type   | Amount                 | Idem suffix      |
|----------|---------------------|--------|------------------------|------------------|
| source   | `customer_balance`  | DEBIT  | `sourceTotal`          | `:src`           |
| source   | `paymax_spread`     | CREDIT | `spread`               | `:src-spread`    |
| source   | `provider_clearing` | CREDIT | `sourceTotal - spread` | `:src-clearing`  |
| dest     | `provider_clearing` | DEBIT  | `destAmount`           | `:dst-clearing`  |
| dest     | `customer_balance`  | CREDIT | `destAmount`           | `:dst`           |

`provider_clearing` ends up **long the source currency and short the destination** — that residual
*is* the FX position, and it is now visible rather than implicit. It unwinds when the provider
settles.

### Transfer — three legs, source currency only

A payout touches only **one** Paymax-held balance. The beneficiary is paid in the destination
currency out of the *provider's* float, never from a Paymax-held balance, so there is no
destination-currency leg — that exposure is tracked by the treasury reserve
(`s.treasury.Reserve`), not by this ledger.

| Currency | Account             | Type   | Amount                 | Idem suffix      |
|----------|---------------------|--------|------------------------|------------------|
| source   | `customer_balance`  | DEBIT  | `sourceTotal`          | `:out`           |
| source   | `paymax_spread`     | CREDIT | `spread`               | `:out-spread`    |
| source   | `provider_clearing` | CREDIT | `sourceTotal - spread` | `:out-clearing`  |

### Why the spread gets its own leg

`sourceTotal = quoted source + provider fee + rail fee`. The **spread is deliberately not in
`sourceTotal`** — it is priced into the rate, so the customer pays it by receiving fewer
destination units. It is nonetheless a known, quoted, source-currency amount
(`bpsOf(srcAmt, spreadBPS)`, carried on the quote as `FeeSpread`), so splitting it out of the
clearing credit recognises Paymax FX revenue explicitly instead of burying it inside
`provider_clearing`. `recon.go` already models `spread` as *"paymax_spread in source minor"* and
proves spread margin during reconciliation — this makes the ledger agree with that model.

### Degenerate-pricing guard

`splitSpread` recognises the quoted spread only when `0 < spread < sourceTotal`; otherwise the
whole debit falls through to `provider_clearing`. Legs with a non-positive amount are skipped
(`amount_minor` has a `CHECK (> 0)`), which cannot unbalance a currency because both sides of a
pair carry the same amount and skip together.

## Consequences

- **Existing idem suffixes are preserved** (`:src`, `:dst`, `:out`); only new counter-legs add new
  suffixes. `orch_ledger_idem_uniq` still dedupes replays leg-by-leg.
- **No projection change.** `orch_balances` updates, insufficient-balance fail-closed behaviour,
  and everything the customer sees are byte-identical. Only counter-legs were added.
- **No reader is affected.** Nothing in the codebase reads `orch_ledger_entries` today —
  `recon.go` reconciles from `orch_conversions` / `orch_transfers` domain rows, not this table.
- **`paymax_spread` and `provider_clearing` become live accounts** in this ledger for the first
  time. They are named after the table's schema comment; the main finance ledger's equivalents are
  `fx_spread_income` and `provider_clearing` (`finance/ledger/model.go`). The names differ because
  the two ledgers are separate; unifying them is out of scope here.
- **Historical rows are reconstructed by a follow-on migration** (see "Historical backfill"
  below). Ledger entries stay immutable — the backfill only INSERTs the legs that were never
  written.

## Alternatives rejected

- **`fx_position` as the counter-account** instead of `provider_clearing`. Rejected: it is a new
  account name outside the documented vocabulary, and `provider_clearing` already carries exactly
  this meaning (value handed to a provider, pending settlement) across the association,
  restaurant, and business modules.
- **Folding the spread into `provider_clearing`** (four legs, no `paymax_spread`). Balances
  correctly, but leaves FX revenue unattributed and contradicts `recon.go`'s spread-margin proof.
- **Adding a destination-currency leg to transfers** for symmetry with conversions. Rejected: it
  would assert a Paymax-held destination balance that does not exist, and would need an
  `external_payout` account invented purely to square it.

## Verification

`backend/tests/fx/orch_ledger_invariants_live_db_test.go` (live-DB, env-gated on
`TEST_DATABASE_URL`/`DATABASE_URL`, so `go test ./...` without a DB stays green):

- `TestOrchLedger_ConversionIsBalancedPerCurrency` — both currencies balance; asserts the exact
  per-account positions incl. the FX position in `provider_clearing`; confirms `orch_balances`
  still moves exactly as before.
- `TestOrchLedger_TransferIsBalancedPerCurrency` — payout balances and touches the source
  currency **only**.
- `TestOrchLedger_ZeroSpreadStaysBalanced` — zero spread and an over-large spread both stay
  balanced with the full debit in clearing.
- `TestOrchLedger_LegacyShapeIsRejected` — writes the old two-leg shape at a 1:1 rate and pins
  that a currency-blind check *passes* it while the per-currency check flags both currencies. This
  is the guard against someone later weakening the invariant back.

All four fail against the pre-fix code with `"<CUR> ledger is single-sided"` and pass after.
Run: `cd backend && DATABASE_URL=... go test ./tests/fx/... -run OrchLedger -v`.

## Historical backfill and the whole-table invariant

Fixing the writers is necessary but not sufficient. Every conversion written *before* this ADR is
still single-sided per currency, and while those rows exist the property cannot be asserted over
the table at all — which is why every assertion in
`orch_ledger_invariants_live_db_test.go` is scoped to a synthetic customer the test created. A
per-writer test cannot catch a writer nobody thought to test, a hand-run repair, or history.

`supabase/migrations/20261205000000_orch_ledger_conservation_backfill.sql` closes that:

- For every `(customer_id, reference, currency)` group that does not net to zero, it posts ONE
  reconstructed leg on `provider_clearing` for the residual. This is not an arbitrary plug — it is
  **exactly** the leg the fixed `ApplyConversion` now writes (`CR provider_clearing` in the source
  currency, `DR provider_clearing` in the destination), with the spread taken as 0. Retained markup
  is not recoverable after the fact, and guessing it would overstate `paymax_spread` revenue;
  leaving the whole amount in clearing understates nothing. `splitSpread` already degrades the same
  way when a spread is absent or nonsensical.
- INSERT-only, no DDL, and `orch_balances` is untouched — customer spendable balances were always
  correct (the same transactions that wrote the lopsided entries maintained them), so rewriting
  them would move real money.
- Balanced pairs written by `cards_store.go` net to zero and are left alone.
- Idempotent: the reconstructed leg's key carries the residual it closes, so a re-run is a no-op
  while a gap re-opening at a different amount still gets its own leg. The migration re-checks
  per-currency conservation before `COMMIT` and aborts if it was not reached.
- It also creates `public.orch_ledger_conservation_check` — one row per currency, `residual_minor`
  must be 0 — as `security_invoker` with `anon`/`authenticated` revoked, since a platform-wide FX
  position is not public data.

⚠ **Deploy order:** the migration must land with or after the Go build carrying this ADR. If the
old single-sided `ApplyConversion` is still running, it re-opens the gap.

Applied to the QA database (`:54322`), it reconstructed 8 legs across 4 legacy conversions and took
`NGN -106669225 / USD +67668` to `0 / 0`.

`backend/tests/fx/orch_global_conservation_live_db_test.go` then guards the whole table:

- `TestOrchGlobalConservation_EveryCurrencyBalances` — every currency in the table conserves,
  whatever wrote it. Verified to have teeth: injecting a lone `GBP CREDIT 12345` reds it with
  `currency GBP: residual -12345`.
- `TestOrchGlobalConservation_CheckViewAgrees` — pins the ops-facing view to the same projection,
  so a query drift in the view is caught.
- `TestOrchGlobalConservation_SurvivesPosting` — captures the residuals, drives a real conversion
  at a non-1:1 rate, and re-checks; this is the regression that would have caught the original bug.

It lives in `package fx_test` deliberately: `TestOrchLedger_LegacyShapeIsRejected` inserts an
unbalanced fixture on purpose, and Go runs tests within a package sequentially, so a whole-table
assertion in the same package can never observe it mid-flight. `backend/tests/fx` and
`backend/internal/orchestration` are the only packages that touch `orch_*` tables, so no other
parallel package can race it either.
