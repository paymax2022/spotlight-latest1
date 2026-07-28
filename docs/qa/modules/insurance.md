# Module: Insurance (Protection)

**Risk tier:** 0 &nbsp;·&nbsp; **Money-path:** yes &nbsp;·&nbsp; **Feature flag:** `FEATURE_INSURANCE_ENABLED`
**Code:** `backend/internal/insurance/` — `policy/{model.go,service.go,handler.go,repository.go}`, `claims/{model.go,service.go,handler.go,register.go,repository.go}`, `embedded/{service.go,model.go,register.go}`, `webhooks/{service.go,handler.go,register.go}`, `reconciliation/{service.go,register.go}`, `catalog/handler.go`, `consent/`, `gateway/`. Providers: `provider/mycover`, `provider/octamile`. Mounted in `backend/internal/app/insurance_routes.go` (`RegisterInsurance`) + `insurance_claims_routes.go` (`RegisterInsuranceClaims`); wired by `finance_routes.go` under `if cfg.FeatureInsuranceEnabled && pool != nil`. Reuses `finance/wallet` (+ `finance/tiers`) + `finance/ledger`.
**Slug:** `INSURANCE` (uppercase, used in Case IDs)

## 1. Overview & scope

Insurance is Spotlight's provider-agnostic protection layer over aggregators (MyCover / Octamile, resolved from the data-driven `catalog`). Two buy paths: **explicit** (`POST /quotes` → `POST /policies` bind, Idempotency-Key REQUIRED) and **embedded** (platform events like `trip.started` auto-bind cover, idempotent on `source_event_id`). The **premium-bind saga** is the headline money path and REUSES `finance/wallet` (constructed WITH `finance/tiers`, so bind debits are tier/KYC-gated): `wallet.Debit(premium)` posts DR guest wallet → CR `AccountProviderClearing` (premium is a **pass-through liability, never revenue**); on provider bind SUCCESS the commission slice moves DR clearing → CR `AccountCommission` (the only revenue); on bind FAILURE the premium is **auto-reversed** (reversing CREDIT back to the wallet) → `VOID` — the user is never left debited without cover. **Claims** run a First-Notice-of-Loss FSM to an **idempotent payout** (`wallet.Credit`, DR provider_clearing → CR claimant wallet) that moves money ONLY on `PAYOUT_PENDING → SETTLED`. Provider **webhooks** (`/internal/webhooks/{mycover,octamile}`) are adapter-signature-verified and idempotent on `(provider, external_event_id)`, driving policy + claim state. **Reconciliation** matches premiums to provider statements and confirms/reverses commission (balanced ledger entries, never a balance UPDATE). Object-level authZ is enforced everywhere off the token (`PolicyholderID` / `ClaimantID`; claims resolve the policy via `policyReaderAdapter` which rejects non-owners). Testing priorities: premium-bind auto-reverse, claim payout idempotency + PAYOUT_PENDING-only gate, both FSMs, per-policy/per-claim IDOR, webhook forgery, tier-gated premium debit. NOTE: insurance does **not** use `settlement.Split` — money conservation here is the balanced double-entry pair (premium ↔ clearing, commission clearing ↔ commission, payout clearing ↔ claimant), not a platform/supplier/provider split. Cross-cutting: `../cross-cutting/money-invariants.md`, `authentication.md`, `rbac-and-permissions.md`, `kyc-and-tiers.md`, `webhooks-and-providers.md`, `feature-flags-and-audit.md`.

## 2. Services / endpoints in scope

| Operation | Method + path | Auth / permission | Money-path? |
|---|---|---|---|
| List products (KYC-tier filtered) | `GET /api/finance/insurance/products?line=&context=` | member (tier-filtered) | no |
| NDPA consent | `GET /consent`, `POST /consent` | member (own) | no |
| Create quote | `POST /quotes` | member (requires consent) | no |
| Get quote | `GET /quotes/:id` | member; **owner only** | no |
| Bind policy | `POST /policies` `{quote_id}` + `Idempotency-Key` | member; **quote owner** | **yes** (premium debit + commission) |
| List policies | `GET /policies` | member (own) | no |
| Get policy | `GET /policies/:id` | member; **owner only** | no |
| Certificate | `GET /policies/:id/certificate` | member; **owner only** | no |
| Cancel policy | `POST /policies/:id/cancel` | member; **owner only** | no (refund deferred to queue) |
| Beneficiaries | `GET/POST /policies/:id/beneficiaries` | member; **owner only** | no |
| Submit FNOL (claim) | `POST /claims` + `Idempotency-Key` | member; **owns policy** | no (money on settle) |
| List / get claims | `GET /claims`, `GET /claims/:id` | member; **owner only** | no |
| Evidence add / list | `POST /claims/:id/evidence`, `GET /claims/:id/evidence` | member; **owner only** | no |
| Embedded trigger / list | `POST /embedded/events`, `GET /embedded/events` | member/internal | **yes** (embedded bind) |
| Admin — catalog | `GET /api/insurance/admin/catalog`, `PATCH /catalog/:code/active` | `insurance.catalog.view` / `insurance.catalog.manage` | no |
| Admin — routing | `PATCH /routing/:code` | `insurance.routing.manage` | no |
| Admin — policy search | `GET /api/insurance/admin/policies` | `insurance.policy.view` | no |
| Admin — claim search / get | `GET /claims`, `GET /claims/:id` | `insurance.claim.view` | no |
| Admin — claim decision | `POST /claims/:id/decision` `{decision, approved_amount_kobo, reason}` | `insurance.claim.manage` | **yes** (settle) |
| Admin — reconciliation | `GET /reconciliation`, `POST /reconciliation/match`, `POST /reconciliation/:id/resolve` | `insurance.reconciliation.view` / `.resolve` | no |
| Admin — commission ledger | `GET /commission`, `POST /commission/:policy_id/confirm`, `POST /commission/:policy_id/reverse` | `insurance.commission.view` / `insurance.reconciliation.resolve` | **yes** (reverse) |
| Provider webhook | `POST /internal/webhooks/{mycover,octamile}` (`X-Signature`/`X-Webhook-Signature`/`X-<provider>-Signature`) | **unauthenticated; provider signature** | **yes** (claim settle via event) |

## 3. Test matrix by layer

| Behavior | Layer | Existing coverage (cite file) | Status |
|---|---|---|---|
| Policy FSM legal/illegal edges + terminal closure | fsm | — (map in `policy/model.go`) | TODO |
| Claims FSM legal/illegal edges + terminal closure | fsm | — (map in `claims/model.go`) | TODO |
| Bind saga: premium debit → commission (happy); bind-fail → auto-reverse → VOID | inv/int | — (`policy/service.go`) | TODO |
| Bind idempotent replay on `Idempotency-Key` | inv | — (`getQuote`/keyed legs) | TODO |
| Claim payout idempotent, PAYOUT_PENDING-only, approved-amount clamp | inv/int | — (`claims/service.go` `Settle`) | TODO |
| Embedded bind idempotent on `source_event_id` + auto-release on fail | inv/int | — (`embedded/service.go`) | TODO |
| Commission confirm/reverse balanced journal (clearing⇄commission) | inv | — (`reconciliation/service.go`) | TODO |
| Reconciliation MATCHED/BREAK premium match | unit | — | TODO |
| Object-level authZ (policy owner, claim/policy owner via adapter) | authz | — (`policyReaderAdapter`, service owner checks) | TODO |
| Provider webhook signature verify + idempotent replay | sec/int | — (`webhooks/service.go`) | TODO |
| Product catalog KYC-tier filter | int | — (`catalog/handler.go`) | TODO |
| Flag-off route inaccessible | sec | — | TODO |

## 4. Manual test cases

| Case ID | Title | Priority | Preconditions | Steps | Test data | Expected result |
|---|---|---|---|---|---|---|
| `INSURANCE-INT-001` | Quote then bind (happy) | P0 | consented guest A, funded; product active | `POST /quotes` → `POST /policies {quote_id}` + `Idempotency-Key` | `premium=5000000`, commission `750000`, key `k1` | 201; policy `ACTIVE`; A −`5000000` → `AccountProviderClearing`; commission `750000` clearing→`AccountCommission`; cert ref stored |
| `INSURANCE-INT-002` | Bind fails → mandatory auto-reverse | P0 | consented A funded; provider bind errors | `POST /policies` + key | provider `BindPolicy` error | policy `BIND_FAILED`→`VOID`; reversing CREDIT `5000000` clearing→A wallet; **net debit == 0**; audit `insurance.bind_failed_reversed` |
| `INSURANCE-INT-003` | Bind insufficient funds | P1 | consented A underfunded | `POST /policies` + key | premium > balance | `PAYMENT_FAILED`→`VOID`; error surfaced; nothing bound, nothing to reverse |
| `INSURANCE-INT-004` | Submit FNOL on active policy | P0 | A owns ACTIVE bound policy | `POST /claims {policy_id,...}` + `Idempotency-Key` | key `c1` | 201 claim `FNOL_SUBMITTED`; provider FNOL hand-off; `provider_claim_ref` stored |
| `INSURANCE-INT-005` | FNOL on non-active / unbound policy | P1 | policy `QUOTED` or no provider ref | `POST /claims` + key | — | 422 `policy_not_active` / `policy_not_bound`; no claim advances |
| `INSURANCE-INT-006` | Claim decision approve → payout | P0 | claim `UNDER_ASSESSMENT` | admin `POST /claims/:id/decision {decision:"approve", approved_amount_kobo}` then `{decision:"settle"}` | `approved=4000000` | `APPROVED`→`PAYOUT_PENDING`→`SETTLED`; claimant wallet +`4000000` (DR clearing → CR wallet), keyed `<claim.key>:payout` |
| `INSURANCE-INT-007` | Claim reject (terminal, no money) | P1 | claim `UNDER_ASSESSMENT` | admin `POST /claims/:id/decision {decision:"reject"}` | — | `REJECTED`; no money; notify claimant |
| `INSURANCE-INT-008` | Embedded auto-bind on event | P1 | mapped event, A funded | `POST /embedded/events {source_event_id, event_type, user_id}` | `trip.started` | policy `ACTIVE` (binding_mode=embedded); premium held + commission; idempotent on `source_event_id` |
| `INSURANCE-INT-009` | Embedded insufficient funds → uncovered | P1 | mapped event, A underfunded | `POST /embedded/events` | premium > balance | policy `VOID`; held premium released; result `INSUFFICIENT_FUNDS`; top-up notify |
| `INSURANCE-INT-010` | Reconciliation match vs break | P2 | policy with posted premium | admin `POST /reconciliation/match` with matching + mismatched lines | expected vs statement | matching → `MATCHED`; mismatch → `BREAK` with reason |
| `INSURANCE-INT-011` | Commission confirm then reverse | P1 | policy with `PENDING` commission | `POST /commission/:policy_id/confirm` then `/reverse` | `commission=750000` | confirm PENDING→CONFIRMED (ledger unchanged); reverse posts DR commission → CR clearing; status `REVERSED` |
| `INSURANCE-INT-012` | Products filtered by KYC tier | P2 | tier-0 guest A | `GET /products` | A tier 0 | only tier-0 products returned; higher-tier products hidden |
| `INSURANCE-INV-001` | Bind idempotent replay | P0 | one bind with key `k1` | repeat `POST /policies` with `k1` | same key | no second premium debit (ledger keyed `<k1>:premium`); no duplicate commission (`<k1>:commission`) |
| `INSURANCE-INV-002` | Claim payout idempotent / re-entry safe | P0 | claim already `SETTLED` | admin `POST /claims/:id/decision {decision:"settle"}` again | — | no second credit (`PayoutExists` + `insurance_claim_payout` UNIQUE); state stays `SETTLED` (MONEY-INV-010) |
| `INSURANCE-INV-003` | Payout only from PAYOUT_PENDING | P0 | claim `UNDER_ASSESSMENT` | admin `settle` decision | not `PAYOUT_PENDING` | 409 `ErrBadState`; **no money moved** |
| `INSURANCE-INV-004` | Embedded idempotent on source_event_id | P0 | one embedded bind | POST same `source_event_id` twice | duplicate event | second returns existing policy `Replayed`; no second premium debit |
| `INSURANCE-SEC-001` | Missing Idempotency-Key on bind | P0 | consented A funded | `POST /policies` no header | no key | 400 "Idempotency-Key header required"; no debit (MONEY-INV-008) |
| `INSURANCE-SEC-002` | Bind/quote without NDPA consent | P1 | consent not granted | `POST /quotes` or `/policies` | — | 428 `ndpa_consent_required`; no provider PII share; no money moved |
| `INSURANCE-SEC-003` | Provider webhook forged signature | P0 | provider secret configured | `POST /internal/webhooks/mycover` bad signature | tampered body | 401 invalid signature; `ev.SignatureValid=false` → rejected, no state change (see `../cross-cutting/webhooks-and-providers.md`) |
| `INSURANCE-SEC-004` | Provider webhook idempotent replay | P1 | valid sig | POST same `(provider, external_event_id)` twice | duplicate | first applied; second recorded once, `Duplicate=true`, 200; claim/policy advanced once |
| `INSURANCE-SEC-005` | Webhook settles claim once | P0 | claim `PAYOUT_PENDING`, provider `claim.settled` | valid signed webhook | — | idempotent payout runs once; replay/out-of-order event on terminal claim is a no-op |
| `INSURANCE-AUTHZ-001` | Cannot bind another user's quote (IDOR) | P0 | quote owned by A | B `POST /policies {quote_id:A}` | B ≠ quote owner | 403 forbidden; no policy, no debit |
| `INSURANCE-AUTHZ-002` | Cannot claim / read another's policy or claim (IDOR) | P0 | policy/claim owned by A | B `POST /claims {policy_id:A}` or `GET /claims/:id` | B ≠ owner | 403 forbidden (`policyReaderAdapter` / `ownedClaim`); no claim created |
| `INSURANCE-AUTHZ-003` | Admin claim decision requires perm | P1 | caller lacking `insurance.claim.manage` | `POST /claims/:id/decision` | no grant | 403 (see `../cross-cutting/rbac-and-permissions.md`) |
| `INSURANCE-SEC-006` | Flag-off inaccessible | P0 | `FEATURE_INSURANCE_ENABLED=off` | call any `/insurance/*`, `/api/insurance/*`, webhook | — | routes not mounted → 404, never 500 (FLAG-SEC-001) |

## 5. State-machine transitions

Two guarded FSMs; both `SetState` optimistic-locked on `version`; edges not in the adjacency map are rejected by `guard()`/`canTransition` (fail-closed).

**Policy lifecycle** (`policy/model.go`; terminal `isTerminal`: `CANCELLED`, `EXPIRED`, `VOID`):

| From | Event | To | Side effect | Case ID |
|---|---|---|---|---|
| `QUOTED` | begin bind | `PENDING_PAYMENT` | none | `INSURANCE-FSM-001` |
| `QUOTED` | ttl lapse | `EXPIRED` | none (terminal) | `INSURANCE-FSM-002` |
| `PENDING_PAYMENT` | premium debited | `BINDING` | `wallet.Debit(premium)` → clearing | `INSURANCE-FSM-003` |
| `PENDING_PAYMENT` | debit fails | `PAYMENT_FAILED` → `VOID` | none (nothing to reverse) | `INSURANCE-FSM-004` |
| `BINDING` | provider bound | `ACTIVE` | commission clearing→`AccountCommission`; cert stored | `INSURANCE-FSM-005` |
| `BINDING` | provider bind fails | `BIND_FAILED` → `VOID` | **auto-reverse premium** to wallet | `INSURANCE-FSM-006` |
| `ACTIVE` | renewal due / cancel / expire | `RENEWAL_DUE` / `CANCELLED` / `EXPIRED` | provider cancel on cancel | `INSURANCE-FSM-007` |
| `RENEWAL_DUE` | renew / lapse / cancel | `ACTIVE` / `EXPIRED` / `CANCELLED` | — | `INSURANCE-FSM-008` |
| terminal (`CANCELLED`/`EXPIRED`/`VOID`) | any | — | rejected (`ErrBadState`); re-entry idempotent | `INSURANCE-FSM-009` |
| illegal (e.g. `QUOTED`→`ACTIVE`, `ACTIVE`→`BINDING`) | any | — | rejected 409 | `INSURANCE-FSM-010` |

**Claim lifecycle** (`claims/model.go`; terminal `isTerminal`: `SETTLED`, `REJECTED`):

| From | Event | To | Side effect | Case ID |
|---|---|---|---|---|
| `DRAFT` | FNOL submitted | `FNOL_SUBMITTED` | provider FNOL hand-off | `INSURANCE-FSM-011` |
| `FNOL_SUBMITTED` | provider ack / assess | `UNDER_ASSESSMENT` | none | `INSURANCE-FSM-012` |
| `UNDER_ASSESSMENT` | needs info | `NEEDS_MORE_INFO` | notify claimant | `INSURANCE-FSM-013` |
| `NEEDS_MORE_INFO` | info supplied | `UNDER_ASSESSMENT` | none (⇄ loop) | `INSURANCE-FSM-014` |
| `UNDER_ASSESSMENT` | approve | `APPROVED` → `PAYOUT_PENDING` | record approved amount | `INSURANCE-FSM-015` |
| `PAYOUT_PENDING` | settle | `SETTLED` | **idempotent** `wallet.Credit` payout | `INSURANCE-FSM-016` |
| `UNDER_ASSESSMENT` | reject | `REJECTED` | none (terminal) | `INSURANCE-FSM-017` |
| terminal (`SETTLED`/`REJECTED`) | any | — | rejected / provider event no-op (`isTerminal` short-circuit) | `INSURANCE-FSM-018` |
| illegal (e.g. `DRAFT`→`APPROVED`, `APPROVED`→`SETTLED` skipping pending) | any | — | rejected 409 `ErrBadState` | `INSURANCE-FSM-019` |

## 6. Security & abuse cases

- **Auto-reverse is the #1 invariant** (`INSURANCE-INT-002` / `INSURANCE-FSM-006`): a failed provider bind reverses the premium with a reversing CREDIT and **zero net debit** — the user is never debited without cover. A reverse-failure leaves `BIND_FAILED` (not `VOID`) for the refund queue and alerts. Same shape in `embedded` (`releaseAndUncover`).
- **Premium is pass-through, commission is the only revenue** (`INSURANCE-INT-001`, `INSURANCE-INT-011`): premium lands in `AccountProviderClearing`; commission moves clearing→`AccountCommission`; reversal drains commission→clearing. Money conservation is the balanced double-entry pair (there is **no** `settlement.Split` here — do not assert a platform/supplier/provider three-way split).
- **Claim payout idempotency + gate** (`INSURANCE-INV-002/003`): payout runs ONLY from `PAYOUT_PENDING`, keyed `<claim.idempotency_key>:payout` with `PayoutExists` pre-check + `insurance_claim_payout` UNIQUE; a concurrent/duplicate settle is a safe no-op.
- **Idempotency / replay** (`INSURANCE-SEC-001`, `INSURANCE-INV-001/004`): bind requires `Idempotency-Key`; premium `<key>:premium`, commission `<key>:commission`, reversal `<key>:reversal`. Embedded is idempotent on `source_event_id` with a hard `uq_insurance_policy_source_event` unique index.
- **Object-level authZ / IDOR** (`INSURANCE-AUTHZ-001/002`): quote/policy ownership checked off token; claims resolve the policy through `policyReaderAdapter.PolicyForClaim`, which returns `ErrForbidden` when `PolicyholderID != userID`. Per-policy / per-claim scope, not global.
- **Webhook forgery** (`INSURANCE-SEC-003/004/005`): the provider adapter's `VerifyWebhook` validates the signature and returns a normalised event; `!ev.SignatureValid` → 401 (never 200); ingest idempotent on `(provider, external_event_id)`; raw provider JSON is never logged. See `../cross-cutting/webhooks-and-providers.md`.
- **Tier/KYC:** unlike `stays`, the premium debit routes through `wallet.Debit` (wallet built WITH `finance/tiers`) so tier-limit / KYC gates apply fail-closed — run `../cross-cutting/kyc-and-tiers.md` cases against `POST /policies` and embedded binds. Product listing is KYC-tier filtered (`INSURANCE-INT-012`).
- Inherit `../cross-cutting/money-invariants.md` (kobo-integer, balanced double-entry, immutable ledger, reversal-not-mutation) and `authentication.md` (member JWT on all `/api/finance/insurance/*`).

## 7. Automated specs to add

- `internal/insurance/policy/fsm_test.go` — `transitions` legal/illegal matrix incl. terminal re-entry (`INSURANCE-FSM-001..010`), pure-logic. TODO.
- `internal/insurance/claims/fsm_test.go` — claim `transitions` incl. NEEDS_MORE_INFO⇄UNDER_ASSESSMENT + terminal short-circuit (`INSURANCE-FSM-011..019`). TODO.
- `internal/insurance/policy/bind_saga_test.go` — premium-debit→commission happy + bind-fail auto-reverse (assert net debit 0) + idempotent replay + quote-owner IDOR, stub gateway/wallet (`INSURANCE-INT-001/002`, `INSURANCE-INV-001`, `INSURANCE-AUTHZ-001`). TODO.
- `internal/insurance/claims/settle_test.go` — payout PAYOUT_PENDING-only, idempotent re-entry, approved-amount clamp (`INSURANCE-INT-006`, `INSURANCE-INV-002/003`). TODO.
- `internal/insurance/embedded/embedded_test.go` — idempotent `source_event_id`, insufficient-funds release, no-mapping no-op (`INSURANCE-INT-008/009`, `INSURANCE-INV-004`). TODO.
- `internal/insurance/webhooks/signature_test.go` — signature verify good/bad + idempotent replay + claim-settle-once (`INSURANCE-SEC-003/004/005`). TODO.
- `internal/insurance/insurance_live_db_test.go` — live-DB (gated on `TEST_DATABASE_URL`): bind→active→claim→settle money moves + commission balance + IDOR denials. TODO.

## 8. Coverage target & exit criteria

Tier-0 pure-logic floor ≥ 85% (both FSM maps, bind/settle saga branches, reconciliation match, webhook signature). Exit criteria: `INSURANCE-INT-001/002/006` (bind happy, auto-reverse, claim payout), `INSURANCE-INV-001/002/003` (bind replay, payout re-entry, payout gate), `INSURANCE-SEC-001/003` (key required, webhook forgery), `INSURANCE-AUTHZ-001/002` (quote + policy/claim IDOR) all green; flag-off `INSURANCE-SEC-006` verified; no S1 (auto-reverse / double-payout / unauthorized-payout) defect open.
