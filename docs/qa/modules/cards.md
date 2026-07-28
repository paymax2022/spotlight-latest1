# Module: Cards / Maplerad WaaS

**Risk tier:** 0 &nbsp;·&nbsp; **Money-path:** yes &nbsp;·&nbsp; **Feature flag:** `FEATURE_MAPLERAD_ENABLED`
**Code:** `backend/internal/finance/maplerad/` (`handler.go`, `service.go`, `model.go`, `repository.go`, `statemachine.go`, `ledgerplan.go`, `webhook_logic.go`, `jobs.go`, plus `statemachine_test.go`, `ledgerplan_test.go`, `service_decisions_test.go`, `webhook_logic_test.go`); mounted in `backend/internal/app/finance_routes.go`; webhook `backend/internal/webhooks/maplerad.go`
**Slug:** `CARDS` (uppercase, used in Case IDs)

## 1. Overview & scope

> **Scope note:** despite the "cards" slug, `internal/finance/maplerad` is the **Maplerad WaaS domain** (ADR-012, NGN v1): customer onboarding, dedicated virtual accounts, **outbound bank transfers**, and **bill purchases** — it does **not** issue/reveal/fund/freeze/terminate physical or virtual cards. (FX virtual-card stubs live in `orchestration/handler_cards.go`; see `fxorch.md`.) The FSM, ledger plan, and webhook here govern the transfer/bill money path.

The domain depends only on provider **gateway ports** (Identity/Wallet/VA/Disbursement/Bills), enforces a **KYC-tier gate (fail-closed, before any adapter call)**, and runs every money op through a pure, unit-tested state machine (`DecideTransition`) whose ledger effect is declaratively described by the ledger plan and applied by the service. A transfer goes INITIATED→PENDING (hold) synchronously and reaches a terminal state via the **unauthenticated, signature-verified webhook**; reconcile + orphan-sweep jobs re-drive stuck ops. Cross-cutting: `../cross-cutting/money-invariants.md`, `../cross-cutting/kyc-and-tiers.md`, `../cross-cutting/webhooks-and-providers.md`.

## 2. Services / endpoints in scope

| Operation | Method + path | Auth / permission | Money-path? |
|---|---|---|---|
| Ensure customer | `POST /api/finance/maplerad/customer` | token + KYC tier ≥ 1 | no |
| Open virtual account | `POST /api/finance/maplerad/virtual-account` | token + KYC tier ≥ 1 | no |
| Initiate transfer | `POST /api/finance/maplerad/transfers` | token + KYC tier ≥ 1 + tier daily-limit | yes (202 → webhook terminal) |
| Get transfer | `GET /api/finance/maplerad/transfers/:ref` | token (owner) | no |
| Purchase bill | `POST /api/finance/maplerad/bills` | token + KYC tier ≥ 1 | yes |
| Provider webhook | `POST /api/webhooks/maplerad/go` | none (HMAC signature verified inside) | yes |
| Reconcile / orphan sweep | `StartReconcile` (daily) / `StartOrphanSweep` (hourly) | background job | yes (drift quarantine) |

`transferRequestBody`: `bank_code`, `account_number`, `amount_kobo`, `narration`, `ref`. **Idempotency-Key header wins over body `ref`** (the ref IS the ledger posting key + `provider_reference` id). `billRequestBody`: `ref`, `type`, `amount_kobo`, `params`. Transfer fee (`TransferFee`): `≤500_000`→`1_000`; `≤5_000_000`→`2_500`; else `5_000`. `RequiredTransferTier = 1`.

## 3. Test matrix by layer

| Behavior | Layer | Existing coverage (cite file) | Status |
|---|---|---|---|
| `DecideTransition` legal forward edges | fsm | `statemachine_test.go` (`TestDecideTransition_AllowedForward`) | AUTOMATED |
| Illegal transitions (skip/backwards/terminal) | fsm | `statemachine_test.go` (`_RejectInitiatedToTerminal`, `_RejectBackwards`, `_RejectTerminalToAnything`, `_OutOfOrderCannotFlip`) | AUTOMATED |
| Terminal replay is no-op | fsm | `statemachine_test.go` (`_TerminalReplayIsNoOp`) | AUTOMATED |
| Webhook status normalization | unit | `statemachine_test.go` (`TestNormalizeWebhookStatus`), `service_decisions_test.go` (`TestClassifyWebhook`) | AUTOMATED |
| Event classification + dedupe | unit | `webhook_logic_test.go` (`TestClassifyEvent`, `TestDecideDedupe_OnceThenNoOp`) | AUTOMATED |
| Drift detect (in-sync / quarantine) | unit | `webhook_logic_test.go` (`TestDetectDrift_*`) | AUTOMATED |
| Ledger plan legs (hold/finalize/reverse/compensate) | inv | `ledgerplan_test.go` (`TestPlanHold_Legs`, `TestPlanFinalize_*`, `TestHoldThenFail_RestoresExactly`, `TestHoldThenSuccess_NetsCorrectly`, `TestPlanCompensate_*`) | AUTOMATED |
| Per-leg idempotency keys distinct | inv | `ledgerplan_test.go` (`TestPlannedLegs_DistinctIdempotencyKeys`), `statemachine_test.go` (`TestLegKey_DistinctPerLeg`), `service_decisions_test.go` (`TestTransferLegKeysDistinct`) | AUTOMATED |
| Net ledger effect per transition | inv | `service_decisions_test.go` (`TestTransferStateMachineLedgerNetEffect`) | AUTOMATED |
| KYC-tier gate fail-closed (real service) | int | — | TODO |
| Webhook signature verify + apply-once (real) | int | — | TODO |
| Object-level ownership on GetTransfer | authz | — (guard in code) | TODO |

## 4. Manual test cases

| Case ID | Title | Priority | Preconditions | Steps | Test data | Expected result |
|---|---|---|---|---|---|---|
| `CARDS-INT-001` | Initiate transfer holds funds | P0 | flag on, Tier-1 user, funded | `POST /transfers` valid NUBAN | `amount_kobo=1_000_000`, ref | 202; state PENDING; hold posted DR user_wallet(amount+fee) → CR failed_transfer_suspense |
| `CARDS-INT-002` | Success webhook finalizes | P0 | PENDING transfer | signed `transfer.successful` webhook | matching ref | State SUCCESS; DR suspense→settlement (amount) + DR suspense→paymax_revenue (fee); suspense nets 0 |
| `CARDS-INT-003` | Failure webhook reverses hold | P0 | PENDING transfer | signed `transfer.failed` webhook | ref | State FAILED; REVERSAL restores amount+fee to user_wallet, drains suspense |
| `CARDS-INT-004` | Reversal after settle compensates | P0 | SUCCESS transfer | signed `transfer.reversed` webhook | ref | State REVERSED; compensate: restore user_wallet, drain settlement |
| `CARDS-INV-001` | Fee re-derived server-side | P0 | Tier-1, funded | `POST /transfers` `amount_kobo=6_000_000` | >₦50k | Fee `5_000`; hold total `6_005_000` |
| `CARDS-INV-002` | Idempotent initiate (same ref) | P0 | — | `POST /transfers` twice, same Idempotency-Key | same ref | 2nd returns stored record; single hold — MONEY-INV-006 |
| `CARDS-INV-003` | Webhook replay → dedupe no-op | P0 | success applied | POST identical signed webhook again | same event id | ACK 200, no second ledger effect (`DecideDedupe`) — WH-SEC-004 |
| `CARDS-INV-004` | Net wallet effect: hold then success | P0 | — | Apply PlanHold then PlanFinalize | — | Wallet net −(amount+fee); suspense→0; settlement+revenue balanced |
| `CARDS-INV-005` | Net wallet effect: hold then fail | P0 | — | Apply PlanHold then PlanReverseHold | — | Wallet net 0 (fully restored) |
| `CARDS-KYC-001` | Tier gate blocks transfer | P0 | Tier-0 user | `POST /transfers` | — | 403 `tier_required` (gate BEFORE adapter call) — KYC-SEC-001 |
| `CARDS-KYC-002` | Tier lookup error fails closed | P0 | force `GetUserTier` error | `POST /transfers` | — | Blocked (`ErrTierTooLow`); never calls provider — TIERS-SEC-001 |
| `CARDS-KYC-003` | Daily-limit enforced | P0 | Tier-1, over daily cap | `POST /transfers` | over | Blocked by `EnforceWalletDebitLimit` before adapter |
| `CARDS-UNIT-001` | Invalid NUBAN rejected pre-flight | P0 | Tier-1 | `POST /transfers` account `"123"` | short | 404 `invalid destination account` (DB-free `validate`) |
| `CARDS-UNIT-002` | Non-positive amount rejected | P0 | — | `POST /transfers` `amount_kobo=0` | 0 | 400 `amount must be a positive kobo integer` |
| `CARDS-UNIT-003` | Missing ref rejected | P1 | Tier-1 | `POST /transfers` no header, no body ref | none | 400 `client reference (ref) required` |
| `CARDS-FSM-001` | INITIATED→SUCCESS rejected | P0 | INITIATED | force success without PENDING | — | Rejected (terminal via webhook/PENDING only) → 409 `illegal transition` |
| `CARDS-FSM-002` | Terminal→anything rejected | P0 | FAILED | apply any transition | — | Rejected (FAILED/REVERSED truly terminal) |
| `CARDS-AUTHZ-001` | GetTransfer owner-only (IDOR) | P0 | A owns transfer ref | B `GET /transfers/:ref` | A's ref | `ErrForbidden` 403 (`row.UserID != userID`) — RBAC-AUTHZ-007 |
| `CARDS-AUTHZ-002` | Identity from token | P0 | A token | `POST /transfers` | — | user_id from context; no spoofable body field |
| `CARDS-SEC-001` | Webhook forged signature rejected | P0 | flag on | POST webhook with wrong/absent HMAC | tampered | Rejected; no ledger effect — WH-SEC-002 |
| `CARDS-SEC-002` | Flag off → routes + webhook not mounted | P0 | `FEATURE_MAPLERAD_ENABLED` off | `POST /transfers`, `POST /api/webhooks/maplerad/go` | — | 404 (whole block gated) — FLAG-SEC-001 |
| `CARDS-SEC-003` | Provider not configured → 503 | P1 | gateway unconfigured | `POST /transfers` | — | 503 `provider not configured` |
| `CARDS-INT-005` | Recon drift quarantined not auto-fixed | P1 | internal ≠ provider balance | run reconcile | drift | Quarantine + alert; NEVER an automatic compensating entry — WH-INT-005 variant |
| `CARDS-INT-006` | Orphan sweep re-drives stuck PENDING | P2 | PENDING past grace | orphan-sweep tick | — | Idempotently re-queries + resolves; no double-post |

## 5. State-machine transitions

`OpStatus`: `INITIATED`, `PENDING`, `SUCCESS`, `FAILED`, `REVERSED`. Terminal: SUCCESS, FAILED, REVERSED (`IsTerminal`). Guard: `DecideTransition(from,to)`; idempotent replay when `from==to` → `NoOp, Allowed`.

| From | Event | To | Ledger effect | Case ID |
|---|---|---|---|---|
| `INITIATED` | initiate (hold) | `PENDING` | `EffectHold`: DR user_wallet(amount+fee) → CR failed_transfer_suspense | `CARDS-INT-001` |
| `PENDING` | success webhook | `SUCCESS` | `EffectFinalize`: DR suspense→settlement (amount) + DR suspense→revenue (fee) | `CARDS-INT-002` |
| `PENDING` | failed webhook | `FAILED` | `EffectReverseHold`: restore wallet, drain suspense | `CARDS-INT-003` |
| `PENDING` | reversed webhook | `REVERSED` | `EffectReverseHold` (still in suspense) | — |
| `SUCCESS` | reversed webhook | `REVERSED` | `EffectCompensate`: restore wallet, drain settlement | `CARDS-INT-004` |
| `INITIATED` | →SUCCESS/FAILED/REVERSED | — | rejected (skip PENDING) | `CARDS-FSM-001` |
| `PENDING` | →INITIATED | — | rejected (backwards) | — |
| `SUCCESS` | →PENDING/FAILED/INITIATED | — | rejected | `CARDS-FSM-002` |
| `FAILED`/`REVERSED` | any | — | rejected (truly terminal) | `CARDS-FSM-002` |
| `x` | →`x` (same) | `x` | NoOp, no effect (idempotent replay) | `CARDS-INV-003` |

Leg keys (`LegKey(ref, leg)`): `hold`, `settle`, `fee`, `reversal`, `compensate` — each ledger post uniquely keyed so a duplicate webhook is a benign unique-constraint no-op.

## 6. Security & abuse cases

- **Webhook signature (`CARDS-SEC-001`):** HMAC verified inside the handler; forged/absent → rejected, no state change — `../cross-cutting/webhooks-and-providers.md` WH-SEC-002/003.
- **Replay idempotency (`CARDS-INV-003`):** `INSERT … ON CONFLICT DO NOTHING` on `webhook_event` → `DecideDedupe` processes exactly once; per-leg ledger keys back-stop it.
- **KYC-tier gate fail-closed (`CARDS-KYC-001/002`):** `requireTier` runs before any adapter call; a tier-lookup error blocks (`ErrTierTooLow`).
- **Object-level authz (`CARDS-AUTHZ-001`):** `GetTransfer`/stored-row checks `row.UserID != userID` → `ErrForbidden`; `InitiateTransfer` re-checks a stored ref's owner.
- **Drift never auto-corrected (`CARDS-INT-005`):** reconciliation quarantines + alerts; resolution is a human-reviewed compensating entry only.
- **PII:** account number stored/returned as last-4 only; BVN/NIN forwarded to Identity, never logged.

## 7. Automated specs to add

- `internal/finance/maplerad/service_gate_test.go` — fake tiers seam: Tier-0 blocked, tier-lookup error fail-closed, daily-limit enforced before adapter (CARDS-KYC-001/002/003). Pure-logic where possible.
- `internal/finance/maplerad/live_db_integration_test.go` — skip-gated on `TEST_DATABASE_URL`: real hold→finalize/reverse/compensate ledger posts + suspense-nets-to-zero; idempotent initiate; GetTransfer IDOR. (gap G5)
- `internal/webhooks/maplerad_signature_test.go` — valid/forged/tampered/replay table for the Maplerad HMAC + apply-once against real ledger (CARDS-SEC-001, CARDS-INV-003). (gap G10)

## 8. Coverage target & exit criteria

Tier-0: **≥ 85%** pure-logic (FSM + ledger plan + webhook logic already strongly covered). Exit: KYC-tier gate + daily-limit fail-closed proven at the seam; webhook signature verify + apply-once proven on real ledger; hold/finalize/reverse/compensate balanced + suspense-nets-zero proven; GetTransfer IDOR proven; drift quarantine (never auto-correct) proven; flag-off returns 404. A failing signature, idempotency, tier-gate, or conservation case is an S1 blocker.
