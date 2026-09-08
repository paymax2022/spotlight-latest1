# foodhub — Merchant-Side Audit (PRD v2 §2)

**Date:** 2026-08-16 · **Against:** `develop` @ 6eae5f02 · **Method:** live schema (local Supabase, 422 migrations), registered routes, Go/RN/admin source, 48 restaurant test files.

## Headline

The food vertical is **substantially more built than PRD v2 assumes.** v2 §2.2 lists eight "likely gaps"; **five of them do not exist as gaps** — hours, modifiers, disputes/refunds, promotions, and settlement/payout runs are all implemented, just under non-`fh_` names. Per §0's rule of interpretation, everything below says EXTEND/REUSE rather than BUILD wherever an equivalent exists.

Three findings dominate the plan:

1. **There are two unreconciled owner-application paths** (A17). The generic engine `onb_application` grants the *capability*; `restaurant_kyb` gates *payouts per restaurant*. Neither knows about the other. This is the single biggest structural decision in the gap plan.
2. **Commission is a hardcoded constant** (A21): `splitProviderPct = 0.80` in `service.go:28`. There is no per-restaurant plan, though a generic `commission_config` table exists and is used by transport and doctor.
3. **Staff roles do not exist at all** (A18). Ownership is a single `restaurants.owner_id`. Every owner-side guard is `assertOwner`. This is the one place where v2 needs a genuinely new table.

Naming deviation (§1.6): **no `fh_` prefix is introduced anywhere.** Existing tables are `restaurant_*`; adding a parallel `fh_*` namespace would create exactly the duplication §0 forbids.

---

## A1 Restaurant entity
Status: **EXISTS_PARTIAL**
Evidence: `restaurants` table; `backend/internal/restaurant/model.go`, `delivery.go`
Current behaviour: id, owner_id, name, description, address, logo_url, is_open, rating, geo_lat/lng, plus_code, cuisine, kyb_status, service_fee_bp, surge_bp, prep_time_minutes, accept_sla_minutes, min_order_kobo, packaging_fee_kobo.
Gap vs target (§5.1): missing `listing_review_status`, `published_snapshot`, `is_open_override`, `delivery_mode`, `delivery_radius_m`, `auto_accept`, `commission_plan_id`, `escrow_subaccount_ref`, `service_modes[]`, `cuisine_tags[]` (single `cuisine` text today), `deleted_at`, `owner_profile_id`.
Conflicts / risks: `cuisine` is scalar; the mobile filter chips match it exactly (`r.cuisine === key`). Adding `cuisine_tags[]` must not break that.
Plan: EXTEND ; Phase: 2

## A2 Restaurant ↔ owner linkage
Status: **EXISTS_COMPLETE** (for single-owner)
Evidence: `restaurants.owner_id`; `assertOwner()` in `delivery.go`; used by UpdateRestaurant/SetAvailability/menu writes
Current behaviour: one owner per restaurant, enforced object-level on every write.
Gap vs target (§5.2): no `owner_profile_id`, no multi-user access.
Conflicts / risks: none — this is the seam A18 hangs off.
Plan: EXTEND ; Phase: 1

## A3 Restaurant operational status & open/closed
Status: **EXISTS_PARTIAL**
Evidence: `restaurants.is_open`, `kyb_status`; `SetAvailability`; `availability.go`
Current behaviour: a boolean open/closed switch plus a KYB status that gates payouts. Discovery serves `WHERE is_open = TRUE`.
Gap vs target (§6.2): no lifecycle enum (DRAFT/PENDING_REVIEW/ACTIVE/SUSPENDED/CLOSED), no `is_open_override`.
Conflicts / risks: **`is_open` is load-bearing for discovery.** A new `status` column must not change what discovery serves until cut over.
Plan: EXTEND ; Phase: 2

## A4 Hours / special hours
Status: **EXISTS_COMPLETE**
Evidence: `restaurant_business_hours`, `restaurant_holiday_hours`; `availability.go`
Gap vs target (§5.2): none. v2's `fh_restaurant_hours` must NOT be created.
Plan: REUSE ; Phase: —

## A5 Menu, categories, items, modifiers, availability
Status: **EXISTS_COMPLETE**
Evidence: `menu_categories`, `menu_items`, `menu_modifier_groups`, `menu_modifiers`, `order_item_modifiers`; owner CRUD at `POST/DELETE /restaurant/:id/menu/{categories,items}`; mobile MenuBuilder in `app/food/restaurant/manage.tsx`
Gap vs target: no CSV import, no "86 board" bulk availability.
Plan: EXTEND ; Phase: 2

## A6 Item / photo moderation
Status: **MISSING**
Evidence: none — no moderation columns on `menu_items` or `restaurants`
Gap vs target (§6.3): no listing review, no item moderation queue.
Plan: BUILD ; Phase: 2

## A7 Cart & pricing engine
Status: **EXISTS_COMPLETE**
Evidence: `PlaceOrder` in `service.go` — subtotal, surge (`surge_bp`), service fee (`service_fee_bp`), promo discount, tip, packaging (`packaging_fee_kobo` × packs), distance-based delivery quote
Gap vs target: VAT is not a separate term.
Conflicts / risks: pricing is snapshotted at order time by design; any plan-driven commission must follow the same rule.
Plan: EXTEND ; Phase: 5

## A8 Order entity + status enum + events
Status: **EXISTS_COMPLETE**
Evidence: `orders` (37 columns incl. tip/discount/surge/service_fee/packaging/scheduled_for), `restaurant_order_status_events`, `order_items`, `order_item_modifiers`
Current behaviour: statuses `pending, confirmed, preparing, ready, picked_up, delivered, cancelled, rejected, dispatch_failed, delivery_failed`, CHECK-constrained, with an append-only event table.
Gap vs target (§6.4): v2 names `PLACED/ACCEPTED/OUT_FOR_DELIVERY/COMPLETED`; the live enum uses different spellings for the same lifecycle.
Conflicts / risks: **do not rename.** §6 says the audit's mapping table is canonical — see GAP_PLAN §Status mapping. `fh_order_events` must NOT be created.
Plan: REUSE + mapping ; Phase: 3

## A9 Restaurant-side order actions & SLA
Status: **EXISTS_PARTIAL**
Evidence: `PATCH /restaurant/:id/orders/:orderId/status`; `restaurants.accept_sla_minutes` read in `availability.go:135`
Current behaviour: the owner drives status transitions; `accept_sla_minutes` gates **scheduled-order activation**.
Gap vs target (§6.4): no auto-reject worker for live orders that go unacknowledged; no `auto_accept`.
Plan: EXTEND ; Phase: 3

## A10 Payment path & ledger posting
Status: **EXISTS_COMPLETE**
Evidence: `settlement.Escrow` at placement; wallet debit via ledger; tier-limit gate; `Idempotency-Key` required
Plan: REUSE ; Phase: —

## A11 Escrow / payable / commission
Status: **EXISTS_COMPLETE**
Evidence: `internal/finance/settlement` — `Escrow` → `Settle`; `ComputeLegs` splits 80/10/10 with 100%-legs for tip (rider), service fee (platform) and packaging (provider, ADR-046)
Gap vs target (§7): posting-type names differ from v2's `FH_*` list; percentages are not plan-driven (see A21).
Conflicts / risks: **money path is live and tested.** v2 §7.1 case (a) applies — extend, never introduce a second path.
Plan: REUSE ; Phase: 5

## A12 Delivery
Status: **EXISTS_COMPLETE**
Evidence: `restaurant_delivery_config`, `restaurant_delivery_offers`, `restaurant_rider_locations`, `drivers`; dispatch queue, rider offers/accept/pickup/handoff routes; `ws_tracking.go`
Gap vs target: zones are fee//distance-config rather than polygons.
Plan: REUSE ; Phase: 4

## A13 Reviews & owner reply
Status: **EXISTS_PARTIAL**
Evidence: `restaurant_ratings`; `POST /restaurant/orders/:orderId/rate`
Gap vs target: **no owner reply columns** (verified: no `%repl%` column), no moderation status.
Plan: EXTEND ; Phase: 6

## A14 Disputes & refunds
Status: **EXISTS_COMPLETE**
Evidence: `restaurant_dispute_refunds`, `restaurant_dispute_tip_clawbacks`; `AdminListFoodDisputes`, `AdminResolveFoodDispute`; per-order refund cap (ADR-032)
Gap vs target: no maker-checker on high-value refunds.
Conflicts / risks: v2 §5.2 suggests reusing a Marketplace disputes service — **ADR-023 removed Marketplace disputes.** Reuse the restaurant one.
Plan: EXTEND ; Phase: 6

## A15 Promotions
Status: **EXISTS_COMPLETE**
Evidence: `restaurant_promos`, `restaurant_promo_redemptions`; `orders.promo_id`, `promo_funder`; funder-aware settlement in `promo.go`
Plan: REUSE ; Phase: 6

## A16 Owner capability grant in RBAC
Status: **EXISTS_COMPLETE**
Evidence: `internal/onboarding/grant.go` — idempotent `user_roles` grant of `restaurant_merchant` + `onb_merchant_profile` activation + audit
Plan: REUSE ; Phase: 1

## A17 Owner application entity & wizard
Status: **EXISTS_PARTIAL — DUPLICATED**
Evidence: (i) `onb_application` + `onb_merchant_type(slug='restaurant')` + `onb_form_schema` + mobile wizard `app/(merchant)/*` + admin `admin/merchant-onboarding`; (ii) `restaurant_kyb` + `restaurant_kyb_documents` + `AdminListApplications`/`AdminDecideApplication` + admin `admin/restaurant/onboarding`
Current behaviour: **two separate review queues.** The generic engine grants the capability and writes `workspace_route`. The KYB flow runs its own state machine and sets `restaurants.kyb_status`, which gates payouts. Neither triggers the other.
Gap vs target (§8): v2 assumes one application. A user can hold the capability with no approved KYB (can trade, cannot be paid), or approved KYB with no capability (has a store, no workspace).
Conflicts / risks: **highest-risk item in this audit.** Any "fix" that collapses them must not break payout gating or the capability grant.
Plan: MIGRATE (reconcile, do not merge tables) ; Phase: 1

## A18 Staff roles per restaurant
Status: **MISSING**
Evidence: no `restaurant_staff` table (verified); all writes guard on `assertOwner`
Gap vs target (§4/§5.2): no MANAGER/CASHIER/KITCHEN/RIDER.
Plan: BUILD (`restaurant_staff`, not `fh_restaurant_staff`) ; Phase: 1

## A19 Owner app screens
Status: **EXISTS_PARTIAL**
Evidence: `app/food/restaurant/` — `manage.tsx` (profile, availability, packaging price, menu builder), `index.tsx` (orders), `order/[orderId].tsx`, `earnings.tsx`; reachable via `/merchant/restaurant`
Gap vs target (§11): no Kitchen mode, staff, promotions, reviews, compliance, disputes or Insights screens; no offline queue; no persistent new-order alert.
Plan: EXTEND ; Phase: 2–6

## A20 Admin restaurant screens
Status: **EXISTS_COMPLETE** (for what exists server-side)
Evidence: `frontend-admin/app/admin/restaurant/{,[id],onboarding,disputes,payouts,dispatch,delivery-fee}`; 20+ `Admin*` handlers
Gap vs target (§10): no unclaimed-restaurants queue, no legacy-migration dashboard, no moderation queue.
Plan: EXTEND ; Phase: 2

## A21 Commission plans, settlements, payouts
Status: **EXISTS_PARTIAL**
Evidence: `restaurant_payout_runs`, `restaurant_payout_lines`, `restaurant_withdrawals`, `restaurant_bank_accounts`; `AdminBuildPayoutRun/Process/Get/List`, `AdminSettleWithdrawal`, `AdminReverseWithdrawal`
Current behaviour: settlement + payout runs exist and work.
Gap vs target (§7.3): **commission is hardcoded** — `splitProviderPct = 0.80` (`service.go:28`). No per-restaurant plan, no cycle config. A generic `commission_config` exists and is used by transport/doctor but not by restaurant.
Plan: EXTEND (adopt `commission_config`, do not build `fh_commission_plans`) ; Phase: 5

## A22 Compliance docs
Status: **EXISTS_COMPLETE**
Evidence: `restaurant_kyb_documents`, `restaurant_kyb` (legal_name, rc_number, tin, bank details, status machine)
Gap vs target: no expiry tracking.
Plan: EXTEND ; Phase: 6

## A23 Notification templates for merchant events
Status: **EXISTS_PARTIAL**
Evidence: `[restaurant] notify user=… event=restaurant.order.{placed,delivered,handoff}` emitted during tests
Gap vs target: no SMS escalation for unacknowledged orders (§11).
Plan: EXTEND ; Phase: 3

## A24 Search index fields
Status: **MISSING / NOT APPLICABLE**
Evidence: no Elasticsearch in the stack; discovery is Postgres + PostGIS (`DiscoverPharmacies`-style ranking, `search/` package)
Deviation (§1.6): v2 §12 assumes ES. **Adapt: express `open_now`/boost/featured as Postgres predicates**, do not introduce ES.
Plan: EXTEND ; Phase: 6

## A25 Audit logging on food entities
Status: **EXISTS_PARTIAL**
Evidence: `audit.go` in the restaurant package; `audit_logs` written on admin decisions and onboarding grants
Gap vs target: not every owner-side mutation is audited.
Plan: EXTEND ; Phase: 3

## A26 Realtime channel for orders
Status: **EXISTS_PARTIAL**
Evidence: `ws_tracking.go`; `restaurant_order_messages`; `restaurant_rider_locations`
Gap vs target: tracking-oriented; no dedicated owner order-board channel.
Plan: EXTEND ; Phase: 3

## A27 Tests
Status: **EXISTS_COMPLETE**
Evidence: 48 test files in `internal/restaurant` incl. live-DB suites for pricing, promos, tips, disputes, modifiers, tier limits, packaging, settlement conservation
Gap vs target: no authorization-matrix tests across staff roles (A18 does not exist yet); no migration-snapshot test.
Plan: EXTEND ; Phase: 1+
