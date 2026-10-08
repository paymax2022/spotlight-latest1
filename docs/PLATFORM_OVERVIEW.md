# Spotlight Platform Overview

**Read this first.** This is the single authoritative document explaining what the whole
Spotlight platform is, how it is built, and exactly how ready each of its 21 modules is for
production. It is derived directly from the repo's own source-of-truth documents — `CLAUDE.md`,
`PAYMAX_BUILD_PLAYBOOK.md`, `docs/architecture/audit.md`, `SPOTLIGHT_UAT_BUG_TRACKER.md`,
`contracts/openapi.yaml`, and a light read of the actual code layout — as of **2026-09-17**.

Every status claim below traces to one of those sources. Where a source is uncertain, disclosed
a gap, or a claim is "the code exists but was never live-verified," this document says so
explicitly rather than rounding up. In this codebase's own history, "the code looks complete"
has repeatedly turned out not to mean "it works" — see the Go-Live Status Summary for details.

---

## 1. What Spotlight Is

Spotlight started as a live contest/voting platform — paid and free voting, image moderation,
a contestant/registration pipeline, and a leaderboard/results engine — and is being transformed,
module by module, into a **fintech super app**. On top of the existing voting product, the
platform now (or will) carry a wallet with virtual accounts, KYC/tiers, peer transfers, FX,
referrals, RBAC-gated admin tooling, and an expanding set of vertical marketplaces: estate/property
management, crowdfunding, restaurant delivery, telemedicine/pharmacy/lab/veterinary care, transport,
events ticketing, insurance, a general marketplace, and a social "Connect" product. The build is
organized as a fixed queue of **21 modules**, each taken through discovery, defect remediation, and
a go-live sign-off (`SPOTLIGHT_UAT_BUG_TRACKER.md`).

The platform is being built **on top of, not instead of**, the existing brownfield Spotlight
codebase. The contest/voting/applicant/legacy-auth code that predates this transformation is never
modified directly — new functionality wraps it via adapters (the "vote bridge" pattern), and a
`PreToolUse` hook enforces this at the tooling level so an AI agent cannot accidentally edit a
protected legacy file.

The core philosophy that runs through every module, especially anything that touches money, is:
**the ledger is the source of truth, not any cached balance column; every migration is additive,
never destructive; and every money mutation requires an idempotency key, a balanced double-entry
posting, an audit event, and a fail-closed tier-limit check.** These are treated as "iron rules" —
CLAUDE.md states them as rules that must never be violated, "no exceptions" — and the UAT tracker's
own defect history shows why: several of the platform's most serious bugs found during go-live
testing were exactly a violation of one of these rules (a status column flipping while no money
moved, a balance updated directly instead of via the ledger, a payout that could double-fire because
two independent code paths both believed they owned settlement).

## 2. Architecture At a Glance

### Stack

| Layer | Technology | Notes |
|---|---|---|
| Frontend web | Next.js 14.2, TypeScript, Tailwind CSS, Supabase SSR | `frontend-web/`; served on cPanel Passenger (Node 20, `frontend-web/server.js` entrypoint) |
| Admin dashboard | Next.js 15.1 | `frontend-admin/`, port 3001, console at `/admin`. No Refine. |
| Backend API | Go 1.23, **Gin v1.10** | `backend/`, module `spotlight/backend`. Not Chi — see conflict note below. |
| Mobile (primary) | React Native / Expo | `mobile-app/reactnative/` |
| Mobile (secondary) | Vue 3 / Quasar | `mobile-app/vue-quasar/` — several modules (e.g. Association, Property/Realtor/Stays) exist only on the RN app, not Vue; this asymmetry recurs across modules and is treated as a per-module product decision, not automatically a defect |
| Separate trading service | Go (`paymax/crypto-backend`) | `mobile-app/reactnative/backend/` — a standalone module with its own Postgres via golang-migrate, housing crypto + stocks + invest trading. Distinct from `backend/internal/crypto`, the ledger-integrated crypto in the main backend module. |
| Database | PostgreSQL 17 via Supabase (cloud-hosted) | No ORM — raw Supabase JS client + SQL RPCs. ~291 additive-only migrations in `supabase/migrations/`. Local DB port 54322. |
| Auth | Supabase Auth (managed JWT/HS256) | See request-flow section below for how it's enforced differently per surface |
| Storage | Cloudflare R2 (`@aws-sdk/client-s3` presigned URLs) | Bucket `spotlight-openmic-songs`, set via `R2_BUCKET` env var — **no default**. The old bucket name `spotlight-open-mic` does not exist in the account; several modules (marketplace `account.api.ts`, mobility, featured-placement fixtures, registration uploads) still pass it literally and are flagged in CLAUDE.md as "unverified and likely broken the same way" |
| Email | Resend API (`RESEND_API_KEY`) | No queue — fire-and-forget; failures are silent |
| Payments | Paystack | HMAC-SHA512 webhook verification; live handler at `frontend-web/app/api/webhooks/paystack/route.ts` |
| FX | Maplerad | Live for some rails (see Module 10 note) |
| Cache / locks / queue | Redis (`backend/internal/platform/redis/`) | Idempotency cache, Redlock (distributed locking), asynq job queue |
| DB access, money-path | pgx pool (`backend/internal/platform/db/`) | Direct transactional Postgres access, used specifically for finance writes |
| DB access, Spotlight modules | Supabase REST + SQL RPCs | Read-heavy / legacy-adjacent modules |

### Directory layout

There is **no Turborepo, no `apps/` directory, no `packages/` directory** — an earlier layout
description in project history was aspirational and CLAUDE.md explicitly corrects it. The actual
layout is flat: `frontend-web/`, `frontend-admin/`, `backend/`, `mobile-app/`, `supabase/`, `docs/`,
plus root-level tracking documents (`PAYMAX_BUILD_PLAYBOOK.md`, `SPOTLIGHT_UAT_BUG_TRACKER.md`,
`contracts/openapi.yaml`). Inside `backend/internal/` alone there are ~65 packages spanning
finance primitives, platform primitives, and one directory per vertical (see the module reference
below for the full map, including several verticals — `insurance`, `marketplace`, `connect`, the
`health/*` sub-packages, `spotlightwealth`, `arena`, `business` — that don't map 1:1 onto a UAT
queue name by their code-directory alone).

### The dual-path request-flow pattern

This is the single most important architectural fact to internalize before reading any module
section, because it recurs everywhere instead of being explained per-module: **a request from the
mobile app or the web app can reach the backend in one of two structurally different ways**, and
which one it takes depends on whether the underlying operation is a "money-path" write or not.

1. **Money-path / newer-module writes go through the Go backend.** The mobile or web client calls
   a Next.js API route (or the Go backend directly), which is backed by `RequireAuthContext` +
   RBAC permission middleware in Go, uses the `pgx` pool for direct transactional Postgres access,
   and posts through the shared ledger primitives in `backend/internal/finance/`. This is the path
   the "iron rules" apply to: idempotency key required, balanced double-entry ledger postings,
   audit event, fail-closed tier check.
2. **Read-heavy / legacy Spotlight-module traffic goes straight to Supabase.** The client (or a
   thin Next.js API route) calls the Supabase REST API or a SQL RPC directly, using either the
   HTTP-only cookie session set by Next.js middleware (`frontend-web/src/middleware.ts`) or a
   Bearer token validated via a service-role client in route handlers
   (`frontend-web/src/lib/auth/request.ts`). This path is faster to build against but does **not**
   go through the Go RBAC/ledger stack — which is precisely why several UAT-found defects (e.g.
   the Property Management module's `realtor_pay_invoice` RPC, PROPMGMT-001) turned out to be a
   Supabase RPC that could fabricate a "paid" state with **zero** money actually moving: nothing on
   that path required going through `debitWallet()` or posting a ledger entry at all, until it was
   explicitly hardened to require one.

Migration status per module is genuinely mixed: some modules (Wallet, Telemedicine, Restaurant,
Film Academy's tuition path) are fully Go-native for their money-moving writes; others still have
Supabase-direct writes for parts of their surface (documented per-module below where known); and a
few, like Property Management, turned out to have a Supabase-direct RPC nobody had audited for the
"does this actually require verified money movement" rule until a UAT pass found it.

The **admin console** has its own version of this duality: many admin modules ship with a
`resolveUseMock()` convention (`src/config/useMock.ts` per app, surfaced in the UI via a
`FixtureBanner` component) that defaults to **mock data in local dev** for developer convenience but
is required to default to **live data in production** unless explicitly opted into mock. This
convention is used identically across roughly 19 admin modules. It has been both the cause and the
red herring of several UAT findings: a whole module's admin console (Crowdfunding) had genuinely
never been exercised against its live backend before a UAT session explicitly flipped the flag off
— and, in the opposite direction, several "the admin console shows fake data" reports during other
modules' UAT passes turned out to be this same intentional, documented convention working as
designed, not a bug.

## 3. Money & Ledger Conventions

These are CLAUDE.md's "iron rules," restated for a reader unfamiliar with this codebase's specific
conventions. They are not aspirational — they are enforced by code review discipline, and the UAT
tracker's bug log is largely a record of what happens when a code path was found to violate one of
them.

- **Integers in kobo, never floats.** All monetary amounts anywhere in the system are integers in
  minor units (1 Naira = 100 kobo). No monetary value is ever a float, and no monetary math is ever
  done on a string.
- **Every money mutation is a four-part contract**, all four required, none optional:
  1. **Idempotency-Key** — the caller must supply one; replaying the same key must be safe and
     return the original result, not double-post. Several real bugs were exactly a violation of
     this (e.g. CF-003: a contribution idempotency replay hit a raw SQL 500 instead of returning
     the original result).
  2. **Balanced double-entry ledger postings** — every money movement is a matched debit/credit
     pair in `ledger_entries`, never a single-sided write.
  3. **An audit event** — every money-moving admin or user action leaves an auditable trail.
  4. **A fail-closed tier-limit check** — a per-tier daily/transaction limit check that refuses the
     operation on any ambiguity, never allows it "just in case."
- **Wallet balances are projections of the ledger, never a source of truth on their own.** No code
  path is permitted to `UPDATE` a balance column directly; the balance is always computed (or
  materialized as a view) from the ledger entries that back it. `WAL-013` is a concrete example of
  what goes wrong when a *reporting* aggregate quietly drifts from this rule (it summed only a
  capped 50-row window instead of the true unbounded total, silently understating figures as the
  platform grows).
- **Ledger entries are immutable.** There is no "edit a past entry." A correction is always a new,
  separate **reversing entry** — this is what makes the ledger auditable and what several of the
  UAT bug fixes (REF-011's clawback, PROPMGMT-001's fix) explicitly modeled their corrections on.
- **Migrations are additive-only.** No `DROP`, no column renames, no type narrowing — ever. This is
  enforced structurally (a migration that violates it is a defect, not a style choice) because the
  same `supabase/migrations/` history has to replay cleanly from empty on every fresh environment
  and CI run.
- **Migration version collisions are a live, recurring hazard, not a hypothetical one.**
  `schema_migrations` is keyed on the leading timestamp alone, so two migration files sharing a
  version abort `supabase start`/`db reset` partway through the chain. A version that's free when
  you write your migration can be silently claimed by a different PR that merges first — the break
  only shows up on the base branch *after* your own merge — so CLAUDE.md requires re-checking for
  collisions immediately before merging, not just when authoring, and CI enforces it via
  `scripts/ci/check-migration-versions.sh` in the `hygiene` lane.
- **The golden-path regression suite (`frontend-web`, `npm run test:regression`, 9 specs / 120
  tests) must be green before and after every change**, no exceptions — this is the platform's
  tripwire for "did this change break basic voting/registration flows that predate the fintech
  work."

## 4. Module-by-Module Reference

Each entry below states current status **exactly as recorded in the UAT tracker's own wording**
(as of 2026-09-17), a short technical "how it works," and, for signed-off modules, the most
notable defects the go-live pass found and fixed. For modules not yet started in the UAT queue,
this section gives an honest "what exists in code, unverified" summary from a light directory/grep
pass rather than presenting them as further along than they are.

### 1. Authentication — ✅ Complete & Signed Off (2026-09-15, 19 closed / 2 accepted exceptions)

**What it does:** registration, email/phone login, account lockout, login rate limiting, OTP email
verification and OTP MFA step-up, session management (list/revoke-one/revoke-all), code-based
password reset, RBAC authorization boundaries, and the admin console's own authentication gate.

**How it works:** Supabase Auth issues the JWT; the Go backend's `RequireAuthContext` + RBAC
permission middleware is the authoritative check for backend routes, while `frontend-web`'s
middleware handles the cookie session and `frontend-admin` has its own separate console-level gate
(`ADMIN_MIDDLEWARE_ENFORCE`, `RequireAdminConsoleRole`).

**Notable defects fixed:** **AUTH-016** (Blocker) — the actual production login page bypassed every
backend security control by calling Supabase directly instead of the Go backend, found only by
driving the real browser UI rather than testing the API in isolation; **AUTH-003** — an admin
overview endpoint returned full operational/financial data to a completely anonymous, unauthenticated
request; **AUTH-001/002** — the admin console's server-side auth gate and JWT-signature verification
both defaulted to fail-open; **AUTH-021** — an admin "Lock User" action had zero actual effect on
login. **Accepted exceptions (2, open):** AUTH-007 (Brevo's dynamic-IP allowlist blocks OTP email
from this dev network — a third-party config issue; recommend verifying the production egress IP is
allowlisted before go-live) and AUTH-013 (a narrow, currently-unexploitable admin-role-scope gap).

### 2. Utility Bills — ✅ Complete & Signed Off (5 closed, full Go migration)

**What it does:** utility bill payment (airtime/data/electricity/cable-type flows) fully migrated
to the Go financial core.

**How it works:** per the UAT queue table this module completed a full Go migration with 5 defects
closed; detailed bug-by-bug narrative is in the Bug Log (`UTIL-001..006`) rather than a dedicated
sign-off summary paragraph, but the queue table records it as fully signed off.

### 3. Film Academy — ✅ Complete & Signed Off (2026-09-15, 3 closed, zero open exceptions)

**What it does:** tuition installment payment (application fee + installment confirmation — the
module's only money-mutating flow), applicant admissions (browse/apply/duplicate/capacity
validation/status polling), curriculum/learning access gating, assignment submission and grading,
and the full admin console (Batches, Applications, Tuition, Curriculum, Progress, Submissions,
Settings).

**How it works:** tuition payment is Go-native, verified via Paystack + ledger journal postings
(not wallet-debit — an earlier draft that used wallet debit was caught as the wrong payment rail
for production, which pays by Paystack card, and corrected before merging). Admin plan-listing,
reminder-email routes, and the Tuition tab's read path deliberately remain on direct Supabase reads
since they are not money-mutating.

**Notable defects fixed:** **FILM-001** (Blocker) — zero Go backend existed for tuition payment
at all; **FILM-002** (Major) — batch capacity (`max_students`) was never enforced on the apply
route, and the DB's own `enrolled_count` column was found to be an unreliable capacity signal (a
trigger inflates it on every application regardless of status, never decrements on rejection) —
fixed with an independent live seat count instead; **FILM-003** (Major) — no email/SMS fired on
application approval or rejection.

### 4. Contest — ✅ Complete & Signed Off (2026-09-16, 16 closed / 0 open, 2 accepted exceptions + 1 business-stakeholder item)

**What it does:** paid/free voting integrity, the admin voting console (packages, templates,
visibility, prizes, results, approvals), the image-moderation/background-removal/template-compositing
pipeline, maker-checker for vote reversal/adjustment/results-publish, consent/rights gating, and the
end-to-end organizer contest-builder flow.

**How it works:** three separate voting engines coexist in production (legacy, a "universal TS"
engine, and a newer Go/Connect engine) — a recurring source of subtlety, since a fix in one engine
does not automatically apply to the others. Money-path fixes were live-tested against real
Postgres with direct SQL verification.

**Notable defects fixed:** **PV-005** (paid-vote double-credit — a PostgREST per-call-transaction
pitfall that made an earlier "fix" never actually serialize); **D-002/D-010** (free-vote race
conditions on two separate engines, each needing a different locking primitive); **SEC-007/D-009**
(upload Content-Type spoofing → stored-XSS risk); **D-008** (an SSE endpoint leaking live vote
counts with zero visibility gating). **Accepted exceptions:** offline/physical (USSD/SMS) vote
reconciliation is explicitly out of scope for this phase by the product's own decision; the final
pixel-compositing step of the image pipeline could not be exercised in this environment (no real
Cloudinary account). **Business-stakeholder item:** TS-15, a business-owner UAT sign-off gate this
engagement cannot self-certify.

### 5. Crowdfunding — ✅ Complete & Signed Off (2026-09-16, 8 closed / 0 open, 1 business-stakeholder item)

**What it does:** campaign creation, contribution, release/refund, creator withdrawal, admin
Fraud & Risk / Compliance / Support tooling, a CSR corporate-matching sub-module, and a ~90-screen
React Native mobile build-out (no Vue/Quasar equivalent).

**How it works:** ~88 endpoints; contributions instant-settle on arrival rather than sitting in an
intermediate held state, which is why several defects here were specifically about response
envelopes lying about outcomes rather than money actually moving wrong.

**Notable defects fixed:** **CF-001** (withdrawal-available balance overstated by the platform fee);
**CF-002/CF-004** (`RefundAll`/`Release` both reported bare `{"ok":true}` regardless of what
actually happened); **CF-003** (an idempotency-key replay — the exact scenario the key exists
for — hit a raw SQL 500); **CF-007** (the admin console's "Freeze funds" action 404'd on every
alert, only found because this engagement tested with `NEXT_PUBLIC_CF_USE_MOCK` explicitly turned
off — nobody had done that before); **CF-008** (a mobile "Message contributors" screen called a
broadcast endpoint that didn't exist anywhere, un-flagged — the real endpoint was built from
scratch, including OpenAPI contract). **Disclosed, not fixed:** `cf_refunds`/`cf_settlements`/
`cf_fraud_alerts`/`cf_disputes` are seed/demo-only with zero real writer; `cf_refund_requests`
never surfaces to any admin queue. **Business-stakeholder item (CF-DECISION-001):** self-service
instant withdrawal has no maker-checker — a deliberate prior design decision, not a regression, but
flagged for an explicit accept/reject call before go-live.

### 6. Insurance — ⬜ Not Started (UAT); substantial code exists, unverified

The UAT queue lists this module as **Not Started** — no discovery pass, no defects logged, no
sign-off. A light code check shows real infrastructure exists: `backend/internal/insurance/`
contains `catalog`, `claims`, `consent`, `embedded`, `gateway`, `policy`, `reconciliation`, and
`webhooks` sub-packages, and `frontend-admin/app/admin/insurance/` has a console surface. Per
project memory this integrates with the MyCover.ai insurance API (a single `/products/buy` endpoint
covering ~69 products), with binds proven working as of 2026-08-31 — but webhook delivery from the
provider has reportedly never been observed inbound in this environment. None of this has been put
through the UAT engagement's live-HTTP/DB-executed verification discipline; treat "code exists" as
exactly that and nothing more until this module reaches the queue.

### 7. Wallet — ✅ Complete & Signed Off (2026-09-16, 15 closed / 0 open, zero exceptions)

**What it does:** top-up, wallet-to-wallet transfer, wallet-to-bank withdrawal, tier/limit
enforcement, transaction history, and the admin payments-finance dashboard (adjustment
maker-checker, audit-log viewer).

**How it works:** this is the core of the "money" side of the super app — the module every other
money-moving vertical ultimately settles through via the shared ledger primitives.

**Notable defects fixed — the highest concentration of real defects of any signed-off module:**
**WAL-010** (P0 — the admin RBAC layer's unrecognized-role fallback silently granted
`finance:view`/`audit:view`/etc. to **any authenticated customer**, exposing every user's wallet
balance, ledger entries, and KYC PII); **WAL-006** (wallet-to-wallet transfer and withdrawal had
**zero transaction-PIN verification anywhere**, client or server — plus a second, independent
instance where a PIN-entry UI silently discarded the PIN it collected); **WAL-003** (a stale-JWT-role
bug made every `user_profiles.role` grant/revoke a permanent no-op for real admin callers,
app-wide); **WAL-004** (the live admin wallet-adjustment page bypassed the real ADR-005
maker-checker entirely — unlimited instant credits/debits, zero threshold, zero second approver);
**WAL-011** (a raw bank account number logged in plaintext); **WAL-012** (raw upstream
Paystack/Postgres errors leaked to end users on 8 call sites); **WAL-013** (the admin reporting
dashboard's balance/volume figures were capped-window sums, not true aggregates — wrong numbers
that looked correct).

### 8. Refer & Earn — ✅ Complete & Signed Off (2026-09-16, 11 closed / 0 open, 1 out-of-phase item)

**What it does:** referral attribution and reward across **three independently-live systems** — a
Go "core" attribution/accrual engine, a newer Go "Direct Referral Rewards" engine, and a
Next.js-native vote-bridge flat ₦500 reward.

**How it works:** the coexistence of three systems is itself the module's main technical risk —
several defects were specifically about one system being blind to another's canonical data.

**Notable defects fixed:** **REF-001** (Blocker — a vote-triggered reward's outbox drain path was a
literal `TODO` stub that silently marked the event "done" without crediting anyone); **REF-002**
(High — the older engine's code resolver was blind to the newer engine's canonical code table,
silently routing genuine referrals to the house account); **REF-009** (High — a suspended/locked
account could still receive a payout **and** withdraw it — closed in two passes after the first
pass only closed the withdrawal side and reflection showed that just moved the risk one step over);
**REF-011** (High — a clawback on an already-paid reward flipped state and logged an audit event but
never actually reversed the wallet credit). **Out-of-phase, not a defect:** REF-006
(merchant-funded campaign settlement) is explicitly tagged "Phase 3" in the product's own PRD.

### 9. Association — ✅ Complete & Signed Off (2026-09-17, 6 closed / 0 open, 1 decision item resolved)

**What it does:** association/group membership — dues, elections, committee roles, bulk import,
offline-payment approval, commission accrual; a 13-page admin console and a 12-screen mobile app.

**How it works:** `backend/internal/association` (153 routes); the module's own pre-existing
formal test plan was fully closed out plus a first-ever live-DB run of its 96 live-DB + 11 unit
test suite.

**Notable defects fixed:** **ASSOC-006** (Blocker — the election management page 403'd for the
actual admin-console user, invisible to a code-only read); **ASSOC-005** (Major — a newly-created
election was permanently invisible to the admin console that created it); **ASSOC-001** (Major —
the mobile app defaulted to mock data locally, faking success on ~50 mutation functions).
**Decision item resolved:** `requireElectionOfficer` gates the whole election lifecycle on "holds
any admin role" rather than the module's usual capability model, letting a Secretary independently
run an election end to end — presented to the user as a product/security decision and **confirmed
intentional** (a normal real-world association convention), now pinned by a permanent regression
test.

### 10. FX Exchange — ⬜ Not Started (UAT); real Go module, partially live per project memory

The UAT queue lists this as **Not Started**. `backend/internal/finance/fx` exists in the completed
backend module list in `PAYMAX_BUILD_PLAYBOOK.md` and `frontend-admin/app/admin/fx/` has a console
surface. Per project memory, FX from mobile to the Go backend is live via server-side quotes, with
the Maplerad rail reported live and a second provider (Eversend) still needing a real secret; the
NGN side of FX is reported to be the **same** main wallet ledger (`ledger_entries`), not a separate
balance. None of this has been through the UAT engagement's own discovery/defect/sign-off process —
treat it as "built and partially operated," not verified.

### 11. Property Management — 🚧 In Progress (Batch 1 done)

**What it does:** disambiguated by the UAT tracker itself into four sub-planes because the name
doesn't map to one code package: `backend/internal/property` (context/rent-passport suite),
`estate/property_mgmt.go` (landlord/tenant CRUD), `backend/internal/realtor` (agency/portfolio/
lease/shortlet admin, partly Supabase-direct), and `stays_property` (shortlet).

**Status in detail (Batch 1, all four Blockers/Majors fixed and independently re-verified):**
**PROPMGMT-001** (Blocker — a tenant could mark their own rent/deposit invoice "paid," activate the
lease, and fabricate a deposit into escrow with **zero money ever moving**, via a `SECURITY DEFINER`
Supabase RPC callable directly by the mobile client with no wallet debit, no ledger entry, no
Paystack verification anywhere; fixed by routing through a real Go-mirrored debit path and revoking
direct RPC access from `authenticated`); **PROPMGMT-003/004** (Blockers — zero admin UI existed for
2 of the module's 4 sub-planes; both built); **PROPMGMT-005** (Major — zero test coverage beyond 3
pure-logic tests; 24 new tests added, one more real NULL-scan crash found along the way). **One
Major disclosed, not fixed:** PROPMGMT-002 (no escrow-release mechanism exists at all — a product
decision, not a mechanical fix). **Open before sign-off:** a mobile-parity decision (PROPMGMT-007,
mirrors ASSOC-DECISION-001), an OpenAPI gap for the realtor admin plane (PROPMGMT-006, partially
closed), and the remainder of the module's test-plan rows not yet formally executed.

### 12. Food (Restaurant Delivery) — ✅ Complete & Signed Off (2026-09-17, 9 closed / 0 open, 2 accepted exceptions)

**What it does:** full restaurant ordering/delivery lifecycle — ordering, delivery handoff,
settlement, restaurant onboarding/KYB, payouts, withdrawals — plus the admin portal's reporting and
dispute-resolution surface.

**How it works:** `backend/internal/restaurant`; settlement runs through the shared
`settlement.Service`; a separate batch payout-run tool exists alongside the direct-at-delivery
settlement path (this coexistence was itself the source of the module's worst bug).

**Notable defects fixed, most severe first:** **FOOD-003** (Blocker — every restaurant approved
through the live admin console was permanently unpayable: KYB submission routes were unregistered,
and admin approval silently skipped `kyb_status` when no KYB row existed); **FOOD-004** (Blocker —
admin-resolved disputes flipped a status column and moved zero money; the real refund-cap engine
existed but was unreachable dead code); **FOOD-008** (Blocker — the dispute-resolve admin route had
**zero permission check** once FOOD-004 wired it to actually move money); **FOOD-009** (Blocker,
systemic — running a payout batch against a delivered order **double-paid** the restaurant owner,
because the direct-at-delivery settlement path and the batch payout tool were two independent money
movers unaware of each other — the fix was proven by deliberately reverting it, confirming the new
regression test fails, then restoring it); **FOOD-010** (Blocker — KYB review was entirely
optional: `SetAvailability` never checked `kyb_status`, so any owner could self-open and take real
orders with zero admin review); **FOOD-005** (Blocker — a complete withdrawal backend service
existed with no route or admin UI anywhere). **Accepted exceptions:** FOOD-006 (no member-facing UI
to request a withdrawal — the backend/admin path already works, so not money-unsafe as shipped) and
FOOD-007 (the live disburser adapter never populates a recipient's bank fields — latent, unreachable
since no live provider is wired today).

### 13. Marketplace — ⬜ Not Started (UAT); real Go module exists

The UAT queue lists this as **Not Started**. `backend/internal/marketplace/` is a substantial
package (listing FSM, boost FSM, automod, messaging service/repository, admin handler, deal
reviews, attribute validation) and `frontend-admin/app/admin/marketplace/` has a console surface.
CLAUDE.md separately flags that the marketplace `account.api.ts` client is one of several modules
still hardcoding the old, nonexistent R2 bucket name (`spotlight-open-mic`), which would make image
uploads presign successfully and then fail at the PUT with `NoSuchBucket` — an unverified but
plausible live defect inherited from the storage-config issue, not yet checked by this module's own
UAT pass.

### 14. Telemedicine — ⬜ Not Started (UAT); real Go module, playbook Block 13 marked done

The UAT queue lists this as **Not Started**, but this is one of the platform's more mature verticals
in code: `backend/internal/telemedicine` appears in the playbook's list of 51 completed, passing Go
packages, with a documented 85%/15% doctor/platform settlement split via `settlement.Service`.
`backend/internal/health/consult`, `intake`, `scheduling`, `triage`, `records`, `consent`, and
`providers` sub-packages also exist under the broader health suite. `frontend-admin/app/admin/health/`
covers the admin surface. Per project memory an earlier engagement already did a
"test-plan-first hardening" pass on telemedicine/pharmacy/lab/rx/consult together and a real
platform-fee ADR (ADR-040) shipped for telemedicine specifically — but none of this has been
through the fixed 21-module UAT queue's own discovery/defect/sign-off discipline, so it is not
counted as "signed off" here regardless.

### 15. Pharmacy — ⬜ Not Started (UAT); real Go module exists

Not started per the UAT queue. `backend/internal/health/pharmacy`, `rx`, `controlled`, and
`labref` sub-packages exist; a `FEATURE_PHARMACY_ENABLED` flag is registered in the playbook's flag
registry ("Pharmacy product catalogue and cart"). Per project memory, three previously-missing list
endpoints plus a wrong-scope bug in pharmacy customer-orders were found and fixed by an earlier,
narrower engagement — again, not the same thing as having gone through this platform's UAT queue.

### 16. Laboratory — ⬜ Not Started (UAT); real Go module exists

Not started per the UAT queue. `backend/internal/health/lab` and `labref` sub-packages exist
alongside pharmacy's; per project memory this was included in the same earlier "lab/pharmacy/rx"
missing-endpoint fix pass referenced under Pharmacy above. No UAT discovery pass or sign-off exists.

### 17. Veterinary — ⬜ Not Started (UAT); real Go module exists

Not started per the UAT queue. `backend/internal/health/vet` exists as its own sub-package
alongside the human-health verticals. Per project memory, a missing vet-appointments list endpoint
was found and fixed (net-new, not a regression) by an earlier engagement, which also surfaced a
latent NULL `service_id` crash risk in the same `Get()` path — again, not a UAT sign-off.

### 18. Ride — ⬜ Not Started (UAT); substantial code exists, unverified

Not started per the UAT queue. This maps to `backend/internal/transport`, a large package covering
bus, car hire, parcel/logistics, towing, scheduled dispatch, mode ratings, negotiation, and a
WebSocket tracking hub, alongside `FEATURE_TRANSPORT_ENABLED` in the flag registry and playbook
Block 14's original spec (base fare ₦1,500, `ProviderPct+PlatformPct+RiderPct=1.0` split enforced
at ride creation, Redlock for concurrent-accept races). `frontend-admin/app/admin/mobility/` is the
console surface. Per project memory, mobility is reported "fully live end to end" with an 80/20
escrow split for on-demand rides, though scheduled rides are still reported mocked — again, unlike
the 9 signed-off modules above, none of this has the live-HTTP/DB-executed proof discipline the UAT
engagement requires for a sign-off.

### 19. Events Tickets — ⬜ Not Started (UAT); real Go module exists, has its own reconciliation history

Not started per the UAT queue. The playbook explicitly documents that this module went through a
significant internal reconciliation already: an original `internal/events` CMS-style package
collided (route + schema) with a newer `internal/top5events` cashless-wallet implementation, and a
later pass made **`top5events` the sole, canonical, wired implementation**, removed the legacy
package's router wiring (files left in place, untouched), added a missing discovery/list endpoint,
fixed a doubled route path, reconciled schema drift via an additive migration, and rewired the
mobile app's 17 Events screens off mock data (see `EVENTS-BUILD.md` at repo root for the full
record). This means the module's *code* has already absorbed one round of real fixes — but it has
not yet been through this platform's UAT queue.

### 20. NaijaDriver — ⬜ Not Started (UAT); code exists as an instance of the Arena quiz engine

Not started per the UAT queue. "NaijaDriver" is not a standalone backend package — it is a
config-driven instance of the competition/quiz engine in `backend/internal/arena` (a "Play-Along +
Theory exam" quiz bank), per `backend/internal/config/config.go` and `backend/internal/app/
arena_routes.go`'s own comments ("Naija Driver = instance #1"). `frontend-admin/app/admin/arena/`
is the console surface. No UAT discovery pass exists for it under either name.

### 21. Connect — ⬜ Not Started (UAT); substantial social-product code exists, unverified

Not started per the UAT queue. `backend/internal/connect/` is one of the largest single verticals
in the codebase — sub-packages for `account`, `aml`, `chat`, `creator`, `credits`, `datesafety`,
`discovery`, `events`, `gamification`, `gifting`, `live`, `matching`, `moderation`, `monetization`,
`networking` (including an "assessments" scoring engine), `onboarding`, `payouts`, `professional`,
`profile`, `safety`, `trust`, and `voting`. `frontend-admin/app/admin/connect/` has a console
surface. This is a large, apparently feature-complete social/dating-and-professional-networking
product in code, but — like the other eight not-started modules — none of it has been exercised
through the UAT engagement's live-verification discipline.

---

**A note on the "Property Management" pattern repeating elsewhere:** the UAT tracker had to
explicitly disambiguate Property Management into four separate code sub-planes because the
UAT-queue name doesn't map 1:1 onto a package name. The same kind of split likely exists for other
not-started modules above (e.g. "Ride" spans several transport sub-features; "Connect" bundles
several distinct products under one name) — this document notes it where the mapping was
confirmed by a directory listing, but a full sub-plane breakdown for each not-started module is
exactly the kind of thing its own future UAT discovery pass would need to do, the same way
Property Management's Batch 1 did.

## 5. Cross-Cutting Systems

- **RBAC / permissions.** The Go backend gates routes with `RequireAuthContext` plus a permission
  middleware (e.g. `middleware.RequirePermission`), checking specific capability slugs
  (`restaurant.admin.disputes`, `property.manage`, etc.) rather than coarse roles alone. The admin
  console has a **second**, separate console-level gate (`RequireAdminConsoleRole`,
  `ADMIN_MIDDLEWARE_ENFORCE`) that was found, during Authentication's UAT pass, to have defaulted
  fail-open in more than one place (AUTH-001–003) before being hardened. Several modules use a
  distinct "maker-checker" pattern for high-risk actions (admin balance adjustments, vote
  reversal/results-publish, Contest's admin actions) where no single role can both propose and
  approve — in Contest's case this is enforced structurally (no role holds both permissions) with a
  DB `CHECK` constraint as a second layer.
- **Feature flags.** Every module is required to ship behind a flag, defaulting to `false`/off; the
  registry lives in `PAYMAX_BUILD_PLAYBOOK.md`'s "Feature flag registry" section (`FEATURE_KYC_ENABLED`,
  `FEATURE_WALLET_ENABLED`, `FEATURE_TELEMEDICINE_ENABLED`, `FEATURE_PHARMACY_ENABLED`, etc. — over
  40 flags as of this writing, heavily weighted toward the Estate vertical's many sub-features).
  CLAUDE.md's workflow rule is explicit: "No flag, no merge."
- **Admin console mock-vs-live convention (`resolveUseMock`).** Described in §2 above — defaults to
  mock in local dev, required to default to live in production, surfaced via a `FixtureBanner`
  component, used consistently across ~19 admin modules. Treat an admin page showing obviously
  fabricated data in local dev as expected, not a bug, unless the flag is explicitly flipped off and
  the fake data persists.
- **The vote-bridge adapter pattern.** Because the legacy voting/contest code cannot be modified
  directly, new fintech functionality that needs to interact with it (e.g. crediting a referral
  reward when a paid vote occurs) goes through an idempotent, KYC-gated "bridge" with its own
  outbox — completed as Playbook Block 6 ("Done — stays in Next.js (brownfield wrapper)"). A
  dedicated `vote-bridge` skill and ADRs (`ADR-004`, `ADR-037`) document the idempotency contract in
  detail; several real defects (REF-001, the Contest module's D-008) were specifically about this
  bridge's outbox drain path silently marking an event "done" without actually doing the work it
  represented.
- **Migration discipline.** Covered in full in §3 — additive-only, timestamp-keyed, collision-checked
  immediately before merge, enforced by `scripts/ci/check-migration-versions.sh`.
- **Legacy/brownfield protection.** A `PreToolUse` hook blocks edits to protected legacy paths
  (`frontend-web/app/api/v1/votes/`, `frontend-web/src/server/votes/`, existing
  `supabase/migrations/` files, non-fintech `frontend-web/components/`) at the tooling level, not
  just as a documented convention.

## 6. Go-Live Status Summary

This mirrors the UAT bug tracker's own **Module Queue Status** table verbatim in intent, re-checked
against the tracker's exact current wording as of 2026-09-17.

| # | Module | Status |
|---|--------|--------|
| 1 | Authentication | ✅ Complete & Signed Off — 19 closed / 2 accepted exceptions |
| 2 | Utility Bills | ✅ Complete & Signed Off — 5 closed, full Go migration |
| 3 | Film Academy | ✅ Complete & Signed Off — 3 closed, full Go-native tuition path |
| 4 | Contest | ✅ Complete & Signed Off — 16 closed / 0 open, 2 accepted exceptions |
| 5 | Crowdfunding | ✅ Complete & Signed Off — 8 closed / 0 open, 1 business-stakeholder item |
| 6 | Insurance | ⬜ Not Started |
| 7 | Wallet | ✅ Complete & Signed Off — 15 closed / 0 open, 0 exceptions |
| 8 | Refer & Earn | ✅ Complete & Signed Off — 11 closed / 0 open, 1 out-of-phase item (not an exception) |
| 9 | Association | ✅ Complete & Signed Off — 6 closed / 0 open, 1 decision item resolved |
| 10 | FX Exchange | ⬜ Not Started |
| 11 | Property Management | 🚧 In Progress — Batch 1 done, 4 Blockers/Majors fixed, 1 Major disclosed open (escrow release), mobile-parity decision + OpenAPI gap outstanding |
| 12 | Food | ✅ Complete & Signed Off — 9 closed / 0 open, 2 accepted exceptions |
| 13 | Marketplace | ⬜ Not Started |
| 14 | Telemedicine | ⬜ Not Started |
| 15 | Pharmacy | ⬜ Not Started |
| 16 | Laboratory | ⬜ Not Started |
| 17 | Veterinary | ⬜ Not Started |
| 18 | Ride | ⬜ Not Started |
| 19 | Events Tickets | ⬜ Not Started |
| 20 | NaijaDriver | ⬜ Not Started |
| 21 | Connect | ⬜ Not Started |

**Aggregate tally: 9 of 21 modules fully signed off, 1 in progress, 11 not started.**

None of the 9 signed-off modules have zero caveats in the absolute sense — most carry at least one
accepted exception, out-of-phase item, or business-stakeholder decision still pending — but all 9
are recorded as "READY FOR PRODUCTION" for the scope actually tested. Property Management is
mid-pass with real Blockers already found and fixed. The remaining 11 modules range from
substantial, apparently-complete code (Telemedicine, Connect, Ride/Transport, Events Tickets) to
modules this document could only confirm exist via a directory listing (Insurance, Marketplace,
Pharmacy, Laboratory, Veterinary, FX Exchange, NaijaDriver) — none of them carry any UAT-verified
claim of correctness, and per this engagement's own repeated finding across every module it has
touched, code maturity (commit count, existing tests, ADRs) has never once been sufficient proof by
itself: real Blockers were found by live execution in every single module actually tested so far.

## 7. For New Contributors

### Commands

There is **no root `package.json`** — every `npm run` command below must be run from its own
module directory.

- `cd frontend-web && npm run test:regression` — golden-path regression suite (must always pass):
  `tests/unit/golden-path`, 9 specs, 120 tests
- `cd frontend-web && npm run test:money` — money invariants (`tests/unit/estate`,
  `tests/unit/wallet`, `tests/unit/tiers`)
- `cd frontend-web && npm run contract:check` — estate implementation vs `contracts/estate.openapi.yaml`
  (estate only — does not check `openapi.yaml`)
- `cd frontend-web && npm run lint` — ESLint via Next.js lint config
- `cd frontend-admin && npm run type-check` — TypeScript strict check (`tsc --noEmit`)
- `cd frontend-web && npx tsc --noEmit` — TypeScript check for the web app
- `cd backend && go vet ./...` — Go static analysis
- `cd backend && go build ./...` — Go compile check
- `cd backend && go test ./... -count=1` — Go unit tests (~464 `*_test.go` files; live-DB suites
  skip unless `TEST_DATABASE_URL` is set)
- `make test` — the same suite with `-race` (needs Postgres + `RAILS_MODE=fake`)
- `make verify` — the go-live gate: build, vet, tsc, contract-check, migrate-reset, test, security-scan
- `cd frontend-web && npx vitest run` — run all unit tests once
- `cd frontend-web && npx vitest run --coverage` — with v8 coverage report
- `supabase db push` — apply pending migrations to the connected Supabase project
- `supabase migration new <name>` — create a timestamped migration
- `supabase db reset` — reset local Supabase instance and replay all migrations (dev only)
- `scripts/dev/ensure-dev-login.sh` — repair local dev login (password + lockout gate); **never
  hand-reset a fixture account's password** — see CLAUDE.md's "Local dev accounts" section for why

### Where to find more detail

- **Per-module test plans and detailed QA history:** `docs/qa/modules/<name>.md` (where they exist
  — several modules referenced above, e.g. `association.md`, `crowdfunding.md`, have dedicated
  formal test plans this document's summaries are drawn from).
- **The living go-live record, including every individual bug's full description and fix
  commit:** `SPOTLIGHT_UAT_BUG_TRACKER.md` at the repo root — this document's module sign-off
  paragraphs are condensed from its "Module Sign-off Summaries" section; read it directly for the
  full bug-by-bug detail this overview necessarily compresses.
- **The API surface:** `contracts/openapi.yaml` (~308 distinct `/api/...` path prefixes as of this
  writing) — the spec-first source of truth; API changes are required to start here before
  implementation.
- **Architecture rationale and the ADOPT/EXTEND/KEEP/CONFLICT decisions** (including the Gin-vs-Chi
  conflict noted below): `docs/architecture/audit.md`.
- **The full build sequence and per-block acceptance criteria** for both completed and not-yet-started
  blocks: `PAYMAX_BUILD_PLAYBOOK.md`.

### One documented conflict worth knowing about

`PAYMAX_BUILD_PLAYBOOK.md` v2 states a preference for the Chi router; `CLAUDE.md` and
`docs/architecture/audit.md` both explicitly override this and require **Gin v1.10**, which is what
the codebase actually uses. This is not an unresolved ambiguity — `docs/architecture/audit.md`
records it as a deliberate, documented decision ("Decision: KEEP Gin... migrating to Chi would be
churn with zero functional gain at this stage") — but it is worth knowing the playbook text itself
still says otherwise if you read it in isolation.
