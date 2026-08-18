# foodhub — Progress (PRD v2 §1.5)

| Phase | Status | Notes |
|---|---|---|
| 0 Audit | **DONE** | `AUDIT.md` (A1–A27 with evidence), `GAP_PLAN.md` (status mapping, naming deviations, risks). No code written, per §2. |
| 1 Owner capability & legacy linking | **IN PROGRESS** | Multi-outlet owner console landed. Staff roles (A18), owner_profile linkage and legacy/unclaimed queue still to do. A17 decision made: BRIDGE (see below). |
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

## A17 — decided: bridge, not merge

The two systems stay separate because they answer different questions, and
because KYB is per OUTLET while the capability is per PERSON — an owner's second
outlet can carry different banking, so merging would break as soon as multi-outlet
is real (it now is).

What was missing was the join, and it was costing money silently:
**1059 of 1075 outlets have no KYB row at all, and 709 are actively trading while
not KYB-approved.** `buildPayoutRun` selects `AND res.kyb_status = 'approved'`
(PY-007), so those outlets take orders, settle into `provider_kobo`, and are
skipped by every payout run with nothing surfaced to owner or admin.

`GET /restaurant/payout-readiness` now reports, per outlet: payable, why not, and
how much has already settled behind the gate. Manage Store shows it as a banner,
only when that outlet is blocked.

## Staff roles (A18) — done

`restaurant_staff` grants authority per (outlet, user), so a manager at Lekki has
none at Ikeja. OWNER rows are system-managed, mirroring `restaurants.owner_id`;
the staff API grants only MANAGER/CASHIER/KITCHEN/RIDER. 1237 owner rows
backfilled — exactly the number of restaurants with an owner — so resolution
returns what `assertOwner` returns and the migration alone changes no behaviour.

Guard swap **done**: all 18 owner-side call sites now go through
`AssertStaffPermission` with a per-action permission. `assertOwner` survives only
as the parity oracle in tests.

Invite/accept and the Staff screen are **done**: an owner (or a manager, for
non-manager roles) invites by user id, hands over a one-time code, and can
suspend, restore or remove anyone except the owner. Staff roles are now usable
end to end.

Remaining in Phase 1: `owner_profile_id` linkage and the legacy/unclaimed queue
(§5.4).

## Remaining Phase 1 work

**A17 — two owner-application paths.** `onb_application` grants the capability; `restaurant_kyb` gates payouts. Neither triggers the other, so today a user can hold the capability without approved KYB (can trade, cannot be paid) or the reverse.

The gap plan recommends **bridging, not merging**: they answer different questions ("may this person be a restaurant merchant?" vs "may this store be paid?"). Merging would either weaken payout verification or gate the capability behind per-restaurant banking. Confirm before Phase 1 starts.

## Deviations logged (§1.6)

- No `fh_` tables — every one has a live equivalent (see GAP_PLAN naming table).
- No Elasticsearch — discovery is Postgres/PostGIS; `open_now`/boost become predicates.
- Marketplace disputes cannot be reused — ADR-023 removed them.
- Flags follow `FEATURE_<X>_ENABLED` env convention, not dotted `foodhub.*`.
