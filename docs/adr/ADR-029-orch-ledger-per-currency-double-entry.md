# ADR-029 — Orchestration ledger: double-entry balances PER CURRENCY

**Date:** 2026-08-13
**Status:** Accepted
**Deciders:** FX/Orchestration
**Scope:** `backend/internal/orchestration/repository.go` (`sqlStore.ApplyConversion`,
`sqlStore.ApplyTransfer`) and one new live-DB invariant suite. **No migration, no API contract
change, no balance/projection change.** Does not touch the main finance ledger
(`backend/internal/finance/ledger`), which was already balanced.

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
- **Historical rows are left as-is.** The existing single-sided entries are pre-fix QA data on a
  dev database. Ledger entries are immutable and corrections must be reversing entries — a
  backfill of production rows, if any exist, is a separate migration with its own review.

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
