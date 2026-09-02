# ADR-PR — Real MyCover Goods-in-Transit cover for parcel delivery

- **Status:** Accepted
- **Date:** 2026-09-02
- **Related:** [ADR-041](ADR-041-card-rail-tops-up-the-wallet.md)-style money-path fix precedent; the existing insurance module's premium-bind saga (`backend/internal/insurance/policy/service.go`); the earlier internal-premium fix this replaces (`20270163000000_parcel_insurance_premium.sql`)

## Context

The parcel describe screen (`app/mobility/parcel/describe.tsx`) collects a
declared value "for insurance" and already renders an "Insurance cover" line
and a "Total" — the mobile UI was fully built and correctly wired. A first fix
(`20270163000000`) made the backend compute an in-house 1.5% premium and fold
it into the courier's fare escrow, released 100% to the platform via
`Split.ServiceFeeKobo`.

That fix worked, but it was not real insurance: no policy, no underwriter, no
claim path — just an internal fee dressed as cover. This repo already has a
mature, live-verified MyCover integration (`backend/internal/insurance/`) used
by a standalone Protection flow, with a proven quote→wallet-debit→bind→
commission-only-revenue saga (5 real sandbox purchases prior to this change).
The task was to wire parcels into *that*, not keep the fabricated premium.

Investigation before writing code found the real state was messier than
assumed:

- Every catalog row that ever supported real cover — including a
  `mycover.health.micro.v1` row that looked "real" at a glance — had been
  retired by a reconciliation migration as `fictional_seed`. There was no
  active, purchasable product for **anything** in this system before this PR.
- A generic "embedded auto-bind on platform event" engine
  (`insurance/embedded/`) already lists `parcel.booked` as an example — but is
  100% inert: nothing emits that event, it has zero test coverage, and its one
  parcel-routed catalog row pointed at Octamile, a second provider whose
  credentials are still the placeholder `"xxx"`.
- A live, read-only catalog sync (`POST /api/insurance/admin/catalog/sync` —
  confirmed GET-only against MyCover, no purchase risk) surfaced **three**
  real, purchasable Goods-in-Transit products: `sti-git-annual`,
  `sti-git-on-demand`, `sti-git-on-demand-capped`, plus a fourth,
  similarly-named `sti-goods-in-transit` that is genuinely broken
  (`purchasable=false`, confirmed by the provider's own catalog).
- The configured `INSURANCE_MYCOVER_API_KEY` is a **test/sandbox key**
  (`MCASECK_TEST...`), not production — the "5 real purchases" this repo's
  history refers to, and this PR's own live quote/bind verification, all run
  against MyCover's sandbox, not real money.

## Decision

**Product:** `mycover:sti-git-on-demand` ("On Demand Goods In Transit") — a
parcel is one shipment, not a year of continuous cover, so the on-demand
product is the correct fit, not the annual one. `sti-goods-in-transit`
(similarly named, broken) must never be used.

**Two-stage cover, not one:**

1. **Estimate time** (`EstimateParcel`, `BookParcel`): a DISPLAY-ONLY figure —
   the product's current synced `rate_bps` × declared value — no provider
   call, no PII shared, no consent needed. This is intentionally an
   *estimate*: a real live quote for a ₦10,000 declared value returned a
   ₦2,000 premium (40× the pure-percentage figure) because the provider
   applies a minimum-premium floor the catalog doesn't expose. Getting an
   exact number would mean a consent-gated, PII-sharing provider call on
   every estimate keystroke, for a screen the sender may never submit — the
   wrong trade. `BookParcel`'s escrow is **fare-only**; the courier settlement
   split (`ServiceFeeKobo`) no longer carves out insurance at all.
2. **Bind time** (`AcceptParcel` → `bindParcelInsurance`): once a real courier
   + vehicle are known (the schema requires a real plate/vehicle type), the
   REAL quote→bind saga runs via the exact same `policy.Service` the
   standalone Protection flow uses, called in-process (not over HTTP) through
   a new `transport.InsuranceBinder` seam — mirrors the existing
   `tierLimiter`/`MapsAdapter`/`CommissionRecorder` local-interface pattern so
   `transport` never imports `insurance/*` packages directly. The premium is
   a **separate wallet debit into `AccountProviderClearing`** (pass-through,
   never platform revenue) with only MyCover's disclosed commission (10% on
   this product) landing in `AccountCommission` — entirely decoupled from the
   courier's fare settlement.

**Best-effort by design, at every step.** Missing sender profile fields
(`gender`/`date_of_birth`/`address` — genuinely often blank; `user_profiles`
backs many unrelated flows), a missing courier vehicle plate, a declined
consent, a failed quote, a failed bind (auto-reversed by the existing saga),
or an empty prefunded float: none of these ever block courier assignment or
delivery. A parcel that can't be insured ships uninsured, logged and
notifiable, never stuck.

**Consent** is granted server-side at `BookParcel` time (best-effort, not
blocking) rather than adding a separate mobile consent screen: the sender
already opted in by entering a value into a field explicitly labelled "for
insurance" — a product decision, not a technical default, documented here so
it's inspectable.

## A real gap found and fixed while verifying live

The synced `form_schema` for `sti-git-on-demand` marks `item_details[].image_url`
as `"required": false` — but the live API rejects a request missing that key
entirely (`400: "/item_details/0 must have required property 'image_url'"`).
We have no real item photo at booking time, so the input builder sends the key
with an empty value. This is exactly the kind of schema-vs-reality mismatch
this module's own code comments warn about elsewhere; noted here so a future
schema-trusting refactor doesn't quietly reintroduce it.

## Consequences

- Two additive migrations: `parcels.insurance_kobo`'s meaning changes from "a
  charge" to "an indicative estimate" (no schema change, documented in
  comments); `parcels.insurance_policy_id` (nullable, no cross-module FK —
  matches the existing `settlement_id` convention) links a parcel to its bound
  policy for tracing and for `CancelParcel` to best-effort cancel it too.
- `RegisterInsurance` now returns `*InsuranceServices` (previously void) so
  `registerFinanceRoutes` can thread the same `policy`/`catalog`/`consent`
  services into transport's wiring instead of constructing a redundant second
  set.
- Verified live against the real MyCover sandbox: a real quote for the exact
  bug-report addresses returned a real premium and commission split; a real
  bind attempt correctly reached `PAYMENT_FAILED → VOID` with zero money moved
  when the QA fixture's Tier-0 KYC gate blocked the wallet debit — proving the
  saga's fail-closed guard applies to this money path exactly as it does to
  transport's own fare escrow. A full success-path bind needs a Tier-1+ KYC'd
  test account, which this environment doesn't have; not something to work
  around by bypassing the gate.
- Mobile-side scope was deliberately kept small: `ParcelEstimate`'s
  `insuranceKobo`/`totalKobo` field *names* are unchanged, so the existing,
  already-correct mobile code needs no changes for this PR. Surfacing the
  bound policy/certificate to the sender, and labelling the estimate as
  approximate in the UI copy, are follow-ups.
