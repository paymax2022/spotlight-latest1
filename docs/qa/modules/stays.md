# Module: Stays (Hotel Booking / Property Suite)

**Risk tier:** 0 &nbsp;·&nbsp; **Money-path:** yes &nbsp;·&nbsp; **Feature flag:** `FEATURE_STAYS_ENABLED`
**Code:** `backend/internal/stays/` — `reservation/{model.go,service.go,handler.go,repository.go}`, `settlement/{service.go,handler.go,model.go}`, `supplierwebhooks/{service.go,handler.go}`, `extranet/{authz.go,handler.go,service.go}`, `reviews/handler.go`, `ari/handler.go`, `pricing/pricing.go`, `search/`, `discovery/`, `dedup/`, `consent/`, `gateway/`, `adapters/direct.go`, `admin/handler.go`, `agent/`. Mounted in `backend/internal/app/stays_routes.go` (`RegisterStays`) + `stays_extranet_routes.go` (`RegisterStaysExtranet`); wired by `finance_routes.go` under `if cfg.FeatureStaysEnabled && pool != nil`. Reuses `finance/settlement` + `finance/ledger`.
**Slug:** `STAYS` (uppercase, used in Case IDs)

## 1. Overview & scope

Stays is Spotlight's hotels.com-style booking marketplace over own inventory (the Direct rail; the third-party bedbank rail is retired). The guest surface is a **two-step booking saga**: `POST /prebook` re-validates live price + availability and lands a durable reservation in `PREBOOK_OK` (no money moves), then `POST /book` (Idempotency-Key REQUIRED) runs **HOLD → BOOK → CHARGE → auto-RELEASE**. The money path REUSES the finance primitives — HOLD is `settlement.Escrow` (DEBIT guest wallet, CREDIT `AccountEscrow`); CHARGE on `CONFIRMED` is `settlement.Settle` splitting escrow into the platform commission (`AccountPaymaxRevenue`) and the net-rate remittance to a `stays-clearing:<supplier>` provider wallet; a `BOOK_FAILED` triggers `settlement.Refund` (reversing CREDIT to the guest wallet, **no net debit**). Cancel/Modify re-price and post partial refunds/charges through the same ledger. A hotelier **extranet** (`/api/stays/extranet/*`, RBAC `stays.hotelier.*` + object-level `stays_hotelier_profile` grant) manages content/ARI/reviews and reads finance; the **settlement back-office** (`/api/stays/admin/*`, RBAC `stays.admin.*`) drives Naira hotel payouts (HELD until first completed stay), the commission ledger, and Rail-A remittance reconciliation. Rail-B supplier webhooks (`/internal/webhooks/stays-supplier`) are HMAC-SHA256 signature-verified and idempotent. Testing priorities: the auto-release invariant (never charged without a confirmed room), settle-split conservation, payout fraud-gate + idempotency, per-property hotelier IDOR, webhook forgery. NOTE: the guest money path posts to the ledger/settlement primitives **directly** (via `settlement.Escrow`→`ledger.Debit`, which is funds-checked) and does **not** route through the wallet tier-limit guard — tier/KYC limits are not enforced on the booking hold (unlike `insurance`, which uses `wallet.Debit`). Cross-cutting: `../cross-cutting/money-invariants.md`, `authentication.md`, `rbac-and-permissions.md`, `kyc-and-tiers.md`, `webhooks-and-providers.md`, `feature-flags-and-audit.md`.

## 2. Services / endpoints in scope

| Operation | Method + path | Auth / permission | Money-path? |
|---|---|---|---|
| Search inventory | `GET /api/finance/stays/search` | member | no |
| Property content | `GET /api/finance/stays/properties/:rail/:supplier/:ref` | member | no |
| Destinations / home / deals / loyalty | `GET /api/finance/stays/{destinations,home,deals,loyalty}` | member | no |
| Wishlist | `GET /saved`, `POST /saved/:key/toggle` | member (own) | no |
| Saved guests | `GET/POST /saved-guests`, `DELETE /saved-guests/:id` | member (own) | no |
| NDPA consent | `GET /consent`, `POST /consent` | member (own) | no |
| Prebook | `POST /api/finance/stays/prebook` | member (guest = token) | no (re-price only) |
| Book | `POST /api/finance/stays/book` + `Idempotency-Key` | member; **guest owns reservation** | **yes** |
| List reservations | `GET /reservations` | member (own) | no |
| Get reservation | `GET /reservations/:id` | member; **owner only** | no |
| Voucher | `GET /reservations/:id/voucher` | member; **owner only** | no |
| Cancel | `POST /reservations/:id/cancel` | member; **owner only** | **yes** (refund) |
| Modify | `POST /reservations/:id/modify` + `Idempotency-Key` | member; **owner only** | **yes** (delta charge/refund) |
| Agent-assisted book | `/api/finance/stays/agent/*` | member w/ agent role | **yes** (reuses saga) |
| Review eligibility / create | `GET /reservations/:id/review-eligibility`, `POST /reservations/:id/review` | member; verified guest | no |
| Reviews read | `GET /reviews`, `/reviews-mine`, `/review-response` | member | no |
| Admin — suppliers | `GET/POST /api/stays/admin/suppliers` | `RequirePermission("stays.admin.supplier")` | no |
| Admin — mapping queue | `GET /mapping-queue`, `POST /mapping-queue/:id/decision` | `stays.admin.mapping` | no |
| Admin — property moderation | `POST /properties/:id/status` | `stays.admin.moderation` | no |
| Admin — reservation search | `GET /api/stays/admin/reservations` | `stays.admin.reservation` | no |
| Admin — payouts list/queue/release | `GET /payouts`, `POST /payouts/queue`, `POST /payouts/:id/release` | `stays.admin.settlement` | **yes** (release) |
| Admin — commission ledger | `GET /commission`, `POST /commission/{accrue,reverse}` | `stays.admin.commission` (view) / `stays.admin.settlement` | **yes** |
| Admin — remittance recon | `GET /remittances`, `POST /remittances/ingest`, `POST /remittances/:id/resolve` | `stays.admin.settlement` | no (recon) |
| Admin — review moderation | `GET /reviews`, `POST /reviews/:reviewId/moderate` | `stays.admin.review` | no |
| Extranet — base gate | (all `/api/stays/extranet/*`) | `stays.hotelier.access` + ACTIVE property grant | no |
| Extranet — content/rooms/rates/reservations/finance | `GET/PATCH/POST /properties/:propertyId/*` | `stays.hotelier.access` + object scope | no (finance reads) |
| Extranet — calendar / ARI / promotions | `GET/PUT/POST /rate-plans/:id/*`, `/room-types/:id/*`, `/properties/:id/promotions*` | `stays.hotelier.calendar` + object scope | no |
| Extranet — review response/flag | `POST /reviews/:reviewId/{response,flag}` | `stays.hotelier.review` + object scope | no |
| Supplier webhook | `POST /internal/webhooks/stays-supplier` (`X-Stays-Signature`) | **unauthenticated; HMAC-SHA256** | no (ARI/reservation sync) |

## 3. Test matrix by layer

| Behavior | Layer | Existing coverage (cite file) | Status |
|---|---|---|---|
| Direct-adapter search/prebook/book/cancel/modify contract | int | `internal/stays/adapters/direct_test.go` | PARTIAL |
| Settle split conservation (platform + provider == total; provider absorbs remainder; no negative leg) | inv | `tests/settlement_split_test.go`, `tests/vertical_settlement_pending_test.go` (shared `settlement.Settle` primitive; not stays-specific) | PARTIAL |
| Reservation FSM legal/illegal edges + terminal closure | fsm | — (map in `reservation/model.go`) | TODO |
| Book saga: HOLD→CHARGE happy; BOOK_FAILED→auto-release (no net debit) | inv/int | — (`reservation/service.go`) | TODO |
| Book idempotent replay on `Idempotency-Key` | inv | — (`FindByIdempotencyKey`) | TODO |
| Cancel/Modify refund + delta-charge conservation & idempotency | inv/int | — | TODO |
| Payout fraud-gate (`HasCompletedStay`) + release idempotency | inv/int | — (`settlement/service.go`) | TODO |
| Commission accrual/reversal balanced journal (clearing⇄commission) | inv | — | TODO |
| Remittance recon MATCHED/BREAK/UNMATCHED tolerance | unit | — | TODO |
| Object-level authZ (guest owns reservation; hotelier ACTIVE property grant) | authz | — (`service.go` owner check, `extranet/authz.go`) | TODO |
| Supplier webhook HMAC verify + idempotent replay | sec/int | — (`supplierwebhooks/service.go`) | TODO |
| Flag-off route inaccessible | sec | — | TODO |

## 4. Manual test cases

| Case ID | Title | Priority | Preconditions | Steps | Test data | Expected result |
|---|---|---|---|---|---|---|
| `STAYS-INT-001` | Prebook re-prices, no money moves | P0 | consented guest A; available offer | `POST /prebook` with selected offer | direct offer | 200; reservation `PREBOOK_OK`; `book_token` returned; no ledger entries |
| `STAYS-INT-002` | Book happy path (HOLD→CHARGE) | P0 | reservation `PREBOOK_OK`, A funded | `POST /book {reservation_id, book_token, guest}` + `Idempotency-Key` | `gross=15000000`, key `k1` | 201; `CONFIRMED`; A −`15000000` to escrow, then escrow split → `AccountPaymaxRevenue` (commission) + `stays-clearing:<sup>` (net); supplier_ref + voucher persisted |
| `STAYS-INT-003` | Book fails → mandatory auto-release | P0 | `PREBOOK_OK`, A funded; supplier returns non-CONFIRMED | `POST /book` | supplier `BOOK_FAILED` | reservation `BOOK_FAILED`→`VOID`; `settlement.Refund` credits A back full gross; **net debit == 0**; guest never charged without a room |
| `STAYS-INT-004` | Prebook sold-out / price drift | P1 | offer no longer available | `POST /prebook` | `SoldOut=true` | `PREBOOK_FAILED`; 409 `PREBOOK_FAILED`; no money moved |
| `STAYS-INT-005` | Cancel with policy refund | P1 | reservation `CONFIRMED`, owner A | `POST /reservations/:id/cancel` | `RefundKobo=8000000` | `CANCELLED_BY_GUEST`; reversing credit escrow→A wallet `8000000` (keyed `stays:cancel:<id>:refund`); cancellation recorded |
| `STAYS-INT-006` | Modify delta charge (later checkout) | P1 | `CONFIRMED`, A funded | `POST /reservations/:id/modify` + `Idempotency-Key` | new gross > old, `delta=3000000` | escrow `3000000` + settle split; row re-priced only after money moves; audit `stays.modified` |
| `STAYS-INT-007` | Modify delta refund (shorter stay) | P1 | `CONFIRMED` | `POST /reservations/:id/modify` + key | new gross < old, `delta=-2000000` | reversing credit `2000000` escrow→A; no net debit; re-priced |
| `STAYS-INT-008` | Payout release after completed stay | P0 | payout `HELD`, property has a `COMPLETED` stay | `POST /api/stays/admin/payouts/:id/release` | — | `PAID`; hotelier wallet credited from `AccountProviderClearing`; keyed `stays:payout:<id>` |
| `STAYS-INT-009` | Payout fraud-gate blocks early release | P0 | payout `HELD`, **no** completed stay | `POST /payouts/:id/release` | — | 409 `PAYOUT_HELD` (`ErrPayoutHeld`); stays `HELD`; **no credit** (fail-closed) |
| `STAYS-INT-010` | Commission accrue + reverse balanced | P1 | reservation with net commission | `POST /commission/accrue` then `/commission/reverse` | `amount=2250000` | accrue DR clearing→CR commission; reverse DR commission→CR clearing; net commission back to 0; both idempotent |
| `STAYS-INT-011` | Remittance ingest MATCHED vs BREAK | P2 | reservation with expected net | ingest within tol; then beyond tol | `|expected−remitted| ≤ 100` / `> 100` | first `MATCHED`; second `BREAK` with delta reason; missing reservation_id → `UNMATCHED` |
| `STAYS-INV-001` | Book idempotent replay | P0 | one book with key `k1` | repeat `POST /book` with `k1` | same key, same guest | returns existing reservation; **no second escrow debit**; replay by a different user → 403 (MONEY-INV-006) |
| `STAYS-INV-002` | Settle split conserves total | P0 | confirmed booking | assert settle legs | `gross=15000000`, commission `2250000` | platform `2250000` + provider `12750000` == `15000000` to the kobo; provider leg absorbs rounding; no negative leg (`Split.Validate`) |
| `STAYS-INV-003` | Payout release idempotent | P0 | payout already `PAID` | `POST /payouts/:id/release` again | — | no-op, returns `PAID`; no double-credit (ledger keyed `stays:payout:<id>`) |
| `STAYS-SEC-001` | Missing Idempotency-Key on book | P0 | `PREBOOK_OK`, A funded | `POST /book` no header | no key | 400 "Idempotency-Key header required"; nothing held (MONEY-INV-008) |
| `STAYS-SEC-002` | Book without NDPA consent | P1 | `PREBOOK_OK`, consent not granted | `POST /book` | — | 428 `ndpa_consent_required`; no supplier PII share; no money moved |
| `STAYS-SEC-003` | Insufficient funds on hold | P1 | `PREBOOK_OK`, A underfunded | `POST /book` | gross > balance | `PAYMENT_FAILED`→`VOID`; 402 `INSUFFICIENT_FUNDS`; nothing booked |
| `STAYS-SEC-004` | Supplier webhook forged signature | P0 | webhook secret configured | `POST /internal/webhooks/stays-supplier` bad `X-Stays-Signature` | tampered body | 401 invalid signature; event NOT applied (see `../cross-cutting/webhooks-and-providers.md`) |
| `STAYS-SEC-005` | Supplier webhook idempotent replay | P1 | secret set, valid sig | POST same `(source, external_event_id)` twice | duplicate event | first `applied`; second 200 `duplicate` via `stays_ari_event` UNIQUE; applied once |
| `STAYS-AUTHZ-001` | Guest cannot read another's reservation (IDOR) | P0 | reservation owned by A | B `GET /reservations/:id` | B ≠ owner | 403 forbidden; also blocks voucher/cancel/modify |
| `STAYS-AUTHZ-002` | Hotelier scoped to granted property (IDOR) | P0 | A has ACTIVE grant on P1 only | A calls extranet route for P2 | `HasProperty(A,P2)=false` | 403; per-property `stays_hotelier_profile` scope enforced in service (`RequireScopedPermission`-style) |
| `STAYS-AUTHZ-003` | Admin settlement requires perm | P1 | caller lacking `stays.admin.settlement` | `POST /payouts/:id/release` | no grant | 403 (see `../cross-cutting/rbac-and-permissions.md`) |
| `STAYS-SEC-006` | Flag-off inaccessible | P0 | `FEATURE_STAYS_ENABLED=off` | call any `/stays/*`, `/api/stays/*`, webhook | — | routes not mounted → 404, never 500 (FLAG-SEC-001) |

## 5. State-machine transitions

Reservation lifecycle per `transitions` in `reservation/model.go`. Every edge not listed is rejected by `canTransition` (fail-closed); `SetState` is optimistic-locked on `version`. Terminal states (`IsTerminal`): `COMPLETED`, `VOID`, `CANCELLED_BY_GUEST`, `CANCELLED_BY_HOTEL`, `NO_SHOW`.

| From | Event | To | Side effect | Case ID |
|---|---|---|---|---|
| `SEARCHING` | offer selected | `OFFER_SELECTED` | none | `STAYS-FSM-001` |
| `OFFER_SELECTED` | prebook OK | `PREBOOK_OK` | book_token + priced snapshot saved | `STAYS-FSM-002` |
| `OFFER_SELECTED` | price drift / sold out | `PREBOOK_FAILED` | no money | `STAYS-FSM-003` |
| `PREBOOK_OK` | hold funds | `PAYMENT_HELD` | `settlement.Escrow` DEBIT guest → `AccountEscrow` | `STAYS-FSM-004` |
| `PAYMENT_HELD` | begin book | `BOOKING` | supplier book call | `STAYS-FSM-005` |
| `BOOKING` | supplier confirmed | `CONFIRMED` | settle split (commission + net); supplier_ref/voucher | `STAYS-FSM-006` |
| `BOOKING` | supplier failed | `BOOK_FAILED` → `VOID` | `settlement.Refund` release hold, **no net debit** | `STAYS-FSM-007` |
| `PREBOOK_OK`/`PAYMENT_HELD` | hold fails | `PAYMENT_FAILED` → `VOID` | none (nothing held) | `STAYS-FSM-008` |
| `CONFIRMED` | guest cancels | `CANCELLED_BY_GUEST` | reversing refund per policy | `STAYS-FSM-009` |
| `CONFIRMED` | complete / hotel cancel / no-show | `COMPLETED` / `CANCELLED_BY_HOTEL` / `NO_SHOW` | — | `STAYS-FSM-010` |
| `PREBOOK_FAILED` | re-quote | `OFFER_SELECTED` | none | `STAYS-FSM-011` |
| terminal (`COMPLETED`/`VOID`/`CANCELLED_*`/`NO_SHOW`) | any | — | rejected (`ErrBadState`); re-entry idempotent no-op | `STAYS-FSM-012` |
| illegal (e.g. `PREBOOK_OK`→`CONFIRMED`, `SEARCHING`→`BOOKING`) | any | — | rejected 409 `ErrBadState` | `STAYS-FSM-013` |

## 6. Security & abuse cases

- **Auto-release is the #1 invariant** (`STAYS-INT-003` / `STAYS-FSM-007`): on any book failure the escrow hold is released with a reversing CREDIT and **zero net debit** — the guest is never charged without a confirmed room. A release-failure leaves `BOOK_FAILED` (not `VOID`) for the reconciliation queue rather than silently voiding.
- **Settle-split conservation** (`STAYS-INV-002`): `settlement.Settle` computes `providerKobo = total − platformKobo − riderKobo` so the provider/remainder leg absorbs rounding; `Split.Validate` rejects negative or non-1.0 splits up front (fail-closed). Assert kobo-exact.
- **Payout fraud-gate + idempotency** (`STAYS-INT-009`, `STAYS-INV-003`): payouts stay `HELD` until `HasCompletedStay`; release is idempotent (`PAID` → no-op) and keyed so no double-credit.
- **Idempotency / replay** (`STAYS-SEC-001`, `STAYS-INV-001`): book/modify require `Idempotency-Key`; escrow keyed `<key>:escrow`, settle keyed `settle:<settlementId>`, settlements row + ledger entries `ON CONFLICT DO NOTHING`. A replay by a different user is rejected 403.
- **Object-level authZ / IDOR** (`STAYS-AUTHZ-001/002`): guest ownership checked off token (`res.GuestUserID != userID`) in every reservation method; hotelier access requires an ACTIVE `stays_hotelier_profile` grant on the exact property (`extranet/authz.go`), per-property not global.
- **Webhook forgery** (`STAYS-SEC-004/005`): HMAC-SHA256 over the raw body, constant-time compare, `sha256=` prefix tolerated, **fail-closed when no secret is configured**; ingest idempotent on `(source, external_event_id)`. See `../cross-cutting/webhooks-and-providers.md`.
- **Tier/KYC:** the booking hold posts through `settlement.Escrow`→`ledger.Debit` (funds-checked) but **not** the wallet tier-limit guard — note this gap when running `../cross-cutting/kyc-and-tiers.md` cases; only balance sufficiency gates the hold today.
- Inherit `../cross-cutting/money-invariants.md` (kobo-integer, balanced double-entry, immutable ledger, idempotency) and `authentication.md` (member JWT on all `/api/finance/stays/*`).

## 7. Automated specs to add

- `internal/stays/reservation/fsm_test.go` — table-driven `transitions` legal/illegal matrix incl. terminal re-entry no-op (`STAYS-FSM-*`), pure-logic. TODO.
- `internal/stays/reservation/saga_test.go` — Book HOLD→CHARGE happy + BOOK_FAILED→auto-release (assert net debit 0) + idempotent replay + owner-IDOR, with stub gateway/settlement (`STAYS-INT-002/003`, `STAYS-INV-001`, `STAYS-AUTHZ-001`). TODO.
- `internal/stays/settlement/payout_test.go` — fraud-gate HELD→PAID, `ErrPayoutHeld`, release idempotency, commission accrue/reverse balanced journal (`STAYS-INT-008/009/010`, `STAYS-INV-003`). TODO.
- `internal/stays/settlement/remittance_test.go` — MATCHED/BREAK/UNMATCHED tolerance math (`STAYS-INT-011`), pure-logic. TODO.
- `internal/stays/supplierwebhooks/signature_test.go` — HMAC verify good/bad/no-secret + idempotent replay on `stays_ari_event` (`STAYS-SEC-004/005`). TODO.
- `internal/stays/stays_live_db_test.go` — live-DB (gated on `TEST_DATABASE_URL`): full prebook→book→settle→payout money moves + escrow net-zero on release + IDOR denials. TODO.

## 8. Coverage target & exit criteria

Tier-0 pure-logic floor ≥ 85% (reservation FSM, split math, payout gate, remittance tolerance, webhook HMAC). Exit criteria: `STAYS-INT-002/003/008` (book happy, auto-release, gated payout), `STAYS-INV-001/002/003` (book replay, split conservation, payout re-entry), `STAYS-SEC-001/004` (key required, webhook forgery), `STAYS-AUTHZ-001/002` (guest + hotelier IDOR) all green; flag-off `STAYS-SEC-006` verified; no S1 (auto-release / conservation / double-credit) defect open.
