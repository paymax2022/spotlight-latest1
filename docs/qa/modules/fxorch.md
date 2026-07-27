# Module: FX Orchestration (provider-agnostic engine)

**Risk tier:** 0 &nbsp;·&nbsp; **Money-path:** yes (quote→lock→execute) &nbsp;·&nbsp; **Feature flag:** `FEATURE_FX_ORCHESTRATION_ENABLED`
**Code:** `backend/internal/orchestration/` (`domain.go`, `service.go`, `handler.go`, `errors.go`, `spread.go`, `treasury.go`, `recon.go`, `compliance.go`, `webhooks.go`, `quotebook.go`, `money.go`, `rates.go`, secondary/business/cards stores + `orchestration_test.go`, `compliance_test.go`, `domain_json_test.go`, `secondary_store_test.go`, `cards_store_test.go`); adapters in `orchestration/adapters/`; mounted in `backend/internal/app/finance_routes.go` at `/api/v1/fx`
**Slug:** `FXORCH` (uppercase, used in Case IDs)

## 1. Overview & scope

FX Orchestration is the **normalized, provider-agnostic FX engine**: smart order routing across providers (Maplerad + Eversend), a spread engine (bps markup over provider all-in rate, guarded min/max), a treasury float model (per provider/currency buckets with low/high-water + exposure limits), a compliance screen (blocks/errors fail-closed), quote→lock→execute with idempotency, unified transaction ledger, inbound provider webhooks (per-provider signature verify) and outbound signed webhooks. The money-path surface is `POST /quotes`, `POST /quotes/:id/lock`, `POST /conversions`, `POST /transfers`, `POST /collections/virtual-accounts` (all under `/api/v1/fx`, auth via `mapsAuth` + `requireUserID`). A large secondary surface (beneficiaries, virtual cards, business-admin console, notifications, rate alerts, customer verification) is **contract-shaped and NOT money-path** — those are stubs / persistence-only. Cross-cutting: `../cross-cutting/money-invariants.md`, `../cross-cutting/webhooks-and-providers.md`, `../cross-cutting/kyc-and-tiers.md`.

## 2. Services / endpoints in scope

| Operation | Method + path (`/api/v1/fx`) | Auth | Money-path? |
|---|---|---|---|
| Create quote | `POST /quotes` | token (customer) | no (priced offer) |
| Lock quote | `POST /quotes/:id/lock` | token (owner) | no |
| Execute conversion | `POST /conversions` | token + `Idempotency-Key` | yes |
| Execute transfer (payout) | `POST /transfers` | token + `Idempotency-Key` | yes |
| Create collection VA | `POST /collections/virtual-accounts` | token | no (provision) |
| Rates / balances / transactions | `GET /rates`, `/balances`, `/transactions`, `/transactions/:id` | token (owner) | no |
| Inbound webhook | `POST /api/v1/fx/webhooks/:provider` | none (per-provider signature) | yes (status apply) |
| Secondary (beneficiaries, cards, business-admin, notifications, rate-alerts, verification) | various | token / per-route RBAC | **no (stubs/persistence)** |

Requests (`domain.go`): `QuoteRequest{source, destination, amount (min=1), amountType, intent (required), destinationRail, lock}`; `ConversionRequest{quote_id (required), customer_id, reference}`; `TransferRequest{quote_id?, customer_id, beneficiary_id?, destination?, amount?, narration, reference}`; `CollectionRequest{customer_id, currency (required), type (required)}`. **`Idempotency-Key` header is required on conversions + transfers** (missing → `invalid_request/missing_idempotency_key`). Normalized error envelope in `errors.go` (11 types → HTTP mapping).

## 3. Test matrix by layer

| Behavior | Layer | Existing coverage (cite file) | Status |
|---|---|---|---|
| Rate rounding / inverse / bps / triangulation | unit | `orchestration_test.go` (`TestApplyRateRounding`, `TestInverseAmount`, `TestBpsOf`, `TestMidRateTriangulation`) | AUTOMATED |
| Spread customer-rate + min/max guards | unit | `orchestration_test.go` (`TestSpreadCustomerRateAndGuards`, `TestSpreadGuardClamps`) | AUTOMATED |
| Router picks highest score / no-viable | unit | `orchestration_test.go` (`TestRouterPicksHighestScore`, `TestRouterNoViable`) | AUTOMATED |
| Quote consume + expiry | fsm | `orchestration_test.go` (`TestQuoteBookConsumeExpiry`) | AUTOMATED |
| Conversion happy path + idempotency | inv | `orchestration_test.go` (`TestConversionHappyPathAndIdempotency`) | AUTOMATED |
| Insufficient balance / rate expired / failover | inv | `orchestration_test.go` (`TestConversionInsufficientBalance`, `_RateExpired`, `_FailoverToAlternative`) | AUTOMATED |
| Missing idempotency key rejected | con | `orchestration_test.go` (`TestMissingIdempotencyKey`) | AUTOMATED |
| Reconcile + canonical status mapping | unit | `orchestration_test.go` (`TestReconcile`, `TestCanonStatusMapping`) | AUTOMATED |
| Compliance block/error fails closed before debit | sec | `compliance_test.go` (`TestExecuteTransferComplianceBlockHaltsBeforeDebit`, `_ScreenerErrorFailsClosed`, `TestCreateQuoteComplianceEnforcement`) | AUTOMATED |
| JSON contract camelCase | con | `domain_json_test.go` | AUTOMATED |
| Beneficiary/rate-alert cross-customer isolation | authz | `secondary_store_test.go` (`TestBeneficiaryCrossCustomerIsolation`, `TestHandlerBeneficiaryObjectLevelAuthZ`) | AUTOMATED |
| Card fund insufficient / idempotent / scoping | inv/authz | `cards_store_test.go` (`TestFundCard_InsufficientFunds_402`, `_Idempotent`, `TestCard_CustomerScoping`) | AUTOMATED (stub store) |
| Inbound webhook signature verify (per provider) | sec | — | TODO |
| Treasury exposure-limit routing (real) | int | — (unit via router) | PARTIAL |

## 4. Manual test cases

| Case ID | Title | Priority | Preconditions | Steps | Test data | Expected result |
|---|---|---|---|---|---|---|
| `FXORCH-INT-001` | Quote → lock → convert | P0 | flag on, funded held balance | `POST /quotes` (lock=true) → `POST /conversions` w/ key | USD-NGN, `amount=1000_00` | Quote `locked`; conversion `settled`/`pending`; source debited once after provider success |
| `FXORCH-INV-001` | Conversion idempotent replay | P0 | one conversion | `POST /conversions` same `Idempotency-Key` | same key | Returns existing conversion; no second debit — MONEY-INV-006 |
| `FXORCH-INV-002` | Missing idempotency key | P0 | locked quote | `POST /conversions` no header | none | 400 `missing_idempotency_key` — MONEY-INV-008 |
| `FXORCH-INV-003` | Insufficient balance halts | P0 | held balance < source total | `POST /conversions` | short | 422 `insufficient_balance`; nothing moves |
| `FXORCH-INV-004` | Debit happens once, after provider success | P0 | valid quote | `POST /conversions` | — | Single ledger debit post-success; failover never double-spends |
| `FXORCH-INV-005` | Spread retained as revenue | P1 | corridor USD-NGN, retail tier | `POST /quotes` | — | `customerRate = providerRate*(1 − bps/10000)`; spread within min/max guard |
| `FXORCH-FSM-001` | Convert expired quote | P0 | quote past `ExpiresAt` | `POST /conversions` | expired | 409 `rate_expired`; nothing moves |
| `FXORCH-FSM-002` | Consume already-consumed quote | P0 | quote consumed | `POST /conversions` same quote | consumed | Rejected (Consume guards status); no double-execute |
| `FXORCH-INT-002` | Failover to alternative provider | P1 | primary provider errors | `POST /conversions` | — | Executes on alternative within locked tolerance; single debit |
| `FXORCH-INT-003` | No viable route | P1 | float/exposure exhausted | `POST /quotes` | over-exposure | 422 `routing_unavailable`; no quote |
| `FXORCH-SEC-001` | Compliance block halts before debit | P0 | screener blocks customer/corridor | `POST /transfers` | blocked | 422 `compliance_block`; NO ledger debit |
| `FXORCH-SEC-002` | Screener error fails closed | P0 | screener errors | `POST /transfers` | — | Blocked (`compliance_block`), never allowed — TIERS-SEC-001 analogue |
| `FXORCH-SEC-003` | Inbound webhook forged signature | P0 | provider configured | `POST /webhooks/:provider` wrong/absent sig | tampered | `authentication/invalid_signature`; no status applied — WH-SEC-002 |
| `FXORCH-SEC-004` | Inbound webhook replay idempotent | P0 | event applied | POST identical event again | same ref | Terminal state not regressed; no double-apply — WH-SEC-004 |
| `FXORCH-AUTHZ-001` | Transaction owner-scoped (IDOR) | P0 | A owns tx T | B `GET /transactions/T` | T id | Not found / denied (scoped by `customerID`) — RBAC-AUTHZ-007 |
| `FXORCH-AUTHZ-002` | Beneficiary cross-customer isolation | P0 | A saved beneficiary | B lists/updates it | — | B cannot see/act on A's (covered by `secondary_store_test.go`) |
| `FXORCH-AUTHZ-003` | Lock another customer's quote | P0 | A owns quote | B `POST /quotes/:id/lock` | A's quote | `quote_not_found` (scoped by customer) |
| `FXORCH-AUTHZ-004` | Identity from token | P0 | A token | any `/v1/fx` call | — | `customerID = c.GetString("user_id")`; body `customer_id` does not override token |
| `FXORCH-CON-001` | Same source==destination rejected | P1 | — | `POST /quotes` USD→USD | same ccy | 400 `same_currency` |
| `FXORCH-CON-002` | Unsupported currency | P1 | — | `POST /quotes` XXX→NGN | bad ccy | 400 `unsupported_currency` |
| `FXORCH-SEC-005` | Flag off → routes not mounted | P0 | `FEATURE_FX_ORCHESTRATION_ENABLED` off | `POST /quotes` | — | 404 (whole `/api/v1/fx` block gated) — FLAG-SEC-001 |
| `FXORCH-CON-003` | Secondary stubs are not money-path | P2 | flag on | `POST /cards`, `POST /beneficiaries` | — | Contract-shaped response; NO ledger movement (confirm no money effect) |

## 5. State-machine transitions

Three canonical status machines (`domain.go`, Appendix B). Provider-native statuses map via `canonTransferStatus` / `canonConversionStatus`.

| Machine | From | Event | To | Case ID |
|---|---|---|---|---|
| Quote | `quoted` | lock | `locked` | `FXORCH-INT-001` |
| Quote | `locked` | consume (execute) | `consumed` | `FXORCH-FSM-002` |
| Quote | `quoted`/`locked` | TTL elapse | `expired` | `FXORCH-FSM-001` |
| Quote | `consumed`/`expired` | consume | — (rejected) | `FXORCH-FSM-002` |
| Conversion | `pending` | provider settle webhook | `settled` | `FXORCH-INT-001` |
| Conversion | `pending` | provider fail webhook | `failed` | — |
| Transfer | `queued` | processing | `processing` | — |
| Transfer | `processing` | paid webhook | `paid` | — |
| Transfer | `processing` | fail/reverse webhook | `failed`/`reversed` | `FXORCH-SEC-004` |

Illegal: executing a `consumed`/`expired` quote, regressing a terminal transfer/conversion on a late/duplicate webhook (`FXORCH-SEC-004` — terminal must not regress).

## 6. Security & abuse cases

- **Compliance fail-closed (`FXORCH-SEC-001/002`):** the screen runs before any debit on quote/conversion/transfer; a block or a screener error halts and nothing moves (`compliance_test.go` proves halt-before-debit).
- **Webhook signature per provider (`FXORCH-SEC-003`):** `VerifyProviderWebhook` delegates to the provider adapter's `VerifyWebhookSignature`; unknown provider or bad sig → reject, no apply.
- **Replay / out-of-order (`FXORCH-SEC-004`):** `HandleProviderEvent` is idempotent; a terminal state must not regress.
- **Idempotency on execution (`FXORCH-INV-001/002`):** `Idempotency-Key` required on conversions + transfers; replay returns the existing record; debit happens once, after provider success (no double-spend on failover, `FXORCH-INV-004`).
- **Customer scoping / IDOR (`FXORCH-AUTHZ-001/002/003`):** quotes, transactions, beneficiaries, cards all scoped by `customerID` (from token); body `customer_id` does not override token (`FXORCH-AUTHZ-004`).
- **Treasury exposure limits:** routing must reject routes exceeding a provider/currency exposure limit (`FXORCH-INT-003`).
- **No-float:** amounts are minor-unit integers (`money.go`); rates are display/derivation floats, never the stored money value.

## 7. Automated specs to add

- `internal/orchestration/webhooks_signature_test.go` — per-provider valid/forged/tampered/replay table for `VerifyProviderWebhook` + `HandleProviderEvent` idempotency (`FXORCH-SEC-003/004`). (gap G10)
- `internal/orchestration/live_db_integration_test.go` — skip-gated on `TEST_DATABASE_URL`: quote→lock→consume against the real store + ledger, single-debit-after-success, transaction IDOR (`FXORCH-INT-001`, `FXORCH-AUTHZ-001`).
- Treasury exposure-limit routing test extending `orchestration_test.go` (route rejected when a bucket's exposure/float is exhausted) (`FXORCH-INT-003`).

## 8. Coverage target & exit criteria

Tier-0: **≥ 85%** on pure-logic money funcs (routing/spread/quotebook/reconcile/compliance already strongly covered). Exit: quote→lock→execute idempotency + single-debit-after-success proven on real store; compliance fail-closed proven (already unit-proven, add integration); webhook signature verify + replay idempotency proven per provider; customer scoping/IDOR proven; flag-off returns 404; secondary stubs confirmed non-money-path. A double-spend, compliance bypass, or webhook-forgery pass is an S1 blocker.
