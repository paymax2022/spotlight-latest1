# foodhub — Gap Plan (PRD v2 §13)

Derived from `AUDIT.md`. Each row is a real gap; capabilities marked EXISTS_COMPLETE are absent here by design.

## Naming deviations from PRD v2 (§1.6)

| PRD v2 says | This repo uses | Why |
|---|---|---|
| `fh_restaurant_hours` | `restaurant_business_hours` + `restaurant_holiday_hours` | already exists |
| `fh_order_events` | `restaurant_order_status_events` | already exists |
| `fh_disputes` / `fh_refunds` | `restaurant_dispute_refunds` (+ tip clawbacks) | already exists; Marketplace disputes were **removed** by ADR-023, so §5.2's "reuse Marketplace" is not available |
| `fh_promotions` | `restaurant_promos` + `restaurant_promo_redemptions` | already exists, already funder-aware |
| `fh_settlements` / `fh_settlement_lines` | `restaurant_payout_runs` / `restaurant_payout_lines` | already exists |
| `fh_compliance_docs` | `restaurant_kyb_documents` | already exists |
| `fh_commission_plans` | `commission_config` (generic, used by transport/doctor) | adopting the platform table beats a food-only one |
| `fh_owner_applications` / `fh_owner_profiles` | `onb_application` / `onb_merchant_profile` | the generic engine already grants the capability |
| `fh_restaurant_staff` | `restaurant_staff` (**new**) | the one genuinely missing table; `fh_` prefix dropped for consistency |
| `fh_config` | `restaurant_*` columns + `commission_config` | no separate config table needed yet |

**No `fh_` table will be created.** §0 forbids parallel entities; every `fh_` name above has a live equivalent.

## Status mapping (canonical per §6 — the live enum wins)

| PRD v2 §6.4 | Live `orders.status` |
|---|---|
| PLACED | `pending` |
| ACCEPTED | `confirmed` |
| PREPARING | `preparing` |
| READY | `ready` |
| OUT_FOR_DELIVERY | `picked_up` |
| DELIVERED / COMPLETED | `delivered` |
| REJECTED_BY_RESTAURANT | `rejected` |
| AUTO_REJECTED | *(missing — Phase 3)* |
| CANCELLED_BY_{RESTAURANT,ADMIN} | `cancelled` + `status_reason` |
| — | `dispatch_failed`, `delivery_failed` (live-only, no v2 equivalent) |

The CHECK constraint is authoritative. New statuses are **added** to it; none are renamed.

## Phased gaps

### Phase 1 — Owner capability, staff, legacy linking
| Gap | Capability | Work |
|---|---|---|
| Two unreconciled application paths | A17 | Decide and implement the relationship between `onb_application` (capability) and `restaurant_kyb` (payout gate). **Recommendation: keep both, bridge them** — approving KYB does not grant a capability, and granting a capability does not verify a business. Add a bridge so a restaurant_merchant approval seeds a DRAFT `restaurant_kyb`, and surface both states in one owner-facing "account status". |
| No staff roles | A18 | New `restaurant_staff` (restaurant_id, user_id, role, status, invited_by, invite_token_hash, accepted_at; UNIQUE(restaurant_id,user_id)). Backfill an OWNER row per `restaurants.owner_id`. Replace `assertOwner` with role resolution that still returns the same answer for owners. |
| No owner_profile linkage | A1/A2 | Additive `restaurants.owner_profile_id` → `onb_merchant_profile`. Nullable; backfill where a profile exists. |
| Unclaimed restaurants | §5.4 | Flag restaurants whose `owner_id` has no merchant profile; admin queue + assign/claim. |
| Authorization matrix tests | A27 | Staff role × own/other restaurant × admin. |

### Phase 2 — Restaurant ops, listing review, menu completion
`listing_review_status` + `published_snapshot` + moderation queue (A6); lifecycle `status` enum alongside `is_open` **without changing what discovery serves** (A3); `is_open_override`, `auto_accept`, `delivery_mode`, `delivery_radius_m`, `service_modes[]`, `cuisine_tags[]`, `deleted_at` (A1); CSV import + 86 board (A5); admin unclaimed/legacy/moderation screens (A20).

### Phase 3 — Order flow completion
Auto-reject worker for live orders using `accept_sla_minutes` (A9); `AUTO_REJECTED` added to the CHECK; owner Kitchen mode + persistent new-order alert + SMS escalation (A19/A23); owner order-board realtime channel (A26); audit every owner mutation (A25); consumer status→label compat map (§6 compat rule).

### Phase 4 — Delivery
Own-rider mode completion, zone polygons if required, delivery exception queue. Mostly EXISTS_COMPLETE — smallest phase.

### Phase 5 — Merchant money
Adopt `commission_config` for restaurants so the 80/10/10 constants become plan-driven **snapshotted at order time** (A21/A7); align posting-type naming; settlement cycle config; reconciler. **No escrow cut-over needed** — §7.1 case (a) applies, escrow is already live (ADR-046 conservation).

### Phase 6 — Trust & growth
Owner reply + review moderation (A13); dispute maker-checker (A14); compliance expiry (A22); `open_now`/boost as Postgres predicates, **not ES** (A24); owner Insights (A19).

### Phase 7 — Hardening & rollout
Offline queue, load tests, accessibility, runbooks, flag rollout.

## Feature flags

v2 §1.4 names `foodhub.*`. The repo convention is `FEATURE_<MODULE>_ENABLED` env booleans (`FEATURE_RESTAURANT_ENABLED` exists, defaults false). **Adapt:** add `FEATURE_FOODHUB_OWNER_CONSOLE`, `FEATURE_FOODHUB_STAFF`, `FEATURE_FOODHUB_SETTLEMENTS`, `FEATURE_FOODHUB_MODERATION`, all defaulting false, rather than inventing a dotted-flag system.

## Risks

1. **A17 is a product decision, not a refactor.** Two review queues exist and both are wired to real screens. Collapsing them wrongly either strands payouts or hands out capabilities without verification.
2. **`is_open` is load-bearing for discovery.** Introducing lifecycle `status` must be additive until an explicit cut-over.
3. **Commission is snapshotted implicitly today.** Making it plan-driven must preserve "priced at order time" or historical orders reprice.
4. **PRD assumptions that do not hold:** Elasticsearch (none), Marketplace disputes to reuse (removed by ADR-023), "no escrow" (escrow is live), "no settlements" (payout runs exist).
