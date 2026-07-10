# Money-Path QA Trace & Invariant Tests

QA pass over the Go/Gin backend (`spotlight/backend`) money paths. For each flow the
happy path, the replay/duplicate path, and the failure/guard path were traced in the
real source. Findings are OK (invariant upheld) or RISK (deviation from the CLAUDE.md
iron rules) with `file:line` and severity. New invariant tests were added ONLY as
`*_test.go` in the money modules; no production code was changed.

Iron rules checked: kobo integers (no float money), Idempotency-Key on every money
mutation, balanced double-entry ledger, guarded state machines, no direct balance
mutation (balances are ledger/derived projections), audit on every mutation.

## Summary table

| Flow | Happy path | Replay / idempotency | Failure / guard | Invariant violations found | file:line | Severity |
|---|---|---|---|---|---|---|
| Ledger core (PostJournal / Debit / Reversal) | OK — balanced pair, kobo ints | OK — per-side unique `idempotency_key` + `ON CONFLICT DO NOTHING`; `ErrDuplicate` on replay | OK — Debit is TOCTOU-safe under `pg_advisory_xact_lock`, fail-closed `ErrInsufficientFunds` | None | `ledger/repository.go:148-232` | OK |
| Ledger reversal-only corrections | OK — `PostReversalPair` REVERSAL_DEBIT/CREDIT | OK — per-side `:rev_debit`/`:rev_credit` unique keys | OK — corrections are reversing entries only; entries immutable (INSERT-only repo) | None | `ledger/repository.go:244-269` | OK |
| Wallet balance | OK — projection of ledger (`balanceProjectionSQL`) | n/a (read path) | OK — pooled read explicitly NOT used to gate debits | None (well documented) | `ledger/repository.go:77-99` | OK |
| KYC tier limits | OK — fail-closed limit checks | n/a | OK | None reviewed in scope | `finance/tiers/service.go` | OK |
| EdTech invoice (SF-2 derived balance, RecordPayment) | OK — balance = total − SUM(succeeded payments); never stored | OK — `AppendPayment` idempotent on unique `idempotency_key`; replay returns existing row, no double status advance | OK — non-payable states rejected (`ErrInvoiceNotPayable`); `ErrIdempotencyRequired` | None — SF-2 structurally enforced (no balance setter on `Store`) | `academy/fees/invoice/service.go:183-207,232-295` | OK |
| EdTech vault (SF-5 segregated account, contribute/apply) | OK — contributions CREDIT `AccountEdtechFeesVault`, never general float; `saved_minor` derived from SUM(contributions) | OK — ledger idempotency + unique contribution key; replay = one row, one debit | OK — only active/target_reached accept contributions; apply only from target_reached; terminal replay rejected | None — SF-5 + derived-balance structurally enforced | `academy/fees/vault/service.go:118-170,249-306` | OK |
| EdTech payment adapter (confirm-and-record) | OK — verify → ledger move (guardian→school) → RecordPayment share ONE idempotency key | OK — end-to-end idempotent; redelivered webhook = one ledger move + one invoice payment | OK — fail-closed on non-success charge; amount-mismatch aborts before any move; unknown ref no-op | None | `academy/fees/payment/service.go:277-328` | OK |
| EdTech scholarship (pledge→fund→apply) | OK — fund via ledger `PostFunding`; apply via invoice `RecordPayment` (never a balance write) | OK — fund idempotent (one ledger move); apply idempotent (one invoice payment, one award, applied-total not double-counted) | OK — unfunded pledge rejected; over-headroom rejected; `ErrIdempotencyRequired` | None | `academy/fees/scholarship/service.go:95-211` | OK |
| Crypto swap | OK — two-leg atomic; net wallet delta = 0 (cashKobo = netCash + spread); spread retained to revenue; nothing minted | OK — `RecordSwapFill` ON CONFLICT dedup; three ledger legs each keyed `idem+suffix`; full replay = triple no-op | OK — fail-closed oversell before any post; same-asset + non-positive units + missing idem rejected | Pre-existing KNOWN GAP: `cashForUnits` int64 overflow on whole-unit high-price swaps (no bounds check) — already documented + regression-guarded | `crypto/service_ext.go:90-170`; overflow `model.go` (see swap_invariants_test.go) | RISK (pre-existing, HIGH, tracked) |
| Crypto withdrawal approve/reject | OK — reject returns parked units via guarded transition; approve requested→pending | OK — guarded `WHERE status='requested'`, idempotent; second decision → `ErrInvalidTransition` | OK — fee-charge failure fails the withdrawal and returns parked units (compensation, never mints) | None | `crypto/admin_service.go:39-81`; `crypto/service_ext.go:346-455` | OK |
| Restaurant payout run (BuildRun/ProcessRun) | OK — ONE balanced ledger transfer DR settlement → CR provider wallet; net = gross − fees; kobo ints | OK — draft→processing→paid guarded UPDATE (`WHERE status=...`); ledger keyed on run `idempotency_key`; duplicate ProcessRun of a paid run = idempotent no-op | OK — missing Idempotency-Key rejected; zero-net rolled back to draft; `failRun` fail-closed | None | `restaurant/payout.go:118-393` | OK |
| Crowdfunding withdrawal payout | OK — balanced DR escrow / CR provider_clearing before terminal flip; audit in same tx | OK — deterministic key `cf:withdraw:payout:<id>`; `ErrDuplicate` on replay = success; already-COMPLETED = no-op | OK — REJECTED illegal; missing idem/approver/ledger fail closed | None (TODO(prod): bank rail not yet wired — funds park in clearing, does not fabricate provider success) | `crowdfunding/adminext/withdraw_approve.go:87-207` | OK |
| **FX Convert (currency wallets)** | source debit hits ledger; target credit does NOT | source debit idempotent (`:debit`); **target credit NOT idempotent** | reversal on provider failure restores full debit | **3 RISKS — see below** | `finance/fx/service.go:96-227` | RISK (HIGH) |
| Orchestration balances | direct `UPDATE orch_balances SET balance_minor` | mixed | — | Direct stored-balance mutation (same pattern as FX; out of primary scope, flagged) | `orchestration/repository.go:56,80,85,130` | RISK (review) |

## Ranked money-path risks found

### RISK-FX-1 — Direct balance mutation on FX target wallet (HIGH, real iron-rule violation)
`finance/fx/service.go:223-227` `creditCurrencyWallet` runs
`UPDATE currency_wallets SET balance_minor = balance_minor + $3`. The foreign-currency
leg of a conversion is a **directly-mutated stored balance**, NOT a projection of the
ledger, and it is **not posted as a balanced double-entry**. Only the NGN source debit
(`s.ledger.Debit`, service.go:122) is on the finance ledger. This violates "wallet
balances are projections of the ledger — never UPDATE a balance column directly" and
breaks double-entry for the target side (money appears in `currency_wallets` with no
counterpart ledger credit). Mitigating context: `currency_wallets` behaves as a separate
Maplerad-fed FX sub-ledger, but there is no offsetting entry, so the two sides do not
reconcile within one system.

### RISK-FX-2 — FX Convert target credit is not idempotent (HIGH)
`finance/fx/service.go:96-103` dedups via `SELECT id FROM fx_conversions WHERE
idempotency_key=$1` then later `INSERT` (service.go:165) with **no unique/tx guard on
that read** — a TOCTOU race. The source ledger debit is protected (keyed `:debit`), but
`creditCurrencyWallet` has **no idempotency key at all**. Two concurrent identical
Converts (or a replay landing in the check→insert window) can both pass the SELECT and
**double-credit the target wallet**. Fix direction: enforce a UNIQUE constraint on
`fx_conversions.idempotency_key` and do the credit + conversion insert in one tx keyed on
that key (or route the target credit through the idempotent ledger).

### RISK-FX-3 — FX Convert is non-atomic across four operations (MEDIUM)
`finance/fx/service.go:117-172`: ledger debit → provider convert → `creditCurrencyWallet`
→ `INSERT fx_conversions` are four separate operations with no surrounding transaction.
A crash after the target credit but before the conversion-row insert leaves the target
wallet credited with **no conversion record and no persisted idempotency key**; a later
retry re-runs the whole flow and double-credits (compounding RISK-FX-2). The failure path
that DOES exist (provider error → `postReversal`, service.go:135-138) is correct and
restores the full debit, but only covers provider-call failure, not a crash after credit.

### RISK-ORCH — Direct balance mutation on orchestration balances (review)
`orchestration/repository.go:56,80,85,130` `UPDATE orch_balances SET balance_minor = ...`
is the same direct stored-balance-mutation pattern as RISK-FX-1, outside the primary
in-scope flows. Flagged for the same iron-rule review; not deep-traced here.

### Pre-existing tracked gap — Crypto cash-conversion int64 overflow (HIGH, already documented)
`cashForUnits`/`unitsForCash` use `units * priceKobo` int64 math with no overflow guard;
a whole-unit high-price swap/buy silently wraps. Already captured and regression-guarded
in `backend/tests/crypto/swap_invariants_test.go`
(`TestPriceSwap_LargeWholeUnitCountOverflowsInt64_KnownGap`). Not re-fixed here.

## Tests added (this pass)

All new tests are DB-free, in-package (or `_test` package), using the existing
in-memory-fake / formula-mirror conventions. No production code changed. `go test` was
NOT run per instructions; files were parser/consistency self-reviewed.

### `backend/internal/finance/ledger/service_test.go` (extended)
Transcribes the production balance-projection CASE (`balanceProjectionSQL`) as a pure
classifier and locks the double-entry arithmetic that keeps the ledger balanced:
- `TestBalanceProjection_EveryEntryTypeIsClassified` — every declared `EntryType`
  contributes a non-zero signed direction (an unclassified type would be invisible to
  balances).
- `TestDoubleEntry_ForwardPairNetsToZero` — a DEBIT+CREDIT pair contributes exactly 0
  system-wide (no mint/burn) for a range of amounts.
- `TestDoubleEntry_ReversalPairNetsToZero` — REVERSAL_DEBIT+REVERSAL_CREDIT is balanced
  and the restore leg is positive (it is a correction, not a second debit).
- `TestReversalIsOppositeOfForward` — reversal legs are the exact inverse of their
  forward counterparts (corrections = reversing entries only).
- `TestPerSideIdempotencySuffixes` — the two sides of a journal use DISTINCT suffixed
  keys (so a balanced insert can't collide) yet share a base key (so a whole-journal
  replay is one logical no-op); `Posted()` probes the `:credit` side.

### `backend/internal/finance/fx/model_test.go` (extended)
Mirrors the FX Convert arithmetic/branches and encodes the discipline the RISKS above
violate (so a future fix changes the mirrored shape and prompts an update):
- `TestFXConvert_TotalDebitIncludesFee` — source debit = source + fee (integer kobo),
  never the source alone.
- `TestConvertRequest_RequiresIdempotencyKey` — a blank Idempotency-Key is not
  idempotency-safe (documents the boundary of the current, partial protection —
  RISK-FX-2).
- `TestFXConvert_CurrencyWalletCreditIsMinorUnitInteger` — the target credit is an
  int64 minor-unit add; no float money crosses the wallet boundary.
- `TestFXConvert_ReversalOnProviderFailureRestoresSourceDebit` — a provider-failed
  conversion reverses the FULL debited amount, leaving the user net zero.

## Coverage notes / scope boundaries

- The EdTech (invoice/vault/payment/scholarship), crypto swap, and state-machine
  modules already ship thorough in-package fake-based invariant tests; no gaps were
  found there, so no redundant tests were added.
- Ledger `Repository`, restaurant `payout.go`, crypto `admin_service.go`/`service_ext.go`,
  and FX `Service` are pgx-backed with `*pgxpool.Pool` fields and no injectable store
  seam, so their write paths require a live Postgres (they are exercised by the
  `backend/tests/{crypto,association}/live_db_integration_test.go` suites). Per the
  no-production-change constraint, new coverage for these was added at the pure-arithmetic
  / classifier level rather than by refactoring in a fake seam.
