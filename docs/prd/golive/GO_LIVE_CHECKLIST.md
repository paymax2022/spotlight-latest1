# PAYMAX SUPER-APP — GO-LIVE CHECKLIST (post-audit swarm)

This documents the repo-wide go-live integration pass. A swarm audited mobile-app, backend, and
admin console, then fixed live-wiring gaps. Backend compiles green (`go build ./...` and
`go vet ./...` both exit 0). Below is what is code-ready, what still needs work, and the exact
steps to flip each module to live.

## What the swarm fixed (mobile: base-path / endpoint / body-shape bugs)
Most modules were NOT missing mock→live branches — they had **wrong base paths** (mostly
`/api/v1/<mod>` where the real Go mount is `/api/finance/<mod>`, or estate-scoped paths). Fixed:
- **Wealth**: stocks (5 paths), crypto (buy/sell/portfolio/quote), savings (base `/api/v1`→`/api/finance`, 9 endpoint/body fixes). invest/investonboarding already correct.
- **Health**: telemedicine (was mock-only → full live wiring), health (dead base `/api/v1/health`→`/api/finance/health`). doctor/triage/nutrition/food already correct.
- **Property**: stays + fractionalre + estateadmin base-path fixes; realtor already live (direct-Supabase data plane + Go admin control plane).
- **Civic/Social**: election (→ estate-scoped), social+escrow+spray (base + body fixes), creators (double-segment path), loyalty+points+black. arena/voting already correct.
- **Finance/Growth**: referral (ambassador/foundation/earnings/gamification fixes + Idempotency-Keys), crowdfunding (3 wallet/ledger paths + withdrawal), insurance (consent/product/cover-summary). transfers/payments already correct.
- **Community/Misc**: meetings/announcements/dues/tasks/documents/vendors/reports/repairs/emergencies/notifications (all estate sub-resources → `/api/finance/estate/:id/...`), academy base fix. events/kycverify already correct.

## Backend endpoints ADDED this pass (additive, persisting)
savings: `GET /summary`, `GET /vaults/:id`, `POST /vaults/:id/early-withdraw`, `GET /circles`,
`POST /circles/:id/contribute`, `GET /targets`, `GET /targets/:id`. crypto: `GET /assets/:id/chart`,
`GET /transactions/:id`. invest: `POST /activate`. social: `GET /activity|/requests|/splits|/pools`.
creators: discovery + my-content + my-subscriptions. points: `GET /points/history`. loyalty: `GET /tiers`.
Admin console: full **crypto admin** section built (overview/orders/assets).

## Flip-to-live status per module
Set the flag in `mobile-app/reactnative/.env.production` (NOT dev `.env`, so local testing keeps
mock). Only flip once the backend is deployed + migrations applied + the module verified against
live data.

### GREEN — verified correct, safe to flip after backend deploy
invest, fractionalre, arena, transfers, doctor, triage, nutrition, food, facilities,
estatesettings, visitor, kycverify, events, crowdfunding, connect(already), fx(already),
carhire/movers/parcel/towing/merchant(already).

### AMBER — core flows correct, some sub-screens hit not-yet-built endpoints (flip + feature-gate the gap screens)
health, telemedicine, stocks, savings, crypto (swap/withdraw/deposit stay mock), insurance
(renew/refund/embedded/agent stay mock), referral (contests/analytics stay mock), social
(feed/contacts live now; some lists pending), loyalty, creators.

### RED — blocked; do NOT flip until the noted gap is closed
- **estate-scoped modules** (meetings, announcements, dues, tasks, documents, vendors, reports,
  repairs, emergencies, notifications, estateadmin) — need an **estate-context provider**
  (currently hardcoded `DEFAULT_ESTATE_ID='est_amber_court'` stopgap). Build a "current estate"
  hook/provider before go-live.
- **marketplace** (mobile feature) — needs a frontend-web proxy route
  `frontend-web/app/api/v1/marketplace/[...path]/route.ts` → Go `/v1/marketplace/*`.
- **learn**, **spotlightwealth** — no Go backend module exists at all; needs a backend build.
- **election** — backend is single-position; mobile is multi-position (model mismatch) + missing
  list/active/ballot reads.

## Remaining backend/proxy work (see docs/prd/golive/BACKEND_GAPS.md from the backend agent)
- Larger subsystems documented, not faked: crypto swap/withdrawal/address-book, invest linked
  banks + statements, estate notifications mark-read, events vendor/attendee lists, stays
  home/deals/agent/reviews/loyalty/trips, insurance embedded/agent/partner.
- frontend-web proxy routes to add: `/api/v1/estate/[...path]`, `/api/v1/marketplace/[...path]`,
  `/api/v1/restaurant/:id/delivery-quote`.

## Go-live steps (per module)
1. Deploy Go backend; apply all `supabase/migrations`.
2. Ensure frontend-web proxy (`next.config.mjs` `/api/finance/:path*` rewrite + `/api/v1/*` routes) is deployed.
3. Set the module's `EXPO_PUBLIC_<MOD>_USE_MOCK=false` in `.env.production` (GREEN list first).
4. Smoke-test the module's core flows against live data; feature-gate AMBER gap screens.
5. Run backend money/regression suites (`backend/tests/*`, `npm run test:money`).

Honest status: this pass made the CODE production-ready for the GREEN set and fixed a large
volume of real integration bugs. True per-module go-live still requires the backend deployed with
migrations + live-DB validation. The app was NOT flipped to live in dev `.env` (would break local
mock testing); flip in `.env.production` per the schedule above.
