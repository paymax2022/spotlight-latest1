# Module: Marketplace

**Risk tier:** 1 &nbsp;·&nbsp; **Money-path:** yes (boost purchase + auto-refund only — escrow retired per ADR-023) &nbsp;·&nbsp; **Feature flag:** `FEATURE_MARKETPLACE_ENABLED`
**Code:** `backend/internal/marketplace/` — `handler.go`, `handler_account.go`, `admin_handler.go`, `messaging_handler.go`, `service.go`, `service_listing.go`, `service_boost.go`, `service_account.go`, `fsm_listing.go`, `fsm_boost.go`, `model.go`, `repository.go`, `messaging_repository.go`, `deal_reviews_repository.go`, `idempotency.go`, `webhook_verify.go`, `audit.go`, `errors.go`, `search/` (Elasticsearch read-model client) · tests: `service_boost_test.go`
**Mounting:** `backend/internal/app/marketplace_routes.go` (`RegisterMarketplace`, base `/v1/marketplace`, gated by `cfg.FeatureMarketplaceEnabled` in `router.go:363`)
**Slug:** `MKT` (uppercase, used in Case IDs)

## 1. Overview & scope

The Marketplace is Nigeria's "listings-and-connect" classifieds surface: sellers create listings, buyers browse/search, the two negotiate via offers and a 1:1 messaging thread, mark the deal "met" off-platform, and review each other. After **ADR-023** the escrow order money-path was retired — the marketplace **no longer holds funds or settles purchases**; parties transact off-platform (Meetup Mode). The **sole surviving money path is the paid listing Boost** (§2.4): a wallet-direct debit into `ledger.AccountCommission` (ad revenue) on purchase, reversed on admin/system reject. Public reads (listing detail, search, categories, seller pages, boost tiers) need no Bearer; member writes require auth (`RequireAuthContext`), with **object-level authorization (OLA)** enforced service-side (seller owns listing; offer participant scoping; thread participant scoping). Admin moderation routes carry per-route RBAC guards (`marketplace.admin.*`). Cross-cutting files that apply: `../cross-cutting/money-invariants.md` (boost ledger legs, idempotency, no-float), `../cross-cutting/authentication.md`, `../cross-cutting/rbac-and-permissions.md` (admin guards), `../cross-cutting/kyc-and-tiers.md` (note: the boost charge is a **raw `ledger.Debit`, NOT routed through TierGuard** — see §6), `../cross-cutting/feature-flags-and-audit.md` (flag-off + `mkt_admin_audit_log`).

## 2. Services / endpoints in scope

| Operation | Method + path | Auth / permission | Money-path? |
|---|---|---|---|
| Get listing detail | `GET /v1/marketplace/listings/:id` | public (auth-optional) | no |
| Search | `GET /v1/marketplace/search` | public | no |
| Categories / one category | `GET /v1/marketplace/categories`, `/categories/:id` | public | no |
| Seller profile / listings / reviews | `GET /v1/marketplace/sellers/:id/{profile,listings,reviews}` | public | no |
| Boost tiers catalog | `GET /v1/marketplace/boosts/tiers` | public | no |
| Create listing (DRAFT) | `POST /v1/marketplace/listings` | auth + owner | no |
| Update listing | `PUT /v1/marketplace/listings/:id` | auth + OLA owner | no |
| Submit listing | `POST /v1/marketplace/listings/:id/submit` | auth + OLA owner | no |
| Pause / Resume / Delete listing | `POST …/pause`, `…/resume`, `DELETE …/:id` | auth + OLA owner | no |
| List offers (negotiation history) | `GET /v1/marketplace/offers?listingId=` | auth + participant scope | no |
| Create / Accept / Counter / Decline offer | `POST /offers`, `/offers/:id/{accept,counter,decline}` | auth + OLA (seller for accept/counter/decline) | no |
| **Purchase boost** | `POST /v1/marketplace/boosts` (**Idempotency-Key**) | auth + OLA owner of listing | **yes** |
| Get boost | `GET /v1/marketplace/boosts/:id` | auth + OLA owner | no |
| Threads (create/list/get/messages) | `POST /threads`, `GET /threads`, `GET /threads/:id`, `GET /threads/:id/messages`, `POST /threads/:id/messages` | auth + participant scope | no |
| Deal met / review | `POST /deals/:id/mark-met`, `POST /deals/:id/review`, `GET /deals/:id/review` | auth + participant scope | no |
| Saved searches | `POST/GET/DELETE/PATCH /saved-searches[/:id]` | auth + OLA owner | no |
| Verification badges | `POST /verification/{id,business}` | auth (self) | no |
| Media presign | `POST /media/presign` | auth; 503 if R2 unconfigured | no |
| Saved items / reports / blocks / notif-prefs / meetup | `POST /listings/:id/save`, `/saved-items`, `/reports`, `/blocks`, `/notification-prefs`, `GET /meetup/safe-spots` | auth + OLA | no |
| Admin moderation queue | `GET /admin/moderation/queue` | `marketplace.admin.moderation` | no |
| Admin approve / reject listing | `POST /admin/listings/:id/{approve,reject}` | `marketplace.admin.approve` / `.reject` | no |
| Admin flags list / action | `GET /admin/flags`, `POST /admin/flags/:id/action` | `marketplace.admin.flags.action` | no |
| Admin audit log | `GET /admin/audit-log` | `marketplace.admin.audit.read` | no |
| **Admin list / reject boost** | `GET /admin/boosts`, `POST /admin/boosts/:id/reject` | `.moderation` (list) / `.reject` (reject → **auto-refund**) | **yes** |

> Note: escrow order + dispute routes and the two inbound webhooks (logistics/payments) were **deleted** in ADR-023. The `Order`/`Dispute` structs, `OrderStatus`/`DisputeStatus` enums, and `mkt_orders`/`mkt_disputes` tables are retained (additive-only) but unused. `webhook_verify.go` HMAC helper remains for parity but has no live inbound route.

## 3. Test matrix by layer

| Behavior | Layer | Existing coverage (cite file) | Status |
|---|---|---|---|
| Boost charge = balanced debit into `AccountCommission` | inv | `internal/marketplace/service_boost_test.go` `TestPostBoostCharge_BalancedDebitIntoCommission` | AUTOMATED |
| Boost charge idempotent (single posting on retry) | inv | `service_boost_test.go` `TestPostBoostCharge_IdempotentSinglePosting` | AUTOMATED |
| Boost charge fail-closed on insufficient funds → 402 | inv | `service_boost_test.go` `TestPostBoostCharge_FailsClosedOnInsufficientFunds` | AUTOMATED |
| Boost auto-refund = balanced reversal to seller wallet | inv | `service_boost_test.go` `TestPostBoostRefund_BalancedReversal` | AUTOMATED |
| Boost auto-refund idempotent (single reversal) | inv | `service_boost_test.go` `TestPostBoostRefund_IdempotentSinglePosting` | AUTOMATED |
| Listing FSM legal/illegal/terminal edges | fsm | `tests/marketplace/fsm_invariant_test.go` `TestListingFSM_*` | AUTOMATED |
| Boost FSM legal/illegal/terminal + never-dangles-active | fsm | `fsm_invariant_test.go` `TestBoostFSM_*` | AUTOMATED |
| Listing outbox op mirrors search visibility | fsm | `fsm_invariant_test.go` `TestListingFSM_OutboxOpMirrorsSearchVisibility` | AUTOMATED |
| Enum values mirror SQL; error codes distinct | con | `tests/marketplace/contract_test.go` `TestEnumValues_MirrorSQLExactly`, `TestErrorCodes_AreNonEmptyAndDistinct` | AUTOMATED |
| Boost tier catalog well-formed (kobo prices) | con | `contract_test.go` `TestBoostTiers_CatalogIsWellFormed` | AUTOMATED |
| Boost-on-rejected-listing auto-refund cascade | int | `tests/marketplace/chaos_error_taxonomy_test.go` `TestChaos_BoostOnRejectedListing_*` | AUTOMATED |
| Verify badge is monotonic set-only / idempotent | int | `chaos_error_taxonomy_test.go` `TestChaos_KYCOutage_*` | AUTOMATED |
| Edit-listing-with-active-order guard (price only) | int | `chaos_error_taxonomy_test.go` `TestChaos_EditListingWithActiveOrder_*` | AUTOMATED (legacy order path) |
| HMAC webhook rejects bad signature | sec | `chaos_error_taxonomy_test.go` `TestChaos_DuplicateWebhook_HMACRejectsBadSignature`, `tests/marketplace/hmac_helper_test.go` | AUTOMATED (helper only; no live route) |
| Full connect flow (listing→offer→thread→met→review) | e2e | `tests/marketplace/connect_flow_live_db_test.go` `TestConnectFlow_LiveDB` (gated on `TEST_DATABASE_URL`) | PARTIAL |
| Boost purchase HTTP handler (auth + Idempotency-Key + 201 envelope) | int | — | TODO |
| Offer/thread participant-scope OLA (IDOR) | authz | — | TODO |
| Admin boost reject RBAC guard (allowed vs denied) | authz | — | TODO |
| Flag-off returns 404 (routes unregistered) | sec | — | TODO |

## 4. Manual test cases

| Case ID | Title | Priority | Preconditions | Steps | Test data | Expected result |
|---|---|---|---|---|---|---|
| `MKT-E2E-001` | Happy path: create → submit → auto-approve → live | P1 | Seller authed; category `risk_tier=0`; seller `trust_score ≥ 0.6` | POST /listings (draft) → POST /listings/:id/submit | title 10–100 chars, description ≥ 8 words, `price_kobo=250000000` | 201 draft; submit returns `status=active`; outbox `upsert` emitted |
| `MKT-E2E-002` | Submit routes to review when not auto-approvable | P1 | Seller authed; category `risk_tier>0` OR trust `<0.6` | POST /listings → POST /listings/:id/submit | valid listing | `status=pending_review`; no search upsert; seller notified "under review" |
| `MKT-INT-001` | Boost purchase debits wallet, activates boost | P0 | Seller owns active listing; wallet balance ≥ tier price | POST /boosts with `Idempotency-Key: k1` | `{listing_id, tier:"vip"}`; price `200000` kobo | 201; `status=active`, `ledger_charge_ref="mkt:boost:<seller>:<listing>:vip:charge"`; ledger debit `200000` into `AccountCommission`; commission earning row appended |
| `MKT-CON-001` | Boost tiers catalog is kobo-exact | P2 | none | GET /boosts/tiers | — | start=50000, vip=200000, vip_gold=500000, diamond=1500000, enterprise=5000000 kobo; all integers |
| `MKT-UNIT-001` | Create-listing validation: title/description/category/state | P1 | Seller authed | POST /listings with each invalid field | title <10 or >100; description <8 words; missing category_id/state; `price_kobo=-1` | 400 `SCHEMA_VALIDATION_FAILED` (title/category/state/price) or 422 `DESCRIPTION_TOO_SHORT` |
| `MKT-UNIT-002` | Offer on own / inactive listing rejected | P1 | Seller authed | POST /offers on own listing; POST /offers on paused listing | `priceKobo=100000` | 422 `SELF_PURCHASE_NOT_ALLOWED`; 422 `LISTING_NOT_ACTIVE` |
| `MKT-UNIT-003` | Boost with unknown tier rejected | P1 | Seller owns listing | POST /boosts | `tier:"platinum"` | 400 `INVALID_BOOST_TIER`; no ledger posting |
| `MKT-AUTHZ-001` | Update/pause/delete listing you don't own | P0 | Caller ≠ listing owner | PUT /listings/:id (foreign) | any body | 403 `FORBIDDEN`; no mutation |
| `MKT-AUTHZ-002` | GET /boosts/:id for another seller's boost (IDOR) | P0 | Boost owned by seller B | Seller A calls GET /boosts/:B-boost | — | 403 `FORBIDDEN` |
| `MKT-AUTHZ-003` | Offer history participant scoping | P1 | Listing has offers from buyers B and C | Seller sees all; buyer B sees only own | GET /offers?listingId= | seller: all offers; buyer B: only B's offers |
| `MKT-AUTHZ-004` | Thread/deal-review participant scoping (IDOR) | P0 | Thread between buyer B and seller S | Non-participant U calls GET /threads/:id, POST /deals/:id/review | — | 404 `THREAD_NOT_FOUND` (non-participant cannot distinguish missing vs not-yours) |
| `MKT-AUTHZ-005` | Admin boost-reject requires `marketplace.admin.reject` | P0 | Caller lacks permission | POST /admin/boosts/:id/reject | `{reason_code:"policy_x"}` | 403 (RBAC guard fail-closed); see `../cross-cutting/rbac-and-permissions.md` |
| `MKT-INV-001` | Boost replay returns cached 201, no double-charge | P0 | Boost k1 already purchased | Re-POST /boosts with same `Idempotency-Key: k1` | identical body | Original 201 body replayed; wallet debited exactly once (deterministic charge key collides). See `../cross-cutting/money-invariants.md` |
| `MKT-INV-002` | Missing Idempotency-Key on boost purchase | P0 | Seller authed | POST /boosts with no header | valid body | 400 `IDEMPOTENCY_KEY_REQUIRED`; no ledger posting |
| `MKT-INV-003` | Admin reject → auto-refund reverses exact kobo | P0 | Active boost priced `200000` | POST /admin/boosts/:id/reject `{reason_code}` | — | `status=auto_refunded`; balanced `PostReversal` of `200000` kobo back to seller wallet; `refund_ref` stamped; audit row written |
| `MKT-INV-004` | Insufficient wallet fails closed | P0 | Wallet balance < tier price | POST /boosts tier `enterprise` (5000000) | balance `4000000` kobo | 402 `INSUFFICIENT_WALLET_BALANCE`; no boost row; no partial ledger entry |
| `MKT-SEC-001` | Concurrent duplicate boost purchase | P0 | Same seller+listing+tier | Fire 2 POST /boosts with distinct Idempotency-Keys simultaneously | tier `vip` | Deterministic charge key `mkt:boost:<seller>:<listing>:vip:charge` collides in ledger → wallet debited once; the second tolerates `ErrDuplicate` |
| `MKT-INT-002` | Listing reject cascades boost auto-refund | P1 | Active listing has an active boost | Admin POST /admin/listings/:id/reject `{reason_code}` | — | Listing `removed_policy`; every active boost → `auto_refunded` with reason `listing_<reason>`; each refund balanced; per-boost failure logged not swallowed |
| `MKT-INT-003` | Update price blocked while active order references listing | P2 | Legacy `mkt_orders` row non-terminal for listing | PUT /listings/:id with new `price_kobo` | any | 409 `LISTING_HAS_ACTIVE_ORDER`; description/attr edits still allowed |
| `MKT-CON-002` | Search degrades to Postgres fallback when ES unwired | P2 | `ELASTICSEARCH_URL` unset | GET /search?q=phone | — | 200 with `degraded:true`, empty facets, real active listings (not 501) |
| `MKT-SEC-002` | Flag-off: all routes unregistered | P0 | `FEATURE_MARKETPLACE_ENABLED=false` | GET /v1/marketplace/listings/:id | — | 404 (routes never registered). See `../cross-cutting/feature-flags-and-audit.md` FLAG-SEC-001 |

## 5. State-machine transitions

This module has **TWO** state machines: the **Listing FSM** (`fsm_listing.go`) and the **Boost FSM** (`fsm_boost.go`). Both use explicit allowed-edge maps; anything not listed returns a typed `CodedError` (409). (The legacy Order/Dispute FSMs were retired in ADR-023 and are out of scope here.)

### 5a. Listing FSM (`INVALID_LISTING_TRANSITION`)

| From | Event | To | Side effect | Case ID |
|---|---|---|---|---|
| draft | submit (not auto-approvable) | pending_review | notify "under review" | `MKT-FSM-001` |
| draft | submit (risk_tier 0 ∧ trust ≥ 0.6) | active | outbox upsert; notify live | `MKT-FSM-002` |
| pending_review | admin approve | active | outbox upsert; audit `mkt.listing.approve` | `MKT-FSM-003` |
| pending_review | admin reject (reason mandatory) | removed_policy | outbox delete; boost cascade auto-refund; audit | `MKT-FSM-004` |
| active | pause | paused | outbox delete | `MKT-FSM-005` |
| paused | resume (not expired) | active | outbox upsert | `MKT-FSM-006` |
| active/paused/expired | delete (owner) | removed_user | outbox delete | `MKT-FSM-007` |
| active | cron auto-expire (past `expires_at`) | expired | outbox delete | `MKT-FSM-008` |
| draft → active bypass approve on foreign / sold → active / removed_* → anything | illegal | — | rejected 409 `INVALID_LISTING_TRANSITION` | `MKT-FSM-009` |
| sold / removed_policy / removed_user (terminal) re-enter | idempotent-reject | — | terminal has no outgoing edges; 409, no state change | `MKT-FSM-010` |

### 5b. Boost FSM (`INVALID_BOOST_TRANSITION`)

| From | Event | To | Side effect | Case ID |
|---|---|---|---|---|
| (create) | purchase | active | wallet debit → `AccountCommission`; auto-activates | `MKT-FSM-011` |
| purchased/active | admin/system reject (reason mandatory) | rejected_with_reason | — | `MKT-FSM-012` |
| rejected_with_reason | auto-refund (same flow) | auto_refunded | balanced reversal to seller wallet; audit | `MKT-FSM-013` |
| active | ends_at passed (cron) | completed | — | `MKT-FSM-014` |
| completed / auto_refunded (terminal) re-enter, or skip rejected→refunded to active | illegal | — | rejected 409 `INVALID_BOOST_TRANSITION`; re-reject is idempotent no-op on refund | `MKT-FSM-015` |

## 6. Security & abuse cases

- **IDOR / object-level:** `MKT-AUTHZ-001..004` — foreign listing mutation, foreign boost read, offer-history scoping, and thread/deal-review participant scoping (non-participant gets `THREAD_NOT_FOUND`, never a distinguishable 403).
- **RBAC bypass:** `MKT-AUTHZ-005` — admin boost/listing moderation guards must fail-closed on a caller lacking the exact seeded slug (`marketplace.admin.{moderation,approve,reject,flags.action,audit.read}`); reference `../cross-cutting/rbac-and-permissions.md`.
- **Idempotency / replay:** `MKT-INV-001/002`, `MKT-SEC-001` — missing key → 400; replay → cached 201; concurrent purchases collide on the deterministic charge key so the wallet is debited exactly once.
- **Amount tampering / server-side re-pricing:** boost price comes ONLY from the frozen `BoostTiers` catalog resolved by `lookupBoostTier(in.Tier)`; a client-supplied price is impossible (body carries `tier` string only). Assert an unknown tier → `INVALID_BOOST_TIER`.
- **Tier/KYC gate (FINDING):** the boost charge calls `s.ledger.Debit(...)` **directly** — it does NOT route through `walletSvc`/`TierGuard`, so there is **no tier-limit or KYC gate** on the boost money path (unlike p2pmarket, which holds via `escrow.Hold` with tier-limit fail-closed). Fail-closed here is only the ledger's insufficient-funds check. Record as a gap; see `../cross-cutting/kyc-and-tiers.md`. Spec in §7.
- **Webhook signature forgery:** `webhook_verify.go` HMAC helper remains (`hmac_helper_test.go`) but **no inbound webhook route is registered** post-ADR-023 — assert the two former routes 404. Reference `../cross-cutting/webhooks-and-providers.md`.
- **Settlement split:** N/A — escrow settlement/split was retired (ADR-023); the only money legs are the boost charge and its 1:1 reversal. Reference the split invariants in `../cross-cutting/money-invariants.md` for the ledger-level balanced-posting guarantee.
- **Fail-closed on dependency error:** media presign returns 503 `UPLOADS_NOT_CONFIGURED` when R2 is unconfigured (never a fabricated URL); search returns Postgres fallback (`degraded:true`) rather than crashing when ES is unwired.
- **Injection / input bounds:** message body bounded at 4000 chars (`MESSAGE_BODY_TOO_LONG` 422); empty body → `MESSAGE_BODY_REQUIRED` 400.

## 7. Automated specs to add

- `internal/marketplace/handler_boost_test.go` — HTTP-level boost purchase: 201 `{data:...}` envelope, missing `Idempotency-Key` → 400 `IDEMPOTENCY_KEY_REQUIRED`, replay returns cached body (hoisted httptest + fake service). **TODO**
- `internal/marketplace/authz_test.go` — table-driven OLA: foreign listing update/pause/delete → 403; foreign boost GET → 403; offer-history seller-vs-buyer scoping; thread/deal-review non-participant → `THREAD_NOT_FOUND`. **TODO**
- `tests/marketplace/rbac_admin_test.go` — admin boost/listing/flags/audit routes: allowed slug 2xx vs missing slug 403 (mirrors seeded `marketplace.admin.*`). **TODO**
- `tests/marketplace/boost_tier_gate_test.go` — assert/lock the current behavior that the boost charge bypasses TierGuard, then (if product decides) add a tier-limit gate and flip the assertion. Table-driven Go. **TODO**
- `tests/marketplace/flag_off_test.go` — with `FEATURE_MARKETPLACE_ENABLED=false`, assert no `/v1/marketplace/*` route is registered (404). **TODO**
- `internal/marketplace/search_fallback_test.go` — `parseSearchFallback` + `Search` degraded envelope shape when searcher nil. **TODO**

## 8. Coverage target & exit criteria

Tier-1 target: **≥ 75% pure-logic coverage** on `service_boost.go`, `service_listing.go`, `fsm_listing.go`, `fsm_boost.go` (boost money legs already covered by `service_boost_test.go`). **Exit criteria (release-ready):** all P0 cases green — `MKT-INT-001` (charge), `MKT-INV-001/002/003/004` (replay/missing-key/refund/fail-closed), `MKT-SEC-001` (concurrency), `MKT-SEC-002` (flag-off), `MKT-AUTHZ-001/002/004/005` (IDOR + RBAC), and both FSM illegal-transition sets (`MKT-FSM-009/010/015`). The boost charge must post a balanced double-entry (debit wallet = credit `AccountCommission`) and be debited exactly once under replay/concurrency; auto-refund must reverse the exact kobo. The tier/KYC-gate gap (§6) must be triaged (accept-as-designed or add a gate) before go-live.
