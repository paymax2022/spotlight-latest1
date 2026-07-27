# Module: Transfers

**Risk tier:** 0 &nbsp;·&nbsp; **Money-path:** yes &nbsp;·&nbsp; **Feature flags:** `FEATURE_WALLET_TRANSFERS_ENABLED` (paymax P2P), `FEATURE_BANK_TRANSFERS_ENABLED` (bank / bank-to-bank). Routes are always mounted; each family returns **503** when its flag is off.
**Code:** `backend/internal/finance/transfers/` (`handler.go`, `admin_handler.go`, `service.go`, `service_ext.go`, `admin.go`, `decision.go`, `pin.go`, `model.go`, `decision_test.go`, `fee_test.go`, `multiprovider_test.go`); mounted in `backend/internal/app/finance_routes.go`; fee oracle `backend/tests/transfer_fees_example_test.go`
**Slug:** `TRANSFERS` (uppercase, used in Case IDs)

## 1. Overview & scope

Transfers moves money three ways: **wallet→wallet** (paymax P2P), **wallet→bank** (reserve into suspense, then provider payout), and **bank→bank** (collect via provider, then payout). It layers a **transaction PIN** (bcrypt, 4–6 digits, 5-fail / 15-min lockout) on bank flows, multi-provider disbursement routing with failover, beneficiary management, and an RBAC-gated admin console (list / detail / retry / reverse / provider-health under `finance.admin.transfers`). Every money mutation requires an `Idempotency-Key` (header wins over body), re-derives its fee server-side (tiered step function, never client-supplied), enforces tier limits fail-closed (wallet paths), and posts balanced ledger legs under the wallet advisory lock. Cross-cutting: `../cross-cutting/money-invariants.md`, `../cross-cutting/kyc-and-tiers.md`, `../cross-cutting/rbac-and-permissions.md`, `../cross-cutting/webhooks-and-providers.md`.

## 2. Services / endpoints in scope

| Operation | Method + path | Auth / permission | 503 flag | Money-path? |
|---|---|---|---|---|
| Resolve paymax recipient | `GET /api/finance/transfers/paymax/resolve?phone=` | token | wallet | no |
| Wallet→wallet | `POST /api/finance/transfers/paymax` | token | wallet | yes |
| Wallet→bank | `POST /api/finance/transfers/bank` | token + PIN | bank | yes |
| Bank→bank | `POST /api/finance/transfers/bank-to-bank` | token + PIN | bank | yes |
| List banks | `GET /api/finance/transfers/banks?provider=` | (gate only) | bank | no |
| Resolve account | `POST /api/finance/transfers/resolve-account` | token | bank | no |
| Beneficiaries | `GET/POST /beneficiaries`, `DELETE /beneficiaries/:id` | token (owner) | bank | no |
| PIN status/set/verify | `GET /pin/status`, `POST /pin`, `POST /pin/verify` | token | **none (always live)** | no |
| Admin list | `GET /api/finance/admin/transfers` | `RequirePermission("finance.admin.transfers")` | — | no |
| Admin detail | `GET /api/finance/admin/transfers/:id` | same | — | no |
| Admin provider health | `GET /api/finance/admin/transfers/provider-health` | same | — | no |
| Admin retry | `POST /api/finance/admin/transfers/:id/retry` | same | — | yes |
| Admin reverse | `POST /api/finance/admin/transfers/:id/reverse` | same | — | yes |

**Fee schedule (`model.go`, integer-kobo step functions, re-derived server-side — no fee field in any request):**
`WalletTransferFee`: `≤500_000`→`0`; `≤5_000_000`→`1_000`; else `2_500`.
`BankTransferFee`: `≤500_000`→`1_000`; `≤5_000_000`→`2_500`; else `5_000`.

## 3. Test matrix by layer

| Behavior | Layer | Existing coverage (cite file) | Status |
|---|---|---|---|
| Fee schedule (wallet + bank) | unit | `fee_test.go`, `tests/transfer_fees_example_test.go` | AUTOMATED |
| Error→HTTP status/code mapping | unit | `decision_test.go` (`TestHTTPStatusForError`) | AUTOMATED |
| Request validation (missing key / amount / phone / account) | unit | `decision_test.go` | AUTOMATED |
| Phone masking (last-4 only) | unit | `decision_test.go` (`TestMaskPhone`) | AUTOMATED |
| Reversal restores balance | inv | `decision_test.go`, `multiprovider_test.go` (`TestReversalRestoresSourceExactly`) | AUTOMATED |
| Reserve leg balanced; success sweep nets 0 | inv | `multiprovider_test.go` | AUTOMATED |
| Bank→bank FSM guard (forward/illegal) | fsm | `multiprovider_test.go` (`TestCanAdvanceBankToBank`) | AUTOMATED |
| Provider error keeps funds reserved | fsm | `decision_test.go`, `multiprovider_test.go` | AUTOMATED |
| Webhook status classification | unit | `decision_test.go`, `multiprovider_test.go` | AUTOMATED |
| PIN bcrypt round-trip | unit | `multiprovider_test.go` (`TestPinBcryptRoundTrip`) | AUTOMATED |
| PIN lockout (5-fail/15-min) | int | — (DB-backed; only bcrypt unit-tested) | TODO |
| Tier-limit enforcement (wallet paths) | int | — | TODO |
| Idempotency replay (real DB) | int | — | TODO |
| Admin retry/reverse RBAC + effect | int | — | TODO |

## 4. Manual test cases

| Case ID | Title | Priority | Preconditions | Steps | Test data | Expected result |
|---|---|---|---|---|---|---|
| `TRANSFERS-INT-001` | Wallet→wallet happy path | P0 | A funded, B exists, wallet flag on | `POST /paymax` | `amount_kobo=1_000_000`, key | 201; A debited `1_000_000`+fee `1_000`, B credited `1_000_000`, revenue `1_000` |
| `TRANSFERS-INV-001` | Wallet fee re-derived | P0 | funded | `POST /paymax` `amount_kobo=100_000` | ≤₦5k | Fee `0`; total debit `100_000` |
| `TRANSFERS-INV-002` | Bank fee re-derived | P0 | funded, PIN set | `POST /bank` `amount_kobo=6_000_000` | >₦50k | Fee `5_000`; reserve `6_005_000` to suspense |
| `TRANSFERS-INV-003` | Reserve leg balanced | P0 | funded | `POST /bank` | `amount_kobo=100_000` | DR user_wallet == CR `failed_transfer_suspense` == `amount+fee` |
| `TRANSFERS-INV-004` | Success sweep nets suspense to 0 | P0 | funds_reserved | provider success webhook | matching ref | DR suspense→CR settlement (amount) + DR suspense→CR paymax_revenue (fee); suspense 0 |
| `TRANSFERS-INV-005` | Failure reverses to source exactly | P0 | funds_reserved | provider failed webhook | — | REVERSAL restores `amount+fee` to user_wallet (wallet-src) / provider_clearing (bank-src); status `failed` |
| `TRANSFERS-INV-006` | Idempotent replay (paymax) | P0 | — | `POST /paymax` twice, same key | same key | 2nd returns prior row 200 `AlreadyProcessed`; no second debit — MONEY-INV-006 |
| `TRANSFERS-INV-007` | Concurrent same-key → one | P0 | funded | Fire N=10 `POST /paymax`, one key | same key | Exactly one succeeds; balance moved once — MONEY-INV-007 |
| `TRANSFERS-INV-008` | Overdraw rejected under lock | P0 | balance `100_000` | `POST /paymax` `150_000` | over | 402 `insufficient_funds`; balance unchanged |
| `TRANSFERS-UNIT-001` | Missing Idempotency-Key | P0 | — | `POST /paymax` no key (header+body) | none | 400 `idempotency_key_required` — MONEY-INV-008 |
| `TRANSFERS-UNIT-002` | Self-transfer rejected | P0 | — | `POST /paymax` recipient == sender | self | 422 `self_transfer_not_allowed` |
| `TRANSFERS-UNIT-003` | Invalid NUBAN | P1 | PIN set | `POST /bank` account `"123"` | short | 404 `invalid_account` |
| `TRANSFERS-CON-001` | Bank ₦1000 minimum | P1 | — | `POST /bank` `amount_kobo=50_000` | <100_000 | 400 (gin binding `min=100000`) — note: only binding enforces this, service checks only `≤0` |
| `TRANSFERS-TIER-001` | Tier limit enforced (wallet) | P0 | Tier-1 user, limit L | `POST /paymax` `L+1` | over | 403 `daily_limit_exceeded` — TIERS-UNIT-003 |
| `TRANSFERS-TIER-002` | Tier-0 wallet disabled | P0 | Tier-0 user | `POST /paymax` | — | 403 `wallet_disabled` |
| `TRANSFERS-TIER-003` | Bank→bank skips tier gate (finding) | P1 | Tier-0 user, PIN set | `POST /bank-to-bank` | — | Not blocked by tier (no `EnforceWalletDebitLimit`); PIN still required — document/confirm intended |
| `TRANSFERS-SEC-001` | Flag off → 503 per family | P0 | wallet flag off | `POST /paymax` | — | 503 `{code:"feature_disabled"}` (route mounted, family disabled) — FLAG-SEC-001 |
| `TRANSFERS-SEC-002` | PIN routes stay live when flags off | P1 | both transfer flags off | `GET /pin/status` | — | 200 (PIN routes not flag-gated) |
| `TRANSFERS-PIN-001` | Bank transfer requires PIN | P0 | funded, PIN set | `POST /bank` wrong PIN | wrong | 403 `pin_invalid`; no money moves |
| `TRANSFERS-PIN-002` | PIN lockout after 5 fails | P0 | PIN set | 5× wrong PIN, then correct | wrong×5 | After 5th → `pin_locked` (15-min window); correct PIN blocked until window elapses |
| `TRANSFERS-PIN-003` | Set PIN requires current when exists | P1 | PIN already set | `POST /pin` new PIN, wrong current | wrong current | Rejected `pin_invalid` |
| `TRANSFERS-PIN-004` | PIN format enforced | P1 | — | `POST /pin` `"12"` / `"1234567"` / `"abcd"` | bad | `pin_invalid` (4–6 numeric) |
| `TRANSFERS-PIN-005` | Wallet P2P needs no PIN (finding) | P2 | funded, no PIN set | `POST /paymax` | — | Succeeds (P2P has no PIN gate) — confirm intended |
| `TRANSFERS-AUTHZ-001` | Beneficiary IDOR | P0 | A owns beneficiary R | B calls `DELETE /beneficiaries/R` | R id | No-op / not-found (`WHERE id AND user_id`); B cannot delete A's — RBAC-AUTHZ-007 |
| `TRANSFERS-AUTHZ-002` | Identity from token only | P0 | A token | `POST /paymax` | — | Sender is A; no body `user_id` field to spoof |
| `TRANSFERS-AUTHZ-003` | Admin list denied to non-admin | P0 | non-admin | `GET /api/finance/admin/transfers` | — | 403 `forbidden` — RBAC-AUTHZ-001 |
| `TRANSFERS-AUTHZ-004` | Admin list allowed w/ permission | P0 | holds `finance.admin.transfers` | same | — | 200 |
| `TRANSFERS-AUTHZ-005` | Admin RBAC fail-closed on error | P0 | force CheckPermission error | admin route | — | 403 (never allow-on-error) — RBAC-AUTHZ-004 |
| `TRANSFERS-INT-002` | Admin retry re-drives payout | P1 | failed transfer, admin | `POST /admin/transfers/:id/retry` | — | Payout re-initiated; audit `actor` recorded — AUDIT-INT-002 |
| `TRANSFERS-INT-003` | Admin reverse credits back | P1 | settled transfer, admin | `POST /admin/transfers/:id/reverse` | — | Balanced reversal; audit written |
| `TRANSFERS-WH-001` | Unknown reference webhook | P1 | — | provider webhook, unmatched ref | random | 200 acknowledged, no ledger effect — WH-INT-003 |
| `TRANSFERS-WH-002` | Out-of-order / terminal replay | P2 | successful transfer | deliver late `pending`/duplicate `success` | reordered | Terminal not regressed; no double-settle — WH-SEC-005/004 |

## 5. State-machine transitions

Wallet P2P is written directly at `successful` in one atomic tx (no multi-step FSM). Bank / bank→bank statuses: `funds_reserved`, `awaiting_funding`, `funded`, `provider_initiated`, `successful`, `failed`, `reversed`. Guard `CanAdvanceBankToBank(from,to)` (rank map awaiting_funding=1, funded=2, provider_initiated=3, successful=4) allows only strictly `+1` forward, plus failed/reversed from any non-terminal.

| From | Event | To | Side effect | Case ID |
|---|---|---|---|---|
| (none) | wallet→bank create | `funds_reserved` | DR wallet → CR suspense (amount+fee) | `TRANSFERS-INV-003` |
| `funds_reserved` | provider accepted | `provider_initiated` | provider routing cached | `TRANSFERS-INT-002` |
| (none) | bank→bank create | `awaiting_funding` | no ledger yet; funding_reference seeded | — |
| `awaiting_funding` | collection webhook | `funded` | DR provider_clearing → CR suspense; auto payout | `TRANSFERS-INV-004` |
| `funded` | payout accepted | `provider_initiated` | — | (forward +1) |
| `provider_initiated` | success webhook | `successful` | DR suspense→settlement + fee→revenue | `TRANSFERS-INV-004` |
| any non-terminal | fail/reverse webhook | `failed`/`reversed` | REVERSAL restores amount+fee, drains suspense | `TRANSFERS-INV-005` |
| `awaiting_funding` | →provider_initiated/→successful | — | rejected (skip step) | `TRANSFERS-WH-002` |
| `funded` | →awaiting_funding | — | rejected (backwards) | — |
| `funded` | →funded | — | no-op (equal returns false) | — |
| terminal | any | — | rejected; `settleTransfer` no-op if already terminal | `TRANSFERS-WH-002` |

`NextStatusOnProviderError`: `funded`→`funded`; else →`funds_reserved` (funds parked in suspense, never rolled back on provider error).

## 6. Security & abuse cases

- **PIN lockout (`TRANSFERS-PIN-002`):** 5 wrong attempts → 15-min lock; DB-backed and currently **unit-untested** — prioritize an integration test.
- **Fee tampering impossible:** no fee field in any request; fee re-derived from amount (`TRANSFERS-INV-001/002`).
- **Idempotency across all money routes:** header wins over body; replay returns prior row; per-leg suffixed keys (`:reserve/:fund/:settle/:fee/:reversal`). `TRANSFERS-INV-006/007`.
- **Tier fail-closed on wallet paths** (`TRANSFERS-TIER-001/002`); **bank→bank omits tier gate** (`TRANSFERS-TIER-003`) — confirm intended.
- **Admin RBAC** deny-by-default + fail-closed (`TRANSFERS-AUTHZ-003/004/005`).
- **Beneficiary IDOR** scoped by `user_id` in SQL (`TRANSFERS-AUTHZ-001`).
- **Webhook** signature verified upstream (WH-SEC-001/002); unknown-ref / replay handled (`TRANSFERS-WH-001/002`).
- **PII:** phone masked to last-4; NUBAN structural check before any money path.

## 7. Automated specs to add

- `internal/finance/transfers/pin_lockout_integration_test.go` — skip-gated on `TEST_DATABASE_URL`: 5-fail lock, 15-min window expiry, reset on success (`TRANSFERS-PIN-002`). (gap)
- `internal/finance/transfers/live_db_integration_test.go` — real reserve→settle/reverse; idempotency replay + concurrent same-key; tier-gate fail-closed on wallet paths; bank→bank tier-gate absence assertion (`TRANSFERS-INV-006/007`, `TRANSFERS-TIER-*`). (gap G5/G7)
- `internal/finance/transfers/admin_handler_test.go` — RBAC deny/allow/fail-closed + retry/reverse effect + audit (`TRANSFERS-AUTHZ-003..005`, `TRANSFERS-INT-002/003`).
- `internal/finance/transfers/service_ext_test.go` — service-side re-validation of the bank ₦1000 minimum (currently only gin binding) closing the `TRANSFERS-CON-001` gap.

## 8. Coverage target & exit criteria

Tier-0: **≥ 85%** pure-logic (fee/FSM/error mapping/reversal already covered). Exit: all P0 money invariants proven on real Postgres (balanced legs, idempotency, overdraw, reversal); PIN lockout proven; tier fail-closed proven on wallet paths; admin RBAC deny-by-default + fail-closed proven; webhook replay/unknown-ref safe. A failing idempotency, tier, PIN-gate, or admin-RBAC case is a release blocker.
