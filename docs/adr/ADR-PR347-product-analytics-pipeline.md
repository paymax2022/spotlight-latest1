# ADR-PR347: Product-Usage Analytics Pipeline

**Status:** Proposed
**Date:** 2026-09-30
**Deciders:** Paymax fintech team
**Audit ref:** AUD-REL-007

## Context

The platform emits **no product-usage telemetry**. Grepping all three apps finds
no event-ingestion SDK, no event schema, and no funnel instrumentation — the
only "analytics" is DB-query dashboards (`estate/analytics`, compliance) and a
dead `analyticsService.ts` fetcher. Sentry covers errors, not product questions.

Concretely, today nobody can answer:

- signup → KYC → first-transaction **activation funnel** and drop-off points
- payment success rate **by cohort/channel** (web vs mobile, paid vote vs wallet top-up)
- feature adoption (which of ~300 flagged admin pages / ~70 mobile groups are used)
- retention / churn signals for voting, wallet, and marketplace flows

Combined with the notification pipeline (AUD-BE-008), the product plane is
doubly invisible: we can't see delivery *or* engagement.

### Constraints

- **Multi-platform**: web (Next.js), admin (Next.js), mobile (RN/Expo), backend (Go).
- **Fintech data sensitivity**: events will brush PII/adjacent data (amounts, KYC
  states). Whatever we choose must support data-residency control or a data
  processing agreement.
- **Operational maturity**: the team already operates Supabase Postgres, Redis,
  and Render/Cloud Run. A self-hosted analytics stack adds a fourth datastore
  to keep alive.
- **Cost**: early-stage volume (~10⁵–10⁶ events/month projected) fits vendor
  free tiers; self-hosting costs engineer-hours, not dollars.

## Options considered

### A. Vendor SDK (PostHog — recommended)

PostHog Cloud (EU region for residency) with `posthog-js`, `posthog-react-native`,
`posthog-go` SDKs. Autocapture covers page views; explicit `capture()` calls
cover the funnel events below. Generous free tier (~1M events/mo), self-hostable
later if residency/DPA demands change.

- ✅ Fastest path to answering funnel questions (days, not a quarter)
- ✅ Session replay + feature-flag tooling come free, replacing hand-rolled flags
- ✅ Proven SDKs for all four platforms we run
- ❌ Third-party PII processor — needs DPA + `person_profiles` config to control
  what identifies users; event payload policy must exclude amounts/PII where
  not needed
- ❌ Vendor dependency; egress at scale eventually costs money

### B. In-house event store

`product_events` Postgres table + `POST /api/v1/events` ingestion route
(batched, feature-flagged) + materialized views for dashboards.

- ✅ Zero new vendor; data never leaves our infra
- ❌ We would be building a database, ingestion API, schema versioning, query
  layer, and dashboards — i.e., a product — to answer questions a vendor answers
  on day one. Every hour spent here is not spent on the fintech roadmap.
- ❌ Funnel/retention/query UX is exactly what makes analytics useful; raw SQL
  on an events table is where "we have the data" goes to die.

### C. Segment-style router

Adds a second vendor plus downstream config for no benefit at our scale.

## Decision

**Adopt PostHog (Option A)**, managed cloud, EU region.

### Implementation sketch (follow-up work, feature-flagged)

1. `NEXT_PUBLIC_POSTHOG_KEY` / `EXPO_PUBLIC_POSTHOG_KEY` env wiring; init behind
   `FEATURE_ANALYTICS_ENABLED` (off by default — iron rule: no flag, no merge).
2. Explicit-event schema (no autocapture of form fields):
   `signed_up`, `kyc_submitted`, `kyc_approved`, `wallet_funded`,
   `vote_purchased`, `first_payout`, keyed by `distinct_id = platform_user.id`
   (pseudonymous UUID only — never email/phone in the event stream).
3. Backend emits server-side events for money-path completions
   (`charge.succeeded` fulfilment) so funnels don't depend on client delivery —
   the same lesson AUD-FE-003 taught for payment fulfilment.
4. Privacy gate: amounts may be bucketed (`<1k`, `1-10k`, …) rather than exact;
   review each event property against PII policy before shipping.

### When to revisit

Re-evaluate self-hosted PostHog or Option B when either is true: event volume
exceeds the free tier sustainably, or a regulator/DPA requires analytics data
to stay in-country.

## Consequences

- Funnel/retention questions become answerable within days of enabling the flag.
- Adds one vendor dependency and one env-secret pair per app.
- The dead `analyticsService.ts` should be removed or rewired when the SDK lands.
- Event-schema discipline is a reviewable artifact: new events get a line in
  `docs/analytics-events.md` (to be created with the first emitter PR).
