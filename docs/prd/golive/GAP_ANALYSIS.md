# PAYMAX SUPER-APP — GO-LIVE GAP ANALYSIS (repo-wide audit)

Scope: mobile-app (React Native/Expo), Go backend, admin console. Goal: move modules from
"mock data view" to real backend-integrated, persisting, production go-live.

## How mock mode works
Each mobile feature has `USE_MOCK = (process.env.EXPO_PUBLIC_<MOD>_USE_MOCK ?? 'true') !== 'false'`.
**Default is mock.** `.env` only sets a few flags to `false` (live). So most screens render mock
data today even where a real backend exists. Going live per module = (1) live api paths correct
+ (2) backend endpoints exist & persist + (3) admin parity + (4) set the env flag `=false`.

## Live today (env=false): carhire, connect, event, fx, logistics, merchant, movers, parcel, towing.
## Mock today (env unset/true → mock): everything else, incl. mobility(true), bus(true), and ~45 modules.

## Backend availability (most modules HAVE a Go backend)
Backends exist for: association, arena, connect, creators, crowdfunding, crypto, doctor, events,
health, insurance, invest, loyalty, marketplace, nutrition, realtor, referral, savings, social,
stays, telemedicine, property, fractionalre, restaurant(food), transport(mobility), academy,
p2pmarket, spray, points, groups, estate. → For these, go-live = wire mobile→live + admin + flag.

## Per-module gap classes (from api-layer scan)
- **MOCK-ONLY api (no live calls) — needs live paths added:** academy(0/0), marketplace-feature(0/4),
  realtor(1/8 → 7 mock-only), health(0/1), insurance(0/0), stays(0/0), meetings(0/1), election(0/1),
  invest(0/1), registration(0/1), documents, dues, tasks, announcements, savings, loyalty, social,
  creators, referral, events, estate*, facilities, visitor, nutrition/food, notifications.
- **Live paths present, flag still mock (flip after verify):** association(done), crypto, stocks,
  investai, investonboarding, investsettings, learn, spotlightwealth, merchant, mobility, bus, fx,
  crowdfunding(4/4), connect.
- **Admin console:** present for many (association, marketplace, mobility, fx, health, invest,
  realtor, stays, savings, referral, loyalty, social, crowdfunding, insurance, etc.) but parity
  with backend admin endpoints is uneven — audit + fill per module.

## Biggest modules (by screen count) — prioritize: (doctor)176, connect122, health121,
crowdfunding96, learn83, referral78, stays75, association70(done), mobility58, fx54, insurance44,
realtor43, marketplace36, crypto35, fractionalre32.

## Execution plan (this run)
A swarm closes CODE gaps (live api paths, missing endpoints, admin build-out) for prioritized
clusters so each module is go-live-ready; env flags are flipped centrally only for modules whose
live path + backend are verified to compile. True production go-live per module still requires the
backend deployed with migrations applied + live-DB validation (documented per module).

### Clusters (disjoint dirs — parallel-safe)
- C1 Wealth: invest, investai, investonboarding, investsettings, stocks, crypto, spotlightwealth, savings
- C2 Health: health, doctor, telemedicine, triage, nutrition, food
- C3 Property: realtor, property, properties, stays, fractionalre, estate/estateadmin/estatesettings/facilities/visitor
- C4 Civic/Social: voting, election, arena, connect, social, creators, loyalty
- C5 Finance/Growth: transfers, payments, referral, crowdfunding, insurance
- C6 Community/Misc: events, meetings, announcements, dues, tasks, documents, learn, academy, marketplace(feature), vendors, reports, repairs, emergencies, notifications, kycverify

### Agent mandate (per cluster) — mobile only, disjoint dirs
For each module: read src/features/<mod>/api + app/<mod>; if api is mock-only, ADD live paths to the
real backend endpoints (confirm base path against a working finance module, e.g. wallet.api.ts →
usually `/api/finance/<mod>` or `/api/v1/<mod>`; read backend routes to confirm); fix wrong base
paths; ensure screens bind live via hooks with loading/empty/error and mutations invalidate/refetch;
keep mock branch as offline fallback. DO NOT edit `.env`, backend, admin, or other clusters.
Report: per module — mock→live status, exact `.env` flag to flip, any MISSING backend endpoint.

### Admin agent: build/fill admin pages to backend parity for the priority modules (own frontend-admin only).
### Backend agent: verify + add any missing endpoints reported (own backend + router wiring).
### Finalize (orchestrator): flip verified `.env` flags, `go build ./...` green, commit, push to GitHub.
