# Admin Console ↔ Backend Route ↔ RBAC Three-Way Alignment Audit

Static analysis only. No code changed. Date: 2026-07-09.

Method: for each console, the frontend LIVE branch (USE_MOCK=false path) in
`frontend-admin/src/services/<mod>Service.ts` was matched against the backend route
registration under `backend/internal/**`, the backend-enforced RBAC slug
(`middleware.RequirePermission` / `RequireScopedPermission`), whether that slug is
SEEDED as a permission row AND granted to a role in `supabase/migrations/*.sql`, and
the nav-gate permission in `AdminSidebar.tsx`.

Verdict legend: **OK** · **404-no-route** (live path has no backend route) ·
**RBAC-unseeded** (handler enforces a slug never seeded → 403 for everyone) ·
**nav-mismatch** (sidebar slug ≠ backend slug) · **mock-only** (no live backend at all).

---

## 1. Crypto  (`cryptoAdminService.ts` → `/api/v1/admin/crypto/*`)

Mock flag: `NEXT_PUBLIC_CRYPTO_ADMIN_USE_MOCK` (default **true** → mock).
Page guard: YES — every `app/admin/crypto/*/page.tsx` has a PermissionGuard.
Nav gate: `crypto.admin` (all 7 items). Backend: `backend/internal/crypto/routes.go`.

| Frontend method+path | Backend route | Match | Slug enforced | Seeded+granted | Nav gate | Verdict |
|---|---|---|---|---|---|---|
| GET /orders | GET /admin/crypto/orders | ✅ | crypto.admin | YES (20260815001600_crypto.sql) | crypto.admin | OK |
| GET /assets | GET /admin/crypto/assets | ✅ | crypto.admin | YES | crypto.admin | OK |
| POST /assets | POST /admin/crypto/assets | ✅ | crypto.admin | YES | crypto.admin | OK |
| GET /withdrawals | GET /admin/crypto/withdrawals | ✅ | crypto.admin | YES | crypto.admin | OK |
| POST /withdrawals/:id/decision | POST /admin/crypto/withdrawals/:id/decision | ✅ | crypto.admin | YES | crypto.admin | OK |
| GET /swaps | GET /admin/crypto/swaps | ✅ | crypto.admin | YES | crypto.admin | OK |
| GET /addresses | GET /admin/crypto/addresses | ✅ | crypto.admin | YES | crypto.admin | OK |
| POST /addresses/:id/decision | POST /admin/crypto/addresses/:id/decision | ✅ | crypto.admin | YES | crypto.admin | OK |
| GET /reconciliation | GET /admin/crypto/reconciliation | ✅ | crypto.admin | YES | crypto.admin | OK |

Console note: the service header comment claims the admin withdrawal routes "are NOT yet
wired server-side" — that comment is **stale**. All 6 oversight routes now exist and are
enforced+seeded. **Fully live-ready; only the default mock flag holds it in mock.**

---

## 2. Restaurant  (`restaurantAdminService.ts`)

Mock flag: `NEXT_PUBLIC_RESTAURANT_ADMIN_USE_MOCK` (default **true** → mock).
Page guard: NO page-level PermissionGuard (relies on nav gate only).
Backend: `finance_routes.go` §restaurant admin + `restaurant/handler_admin.go`.

Two different base paths: monitoring reads hit `/api/finance/restaurant`; ops surfaces hit
`/api/restaurant/admin`; disputes reuse `/api/finance/*`.

| Frontend method+path | Backend route | Match | Slug enforced | Seeded+granted | Nav gate | Verdict |
|---|---|---|---|---|---|---|
| GET /restaurant (list) | GET /api/finance/restaurant | ✅ | (member group) | n/a | restaurant.manage | OK (read) |
| GET /restaurant/orders?role= | member role-scoped feed | ~ | member | n/a | restaurant.manage | OK (fan-out) |
| GET adminBase/riders | GET /api/restaurant/admin/riders | ✅ | restaurant.admin.dispatch | YES (20260919000200) | restaurant.admin.dispatch | OK |
| GET adminBase/dispatch/queue | GET …/dispatch/queue | ✅ | restaurant.admin.dispatch | YES | restaurant.admin.dispatch | OK |
| POST adminBase/orders/:id/assign | POST …/orders/:id/assign | ✅ | restaurant.admin.dispatch | YES | restaurant.admin.dispatch | OK |
| POST base/orders/:id/dispatch (redispatch) | member dispatch route | ✅ | member | n/a | restaurant.manage | OK |
| GET adminBase/onboarding | GET …/onboarding | ✅ | restaurant.admin.onboarding | YES | restaurant.admin.onboarding | OK |
| POST adminBase/onboarding/:id/{approve\|reject} | POST …/onboarding/:id/:decision | ✅ | restaurant.admin.onboarding | YES | restaurant.admin.onboarding | OK (wildcard :decision handles approve/reject/decision) |
| GET adminBase/payouts | GET …/payouts | ✅ | restaurant.admin.payouts | YES | restaurant.admin.payouts | OK |
| GET adminBase/payouts/:id/lines | GET …/payouts/:id (run+lines) | ~ | restaurant.admin.payouts | YES | restaurant.admin.payouts | OK (lines returned inside run detail; FE calls `/payouts/:id/lines` — path mismatch, see note) |
| POST adminBase/payouts/:id/process | POST …/payouts/:id/process | ✅ | restaurant.admin.payouts | YES | restaurant.admin.payouts | OK |
| GET financeBase/disputes?module_type=food | GET /api/finance/disputes | ✅ | (finance group) | n/a | restaurant.manage | OK |
| POST financeBase/admin/disputes/:id/resolve | POST /api/finance/admin/disputes/:id/resolve | ✅ | (finance admin) | n/a | restaurant.admin.disputes | OK |

Path mismatch (P2): FE `getPayoutLines()` calls `GET …/payouts/:id/lines` but the backend
only exposes `GET …/payouts/:id` (lines embedded in the run detail). Would 404 on live.

**Nav-gate P1 (nav-mismatch / RBAC-unseeded on nav slug):** several restaurant nav items gate
on **`restaurant.manage`** and **`restaurant.admin.pricing`**, neither of which is seeded in any
migration (comment-only in `20260919000200_restaurant_admin_rbac.sql`). The nav items
("Order Monitoring", "Delivery Fee", and the `.manage`-OR alternatives on Dispatch/Onboarding/
Disputes) therefore render only for wildcard super-admins. The **Delivery Fee** console
(`GET/PUT /api/restaurant/admin/delivery-config`) is enforced on `restaurant.admin.pricing`
(`finance_routes.go:1251-1252`) which is **not seeded** → **RBAC-unseeded P0 for that console**.

---

## 3. Nutrition  (`nutritionAdminService.ts` → `/api/nutrition/admin/*`)

Mock flag: `NEXT_PUBLIC_NUTRITION_ADMIN_USE_MOCK` (default **true** → mock).
Page guard: shared `_ui.tsx`. Backend: `backend/internal/nutrition/routes.go`.

| Frontend method+path | Backend route | Match | Slug enforced | Seeded+granted | Nav gate | Verdict |
|---|---|---|---|---|---|---|
| GET /nutrition/composition | member public read | ✅ | (member) | n/a | nutrition.admin.manage | OK |
| GET /nutrition/library | member public read | ✅ | (member) | n/a | — | OK |
| GET /nutrition/admin/implausible | ❌ no admin implausible route | — | — | — | nutrition.admin.manage | **404-no-route** |
| GET /nutrition/admin/implausible/:id | ❌ | — | — | — | — | **404-no-route** |
| POST /nutrition/admin/composition | POST …/composition | ✅ | nutrition.admin.manage | YES (20260919000300) | — | OK |
| POST /nutrition/admin/library | POST …/library | ✅ | nutrition.admin.manage | YES | — | OK |
| POST /nutrition/admin/reresolve | POST …/reresolve | ✅ | nutrition.admin.resolve | YES | — | OK |
| POST /nutrition/admin/resolve | POST …/resolve | ✅ | nutrition.admin.resolve | YES | — | OK |
| GET /nutrition/admin/consults | GET …/consults | ✅ | nutrition.admin.manage | YES | nutrition.admin.resolve | OK (nav gate slug differs from backend read slug — see note) |
| POST /nutrition/admin/consults/:id/resolve | POST …/consults/:id/resolve | ✅ | nutrition.admin.resolve | YES | nutrition.admin.resolve | OK |
| GET /nutrition/admin/payouts | GET …/payouts | ✅ | nutrition.admin.manage | YES | nutrition.admin.resolve | OK (read explicit-empty; no settlement entity) |
| GET/POST /nutrition/admin/payouts/:id, /:id/reconcile | ❌ no per-run / reconcile route | — | — | — | nutrition.admin.resolve | **404-no-route** |

Notes: the "Implausible review queue" (`/admin/implausible*`) — the primary NRE admin surface
in the console — has **no backend route**; only composition/library/reresolve/resolve exist.
Payout per-run detail and reconcile are also unrouted (payouts list returns an explicit empty
shape). Nav gates Consults/Payouts on `nutrition.admin.resolve` while the backend list reads
enforce `nutrition.admin.manage` — a viewer with only `.resolve` sees the nav item but the list
GET would 403 (P1 nav/permission skew, both slugs seeded so low severity).

---

## 4. Vendors  (`vendorsAdminService.ts` → `/api/finance/estate/:id/vendors*`)

Mock flag: `NEXT_PUBLIC_VENDORS_ADMIN_USE_MOCK` (default **true** → mock).
Page guard: shared `_ui.tsx`. Nav gate: `estate.manage` / `estate.admin`.
Backend: `finance_routes.go:1046-1048` (estate member group; **no per-route RBAC** — the estate
service self-gates on `estate_residents.role='estate_admin'` membership, not RBAC slug).

| Frontend method+path | Backend route | Match | Slug enforced | Seeded+granted | Nav gate | Verdict |
|---|---|---|---|---|---|---|
| GET /estate/:id/vendors?status= | GET /estate/:id/vendors | ✅ | none (membership self-gate) | n/a | estate.manage / estate.admin | OK* |
| GET /estate/:id/vendors?status=pending (applications) | same route | ✅ | none | n/a | estate.manage | OK* |
| POST /estate/:id/vendors/:vendorId/verify {status} | POST /estate/:id/vendors/:vendorId/verify | ✅ | none (membership self-gate) | n/a | estate.manage | OK* |
| GET /estate/:id/vendor/jobs?status= (payouts) | ❓ verify `vendor/jobs` read exists | ~ | none | n/a | estate.manage / estate.admin | verify-route |

*OK\* caveat: these routes authorize by **estate-membership** (caller must be an
`estate_admin` resident of that estate), NOT by the `estate.manage`/`estate.admin` RBAC slug the
nav gate implies. A platform operator who holds `estate.manage` but is not a resident of the
target estate will be rejected ("not a member of this estate"). The service itself flags this:
live mode **throws unless an `estateId` is supplied** (no cross-estate aggregate exists). So the
Vendor Directory / Onboarding / Payouts consoles are effectively **single-estate + membership-
scoped**, not the platform-wide oversight the nav suggests. Not a 403-for-everyone, but a
model mismatch worth noting. `GET /estate/:id/vendor/jobs` should be confirmed to exist.

---

## 5. Estate + Platform Oversight  (`estateAdminService.ts`)

Mock flag: `NEXT_PUBLIC_ESTATE_ADMIN_USE_MOCK` (default **true** → mock).
Two surfaces: (a) per-estate admin `/api/finance/estate/:id/admin/*` (membership self-gated),
(b) platform oversight `/api/finance/estate-admin/*` (`estate_admin_routes.go`, real RBAC).

### (a) Per-estate admin (membership self-gated, no RBAC slug)
| Frontend | Backend | Match | Verdict |
|---|---|---|---|
| GET /estate/:id/admin/dashboard | exists | ✅ | OK (membership) |
| GET /estate/:id/admin/dashboard/activity | verify | ~ | verify-route |
| GET /estate/:id/admin/residents | exists | ✅ | OK |
| POST /estate/:id/admin/residents/:id/ban, /restore | verify | ~ | verify-route |
| GET /estate/:id/dues/invoices, /gates, /guard/shifts, /guard/incidents, /vendors | exist | ✅ | OK |
| POST /estate/:id/vendors/:id/verify | exists | ✅ | OK |
| GET /property/rent-passport/lookup/:userId | exists (property.manage) | ✅ | OK |
| GET /property/context | exists | ✅ | OK |

### (b) Platform oversight `/api/finance/estate-admin/*` — all read-only, real RBAC
| Frontend method+path | Backend route | Match | Slug enforced | Seeded+granted | Nav gate | Verdict |
|---|---|---|---|---|---|---|
| GET /estate-admin/security/incidents | ✅ | ✅ | estate.admin.security | YES (20260919000000) | estate.admin.security | OK |
| GET /estate-admin/security/guard-shifts | ✅ | ✅ | estate.admin.security | YES | estate.admin.security | OK |
| GET /estate-admin/security/visitor-logs | ✅ | ✅ | estate.admin.security | YES | estate.admin.security | OK |
| GET /estate-admin/security/emergencies | ✅ | ✅ | estate.admin.security | YES | estate.admin.security | OK |
| GET /estate-admin/dues/reconciliation | ✅ | ✅ | estate.admin.dues | YES | estate.admin.dues | OK |
| GET /estate-admin/dues/payments | ✅ | ✅ | estate.admin.dues | YES | estate.admin.dues | OK |
| GET /estate-admin/dues/restrictions | ✅ | ✅ | estate.admin.dues | YES | estate.admin.dues | OK |
| GET /estate-admin/ops/{repairs,tasks,meetings,facilities} | ✅ | ✅ | estate.admin.ops | YES | estate.admin.ops | OK |
| GET /estate-admin/content/{announcements,documents} | ✅ | ✅ | estate.admin.content | YES | estate.admin.content | OK |
| GET /estate-admin/elections, /:id/results, /:id/audit | ✅ | ✅ | estate.admin.election | YES | estate.admin.election | OK |

**Estate platform oversight (b) is the cleanest new console — full three-way alignment, all 5
`estate.admin.*` slugs seeded + granted to super-admin, system-admin, and the estate-admin role.**

---

## 6. Academy / Fees (school-admin)  (`academyFeesService.ts` → `/api/academy/admin/*`)

Mock flag: `NEXT_PUBLIC_ACADEMY_USE_MOCK` (default **true** → mock).
Page guard: YES — each `academy/fees/*/page.tsx` guarded. Backend: `academy_routes.go` +
`academy/fees/*/handler.go`. **This is the worst offender for 404-no-route.**

| Frontend method+path | Backend route | Match | Slug enforced | Seeded | Nav gate | Verdict |
|---|---|---|---|---|---|---|
| GET /admin/schools/admin | GET /api/academy/admin/schools/admin | ✅ | academy.fees.school.verify | YES | academy.fees.setup | OK (nav slug ≠ backend slug — P1) |
| POST /admin/fees/schools | ❌ (member-only POST /api/finance/academy/schools) | — | — | — | academy.fees.setup | **404-no-route** |
| GET/POST /admin/fees/sessions | ❌ member-only /schools/:id/sessions | — | — | — | academy.fees.setup | **404-no-route** |
| GET/POST /admin/fees/classes | ❌ member-only | — | — | — | academy.fees.setup | **404-no-route** |
| GET/POST /admin/fees/schedules | ❌ member-only | — | — | — | academy.fees.setup | **404-no-route** |
| POST /admin/fees/schedules/:id/issue | ❌ (member has /fee-schedules/:id/lock) | — | — | — | academy.fees.setup | **404-no-route** |
| GET /admin/fees/onboarding/batches | ❌ no route anywhere | — | — | — | academy.fees.onboarding | **404-no-route** |
| POST /admin/fees/onboarding/batches/:id/decision | ❌ | — | — | — | academy.fees.onboarding | **404-no-route** |
| GET /admin/fees/collections/overview | ❌ no aggregate | — | — | — | academy.fees.collections | **404-no-route** |
| GET /admin/fees/invoices | ❌ member per-student only | — | — | — | academy.fees.collections | **404-no-route** |
| GET /admin/hardship/admin | GET …/hardship/admin | ✅ | academy.fees.hardship.review | YES | academy.fees.hardship.review | OK |
| POST /admin/hardship/admin/:id/approve | ✅ | ✅ | academy.fees.hardship.review | YES | academy.fees.hardship.review | OK |
| POST /admin/hardship/admin/:id/deny | ✅ | ✅ | academy.fees.hardship.review | YES | academy.fees.hardship.review | OK |
| GET /admin/fees/promotions | ❌ member-only /schools/:id/promotions | — | — | — | academy.fees.promotion.approve | **404-no-route** |
| POST /admin/fees/promotions/:id/approve | ❌ | — | — | — | academy.fees.promotion.approve | **404-no-route** |
| POST /admin/fees/promotions/:id/apply | ❌ | — | — | — | academy.fees.promotion.approve | **404-no-route** |
| POST /admin/competitions/:id/register | POST …/competitions/:id/register | ✅ | academy.fees.competition.register | YES | academy.fees.competition.manage | OK (nav uses .manage, route uses .register — P1) |
| GET /admin/fees/competitions | ❌ no list route | — | — | — | academy.fees.competition.manage | **404-no-route** |
| GET /admin/fees/competitions/registrations | ❌ | — | — | — | academy.fees.competition.manage | **404-no-route** |
| GET /admin/export/compliance/:schoolId | ✅ | ✅ | academy.fees.export.run | YES | academy.fees.export.run | OK |
| POST /admin/export/compliance | ✅ | ✅ | academy.fees.export.run | YES | academy.fees.export.run | OK |
| GET /admin/fees/gov-export/opt-ins, PATCH, /log | ❌ no opt-in routes | — | — | — | academy.fees.export.run | **404-no-route** |
| GET/POST /admin/schools/:schoolId/staff | ✅ | ✅ | academy.fees.roles.assign (RequireScopedPermission, scope=school) | YES | academy.fees.roles.assign | OK |
| POST /admin/fees/roles/:id/revoke | ❌ (backend is DELETE /schools/:id/staff) | — | — | — | academy.fees.roles.assign | **404-no-route** |

Count of live paths with NO backend route in this console: **~19**. Only hardship (3), export
compliance (2), competition register (1), schools staff (3), schools/admin list+verify (1) are
real. Everything under the flat `/admin/fees/*` namespace is member-only under a different
(per-school, non-`/fees`) path. The service already annotates each with `TODO(no backend route)`.

Nav-slug mismatches (P1, both slugs seeded so cosmetic): Setup Wizard nav = `academy.fees.setup`
but backend school list = `academy.fees.school.verify`; Competitions nav = `.competition.manage`
but the register route = `.competition.register`.

---

## 7. Platform / EdTech (super-admin)  (`platformEdtechAdminService.ts`)

Mock flag: `NEXT_PUBLIC_EDTECH_PLATFORM_USE_MOCK` (default **true** → mock).
Page guard: YES — `<PlatformGuard>` on every page + `_ui.tsx`. Nav gate: `platform_edtech_admin`
(seeded + granted). Backend target: `/api/academy/admin/platform/*`.

**Backend verdict: the entire `/api/academy/admin/platform/*` route group DOES NOT EXIST.** Grep
across `backend/` for `admin/platform`, `verification-queue`, `gov-sync`, `compliance-posture`,
`scholarship-pledges`, `support-tickets` returns zero files. `platform_edtech_admin` is
referenced only in comments + as a super-admin RBAC *bypass* in `fees/roles/service.go` — never
as a `RequirePermission` on any registered route.

| Frontend (SU-01..SU-12) | Backend route | Verdict |
|---|---|---|
| GET /schools, /verification-queue, POST /verification-queue/:id/review | ❌ | **mock-only** |
| GET /collections, /risk, POST /risk/:id/action | ❌ | **mock-only** |
| GET /gov-sync, /compliance-exports, /audit-log | ❌ | **mock-only** |
| GET /competitions, POST /competitions/:id/transition | ❌ | **mock-only** |
| GET /trust-scores, POST /trust-scores/:id/override | ❌ | **mock-only** |
| GET /scholarship-pledges, /support-tickets, POST /support-tickets/:id/action | ❌ | **mock-only** |
| GET /flags, POST /flags/toggle | ❌ | **mock-only** |
| GET /compliance-posture | ❌ | **mock-only** |

**All 12 SU-* screens are mock-only with zero backend.** RBAC scope separation is correctly
designed on the frontend (single `platform_edtech_admin` gate, page + nav), and the slug is
seeded+granted, but there is nothing to authorize because no route is registered. Flipping the
mock flag would 404 every screen.

---

## Mature-console regression spot-check

| Module | Verdict | Detail |
|---|---|---|
| connect | nav-mismatch (P2 cosmetic) | Backend-enforced connect.* slugs (config/cases/audit/moderation/verification/creator/business/plans/payments/gamification/live/discovery/boost) all seeded+granted. But ~9 sidebar slugs — `connect.finance.view`, `connect.identity.review`, `connect.voting.view`, `connect.rbac.view`, `connect.catalog.view`, `connect.comms.view`, `connect.analytics.view`, `connect.support.view`, `connect.users.view` — have NO backend route and NO seed. Dead nav gates (show only for wildcard super-admins). No security impact. |
| **finance** | **RBAC-unseeded (P0)** | Transfers admin console enforces **`finance.admin.transfers`** (`finance_routes.go:275-279`); KYC-verify admin console enforces **`finance.admin.kyc`** (`finance_routes.go:760-766`, `finance/kycverify/handler.go`). **Neither slug is seeded in ANY migration** (grep `finance.admin` in `supabase/` = 0). Every non-wildcard admin gets **403 on the whole Transfers + KYC-verify console**. Nav hides the skew by gating those items on `audit.logs.view` (seeded), so the menu shows but the API call 403s. |
| mobility | OK | `mobility.view` seeded (20260621090000) + granted; `transport.admin.scheduled.read` seeded (20260906000001). Nav matches. |
| referral | OK | Spot-checked `referral.gam.view`, `referral.amb.view`, `referral.merchant.view`, etc. — backend uses the same short forms as nav; all seeded (20260707000000/…001). referral-rewards `referral.admin.*` (7) seeded 20260910000000. |
| fx | OK-but-open | FX routes carry **no RequirePermission at all** (member `mapsAuth()`+`requireUserID()` only). Nav is also ungated → consistent. `fx.*` correctly absent from migrations. Separate hardening note: the FX **business-admin** console (approvals, API keys, webhooks) is reachable by any authenticated user, gated only by `business_id` scoping. Not an RBAC-alignment bug. |
| health | OK | pharmacy/lab/vet enforced slugs match nav and are seeded (20260815000200 / …300 / …400, 20260827000000). |

---

## Aggregate — RBAC health

### P0 — enforced-but-unseeded slug (403 for every non-wildcard admin)
1. **`finance.admin.transfers`** — enforced on the Transfers admin console (`finance_routes.go:275-279`); **not seeded** in any migration. Transfers console 403s for everyone but super-admin.
2. **`finance.admin.kyc`** — enforced on the KYC-verify admin console (`finance_routes.go:760-766`); **not seeded**. KYC-verify console 403s for everyone but super-admin.
3. **`restaurant.admin.pricing`** — enforced on the Delivery-Fee console (`finance_routes.go:1251-1252`); **not seeded** (comment-only in `20260919000200_restaurant_admin_rbac.sql`). Delivery-Fee console 403s for everyone but super-admin.

Fix for all three: add an additive permissions-seed migration inserting these slugs and granting to the appropriate finance/compliance/restaurant-ops roles.

### P1 — nav slug ≠ backend-enforced slug (both slugs seeded; cosmetic but confusing)
- restaurant nav gates use unseeded `restaurant.manage` on several items → items only visible to super-admin (overlaps P0 for pricing).
- academy fees: Setup Wizard nav `academy.fees.setup` vs backend `academy.fees.school.verify`; Competitions nav `academy.fees.competition.manage` vs register route `academy.fees.competition.register`.
- nutrition: Consults/Payouts nav `nutrition.admin.resolve` vs backend list read `nutrition.admin.manage`.

### P1 — frontend live path with NO backend route (would 404 when USE_MOCK=false)
Count of no-backend-route live calls per console:
- **academy/fees: ~19** (all `/admin/fees/*` flat namespace: schools create, sessions, classes, schedules, schedules/:id/issue, onboarding batches + decision, collections/overview, invoices, promotions + approve + apply, competitions list + registrations, gov-export opt-ins + log, roles list + revoke).
- **platform/edtech: 20** (entire SU-01..SU-12 surface — mock-only, no route group at all).
- **nutrition: 4** (implausible list, implausible/:id, payouts/:id, payouts/:id/reconcile).
- **restaurant: 1** (`payouts/:id/lines` — lines are embedded in `payouts/:id` instead).
- **crypto: 0**, **estate oversight: 0**, **vendors: 0** (but membership-scoped, not RBAC-scoped).

### Mock-only vs live-ready (default mock flag state)
Every new console defaults to **mock** (`NEXT_PUBLIC_*_USE_MOCK` unset ⇒ true). Readiness if the flag were flipped to false:
- **Live-ready (backend + RBAC fully aligned):** Crypto (all 9 routes), Estate platform-oversight (all read routes).
- **Partially live (some routes 404):** Restaurant (ops routes live; payouts/:id/lines + pricing-console-seed gaps), Nutrition (composition/library/resolve/consults live; implausible + payout-detail 404), Vendors (live but single-estate + membership-scoped, not platform-wide), Academy/Fees (only hardship/export/roles/competition-register/schools-verify live; ~19 paths 404).
- **Mock-only (no backend at all):** Platform/EdTech super-admin (all 12 SU screens).

### Page-level guard coverage (new consoles)
- Crypto: YES (per-page PermissionGuard). Platform/EdTech: YES (`<PlatformGuard>` per page). Academy/Fees: YES (per-page guard).
- Nutrition, Vendors, Restaurant: shared `_ui.tsx` (no explicit per-page PermissionGuard for restaurant — relies on nav gate + backend enforcement). Estate: relies on nav + backend.
