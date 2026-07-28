# ROUTING VERIFICATION — mobile base-path fixes (non-estate modules)

Independent verification pass over the go-live swarm's mobile base-path fixes. Scope:
`mobile-app/reactnative/src/features/**` EXCLUDING the estate cluster (dues, meetings,
announcements, documents, notifications, emergencies, facilities, ainotes, tasks, vendors,
reports, repairs, estateadmin, visitor, properties, election) and EXCLUDING marketplace/food
frontend-web proxies.

Routing truth used throughout: mobile's `api` axios client hits **frontend-web** (Next.js).
A path resolves if EITHER (a) it starts with `/api/finance/` (blanket rewrite in
`frontend-web/next.config.mjs` → Go), OR (b) a frontend-web route handler / catch-all exists at
`frontend-web/app/api/<that-path>/route.ts`. "Resolves" here means the HTTP call reaches a real
handler — it does NOT always mean the specific sub-route is implemented on the Go side; those
narrower gaps are called out separately per module.

## Summary table

| Module | Live base path(s) | Resolves? | Action taken |
|---|---|---|---|
| stocks | `/api/v1/stocks*` | catch-all `app/api/v1/stocks/[...path]` → Go `internal/invest/routes.go` (confirmed) | none needed |
| invest | `/api/v1/invest*` | catch-all `app/api/v1/invest/[...path]` → Go invest routes (confirmed) | none needed |
| crypto | `/api/v1/crypto*` | catch-all `app/api/v1/crypto/[...path]` → Go `internal/crypto/routes.go` (confirmed for assets/orders/portfolio) | none needed; unimplemented sub-paths flagged below |
| savings | `/api/finance/savings` | blanket rewrite → Go `internal/savings/handler.go` (confirmed) | none needed (already fixed by prior pass) |
| investai | `/api/v1/ai/invest/*` | **NONE** — no frontend-web dir, no Go route | flagged only (whole feature missing) |
| investonboarding | was `/api/v1/suitability/*` (3 fns), should be `/api/v1/invest/suitability/*` | rewrite via invest catch-all once fixed | **FIXED** — see edits below |
| investsettings | `/api/v1/invest/*` | catch-all (confirmed) | none needed |
| spotlightwealth | `/api/v1/spotlight/*` | **NONE** — no frontend-web dir, no Go module at all | flagged only (whole backend module missing) |
| health | `/api/finance/health*` | blanket rewrite → Go `health_routes.go` + vet/pharmacy/lab (confirmed) | none needed |
| doctor | `/api/v1/doctor` | catch-all `app/api/v1/doctor/[...path]` → Go `r.Group("/api/v1/doctor")` (confirmed) | none needed |
| triage | `/api/finance/health/triage` | blanket rewrite (confirmed) | none needed |
| nutrition | `/api/v1/nutrition` | catch-all → proxies to Go `/api/finance/nutrition` (confirmed) | none needed |
| telemedicine | `/api/v1/telemedicine` | **PARTIAL** — only appointments (list/:id/complete/prescription) + doctors have explicit handlers; no catch-all | flagged only — frontend-web gap, not a mobile base-path bug (no alternate resolvable base exists) |
| arena | `/api/arena` (top-level, not under finance) | catch-all `app/api/arena/[...path]` → Go `arena_routes.go` (confirmed) | none needed (reconfirmed "already correct") |
| connect | `/api/v1/connect` | catch-all → Go `r.Group("/api/v1/connect")` (confirmed) | none needed |
| social | `/api/finance/social` (+ `/api/finance/p2p/p2p` escrow, `/api/finance/p2p/spray`) | blanket rewrite (confirmed double-nested p2p paths match Go) | none needed |
| creators | `/api/finance/creators/creators` (double-nested, intentional) | blanket rewrite (confirmed) | none needed |
| loyalty | `/api/finance/loyalty` (+ `/api/finance` for points) | blanket rewrite (confirmed) | none needed |
| events | `/api/finance/events` | blanket rewrite (confirmed) | none needed |
| kycverify | `/api/finance/kyc` | blanket rewrite (confirmed); separate `src/api/kyc.api.ts`/`profile.api.ts` correctly use dedicated `/api/v1/kyc/{me,initiate,tier0}` handlers | none needed |
| referral (home/rewards subfeature) | `/api/v1/referrals` (plural) | catch-all → Go `/v1/referrals` rewards engine (confirmed) | none needed |
| referral (ambassador/agent/gamification/foundation/campaigns) | `/api/v1/referral` (singular) | catch-all → Go `/api/finance/referral/{campaigns,gamification,network}` via `referral_econ_routes.go` (confirmed) | none needed |
| referral (merchant) | mock-only, documented backend gap (admin-only Go route, no member endpoint) | N/A — intentionally mock | none needed, correctly left mock |
| crowdfunding | `/api/v1/crowdfunding/*` | ~45 explicit frontend-web routes, each proxying to matching `/api/finance/crowdfunding/*` (confirmed) | none needed |
| insurance | `/api/v1/insurance` | catch-all → `/api/finance/insurance` (confirmed) | none needed |
| transfers | `/api/v1/transfers/*` | explicit routes + catch-all → `/api/finance/transfers/*` (confirmed) | none needed |
| payments | `/api/v1/wallet/topup*` | explicit routes (confirmed) | none needed |
| fx (fx/fxCards/fxAccount/fxKyc) | `/api/v1/fx/*` | catch-all → Go `/api/v1/fx` orchestration group (confirmed for quotes/conversions/transfers/collections/beneficiaries/rates/cards) | none needed; unimplemented sub-paths flagged below |
| mobility (core + carhire/movers/parcel/towing/bus/busProvider/logistics/event) | `/api/v1/mobility/*` (busProvider uses same base w/ `/bus/provider/*`) | catch-all → Go `/api/finance/mobility` (confirmed for rides/parcels/towing/car-hire/bus/bus-provider) | none needed |
| mobility (scheduled) | `/api/finance/mobility/scheduled` | blanket rewrite (confirmed, flag-gated) | none needed |
| learn | `/api/v1/learn/*` | **NONE** — no frontend-web dir, no Go route anywhere in backend | flagged only (whole backend module missing, matches docs) |
| academy | `/api/finance/academy` | blanket rewrite (confirmed); redundant v1 catch-all also exists | none needed (already fixed by prior pass) |

## Fixes made (this pass)

**1 file edited, 3 base-path corrections** (all in one module):

`mobile-app/reactnative/src/features/investonboarding/api/onboarding.api.ts`
- `getSuitabilityQuestions()`: `/api/v1/suitability/questions` → `/api/v1/invest/suitability/questions`
- `getSuitability()`: `/api/v1/suitability/result` → `/api/v1/invest/suitability/result`
- `submitSuitability()`: `/api/v1/suitability/submit` → `/api/v1/invest/suitability/submit`
- Header comment corrected to describe the real route mapping.

Root cause: Go registers suitability nested under the `invest` route group
(`backend/internal/invest/routes.go`, `/api/v1/invest/suitability/*`), and frontend-web only has
a catch-all at `/api/v1/invest/[...path]` (no top-level `/api/v1/suitability` handler exists) —
so the old top-level path was a guaranteed 404. Confirmed fix is consistent with `invest.api.ts`,
which already called the correctly-nested path for the same underlying feature. The edited file
was re-parsed with the TypeScript compiler's parser (0 diagnostics) to confirm no syntax breakage;
mock branches were left untouched.

No other genuine 404s were found among base paths in this scope — everything else the prior
swarm passes touched already resolves via either the blanket `/api/finance/:path*` rewrite
(with the specific Go sub-route independently confirmed by grep) or an existing frontend-web
route handler/catch-all.

## Confirmed dead ends — need backend or frontend-web work (out of this agent's reach)

These are genuine gaps but NOT wrong-base-path bugs (no alternate correct path exists to redirect
mobile to), so they were left untouched per the task's fix-only-genuine-404s constraint:

1. **spotlightwealth** — base `/api/v1/spotlight/*`. No frontend-web directory, no Go backend
   module exists at all (confirmed: no `learn`/`wealth`/`spotlight`-education package anywhere in
   `backend/internal/`). Matches `GO_LIVE_CHECKLIST.md`'s note that this module has no backend.
2. **learn** — base `/api/v1/learn/*` (`paths`, `glossary`). No frontend-web directory, no Go
   route anywhere in the backend. Same class of gap as spotlightwealth.
3. **investai** — base `/api/v1/ai/invest/*` (chat, explain-asset). No frontend-web directory,
   no Go route. Whole AI-assist feature is unbuilt.
4. **telemedicine** — base `/api/v1/telemedicine` has only 5 explicit frontend-web handlers
   (appointments list/:id/complete/prescription, doctors). Missing handlers for `specialties`,
   `doctors/:id`, `doctors/:id/availability`, `doctors/:id/reviews`,
   `appointments/:id/summary`, `appointments/:id/confirm`, `appointments/:id/reschedule`,
   `appointments/:id/cancel`, `appointments/:id/review` — these currently 404. This is a
   frontend-web catch-all gap (needs a `[...path]/route.ts` there, mirroring doctor's), not
   fixable by editing the mobile module since no alternate correct base exists.
5. **crypto** — `quote`, `swap`, `deposit-address`, `addresses*`, `withdrawals/*`, `withdraw`
   reach the frontend-web catch-all fine but have no matching Go handler in
   `internal/crypto/routes.go`. Backend gap (matches docs: "swap/withdraw/deposit stay mock").
6. **fx** — `/api/v1/fx/team`, `/approvals*`, `/activity`, `/api-keys*`, `/webhooks` (settings),
   `/notifications*`, `/settings*`, `/limits`, `/customers*` reach the frontend-web catch-all
   (which correctly proxies to `/api/v1/fx/...`) but Go's orchestration group
   (`finance_routes.go` ~line 543) does not register any of these sub-routes. Backend gap
   (business/notifications/settings/KYC verticals of FX not yet implemented server-side).
7. **mobility** — `listMovers()` calls `GET /mobility/movers` (list, no id); Go only registers
   `GET /mobility/movers/:id`. No list endpoint exists. Backend gap, single function.
8. **savings** — `/circles/discover` called by mobile has no matching Go route
   (`internal/savings/handler.go` registers `circles`, `circles/:id`, `circles/:id/join`,
   `circles/:id/contribute`, `targets*` but not `circles/discover`). Backend gap.
9. **referral (merchant)** — intentionally mock-only; Go only exposes merchant management on the
   ADMIN router group (`/api/referral/admin/merchants/*`), no member-role endpoint exists.
   Correctly documented in-file and left as mock; no member path to redirect to.

## Modules confirmed OK (no action needed, prior fixes verified correct)

stocks, invest, investsettings, savings, health, doctor, triage, nutrition, arena, connect,
social, creators, loyalty, events, kycverify, referral (all subfeatures except merchant, which
is correctly mock), crowdfunding, insurance, transfers, payments, fx (core paths), mobility (core
+ carhire/movers/parcel/towing/bus/busProvider/logistics/scheduled), academy.
