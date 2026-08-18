# foodhub — Progress (PRD v2 §1.5)

| Phase | Status | Notes |
|---|---|---|
| 0 Audit | **DONE** | `AUDIT.md` (A1–A27 with evidence), `GAP_PLAN.md` (status mapping, naming deviations, risks). No code written, per §2. |
| 1 Owner capability & legacy linking | **IN PROGRESS** | Multi-outlet owner console landed. Staff roles (A18), owner_profile linkage and legacy/unclaimed queue still to do. A17 decision still open. |
| 2 Restaurant ops & menu | NOT STARTED | |
| 3 Restaurant-side order flow | NOT STARTED | |
| 4 Delivery | NOT STARTED | Smallest phase; mostly already complete. |
| 5 Merchant money | NOT STARTED | Escrow already live — no cut-over needed. |
| 6 Trust & growth | NOT STARTED | |
| 7 Hardening & rollout | NOT STARTED | |

## Phase 0 outcome

Five of PRD v2's eight "likely gaps" (§2.2) are **not gaps**: hours, modifiers, disputes/refunds, promotions and settlement/payout runs all exist. Three real gaps dominate: duplicated owner-application paths (A17), hardcoded commission (A21), and no staff roles (A18).

## Multi-outlet (Chowdeck-style) — done

The platform was already multi-restaurant server-side: `restaurants.owner_id` is
1:N and `ListOrders(role=restaurant)` joins on it, so the order queue always
spanned every outlet. **The owner console was not** — Manage Store read
`stores.data?.[0]`, so of the 61 owners who already run 2–3 outlets, each could
manage only their first. Fixed: outlet switcher, add-outlet flow, and selection
that survives an outlet being transferred or closed.

Not needed after checking: an outlet label on order rows — `OrderListRow` already
renders `order.restaurantName`.

## Open decision blocking the rest of Phase 1

**A17 — two owner-application paths.** `onb_application` grants the capability; `restaurant_kyb` gates payouts. Neither triggers the other, so today a user can hold the capability without approved KYB (can trade, cannot be paid) or the reverse.

The gap plan recommends **bridging, not merging**: they answer different questions ("may this person be a restaurant merchant?" vs "may this store be paid?"). Merging would either weaken payout verification or gate the capability behind per-restaurant banking. Confirm before Phase 1 starts.

## Deviations logged (§1.6)

- No `fh_` tables — every one has a live equivalent (see GAP_PLAN naming table).
- No Elasticsearch — discovery is Postgres/PostGIS; `open_now`/boost become predicates.
- Marketplace disputes cannot be reused — ADR-023 removed them.
- Flags follow `FEATURE_<X>_ENABLED` env convention, not dotted `foodhub.*`.
