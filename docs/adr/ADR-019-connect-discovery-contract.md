# ADR-019 — Connect Discovery: Align Backend to the Mobile Contract (privacy-bucketed, money-path boosts)

**Date:** 2026-07-04  
**Status:** Accepted  
**Deciders:** Platform team, Connect module owners

## Context

Connect (the dating/social super-app vertical) has two independently-built
surfaces for the discovery experience:

- The **mobile client** models discovery as a rich, opinionated flow:
  a swipeable `stack`, a `swipe` action with `like | pass | superlike`,
  a `likes-you` surface, a `nearby` surface, a premium `rewind`, and a
  paid `boost` to raise one's visibility.
- The **backend** historically exposed only flat primitives:
  `GET /discovery`, `GET /search`, `POST /likes`, `GET /matches` — with no
  swipe direction taxonomy, no pass persistence, no boosts, and no
  privacy-bucketed distance.

The backend now implements the richer member routes under
`/api/v1/connect/discovery/*` (camelCase responses). Three problems had to be
resolved before this could ship:

1. **Contract drift.** The spec (`contracts/openapi.yaml`) had **no** `/connect`
   paths at all, violating the spec-first workflow rule. Mobile and backend
   agreed on shapes out-of-band with nothing authoritative in between.

2. **Location privacy.** `ProfileCard` must never leak raw coordinates. The
   underlying `connect_profiles` data can support proximity ranking, but the
   card that crosses the wire has to be privacy-preserving.

3. **A missing swipe outcome.** The existing `connect_likes.kind` CHECK allows
   only `('like','super')`. There was nowhere to record a **pass**, so a passed
   card could be re-shown and `rewind` had nothing to undo for a pass.

## Decision

### 1. Align the backend to the mobile's richer contract — do not reshape the client.

The authoritative contract is now the mobile-shaped set of routes
(`stack`, `swipe`, `likes-you`, `nearby`, `rewind`, `boosts`), specified in
`contracts/openapi.yaml` under `/api/v1/connect/discovery/*` with tag
`[Connect]` and `bearerAuth`. The flat legacy routes
(`/api/v1/connect/{discovery,search,likes,matches}`) are **kept and documented**
as aliases for existing callers, but the stack/swipe model is canonical.

Rationale: the client's model is the product-correct one (a Tinder-style deck is
the whole UX), it is already built, and reshaping it to fit flat primitives would
be a large, user-visible regression for no benefit. The cheaper and safer move is
to make the backend and the spec speak the client's language.

### 2. `nearby` exposes bucketed distance only — never raw coordinates.

`ConnectProfileCard` carries **no `lat`/`lng`**. Proximity is exposed as:

- `distanceLabel` — a human string (e.g. "Within 5 km"), and
- `distanceBucket` — a coarse enum `here | near | city | region | far`.

The bucket is the *only* machine-readable proximity signal. Raw coordinates are
computed and ranked server-side and never leave the server. The client was
(re)designed around buckets rather than a precise distance/radius, so there is no
place in the UI that needs a raw number. This is privacy-by-design: a member's
exact location can never be triangulated from the discovery surface.

### 3. Boosts are a money-path feature.

`POST /api/v1/connect/discovery/boosts` charges the member's wallet in kobo for a
visibility boost. It follows the same iron rules as every other money mutation:

- **Idempotency-Key header REQUIRED** (fails closed with HTTP 400 if absent);
  retries with the same key return the original boost with no double-charge.
- **Balanced double-entry ledger** posting; `connect_boosts.ledger_ref` ties the
  boost to its journal. No balance column is ever added — balances stay derived.
- **Audit event** emitted; **tier-limit** checked fail-closed.
- **Price and duration are backend-owned** (`connect_config` keys
  `discovery.boost_price_kobo` = 50000, `discovery.boost_duration_minutes` = 30),
  never client-supplied.

`connect_boosts` uses `text` `id`/`user_id` to match the Connect member API's
opaque-string / camelCase contract; the `idempotency_key` column is `UNIQUE`,
mirroring the ledger key. Boost lifecycle is forward-only in the service layer
(`active → expired | refunded`), enforced by a CHECK constraint on `status`.

### 4. A dedicated `connect_passes` table records pass swipes.

Because `connect_likes.kind` cannot represent a pass, passes get their own table
that mirrors `connect_likes` exactly: `uuid` FKs to `connect_profiles(id)`,
`CHECK(from_profile <> to_profile)`, and `UNIQUE(from_profile, to_profile)` for
idempotency. This keeps a passed card out of the stack and gives `rewind` a row
to delete. Owner-scoped RLS mirrors `connect_likes` (an actor sees/creates only
their own passes; nobody can read who passed on them); `service_role` bypasses.

### 5. RBAC: two new member permissions.

`connect.discovery.access` (use the discovery surfaces) and
`connect.boost.purchase` (buy a boost) are seeded into the enterprise RBAC tables
and granted to the default member roles `registered-user` and `verified-user`
(plus super/system-admin for a complete map), mirroring the connect_rbac /
connect_money seed pattern. This is the first Connect **member** permission —
prior Connect RBAC seeds were admin/moderator only.

## Consequences

### Positive
- One authoritative contract; mobile and backend can no longer drift silently.
- Members' exact location is structurally unleakable via discovery.
- Boosts inherit the full money-path safety net (idempotency, ledger, audit,
  tier limits) rather than being a bespoke charge.
- Passes are first-class, so the stack behaves correctly and rewind is coherent.

### Negative / trade-offs
- The backend carries both the canonical stack/swipe routes **and** the flat
  legacy aliases until clients fully migrate — more surface to maintain/test.
- Bucketed distance means the UI cannot show a precise "1.2 km away"; product
  accepted this as the privacy cost.
- Boost pricing is a config row, not a schema constraint — a bad config value
  (e.g. 0 kobo) would ship a free boost. The purchase path must validate the
  config-sourced price fail-closed (documented as a smoke test in the runbook).

### Deferred
- Boost stacking / auto-renew and refund automation (manual refund only for now;
  `refunded` status exists but no automated reversal flow is specified here).
- Entitlement modelling for `likes-you` / `rewind` premium gating (assumed to be
  handled by the existing Connect entitlement layer; not re-specified here).
- Precise-distance opt-in (a member voluntarily sharing exact distance) is out of
  scope; buckets only for v1.
