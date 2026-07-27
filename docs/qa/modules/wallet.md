# Module: Wallet

**Risk tier:** 0 &nbsp;·&nbsp; **Money-path:** yes (read + debit gate) &nbsp;·&nbsp; **Feature flag:** `FEATURE_WALLET_ENABLED` (default off)
**Code:** `backend/internal/finance/wallet/` (`handler.go`, `service.go`, `model.go`, `model_test.go`); mounted in `backend/internal/app/finance_routes.go`
**Slug:** `WALLET` (uppercase, used in Case IDs)

## 1. Overview & scope

The wallet is the **user-facing projection of the ledger** `user_wallet` account. It exposes read endpoints (balance, transaction history) and internal debit/credit helpers used by the vote-bridge and Paystack top-up webhook. `Service.Debit` is the tier-gated money-out primitive: it calls `tiers.EnforceWalletDebitLimit` **before** `ledger.Debit`, so wallet debits inherit `../cross-cutting/kyc-and-tiers.md` fail-closed limits. Balances are never stored — every read is a ledger projection. Routes live under `/api/finance/wallet/*` (member) and `/api/finance/admin/wallets/:user_id/*` (admin), gated by `FEATURE_WALLET_ENABLED`. All auth facts are in `../cross-cutting/authentication.md`; money invariants in `../cross-cutting/money-invariants.md`.

**Known authorization finding to test:** the admin group (`/api/finance/admin`) is mounted with `requireUserID()` only — there is **no RBAC/permission middleware** on the admin wallet routes despite the "admin only" handler comments. Any authenticated user could read another user's balance/transactions via the `:user_id` path param. Cases `WALLET-AUTHZ-003/004` target this.

## 2. Services / endpoints in scope

| Operation | Method + path (or service func) | Auth / permission | Money-path? |
|---|---|---|---|
| Read own balance | `GET /api/finance/wallet/balance` | `requireUserID()` (token) | no (read) |
| List own transactions | `GET /api/finance/wallet/transactions?limit&offset` | `requireUserID()` | no (read) |
| Admin read balance | `GET /api/finance/admin/wallets/:user_id/balance` | `requireUserID()` only (no RBAC — finding) | no |
| Admin list transactions | `GET /api/finance/admin/wallets/:user_id/transactions` | `requireUserID()` only | no |
| Tier-gated debit | `Service.Debit(ctx, userID, ref, idemKey, creditAccountID, amountKobo)` | library | yes |
| Credit (top-up webhook) | `Service.Credit(ctx, userID, ref, idemKey, amountKobo)` | library | yes |
| Vote debit | `Service.VoteDebit(ctx, userID, ref, idemKey, amountKobo)` | library (via vote-bridge) | yes |

## 3. Test matrix by layer

| Behavior | Layer | Existing coverage (cite file) | Status |
|---|---|---|---|
| kobo→naira projection consistency | unit | `internal/finance/wallet/model_test.go` (`TestBalanceResponseConsistency`) | AUTOMATED |
| Balance non-negative invariant | unit | `model_test.go` (`TestBalanceMustNotBeNegative`) | AUTOMATED |
| Top-up request min 100 kobo + key required | unit | `model_test.go` (`TestTopupRequestMinimum`) | AUTOMATED |
| Transaction amounts positive; pagination shape | unit | `model_test.go` | AUTOMATED |
| Handler 401 on missing user_id | authz | — | TODO |
| Debit enforces tier limit first | inv | — (service delegation untested) | TODO |
| Admin routes lack RBAC (finding) | authz | — | TODO |
| limit/offset parsing & clamp | con | — | TODO |

## 4. Manual test cases

| Case ID | Title | Priority | Preconditions | Steps | Test data | Expected result |
|---|---|---|---|---|---|---|
| `WALLET-INT-001` | Read own balance | P0 | `qa-user-a` valid token, flag on, seeded balance | `GET /api/finance/wallet/balance` | balance `100000` | 200 `{user_id, balance_kobo:100000, balance_naira:1000}` |
| `WALLET-INT-002` | List own transactions | P1 | seeded entries | `GET /wallet/transactions?limit=10` | — | 200; `type` = credit for CREDIT/REVERSAL_DEBIT else debit; kobo-exact |
| `WALLET-CON-001` | limit clamp | P2 | — | `GET /wallet/transactions?limit=9999` | `9999` | Service clamps to 20 (limit≤0 or >100 → 20) |
| `WALLET-CON-002` | Non-numeric limit/offset | P2 | — | `?limit=abc&offset=xyz` | garbage | Atoi errors ignored → 0/default; no 500 |
| `WALLET-INV-001` | Debit enforces tier limit first | P0 | Tier-1 user, limit L | `Service.Debit` `L+1` | over limit | Rejected by `EnforceWalletDebitLimit` before ledger; nothing posted — see `../cross-cutting/kyc-and-tiers.md` TIERS-UNIT-003 |
| `WALLET-INV-002` | Debit fail-closed on tier lookup error | P0 | force tier lookup error | `Service.Debit` any | — | Blocked (503-class), never allowed — TIERS-SEC-001 |
| `WALLET-INV-003` | Debit overdraw rejected | P0 | balance `100000` | `Service.Debit` `150000` | over | `ErrInsufficientFunds`; balance unchanged (via ledger advisory lock) |
| `WALLET-INV-004` | Credit idempotent replay | P0 | pending top-up ref | `Service.Credit` twice, same key | same key | Single credit; entry count unchanged — MONEY-INV-006 |
| `WALLET-INV-005` | VoteDebit tier-gated | P1 | Tier-0 user | `VoteDebit` any amount | — | Blocked (VoteDebit routes through `Debit` → tier check) |
| `WALLET-AUTHZ-001` | Missing token on member route | P0 | no token | `GET /wallet/balance` | — | 401 `unauthenticated` (handler) — `../cross-cutting/authentication.md` AUTH-UNIT-001 |
| `WALLET-AUTHZ-002` | Token identity, not body/param | P0 | `qa-user-a` token | `GET /wallet/balance` | — | Balance is `qa-user-a`'s; no body/query overrides identity |
| `WALLET-AUTHZ-003` | Admin route reachable w/o RBAC (finding) | P0 | any authenticated non-admin | `GET /api/finance/admin/wallets/<other>/balance` | victim id | **Currently 200** (no RBAC guard) — file as S2 authz defect; expected target: 403 `forbidden` |
| `WALLET-AUTHZ-004` | IDOR via admin path param | P0 | `qa-user-b` token | `GET /admin/wallets/<qa-user-a>/transactions` | qa-user-a id | Should be denied; assert against target contract (RBAC `finance.admin.wallets`) — RBAC-AUTHZ-007 |
| `WALLET-SEC-001` | Flag off → routes not mounted | P0 | `FEATURE_WALLET_ENABLED` off | `GET /wallet/balance` | — | 404 (member + admin wallet routes both inside the flag block) — FLAG-SEC-001 |
| `WALLET-SEC-002` | Audit on debit | P1 | — | `Service.Debit` once | — | One audit event (actor=token id, amount kobo, idem ref) — AUDIT-INT-001 |

## 5. State-machine transitions

Not applicable — no FSM. (`TopupIntent.Status` pending|success|failed is driven by the Paystack webhook path documented in `../cross-cutting/webhooks-and-providers.md`, not by this module's handlers.)

## 6. Security & abuse cases

- **Missing RBAC on admin routes (`WALLET-AUTHZ-003/004`):** highest-value finding — admin wallet reads are only `requireUserID()`-gated. Confirm the intended guard is `RequirePermission(rbac, "finance.admin.wallets")` and that it is enforced before go-live; see `../cross-cutting/rbac-and-permissions.md`.
- **Header/identity spoofing:** member handlers read `c.GetString("user_id")` (token), not body — a spoofed `user_id` must be ignored (`WALLET-AUTHZ-002`, AUTH §4).
- **Tier fail-closed:** wallet debit inherits `../cross-cutting/kyc-and-tiers.md` TIERS-SEC-001/002.
- **No overdraw / no float:** `../cross-cutting/money-invariants.md` I1/I4.

## 7. Automated specs to add

- `internal/finance/wallet/handler_test.go` — httptest table: 401 on missing user_id; balance JSON shape; limit/offset clamp; admin path-param routing. Follow the hoisted-mock/table style. (covers WALLET-AUTHZ-001, CON-001/002)
- `internal/finance/wallet/service_test.go` — fake `tiers.Service` + `ledger.Service` seams proving `Debit` calls `EnforceWalletDebitLimit` **before** `ledger.Debit`, and fail-closes on tier error (WALLET-INV-001/002). (gap)
- `internal/app/finance_routes_wallet_authz_test.go` — assert admin wallet routes require the finance-admin permission (currently a gap) — the RBAC regression that would catch `WALLET-AUTHZ-003`.

## 8. Coverage target & exit criteria

Tier-0: **≥ 85%** pure-logic (model already covered). Exit: member read auth proven; `Service.Debit` tier-gate-first + fail-closed proven at the seam; **admin RBAC gap resolved** (WALLET-AUTHZ-003 no longer 200 for a non-admin); flag-off returns 404; audit emitted on debit. A failing `WALLET-AUTHZ-003` or `WALLET-INV-001/002` is a release blocker.
