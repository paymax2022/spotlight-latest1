# Module: Ledger

**Risk tier:** 0 &nbsp;·&nbsp; **Money-path:** yes &nbsp;·&nbsp; **Feature flag:** `FEATURE_INTERNAL_LEDGER_API_ENABLED` (internal HTTP surface only; the ledger *library* is always compiled)
**Code:** `backend/internal/finance/ledger/` (`model.go`, `repository.go`, `service.go`, `service_test.go`, `reversal_test.go`, `toctou_test.go`); internal HTTP surface `backend/internal/app/internal_ledger_routes.go`; DB-free oracle `backend/tests/ledger_invariants_test.go`
**Slug:** `LEDGER` (uppercase, used in Case IDs)

## 1. Overview & scope

The ledger is the **authoritative double-entry money core**. Every money-moving module (wallet, transfers, escrow, settlement, FX, cards, commission, referral rewards, VA) posts through `ledger.Service`; balances are computed as a projection of `ledger_entries`, never stored. It exposes no user-facing HTTP: it is a Go library plus one **service-authenticated** internal API (`/internal/finance/ledger/{journal,balance}`) used by the standalone trading backend to post its cash legs. Because it is the oracle for every money invariant, all cases in `../cross-cutting/money-invariants.md` (I1–I13) ultimately reduce to ledger behavior — this file adds the ledger-specific unit and internal-API cases. The internal API is guarded by `middleware.RequireServiceToken` (constant-time bearer vs `cfg.LedgerServiceToken`; empty token ⇒ every call 503), NOT a user JWT. See `../cross-cutting/webhooks-and-providers.md` for the trading-service integration and `../cross-cutting/feature-flags-and-audit.md` for the flag/audit posture.

## 2. Services / endpoints in scope

| Operation | Method + path (or service func) | Auth / permission | Money-path? |
|---|---|---|---|
| Post cash leg (trading svc) | `POST /internal/finance/ledger/journal` | `RequireServiceToken(LedgerServiceToken)` | yes |
| Read projected balance | `GET /internal/finance/ledger/balance?userId&account` | `RequireServiceToken` | no (read) |
| Money-in | `Service.Credit(ctx, userID, ref, idemKey, debitAccountID, amountKobo)` | library | yes |
| Money-out (TOCTOU-safe) | `Service.Debit(ctx, userID, ref, idemKey, creditAccountID, amountKobo)` | library | yes |
| Balanced non-wallet post | `Service.PostJournal(ctx, JournalEntry)` | library | yes |
| Reversal (correction) | `Service.PostReversal(ctx, restoreAcctID, releaseAcctID, amountKobo, ref, idemKey)` | library | yes |
| Balance / account resolution | `GetBalance`, `GetAccountBalance`, `GetOrCreateUserWallet`, `GetOrCreateStandingAccount` | library | no |
| Replay probe | `Service.Posted(ctx, baseIdempotencyKey)` | library | no |

Account types (14, `model.go`): `user_wallet`, `virtual_account`, `escrow`, `refund`, `provider_clearing`, `paymax_revenue`, `commission`, `referral_reward_expense`, `fx_spread_income`, `settlement`, `failed_transfer_suspense`, `placement_escrow`, `placement_revenue`, `edtech_fees_vault`. Entry types: `CREDIT`, `DEBIT`, `REVERSAL_CREDIT`, `REVERSAL_DEBIT`. Balance projection: `SUM(CASE WHEN type IN ('CREDIT','REVERSAL_DEBIT') THEN +amount ELSE -amount END)`.

## 3. Test matrix by layer

| Behavior | Layer | Existing coverage (cite file) | Status |
|---|---|---|---|
| Entry-type / account-type constants stable | unit | `internal/finance/ledger/service_test.go` | AUTOMATED |
| Balance projection classifies every entry type | inv | `service_test.go` (`TestBalanceProjection_EveryEntryTypeIsClassified`), `toctou_test.go` (`TestBalanceProjectionClassification`) | AUTOMATED (pure-logic mirror) |
| Forward pair nets to zero (balanced) | inv | `service_test.go` (`TestDoubleEntry_ForwardPairNetsToZero`), `tests/ledger_invariants_test.go` | AUTOMATED |
| Reversal pair nets to zero / opposite of forward | inv | `service_test.go`, `reversal_test.go` | AUTOMATED |
| Per-side idempotency-key suffixes distinct | inv | `service_test.go` (`TestPerSideIdempotencySuffixes`) | AUTOMATED |
| Reject non-positive amount (Debit/Reversal) | unit | `reversal_test.go`, `toctou_test.go` (nil-pool guard) | AUTOMATED |
| Idempotent replay = no-op (in-memory oracle) | inv | `tests/ledger_invariants_test.go` (`TestIdempotency_ReplayIsNoOp`) | AUTOMATED (oracle only) |
| Concurrent same-key → exactly one row | inv | `tests/ledger_invariants_test.go` (`TestIdempotency_ConcurrentSameKeySingleRow`, 50 attempts) | AUTOMATED (oracle only) |
| Overdraw rejected | inv | `tests/ledger_invariants_test.go` (`TestDebit_RejectsOverdraw`) | AUTOMATED (oracle only) |
| Advisory-lock TOCTOU on real Postgres | int | — (all `_test.go` are pure-logic; no `TEST_DATABASE_URL` path) | TODO |
| `ON CONFLICT`/23505 → `ErrDuplicate` on real DB | int | — | TODO |
| Internal API auth + journal/balance | int | `internal/app/internal_ledger_routes_test.go` | PARTIAL |
| Audit emission on posting | int | — | TODO |

## 4. Manual test cases

| Case ID | Title | Priority | Preconditions | Steps | Test data | Expected result |
|---|---|---|---|---|---|---|
| `LEDGER-INV-001` | Balanced journal | P0 | two accounts | `PostJournal` A→B | `100000` | One DEBIT + one CREDIT, equal `amount_kobo`; balances move by ∓`100000` |
| `LEDGER-INV-002` | Balance is projection, not column | P0 | seeded wallet | Post several credits/debits; recompute from entries | mixed | Reported balance == `SUM(CASE…)`; no stored-balance column |
| `LEDGER-INV-003` | Overdraw rejected under lock | P0 | wallet balance `100000` | `Debit` `150000` | over | `ErrInsufficientFunds`; balance stays `100000`; no entries inserted |
| `LEDGER-INV-004` | Debit at exact balance allowed | P0 | balance `100000` | `Debit` `100000` | boundary | Success; balance `0` |
| `LEDGER-INV-005` | Idempotent replay (Debit) | P0 | — | `Debit` twice, same `idemKey` | same key | 2nd is no-op (`ON CONFLICT DO NOTHING`); entry count 2, not 4 |
| `LEDGER-INV-006` | Idempotent replay (PostJournal) → `ErrDuplicate` | P0 | — | `PostJournal` twice, same key | same key | 2nd returns `ErrDuplicate`; no extra entries |
| `LEDGER-INV-007` | Concurrent same-key → exactly one | P0 | — | Fire N=10 `Debit` goroutines, one key | same key | Exactly 1 succeeds; balance moved once |
| `LEDGER-INV-008` | Reversal restores prior balance + appends | P0 | a completed debit | `PostReversal(restore=wallet, release=suspense)` | — | Balance == pre-debit; REVERSAL_DEBIT/CREDIT appended; original rows intact |
| `LEDGER-INV-009` | Reversal idempotent | P0 | already-reversed journal | Reverse again, same key | same key | No second refund; balance unchanged |
| `LEDGER-INV-010` | Non-positive amount rejected | P0 | — | `Debit`/`Credit`/`PostReversal` with `0`, `-1` | `0`,`-1` | Rejected before any DB touch; nothing posted |
| `LEDGER-INV-011` | `Posted()` replay probe | P1 | a posted journal | `Posted(baseKey)` | base key | Returns true (probes `…:credit`); false for unknown key |
| `LEDGER-UNIT-001` | Standing account is singleton by type | P1 | — | `GetOrCreateStandingAccount(escrow)` twice | — | Same account id both times (no duplicate standing row) |
| `LEDGER-UNIT-002` | User wallet keyed per (user,type) | P1 | — | `GetOrCreateUserWallet(u)` twice; different user once | u, u2 | Stable id per user; distinct per user |
| `LEDGER-INT-001` | Internal journal posts balanced leg | P0 | flag on, valid service token | `POST /internal/finance/ledger/journal` `debitAccount=user_wallet, creditAccount=settlement` | `amountKobo=100000`, `userId`, `idempotencyKey` | 200 `{posted:true}`; balanced pair posted |
| `LEDGER-INT-002` | Internal replay reports replay | P0 | prior post landed | POST same `idempotencyKey` again | same key | 200 `{posted:true, replay:true}`; no double-post |
| `LEDGER-INT-003` | balanceChecked debit insufficient → 409 | P0 | wallet balance `0`, `balanceChecked=true, debitAccount=user_wallet` | POST journal | `amountKobo=100000` | 409 `{error:"insufficient_funds"}` |
| `LEDGER-INT-004` | balanceChecked requires user_wallet debit | P0 | `balanceChecked=true, debitAccount=escrow` | POST journal | — | 400 `balanceChecked requires debitAccount=user_wallet` |
| `LEDGER-INT-005` | Unknown account name rejected | P1 | flag on | POST with `debitAccount=made_up` | bogus name | 400 `unknown debitAccount` (fail-closed, no silent create) |
| `LEDGER-INT-006` | Same debit==credit rejected | P1 | flag on | POST `debitAccount==creditAccount` | equal names | 400 `must differ` |
| `LEDGER-INT-007` | Missing idempotencyKey / userId rejected | P0 | flag on | POST with each field blank | blank | 400 with the specific missing-field error |
| `LEDGER-SEC-001` | Internal API requires service token | P0 | flag on | POST journal with no / wrong `Authorization` | garbage token | Rejected by `RequireServiceToken`; never posts |
| `LEDGER-SEC-002` | Empty configured token → fail-closed 503 | P0 | `LedgerServiceToken=""`, flag on | POST journal with any token | — | 503; no money surface exposed |
| `LEDGER-SEC-003` | Flag off → internal routes not mounted | P0 | `FEATURE_INTERNAL_LEDGER_API_ENABLED` off | POST `/internal/finance/ledger/journal` | — | 404 (routes never registered) — see `../cross-cutting/feature-flags-and-audit.md` FLAG-SEC-001 |
| `LEDGER-SEC-004` | No mutating API path can alter history | P1 | posted entries | Attempt to update/delete an entry | — | No handler exposes UPDATE/DELETE; ledger is append-only (AUDIT-INT-003) |

## 5. State-machine transitions

Not applicable — the ledger has no FSM. Correctness is expressed as invariants (Section 4 / `../cross-cutting/money-invariants.md`), not status transitions. Entries are immutable; the only "transition" is appending a reversal pair.

## 6. Security & abuse cases

- **Service-token gate (`LEDGER-SEC-001/002`):** constant-time compare; empty configured token fails closed (503). Never a user JWT.
- **Fail-closed account resolution (`LEDGER-INT-005`):** an unknown account name is rejected, never silently created, so a typo can't fork a divergent account.
- **Amount tampering / no-float:** amounts are `int64` kobo; non-positive rejected (`LEDGER-INV-010`); see `../cross-cutting/money-invariants.md` I1/MONEY-INV-002.
- **Replay across scope:** the same idempotency key must not return a stale success for a *different* logical journal — per-side suffixing (`:debit`/`:credit`/`:rev_debit`/`:rev_credit`) keeps the two legs distinct while sharing a base; verify a reused base key on a different op is not silently a no-op.
- **Audit:** every posting must emit exactly one audit event (actor/service, amount, idempotency ref) — `../cross-cutting/feature-flags-and-audit.md` AUDIT-INT-001/004.

## 7. Automated specs to add

- `internal/finance/ledger/live_db_integration_test.go` — skip-gated on `TEST_DATABASE_URL`; drive `Debit`/`Credit`/`PostJournal`/`PostReversal` against real Postgres to prove the advisory-lock TOCTOU (`LEDGER-INV-003/007`), `ON CONFLICT`/23505→`ErrDuplicate` (`LEDGER-INV-005/006`), and reversal immutability (`LEDGER-INV-008/009`). Use `tests/ledger_invariants_test.go` as the oracle. (gap G5/G7)
- `internal/app/internal_ledger_routes_test.go` — extend to cover `LEDGER-INT-002/003/004/005/006` and both `LEDGER-SEC-001/002` token branches (table-driven, real handlers, real ledger service).
- Assert audit emission in the money-path integration test (`LEDGER-SEC-004`), reusing the `crypto/audit.go` pattern.

## 8. Coverage target & exit criteria

Tier-0 core: **≥ 85%** on pure-logic ledger funcs (already near this via the three `_test.go` files). Exit: I2–I9 (`../cross-cutting/money-invariants.md`) proven **against real Postgres** (not only the in-memory oracle); internal-API auth + replay + insufficient-funds paths green; append-only confirmed (no mutating path); no S1 open.
