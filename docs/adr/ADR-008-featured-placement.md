# ADR-008 — Featured Placement: a booking system over scarce ad inventory

**Date:** 2026-06-29
**Status:** Accepted
**Deciders:** Platform / Backend, with Frontend + Mobile + Finance + QA

## Context

Any verified merchant with an eligible, published listing (product, service,
property, event, store, creator profile) can pay to surface that item on the
mobile app landing page for a chosen time window. When the window ends it comes
down automatically.

The hard part is not "merchant pays, item shows." The landing page is **finite
inventory**: a fixed number of slots across a continuous timeline. So the module
is a **booking/reservation system over scarce ad inventory**, wrapped in escrow
payments, mandatory moderation, and a scheduled serving engine — built entirely
on existing Paymax rails (KYC tiers, the append-only ledger, notifications,
audit, the mobile design system).

## Decisions

### 1. Campaign ≠ Reservation (one row never does both jobs)
`featured_campaign` is the **request + review state** (DRAFT → … → COMPLETED).
`placement_reservation` is the **durable, non-overlapping slot hold** produced
on approval. Separating them keeps the review lifecycle independent from the
inventory invariant and lets the exclusion constraint guard only real holds.

### 2. Overlap is impossible in the schema, not just in code
EXCLUSIVE zones (HERO, capacity 1) are reserved against a continuous timeline. A
Postgres GiST `EXCLUDE` constraint on `placement_reservation` makes two
overlapping holds in the same zone structurally unrepresentable:

```sql
EXCLUDE USING gist (zone_code WITH =, tstzrange(window_start, window_end, '[)') WITH &&)
  WHERE (state IN ('SCHEDULED','ACTIVE','PAUSED'))
```

`btree_gist` (already enabled, see realtor migration `20260620020000`) supplies
the `=` opclass for the scalar `zone_code`. Half-open `[)` ranges make back-to-back
windows non-overlapping. The partial `WHERE` frees the slot the moment a
reservation goes terminal. This is the "illegal states unreachable" pattern.

POOLED zones (carousel cap 8, grid cap 12) do **not** reserve; capacity is
checked transactionally at activation and oversubscription is served by weighted
fair rotation (§ Serving), never refused.

### 3. Money = escrow→revenue on the existing ledger (no new engine)
Reuse the append-only double-entry ledger (ADR-002) with two new **standing
accounts** added as Go constants, auto-created on first use exactly like
`AccountEscrow` (no seed row, no `ledger_accounts` schema change):
`AccountPlacementEscrow`, `AccountPlacementRevenue`.

| Trigger | Ledger movement | Idempotency key |
|---|---|---|
| Approval + pay | merchant wallet → PLACEMENT_ESCROW (tier-checked debit) | `placement:<id>:hold` |
| Reject / pre-start cancel | reverse ESCROW → merchant wallet (full) | `placement:<id>:refund` |
| Completion | ESCROW → PLACEMENT_REVENUE (full) | `placement:<id>:recognize` |
| Early cancel / suspend | earned days → REVENUE; remainder → wallet | `…:recognize_partial` + `…:refund_partial` |
| Pause | no money; `window_end` extended by paused duration | — |

Balances stay derived from the ledger; no mutable money number on the campaign.
Every money mutation is idempotent on `campaign_id + operation`, so retries and
double-submits never double-apply. Wallet debits flow through tier-limit checks
fail-closed (tiers service), like every other money-out leg.

### 4. Guarded state machine, no raw status writes
`State` consts + a `transitions` adjacency map + `canTransition` live in the
module; a single private `service.transition()` is the only mutation path and
calls `repo.SetState(id, to, expectedVersion)` (optimistic `version` lock). Every
transition records actor + timestamp and writes an immutable `placement_audit_log`
entry. Any edge not declared is rejected (fail-closed).

### 5. Polymorphic subject by reference, never by copy
`subject_type` + `subject_id` (both TEXT, no FK), mirroring
`maps.merchant_locations`. Subjects span tables with mixed PK types, and copying
listing data into the campaign would let it drift. Eligibility (published, owned,
in good standing) is re-checked server-side at submit **and** at activation
**and** at serve time.

### 6. Serving: re-check liveness at serve time, never an empty hero
`GET /api/finance/placement/landing` (public, unauthenticated, short-TTL
cacheable, offline-first) returns, per zone, the campaigns active *now*,
re-checking live eligibility at serve time — a suspended merchant or unpublished
subject is dropped immediately even if the row still says ACTIVE. HERO falls back
to house content when empty. Pooled zones over capacity use weighted fair
rotation (weight by tier, fairness counter for proportional impression share).
Each served unit carries a fresh `placement_token` for attribution and is
labelled "Featured/Promoted".

### 7. Scheduler jobs are idempotent service methods
Activator (SCHEDULED→ACTIVE), Expirer (ACTIVE→COMPLETED, recognize revenue),
Reminder (T-24h renew nudge), Pause-accounting (extend `window_end`),
Reconciliation (nightly ledger sweep + orphaned-hold TTL release). Each is safe
to re-run; the cron/queue runner only needs to call them periodically.

### 8. URL + flag conventions (match the codebase)
Member: `/api/finance/placement/*` (authed via the finance group). Admin:
`/api/placement/admin/*` (`requireUserID` + `RequirePermission(rbac,
"placement.admin.*")`). Public resolver mounted on the root engine (no
`requireUserID`). Next proxies under `/api/v1/placement/*` and `/api/v1/landing/*`.
Gated by `FEATURE_PLACEMENT_ENABLED` (default false — no flag, no merge).

## Consequences
- Premium scarcity (HERO) and scalable participation (pooled) coexist.
- The inventory invariant is enforced by Postgres, not trusted to app code.
- Money is auditable escrow→revenue with full idempotency; no new payment path.
- The big lift is the serving resolver + scheduler + review queue, not the CRUD.

## Open commercial knobs (§15 — architecture-neutral defaults shipped)
HERO pricing fixed-rate (v1) vs sealed second-price auction (v2); exact
`base_daily_rate`/`tier_multiplier`/duration-discount curve per zone; pooled
capacities (8/12); pause credits time (default) vs money refund;
concurrent-campaign cap + per-zone cooldown lengths. All are config/data, changeable
without re-architecting.
