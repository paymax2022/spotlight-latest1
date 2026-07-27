# Module: Business (CAC Business Registry)

**Risk tier:** 1 &nbsp;·&nbsp; **Money-path:** yes &nbsp;·&nbsp; **Feature flag:** `FEATURE_BUSINESS_REGISTRY_ENABLED`
**Code:** `backend/internal/business/` — `handler.go`, `service.go`, `repository.go`, `model.go`, `statemachine.go`, `routes.go`. Mounted in `backend/internal/app/finance_routes.go` (`business.Register`, ~L1930): member routes on the finance group → `/api/finance/business/*`; admin on `r.Group("/api/business/admin")` (`RequireAuthContext` + `requireUserID`, then per-route RBAC `business.registry.review`). CAC provider is `provider/cac.BusinessRegistryProvider` (real HTTP adapter when `CAC_VAS_*` configured, else deterministic sandbox). Fee money reuses `finance/wallet` + `finance/ledger`; gateway alternative uses `provider.PaymentProvider` (Paystack). No in-package `*_test.go`.
**Slug:** `BUSINESS` (uppercase, used in Case IDs)

## 1. Overview & scope

Business Registry is a CAC (Corporate Affairs Commission) identity module with two flows: **register-new** (name check → reserve → pay fee → submit → CAC review → registered) and **verify-existing** (look up + verify an existing RC/BN number). It charges a real, tier-checked, idempotent **registration fee** to the caller's wallet, or via a Paystack gateway alternative. The fee is two legs: the **CAC registration fee** (₦15,000 = `1_500_000` kobo, a pass-through credited to `provider_clearing`) plus a **platform processing fee** (₦2,000 = `200_000` kobo, Paymax revenue credited to `paymax_revenue`) — total charged `1_700_000` kobo. It returns `HasVerifiedBusiness`, the merchant-upgrade gate consulted by onboarding before granting CAC-requiring merchant roles. The whole lifecycle is a guarded state machine (`statemachine.go`). Testing priorities: the fee money path (idempotency + fee-first ordering + affordability on the TOTAL), the CAC provider fail-closed behaviour (`ErrProvider`→502), object-level ownership (`ownedProfile`), the FSM legality, and admin-review RBAC. Cross-cutting: `../cross-cutting/money-invariants.md`, `authentication.md`, `rbac-and-permissions.md`, `kyc-and-tiers.md`, `webhooks-and-providers.md`, `feature-flags-and-audit.md`.

## 2. Services / endpoints in scope

| Operation | Method + path | Auth / permission | Money-path? |
|---|---|---|---|
| Name availability check | `POST /api/finance/business/name/check` `{proposedName, businessId?, lineOfBusiness?}` | member | no (CAC call) |
| Reserve name | `POST /api/finance/business/name/reserve` `{businessId}` | member; **owner** | no (CAC call) |
| Verify existing business | `POST /api/finance/business/verify` `{rcOrBnNumber, entityType?}` | member | no (CAC call) |
| Start register-new | `POST /api/finance/business/register` `{entityType, proposedName, …, proprietors[]}` | member | no |
| Pay registration fee (wallet) | `POST /api/finance/business/:id/pay-fee` + `Idempotency-Key` | member; **owner** | **yes** |
| Init fee via Paystack | `POST /api/finance/business/:id/pay-fee/paystack` `{email?, callbackUrl?}` | member; **owner** | no (no money moves) |
| Verify Paystack fee | `POST /api/finance/business/:id/pay-fee/paystack/verify` `{reference}` | member; **owner** | **yes** (marks paid) |
| Submit registration | `POST /api/finance/business/:id/submit` + `Idempotency-Key` | member; **owner** | no (CAC call; fee-gated) |
| Refresh status | `GET /api/finance/business/:id/status` | member; **owner** | no (CAC poll) |
| Get certificate | `GET /api/finance/business/:id/certificate` | member; **owner** | no |
| List my businesses | `GET /api/finance/business/me` | member (own) | no |
| Get one | `GET /api/finance/business/:id` | member; **owner** | no |
| Admin list | `GET /api/business/admin` `?status&mode&limit` | `RequirePermission("business.registry.review")` | no |
| Admin get | `GET /api/business/admin/:id` | `business.registry.review` | no |
| Admin approve (override) | `POST /api/business/admin/:id/approve` | `business.registry.review` | no |
| Admin reject | `POST /api/business/admin/:id/reject` `{reason}` | `business.registry.review` | no |

## 3. Test matrix by layer

| Behavior | Layer | Existing coverage (cite file) | Status |
|---|---|---|---|
| FSM legality (`CanTransition`, `IsTerminal`, `IsVerifiedOrRegistered`) | fsm | — (map in `statemachine.go`) | TODO |
| Fee two-leg charge: CAC→`provider_clearing`, platform→`paymax_revenue`; total kobo-exact | inv | — (logic in `service.go` `PayRegistrationFee`) | TODO |
| Fee idempotent replay (per-leg keys `idemKey` / `idemKey:platform`); already-paid short-circuit | inv | — | TODO |
| Affordability pre-check on TOTAL before any leg posts | inv | — | TODO |
| Paystack verify fail-closed (only `status==success` && `amount>=total` marks paid) | sec | — | TODO |
| CAC provider error → `ErrProvider` (502) fail-closed; `HasVerifiedBusiness` false on error | sec | — | TODO |
| Ownership on every `:id` op (`ownedProfile` → `ErrForbidden`) | authz | — | TODO |
| Admin review RBAC (`business.registry.review`) | authz | — | TODO |
| Flag-off route not mounted | sec | — | TODO |

No in-package or `backend/tests/` suite currently exercises this module — all rows are TODO (see §7).

## 4. Manual test cases

| Case ID | Title | Priority | Preconditions | Steps | Test data | Expected result |
|---|---|---|---|---|---|---|
| `BUSINESS-INT-001` | Register-new happy path to submitted | P0 | member funded ≥ `1_700_000` | register → name/check → name/reserve → pay-fee → submit | fee `1_500_000` + platform `200_000` | states advance draft→name_check→name_reserved→(fee paid)→registration_submitted; ticket returns profile |
| `BUSINESS-INT-002` | Verify-existing happy path | P1 | member; sandbox knows RC | `POST /verify {rcOrBnNumber}` | valid RC/BN | draft→submitted→verified; `legalName`/`rc_or_bn_number` populated; terminal `verified` |
| `BUSINESS-INT-003` | Pay fee debits two balanced legs | P0 | profile `name_reserved`, wallet ≥ total | `POST /:id/pay-fee` + key `k1` | `1_700_000` total | 200; wallet −`1_700_000`; `provider_clearing` +`1_500_000`; `paymax_revenue` +`200_000`; `fee_ledger_ref` set; `feeBreakdown` audit |
| `BUSINESS-INT-004` | Submit requires fee paid | P0 | profile `name_reserved`, fee UNPAID | `POST /:id/submit` + key | `FeeLedgerRef=""` | 409 `ErrFeeNotPaid`; no CAC submission |
| `BUSINESS-INT-005` | Admin approve override to terminal | P1 | profile `under_review` | `POST /admin/:id/approve` | register-new mode | → `registered` (verify-existing → `verified`); `admin.approved` audit `override:true` |
| `BUSINESS-INT-006` | Get certificate 404 until ready | P2 | registered, no cert URL yet | `GET /:id/certificate` | cert missing | 404 `ErrCertNotReady`; once CAC returns URL → 200 `{certificateUrl}` |
| `BUSINESS-INV-001` | Fee idempotent replay | P0 | one fee key `k1` used | repeat `POST /:id/pay-fee` with `k1` | same key | already-paid short-circuit → same profile; no second debit (MONEY-INV-006); per-leg keys dedupe |
| `BUSINESS-INV-002` | Affordability on TOTAL, not per-leg | P0 | wallet = `1_600_000` (covers CAC but not platform) | `POST /:id/pay-fee` | `< 1_700_000` | 402 `ErrInsufficientFunds` BEFORE any leg posts; wallet unchanged; no partial charge |
| `BUSINESS-INV-003` | Submit idempotent replay | P1 | already submitted (`CACRegistrationRef` set) | `POST /:id/submit` again + key | — | returns current state; no duplicate CAC submission |
| `BUSINESS-SEC-001` | Missing Idempotency-Key on pay-fee | P0 | profile `name_reserved` | `POST /:id/pay-fee` no header | no key | 400 `ErrMissingIdemKey` (MONEY-INV-008); no money moved |
| `BUSINESS-SEC-002` | Missing Idempotency-Key on submit | P1 | profile ready | `POST /:id/submit` no header | no key | 400 `ErrMissingIdemKey` |
| `BUSINESS-SEC-003` | Paystack verify fails closed | P0 | pending Paystack ref | verify where gateway `status!=success` OR `amount<1_700_000` | short/failed charge | 409 `ErrFeeNotPaid`; fee NOT marked paid; no status flip |
| `BUSINESS-SEC-004` | CAC provider error fail-closed | P0 | provider errors on check/reserve/submit | trigger a CAC call | dependency error | 502 `ErrProvider`; no state advance past the failed step |
| `BUSINESS-SEC-005` | Duplicate verify same RC/BN | P1 | user already verified this number | `POST /verify` same RC | unique violation | 409 `ErrDuplicate` "already exists" |
| `BUSINESS-SEC-006` | Register-new validation | P2 | member | `POST /register` missing `entityType`/`proposedName` | empty required | 422 `ErrValidation` |
| `BUSINESS-AUTHZ-001` | Ownership on `:id` ops (IDOR) | P0 | profile owned by A | B calls pay-fee / submit / status / get on A's `:id` | B != owner | 403 `ErrForbidden` (`ownedProfile`); no money moved |
| `BUSINESS-AUTHZ-002` | Admin review requires permission | P0 | caller lacking grant | `GET /api/business/admin` | no `business.registry.review` | 403 (see `../cross-cutting/rbac-and-permissions.md`) |
| `BUSINESS-AUTHZ-003` | Admin reject requires reason | P2 | admin, non-terminal profile | `POST /admin/:id/reject {}` | empty reason | 400 "reason is required"; terminal profile → 409 `ErrConflict` |
| `BUSINESS-SEC-007` | Flag-off inaccessible | P0 | `FEATURE_BUSINESS_REGISTRY_ENABLED=off` | call any `/business/*` route | — | Route not mounted / 404 — never 500 (FLAG-SEC-001) |

## 5. State-machine transitions

Real FSM in `statemachine.go` (`allowedTransitions`, `CanTransition`, `IsTerminal`). Every transition is enforced by the repository `transition` (guarded `WHERE status IN (fromStates)`) and logged to `business_profile_events`. Terminal states (`registered`, `verified`, `rejected`, `failed`) have **no** outgoing edges.

| From | Event | To | Side effect | Case ID |
|---|---|---|---|---|
| `draft` | name check (owned) | `name_check` | CAC availability recorded | `BUSINESS-FSM-001` |
| `draft`/`name_check` | reserve name | `name_reserved` | CAC reservation ref stored | `BUSINESS-FSM-002` |
| `name_reserved` | submit (fee paid) | `registration_submitted` | CAC submission; provider ref stored | `BUSINESS-FSM-003` |
| `registration_submitted` | provider queues / registers | `under_review` / `registered` | status poll advances | `BUSINESS-FSM-004` |
| `under_review` | CAC registers | `registered` (terminal) | RC/BN + cert URL + `registered_at` | `BUSINESS-FSM-005` |
| `draft` | verify-existing submit | `submitted` | lookup in flight | `BUSINESS-FSM-006` |
| `submitted` | CAC found | `verified` (terminal) | legal name + source | `BUSINESS-FSM-007` |
| non-terminal | admin reject / CAC rejected/failed | `rejected` / `failed` (terminal) | reason recorded | `BUSINESS-FSM-008` |
| `draft`→`under_review` (skip) | any illegal edge | — | rejected `ErrConflict` (409); guarded update no-ops | `BUSINESS-FSM-009` |
| any terminal | any event | — | rejected (`IsTerminal`); no-op | `BUSINESS-FSM-010` |

Illegal transitions (e.g. `draft`→`registration_submitted`, submit from a non-`name_reserved` state) must be rejected with `ErrConflict`. Re-entering a terminal state must be a guarded no-op (RowsAffected=0), not a second side effect.

## 6. Security & abuse cases

- **Fee-first + affordability on TOTAL:** `BUSINESS-INV-002` — the wallet must cover CAC + platform together before either `wallet.Debit` runs, so a user is never left charged for one leg but not the other. Each leg dedupes on a distinct idempotency key (`idemKey`, `idemKey:platform`).
- **Server-side re-pricing:** the fee amount is server-derived (`DefaultRegistrationFeeKobo` + `DefaultPlatformFeeKobo`, or `Deps.FeeKobo`), never from the request body — no amount tampering surface.
- **Gateway fail-closed:** `BUSINESS-SEC-003` — Paystack verify marks paid only on `status==success` AND `amount>=total`; the bookkeeping ledger post (`recordPaystackFeeLedger`) is best-effort and must never gate the user's paid status. Signature/verification cross-cutting: `../cross-cutting/webhooks-and-providers.md`.
- **CAC provider fail-closed:** `BUSINESS-SEC-004` — every CAC call wraps errors to `ErrProvider` (502); `HasVerifiedBusiness` returns false on any error so the merchant-upgrade gate never opens on a lookup failure.
- **IDOR:** `BUSINESS-AUTHZ-001` — every `:id` operation resolves through `ownedProfile` and rejects a non-owner; identity is the token `userID`, never a body id.
- **PII minimisation:** proprietor BVN/NIN are never persisted raw — only a masked tail (`maskTail`) is stored and returned. Assert no raw identity leaks in API responses (see `../cross-cutting/authentication.md` PII notes).
- **Audit actor identity:** transitions + fee events log the token actor via the repository event writer / audit sink (AUDIT-SEC-001).
- Inherit `../cross-cutting/money-invariants.md` (idempotency, balanced double-entry, no-float) and `../cross-cutting/kyc-and-tiers.md` (the fee debit runs through `wallet.Debit`, which enforces the tier-limit check fail-closed).

## 7. Automated specs to add

- `internal/business/statemachine_test.go` — table-driven `CanTransition` legal/illegal matrix + `IsTerminal`/`IsVerifiedOrRegistered`, following the placement `TestCanTransition` convention (`BUSINESS-FSM-*`). TODO.
- `internal/business/fee_math_test.go` — pure `totalFeeKobo`, leg split (CAC vs platform), default-vs-override fee, kobo-exact; asserts total == sum of legs (`BUSINESS-INV-001/002`). TODO.
- `internal/business/service_live_db_test.go` — live-DB (gated on `TEST_DATABASE_URL`): pay-fee two-leg balanced post + idempotent replay, affordability-on-total, submit fee-gate, ownership IDOR denials, admin approve/reject transitions. Use a stub `cac.BusinessRegistryProvider` + `provider.PaymentProvider`. TODO.
- `internal/business/provider_failclosed_test.go` — stub CAC provider returning errors → `ErrProvider`; `HasVerifiedBusiness` false on repo error; Paystack verify fail-closed on partial/failed charge (`BUSINESS-SEC-003/004`). TODO.

## 8. Coverage target & exit criteria

Tier-1 pure-logic floor ≥ 80% on the FSM map + fee math. Exit criteria (release-ready): `BUSINESS-INT-003` (two-leg charge), `BUSINESS-INV-001/002` (idempotent replay + affordability-on-total), `BUSINESS-INT-004` (submit fee-gate), `BUSINESS-SEC-001/003/004` (missing key, gateway + provider fail-closed), `BUSINESS-AUTHZ-001/002` (IDOR + admin RBAC), and `BUSINESS-FSM-009/010` (illegal + terminal re-entry) all green; flag-off `BUSINESS-SEC-007` verified; no S1 open.
