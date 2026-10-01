# Full Production Readiness Audit

## Audit Metadata

* Date: 2026-09-30
* Repository: `/Users/bushadigitallimited/Desktop/patrick/spotlight-latest1` ("Paymax × Spotlight" super-app monorepo)
* Git branch: `main`
* Git commit: `1bb214f7ff97b0ceaa157413218059a483cbb962` (Merge PR #283, promote banner to production)
* Initial working-tree state: **clean** — `nothing to commit, working tree clean`; branch up to date with `origin/main`
* Auditor: Devin (read-only audit; no source modifications)
* Scope: Entire repository — Go backend (`backend/`), Next.js web (`frontend-web/`), Next.js admin (`frontend-admin/`), React Native/Expo mobile + its standalone Go backend (`mobile-app/reactnative/`), Vue/Quasar app (`mobile-app/vue-quasar/`), Supabase migrations (`supabase/`), OpenAPI contracts (`contracts/`), infra (`infra/`, Dockerfiles, `render.yaml`, `docker-compose.yml`, deploy scripts), CI (`.github/workflows/`, 37 workflow files).

## Executive Summary

**Overall verdict: NOT READY** — the repository contains a mature, unusually disciplined codebase, but the deployable artifact currently cannot be built, and several verified defects have direct user/security/financial impact.

Verified at HEAD (`1bb214f`):

* **The backend does not compile** (`go build ./...` → `FeatureContestantSocialEnabled` undefined, `internal/connect/voting/handlers.go:291,314`). A merge (`0b315a23`) resolved config conflicts by accepting `main`'s `config.go` while `handlers.go` kept the new field — and **the checks that would have caught this ran red but weren't required on `main`** (AUD-TEST-003).
* **`ChangePassword` returns `{"success":true,"message":"Password changed"}` without ever-changing the password** — no `currentPassword` verification, no GoTrue call, and it writes a false `password.change` audit entry while revoking session rows (AUD-BE-005).
* **Account lockout self-destructs**: an auto-expired lock never clears `status='locked'` — one successful login, then permanent lockout until admin unlock (AUD-BE-009).
* **Client-side payment fulfilment**: `paymax_gateway` webhook events are logged but fulfilment happens only when the browser/app hits a verify endpoint — a crash or network loss strands real money (AUD-FE-003). Paid-vote crediting is **non-atomic and unrecoverable**: the `credited` flag is written before the votes, so a mid-flight crash leaves a transaction that re-verify reports as "already processed" while the votes never existed (AUD-DB-002). The `/vote-callback` page sends no `transactionId` to a verify endpoint that requires it — every successful buyer sees "Payment Not Confirmed / you have not been charged" (AUD-FE-007).
* **`handleApiError` swallows every unexpected error across 1,068 API-route call sites** with zero logging or Sentry capture — the entire Next.js BFF fails silently (AUD-FE-006).
* **Production EAS profile carries no `EXPO_PUBLIC_*` env** (API base URL, Supabase URL+key) — builds fall back to `http://localhost:3000` or crash, unless EAS dashboard vars compensate (AUD-FE-001).
* **Auth middleware fails open**: `GetUserStatus` errors are discarded and the repository returns `"pending"` on Supabase failure — suspended accounts can authenticate during upstream outages (AUD-BE-002).
* **The deploy pipeline's own smoke tests curl `/healthz` + `/readyz` — endpoints the router never registers** — so every production deploy via `deploy.yml` fails post-build even with healthy code (AUD-INFRA-007).
* **The notification queue has producers but no consumer** — asynq `NewServer`/`notifications.Workers` are never called by any binary; enqueued push/email/SMS are silently never delivered (AUD-BE-008).
* **No enforced CI gates on `main`** — required checks are declared only for `develop`; `main` lands merges on red pipelines (AUD-TEST-003) with several advisory/dead lanes (AUD-TEST-004).

Verified working:

* Frontend regression suite **129/129 green**; `frontend-web` and `frontend-admin` `tsc --noEmit` clean; mobile `check:confirm` green.
* Ledger: integer-kobo, immutable entries, advisory locks, double-entry invariants with a dedicated test suite; paid-vote amounts verified server-side in kobo with idempotent re-verify.
* Boot fails closed on missing prod DB/secrets; layered admin auth; Sentry + OTel wired; build-identity endpoint; OTP hardened with Postgres-backed rate limiting.
* **0 migration version collisions** across 568 files; RLS lockdown migrations exist for the backend-only tables.
* No secrets committed (only `.env.example` templates); TruffleHog runs on main pushes.

Structural risks (not blocking but real): fragmented deploy targets (Cloud Run / Render / Railway / cPanel — no declared authority, AUD-INFRA-003); dormant migration pipeline with a documented prior 60-migration drift incident (INFRA-005); worker/cron binaries deployed nowhere (INFRA-006); Expo dev server as a production start command (INFRA-002); per-request Supabase fan-out with no caching (PERF-001); sparse, spoofable, per-instance rate limiting (SEC-001, BE-004).

~50 discrete findings are logged below across BE/FE/DB/SEC/INFRA/TEST/PERF/REL/DOC categories. A 10-agent pairwise re-verification campaign (each finding independently re-checked against source by a fresh reviewer) is summarized in the final section — it refuted 3 claims, confirmed ~15, amplified 8, and surfaced 4 new findings including a permanent-lockout bug (AUD-BE-009) and an always-failing paid-vote callback (AUD-FE-007).

## System Inventory

* **Backend API**: `backend/` — Go, Gin v1.10, module `spotlight/backend`. Entrypoint `cmd/server/main.go`. Workers: `cmd/marketplace-indexer`, `cmd/marketplace-cron`, `cmd/transport-scheduler`, `cmd/fxsmoke`, `cmd/voting-test-server`. ~80 packages under `internal/` spanning finance (ledger, wallet, KYC, tiers, transfers, referrals, virtual accounts, FX, utility bills, insurance, savings), commerce (marketplace, restaurant, escrow, placement), health (doctor, telemedicine, pharmacy, nutrition, aicare), transport, estate/realtor/property/fractionalre/stays, academy/learn/invest/trading/investai/spotlightwealth, connect (dating), arena, groups, association, business registry, crypto, crowdfunding, loyalty/points, notifications, OTP, orchestration, webhooks.
* **Trading service (separate module)**: `mobile-app/reactnative/backend/` — standalone Go module `paymax/crypto-backend` with own Postgres via golang-migrate. Posts cash legs to the main ledger via `/internal/finance/ledger/*` guarded by `LedgerServiceToken` (flag-gated, default OFF).
* **Frontend web**: `frontend-web/` — Next.js 14.2, TS, Tailwind, Supabase SSR; Vitest 4.1 unit tests + Playwright e2e. Custom `server.js` (cPanel Passenger). Sentry wired (`sentry.*.config.ts`, `instrumentation.ts`).
* **Admin dashboard**: `frontend-admin/` — Next.js 15.1, port 3001, admin-proxy route attaches `x-admin-api-key` server-side.
* **Mobile**: `mobile-app/reactnative/` (Expo RN + RN web) and `mobile-app/vue-quasar/` (Vue 3/Quasar — likely legacy/secondary).
* **Database**: Supabase-hosted Postgres 17; `supabase/migrations/` has **568** migration files (additive-only policy). Direct pgx pool (`internal/platform/db`) for money path; Supabase REST client for legacy modules.
* **Cache/queue**: Redis (idempotency cache, Redlock, asynq, SSE fan-out) — optional, degrades to DB-unique-constraint backstop.
* **Search**: Elasticsearch 8.13.4 (marketplace read model, compose profile `marketplace`).
* **Object storage**: Cloudflare R2 via S3 presigned URLs (`R2_BUCKET` required, no default).
* **Payments**: Paystack (HMAC-SHA512 webhooks); Maplerad, Eversend, Monnify, Quidax adapters (flag-gated).
* **Email**: Resend + Brevo (OTP) — noted in CLAUDE.md as fire-and-forget, silent failures.
* **Observability**: Sentry + OTel→Cloud Trace via `internal/platform/observability` (no-op unless configured); `internal/platform/metrics`.
* **CI**: 37 workflow files; repo `ci.yml` = build+vet; per-module lanes; `hygiene` lane checks migration-version collisions; `security.yml`, `integration-verify.yml`, `mobile-eas.yml`, deploys for cPanel and others.
* **Infra**: Terraform for GCP Cloud Run (`infra/terraform`, cloud-run-service module, workload identity, monitoring/dashboard); OSRM graph infra for transport.
* **Contracts**: `contracts/openapi.yaml` (source of truth per CLAUDE.md), plus per-module specs (e.g. `estate.openapi.yaml`).

## Architecture Assessment

* **Verified topology**: Go monolith (`backend/`, Gin v1.10, ~80 `internal/` packages, 198 routes) fronted by three client surfaces: `frontend-web` (Next.js 14, which itself exposes **513 API routes** — a full BFF layer that owns the live Paystack webhook, paid-vote fulfilment, utility payments, and registration), `frontend-admin` (Next.js 15, proxies through `admin-proxy` injecting `x-admin-api-key`), and `mobile-app/reactnative` (Expo RN, talks directly to the Go API + Supabase).
* **Dual data planes**: money-path modules use a direct pgx pool (`internal/platform/db`) + double-entry ledger with invariants; legacy Spotlight modules use Supabase REST repositories. Two money conventions coexist (integer kobo vs float NGN — AUD-DB-003).
* **Dual payment pipelines**: Paystack webhooks land in `frontend-web/app/api/webhooks/paystack/` (six handlers, `allSettled`, always-200) **and** a Go `internal/webhooks/paystack.go` exists — only one can receive events; the live one is the Next.js route per CLAUDE.md. Fulfilment for `paymax_gateway` delegates to client verify (AUD-FE-003).
* **Auth layering**: Supabase GoTrue → `RequireAuthContext` (token + status + roles + permissions per request — AUD-PERF-001 fan-out) → route-level permission middleware; admin adds `RequireAdmin` + `RequireAdminConsoleRole` + scoped access.
* **Feature-flag discipline**: every new module is flag-gated with fail-closed startup validation — the codebase is explicitly designed for "merge dark, launch later" (task-tracker confirms several verticals shipped mid-build, AUD-DOC-002).
* **Deployment is the weakest axis**: four credible deploy paths (Cloud Run / Render / Railway / cPanel) coexist with no declared authority; the migration pipeline is dormant; workers are undeployed; the main branch has no enforced gates.
* **The architecture is sound; the gates are advisory.** Every subsystem inspected has the right defensive shape — the failures are in enforcement (CI on main), completeness (ChangePassword, gateway fulfilment), and observability wiring (handleApiError).

## Production Readiness Matrix

| Area            | Status | Evidence | Findings |
| --------------- | ------ | -------- | -------- |
| Architecture    | READY WITH RISKS | 3 frontends, Go monolith + Next.js BFF (513 routes), Supabase + Redis, flag-gated modules | Fragmented deploy targets (INFRA-003); dual money conventions (DB-003) |
| Backend         | **NOT READY** | `go build ./...` fails at HEAD | BE-001 (CRITICAL), BE-002..BE-007 |
| Database        | READY WITH RISKS | 568 migrations, 0 version collisions, RLS lockdown waves, ledger invariants tested | DB-001 (gate gap), DB-002 (non-atomic fulfilment) |
| Authentication  | **NOT READY** | change-password doesn't change password; status check fails open; no-timeout HTTP | BE-002, BE-005, BE-006 |
| Authorization   | READY WITH RISKS | Layered RequireAdmin/RBAC/identity middleware; scoped user access; scoped filters | FE-005 (self-declared admin role via shared key), BE-003 |
| Frontend/Mobile | READY WITH RISKS | web tsc=0, regression 129/129, admin tsc=0, check:confirm green | FE-001 (CRITICAL-conditional), FE-002..FE-006 |
| API Contracts   | UNVERIFIED | openapi.yaml parses, 600 paths; conformance check only covers estate | DOC-003, TEST-001 |
| E2E Flows       | READY WITH RISKS | paid-vote and wallet paths traced with idempotent verify; gateway fulfilment client-dependent | FE-003, FE-004, BE-005 |
| Security        | READY WITH RISKS | HMAC webhook verification, fail-closed config, backend-only RLS waves, secrets scan wired | BE-004, SEC-001, FE-005, INFRA-001 |
| Performance     | READY WITH RISKS | per-request Supabase fan-out; in-memory limiters | PERF-001, PERF-002 |
| Observability   | READY WITH RISKS | Sentry+OTel exporters on Go side; build-info endpoint; but no request IDs, no HTTP spans, silent BFF errors | FE-006 (HIGH), REL-004/005/007 |
| Testing         | READY WITH RISKS | golden-path 129/129 green; 1 vitest failure on HEAD; Go subset green | TEST-001..004 |
| CI/CD           | **NOT READY** | real gates exist but only on develop; main merges land on red pipeline unblocked; deploy smoke tests curl nonexistent endpoints | TEST-003, TEST-004, INFRA-007 |
| Deployment      | **NOT READY** | backend image cannot build from HEAD; deploy smoke test always 404s; hollow canary; conflicting deploy paths; workers undeployed; dormant migration pipeline; no backup/restore runbook | BE-001, INFRA-002/003/005/006/007/008/009 |
| Reliability     | READY WITH RISKS | graceful shutdown (server + workers), boot fail-closed, idempotent webhook dedup, retryable verify — but notification queue has no consumer | BE-008, REL-001..006, INFRA-006 |
| Data Integrity  | READY WITH RISKS | ledger invariants enforced+tested; immutable entries; advisory locks | DB-002, DB-003 |

## Screen-by-Screen Audit

### Verification method and honest scope

* `frontend-web`: **77 page routes** (`find app -name page.tsx`). Audit method: static inspection of state handling (loading/error/empty/auth) on critical flows + full enumeration below. Most pages are thin shells over feature components; deep interaction testing requires a running stack — **not performed** (local Supabase not running; production env absent).
* `frontend-admin`: **~300 admin pages** under `app/admin/` — enumerated by section; per-page state checks not individually executed. `npx tsc --noEmit` for the whole admin app: **passes (exit 0)**.
* `mobile-app/reactnative`: **582 route files** across ~70 feature groups under `app/`. Mobile `typecheck` (committed `tscFull.txt` artifact): 0 errors at last recorded run — **stale artifact, marked UNVERIFIED for HEAD**. `npm run check:confirm` (no raw multi-button `Alert.alert`): **passes**.
* Per-screen interaction verdicts below are limited to screens actually read; everything else is **UNVERIFIED** rather than assumed-working.

### frontend-web — page inventory (77 routes)

| Group | Routes | Audit status |
|-------|--------|--------------|
| Auth | `login`, `register`, `forgot-password`, `auth/reset-password`, `verify-email`, `open-mic/login`, `open-mic/register` | PARTIAL — `login` (595 lines) read: has `busy`/`error`/`info` states, MFA tab, `try/catch/finally` on all submits, maps distinct Go/GoTrue error messages. `vote-callback` (142 lines) read: handles `missing_params`, `failed`, `already_processed`, `success`, network-failure message corrects user expectation ("payment may still have processed — check your email"). Others UNVERIFIED. |
| Voting (public) | `voting`, `vote/[contestSlug]/[contestantSlug]`, `vote-callback`, `vote-link/[token]` | PARTIAL — vote-callback verified (above). Voting/checkout static-only. |
| Contests/Open-mic | `open-mic`, `open-mic-competition`, `open-mic/[slug]` (+`apply`,`enter`,`entries`,`entry`,`entry/[artistSlug]`,`finale`,`dashboard`,`profile`,`winners`), `dashboard/open-mic/[slug]` | UNVERIFIED — enum only. |
| Money | `utility`, `utility/receipt/[id]`, `earn`, `crowdfunding` (+`[id]`,`donate`,`contributions`,`contributions/[id]`,`create`) | PARTIAL — utility routes covered by rate-limit + test findings (AUD-TEST-001); screens UNVERIFIED. |
| Commerce | `restaurant` (+`[id]`,`checkout`,`orders`,`orders/[id]`,`orders/[id]/rate`,`paystack`), `services` (+`[slug]`,`paystack/[reference]`) | UNVERIFIED — enum only. |
| Academy/media | `academy/analytics`, `academy/compliance`, `apply/film-academy`, `film-academy/apply`, `film-academy/dashboard`, `media`, `media-room`, `stem/contests`, `stem/schools/join`, `stem/schools/register` | UNVERIFIED — enum only. |
| Corporate/static | `homepage`, `about-adjacent` set: `brand-activation`, `government-partnerships`, `institutional-partnerships`, `impact`, `opportunities`, `partnerships/sponsors`, `press`, `privacy-policy`, `terms-and-conditions`, `programs`, `season-2`, `services`, `sponsor`, `sponsors-partners`, `spotlight-studios`, `studios`, `talent-vault`, `talent-vault/[slug]`, `restaurant`, `my-applications`, `profile`, `user-dashboard`, `contestants`, `contestant/votes` | UNVERIFIED — enum only. |

| ID | Severity | Issue | Evidence | Reproduction | Production Impact | Status |
|----|----------|-------|----------|--------------|-------------------|--------|
| SCR-001 | HIGH | Screen-level behavior of ~70 of 77 web routes, ~300 admin pages, and 582 mobile routes was not executed end-to-end | no running local stack (no local Supabase/Redis); audit is static + test-based | — | Unknown error/empty/auth-expiry behavior on the long tail of screens | UNVERIFIED |
| SCR-002 | LOW | `vote-callback` correctly handles param-less landing, double-verify (`alreadyProcessed`), and network failure | `app/vote-callback/page.tsx` | read | — | VERIFIED (positive) |

### frontend-admin — page inventory (by section, ~300 pages)

Sections present: `academy/*` (analytics, bundles, commerce, content, content-production, credentials, curriculum, edupay, exams, fees/*, film, gamification, live, moderation, notifications, question-bank, rewards, schools, sponsors, tutors), `arena/*` (config, credentials, judge, lifecycle, merit, pot, proctor, questions, screening, sponsors), `association/*` (approvals, audit, content/*, dashboard, dues, elections, import, members, organisations), `audit-logs`, `business`, `chatbot`, `commission`, `competitions/*`, `connect/*` (aml, analytics, assessments, audit, bounties, cases, catalog, comms, company-claims, config, content, dashboard, finance, gamification, geo, gifting, identity, jobs, loyalty-audit, media-review, mentorship, moderation, payouts, rbac, support, underage, users, voting), `contests`, `creators/*`, `crowdfunding/*`, `crypto/*`, `estate/*`, `events/*` — plus many more beyond display truncation.

* Whole-app `npx tsc --noEmit`: **exit 0** (verified 2026-09-30).
* Per-page behavior: UNVERIFIED except admin-auth proxy path (AUD-FE-005) and the earlier verified session-gated `admin-proxy` route.

### mobile-app/reactnative — feature groups (582 route files)

Groups: `(auth)`, `(doctor)`, `(merchant)`, `(tabs)`, `admin`, `ai-notes`, `ai-trading`, `announcements`, `arena`, `association`, `connect`, `creators`, `crowdfunding`, `crypto`, `documents`, `dues`, `election`, `emergencies`, `estate-*`, `events`, `facilities`, `featured`, `film-academy`, `finance`, `food`, `fractionalre`, `fx`, `guard`, `health`, `insurance`, `invest*`, `kyc*`, `learn`, `loyalty`, `maps`, `marketplace`, `meetings`, `merchant`, `mobility`, `module-unavailable`, `nutrition`, `onboarding`, `pharmacy`, `profile`, `properties`, `property`, `realtor`, `referral`, `registration`, `repairs`, `reports`, `savings`, `security`, `services`, `social`, `spotlight-wealth`, `stays`, `stocks`, `tasks`, `vendor-portal`, `vendors`, `visitor`, `voting`, `wallet`.

* Verified: `check:confirm` gate green (no raw `Alert.alert` confirmations — required for web-preview correctness); API client has 60s timeout + 401→sign-out redirect (`src/api/client.ts`); `module-unavailable.tsx` exists (flag-off UX path).
* Findings: AUD-FE-001 (prod EAS env), AUD-FE-002 (duplicate `staging-aab`).
* All per-screen runtime behavior: UNVERIFIED — no simulator/device run performed; e2e Playwright specs exist under `tests/e2e/` but were not executed (require running backend+app).

## End-to-End Flow Audit

| Flow | Path traced | Success verified | Failure-path verified | Findings |
|------|-------------|------------------|-----------------------|----------|
| Registration → login | `register` page → `POST /api/auth/*` proxy → Go `auth_service.go` | Partially (static + tests) | Login 401 folds all failure causes into one generic message (documented in CLAUDE.md as intentional); failed-login counter non-atomic (AUD-BE-007) | AUD-BE-002, BE-007 |
| Password change | `POST /api/auth/change-password` → `ChangePassword` service | **Verified broken** — returns success without changing password | Never verifies `currentPassword`; never calls GoTrue | **AUD-BE-005 (HIGH)** |
| Paid vote | `votes/paid/initiate` → Paystack → `vote-callback` → `votes/paid/verify` | Static trace: server-computed amounts, kobo comparison, idempotent re-verify, `increment_vote_totals` RPC | Webhook swallows handler errors (AUD-FE-004); receipt email fire-and-forget (AUD-REL-001); no rate limit on initiate (AUD-SEC-001) | AUD-FE-004, AUD-SEC-001, AUD-DB-002 |
| Wallet top-up | `webhooks/paystack` wallet handler → ledger | Partially (static) — verify-on-read fallback exists | Webhook always-200 (AUD-FE-004) | AUD-FE-004 |
| Gateway order payment | Paystack `paymax_gateway` → client-side verify | **Verified design flaw** — fulfilment depends on client reaching verify endpoint | Crash/network-loss post-payment leaves order unpaid | **AUD-FE-003 (HIGH)** |
| KYC / tier-gated money ops | `RequireVerifiedIdentity` + fail-closed tier checks in Go router | Static — layered middleware verified in router.go | Runtime not executed | partially verified |
| Admin action | `admin-proxy` → session check → `x-admin-key` → Go `RequireAdmin` + RBAC | Static — layered checks exist | Caller-declared role headers (AUD-FE-005) | AUD-FE-005 |
| Mobile app start (prod build) | EAS production profile → `src/api/client.ts` / `supabase.ts` | **Verified risk** — profile omits API/Supabase env; client defaults to `http://localhost:3000`, supabase throws on missing config | App fails at boot if EAS dashboard vars absent | **AUD-FE-001 (CRITICAL-conditional)** |
| Backend startup | `main.go` → config validate → DB probe → serve | Positive: fails closed on missing prod secrets/DB | Health endpoint is static-200 (does not probe DB at request time) | see OBS notes |
| Transport/marketplace scheduled jobs | `cmd/*` workers | N/A — **not deployed anywhere** | Jobs simply never run in prod | AUD-INFRA-006 |

## Backend Findings

### AUD-BE-001 — `main` HEAD does not compile (server binary unbuildable)

* Severity: **CRITICAL**
* Component: backend build / `internal/connect/voting`
* Location: `backend/internal/connect/voting/handlers.go:291,314` references `cfg.FeatureContestantSocialEnabled`; field absent from `backend/internal/config/config.go`
* Evidence: `cd backend && go build ./cmd/server` →
  `internal/connect/voting/handlers.go:291:10: cfg.FeatureContestantSocialEnabled undefined (type config.Config has no field or method)` (exit 1). `go build ./...` fails identically. Verified 2026-09-30, clean tree @ `1bb214f7`.
* Mechanism: `git log` shows `0b315a23 chore: resolve merge conflicts - accept main's backend config` (merge of `628a93dc` + `e1978351`, merged via PR #283) took main's `config.go` wholesale, discarding the `FeatureContestantSocialEnabled` field+env wiring added by `2b24b802` (contestant likes/shares). `handlers.go` kept the references.
* Expected: `main` (the production promotion target) always compiles.
* Actual: HEAD is unbuildable; any deploy or `go vet`/`go test` run from `main` fails.
* Production impact: production deploys from `main` will fail at build; any rollback to this SHA fails too. Also signals the promotion flow can merge untested code to the production branch.
* Confidence: HIGH — reproduced locally.
* Status: **FIXED — PR #286 (merged).** Config field restored; `backend` CI lane green on merge.
* Re-verification (agent sweep of all 69 `config.Config` consumers): `FeatureContestantSocialEnabled` is the **only** missing config field — every other `cfg.*` access across handlers/services/tests/`validate.go` resolves. Confirmatory detail: `.github/workflows/staging-module-flags.yml:155` still sets `FEATURE_CONTESTANT_SOCIAL_ENABLED=true` — dead env wiring consistent with the merge-regression theory.

### AUD-BE-002 — Auth middleware fails OPEN on account-status check; every request fans out to Supabase

* Severity: HIGH (fail-open suspension check) + MEDIUM (latency/availability fan-out)
* Component: auth middleware
* Location: `backend/internal/middleware/auth_context.go:50` — `status, _ := rbac.GetUserStatus(id)`; error discarded. `internal/repositories/rbac_supabase_repository.go:21-33` returns `"pending"` on error or missing row.
* Evidence: On any Supabase REST error (timeout, 5xx, PostgREST restart), `GetUserStatus` returns `("pending", err)`; `requireAuth` ignores `err`, so a `suspended`/`locked`/`deleted` account with a still-valid JWT passes the restriction check for the duration of the outage.
* Additionally, each authenticated request performs ~4 sequential remote calls: `supabase.AuthUser(token)` (GoTrue `/auth/v1/user`), `platform_users` status, `user_roles`, and `effective_permissions` RPC — no caching. Every authed endpoint inherits Supabase Auth+PostgREST latency and availability; Supabase REST outage = all authenticated endpoints (including money-path reads) fail open on status and return empty roles/perms.
* Expected: status lookup failure should fail closed (503/401), not degrade to "pending"; per-request lookups should be cached or served from the pgx pool.
* Actual: fail-open status gate; uncached 4-call fan-out per request.
* Production impact: suspended/locked accounts retain access during Supabase incidents; p50 latency of every authed call includes up to 4 sequential network hops; GoTrue outage takes down the entire API.
* Confidence: HIGH for the code path; MEDIUM on real-world likelihood (Supabase availability).
* Status: **FIXED — PR #294 (merged, `c391eebf`).** `RequireAuthContext` returns 503 on `GetUserStatus` errors; restricted statuses still 403; missing-row `pending` preserved.
* Re-verification amplifier: `auth_context.go:62-63` also swallows `GetUserRoles`/`GetUserPermissions` errors → empty role/perm slices (fail-closed for `RequirePermission` but silently degraded). The fail-closed fix pattern already exists — `admin_console_rbac.go:132-138` (AUTH-012) checks `serr` — it was never applied to `requireAuth`. Existing test `auth_context_test.go:158-191` pins the current fail-open behavior.

### AUD-BE-003 — Admin user-list filtering applied AFTER limit (under-fetching) + PostgREST `or` filter built by raw string interpolation

* Severity: MEDIUM (correctness) / LOW (injection risk — admin-only)
* Component: admin user directory
* Location: `backend/internal/repositories/rbac_supabase_repository.go:365-410` (`ListAdminUsers`)
* Evidence: `filter.Limit` (default 100, max 500) is applied in the PostgREST query, then `state`/`program`/`contest`/`school`/`country` filters are applied in-memory in Go — so a filtered listing can silently return far fewer than `limit` matching rows and has no pagination signal. Separately, `filter.Search` is interpolated verbatim into the PostgREST `or=(email.ilike.*%s*,...)` expression; `)`/`,`/`*` characters in a search string alter filter grouping (PostgREST filter-DSL injection) — admin-only surface (`users.view` permission) limits blast radius.
* Expected: filters pushed down to the query (or `profiles` embed constraints), and search term sanitized/parameterized.
* Actual: post-limit in-memory filtering + raw interpolation.
* Production impact: admin console user search silently misses users when scoped filters are used; crafted search strings can distort the admin query (needs admin permission).
* Confidence: HIGH (code-read verified).
* Status: **FIXED — PR #318 (merged, `6162e995`) + PR #330 (merged, `88bd959d`).** PostgREST `or` search pattern quoted/sanitized; scoped filters pushed into PostgREST via `!inner` embed (applies only when a scoped filter is present); the two approaches composed correctly on main — pushdown fixed the under-fetch, sanitize fixed the injection.

### AUD-BE-004 — IP-based controls keyed on spoofable `ClientIP()` (no trusted-proxy configuration)

* Severity: HIGH
* Component: all IP-keyed middleware/handlers
* Location: `backend/internal/app/router.go` — `gin.Default()` used with no `SetTrustedProxies`/`TrustedPlatform` call anywhere in the repo (grep: zero matches). Gin v1.10 defaults to trusting ALL proxies, so `c.ClientIP()` returns the **leftmost** entry of `X-Forwarded-For` — client-injected verbatim (downstream proxies append, never rewrite the head) — attacker-controlled.
* Evidence: `internal/middleware/auth_rate_limit.go:109` keys the login/register/reset limiter on `c.ClientIP()`; `stem_rate_limit.go:31` same; `internal/handlers/auth_handler.go` logs `ClientIP()` into audit/login records and feeds the signup gate + OTP issuance; `internal/connect/onboarding/handler.go` and `kycverify/handler.go:116` store `ClientIP()` as consent/audit IP. A caller can send any `X-Forwarded-For` to rotate the bucket key (defeating rate limits and signup gates) or forge IPs in audit/consent records.
* Re-verification — the blast radius is larger than initially logged:
  * **Security controls keyed on spoofable IP:** `AuthRateLimiter` (login/register/reset), `StemRateLimit` (all STEM groups — additionally keyed on caller-set `x-stem-role` header, second bypass axis), OTP per-IP send/verify Postgres budgets (`otp/service.go:153-160,230-237`), signup gate budget (`otp_routes.go:126-134`), health symptom-search device fallback (`symptomsearch/handler.go:323`).
  * **Suspicious-login engine is poisoned at the source:** `EvaluateLogin` (`session_service.go:303`) builds `EventNewIP`/`EventImpossibleTravel`/`PolicyForceReset` decisions on `c.ClientIP()` — an attacker can suppress new-IP alerts with a fixed forged XFF, or manufacture lockouts by rotating it.
  * **Audit/consent record integrity:** login logs, 16 rbac + 5 admin-mutation audit sites, KYC `RecordConsent` (kycverify:116, connect/onboarding, kyc_connect:243) all persist attacker-supplied IPs; `HasKnownIP` (`session_supabase_repository.go:302`) queries a table self-poisoned by the same bug.
  * **Second, worse extractor:** `registration_handler.go:477-488` `getIPAddress()` reads `X-Forwarded-For[0]` directly, bypassing even Gin's abstraction — used by 9 registration audit sites + payouts/kyc/gifting handlers; its `RemoteAddr` fallback returns unparsed host:port.
  * **Same bug in the second Go module:** `mobile-app/reactnative/backend/internal/api/server.go:409-417` `clientIP()` prefers leftmost XFF with no trusted-proxy check.
  * `StemRateLimit` is also in-memory per-instance and **never evicts** (`stem_rate_limit.go:17-20`, no sweep) — attacker-keyed unbounded map growth.
* Expected: `SetTrustedProxies` pinned to the actual ingress (e.g. Railway/Render/Cloud Run edge ranges) or trusted-platform header config; failing that, `RemoteIP()` for rate limiting.
* Actual: every IP-derived control — rate limits, OTP budgets, signup gate, fraud/travel heuristics, audit and KYC consent records — is spoofable by one header.
* Production impact: credential-stuffing and OTP/quota abuse bypass the (per-instance) rate limiter; audit logs and KYC consent records can carry forged IPs (compliance integrity); suspicious-login engine both evadable and weaponizable; `StemRateLimit` doubles as a memory-growth DoS.
* Confidence: HIGH (Gin default behavior + zero proxy config in repo, re-verified). Caveat: if the deployed edge (Railway/Render) strips client-supplied XFF, exposure is reduced — unverifiable from repo.
* Status: **FIXED — PR #322 (merged, `dd4787ad`).** `TRUSTED_PROXY_CIDRS` → `SetTrustedProxies`; invalid config fails startup; untrusted peers can no longer spoof XFF.

### AUD-BE-005 — `POST /api/auth/change-password` reports success but never changes the password

* Severity: HIGH
* Component: auth service
* Location: `backend/internal/services/auth_service.go:419-438` (`ChangePassword`); caller `backend/internal/handlers/auth_handler.go:501-527`
* Evidence: `ChangePassword` (1) validates min-length on both fields, (2) resolves the user via `supabase.AuthUser(accessToken)`, (3) marks `auth_sessions` rows revoked, (4) returns nil → handler answers `{"success": true, "message": "Password changed"}`. **No call to GoTrue (`PUT /auth/v1/user`) ever updates the password, and `currentPassword` is never verified against anything.** Verified by reading the full function — it ends at line 438 having touched only `auth_sessions`.
* Expected: verify the current password (re-auth), then update the credential at the provider, then revoke sessions.
* Actual: the endpoint is a session-revocation side-effect that lies to the user — the old password keeps working, and (with session-hardening OFF, the default) even the session revocation is cosmetic since GoTrue tokens are unaffected by `auth_sessions` rows.
* Production impact: users believe they rotated a compromised password when nothing changed — a security-relevant UX lie; a stolen bearer token can also invoke it to wipe the `auth_sessions` table for the victim (denial of the session-tracking feature). **Re-verification amplifier:** the handler also writes a `"high"`-severity `password.change` audit-log entry for an event that never happened — the audit trail actively records a falsehood. `AdminSetPassword` exists in the codebase (`integrations/supabase_auth_admin.go:72`) but its only caller is the OTP reset flow — unreachable from `ChangePassword`.
* Confidence: HIGH — direct code read + independent re-verification (no outbound password update exists; `PUT /auth/v1/user` appears nowhere in the backend).
* Status: **FIXED — PR #292 (merged, `94954419`).** `ChangePassword` verifies the current password via GoTrue password grant (`VerifyPasswordGrant`), updates via `AdminSetPassword`, then revokes sessions; covered by `change_password_test.go`.

### AUD-BE-006 — Login/reset use `http.DefaultClient` with no timeout

* Severity: MEDIUM
* Component: auth service
* Location: `auth_service.go:197` (RegisterUser → signup), `:332` (LoginUser → `grant_type=password`), `:396` (RequestPasswordReset → recover) — plus a second instance found on re-verification at `internal/app/insurance_uploads.go:97`.
* Evidence: `http.DefaultClient` has no timeout; a hung/slow GoTrue stalls the request goroutine indefinitely. All other Supabase calls use `SupabaseRestClient` with a 10s timeout (`integrations/supabase_rest.go:22`) — verified consistent.
* Production impact: GoTrue slowness converts into unbounded p99 tail on login/register/reset; no isolation; goroutine accumulation under upstream stall.
* Confidence: HIGH (re-verified).
* Status: **FIXED — PR #304 (merged, `96278884`).** GoTrue calls share a bounded `http.Client` (10s timeout); R2 insurance upload PUT bounded at 30s. Cross-listed as AUD-REL-003.

### AUD-BE-007 — Failed-login counter is a non-atomic read-modify-write

* Severity: LOW–MEDIUM (counter) + **new HIGH edge case discovered on re-verification (see AUD-BE-009)**
* Component: auth lockout
* Location: `auth_service.go:501-509` — reads `failed_login_attempts`, PATCHes `n+1` via PostgREST. Concurrent failures undercount (lost update), extending the effective lockout threshold; its error is also discarded (`_ = s.bumpFailedLogin(user)`), so a failed PATCH silently skips counting entirely; and per-account lockout + spoofable IPs (AUD-BE-004) means a targeted account can be locked by an attacker (email-known DoS).
* Confidence: HIGH.
* Status: **FIXED — PR #326 (merged, `39a502bc`).** Read-modify-write PATCH replaced by the atomic `bump_failed_login_attempts` RPC — increment + lock decision in one UPDATE.

### AUD-BE-009 — Auto-expired account lock becomes a PERMANENT lockout (status never unlatched)

* Severity: HIGH (found during re-verification — new finding, not previously logged)
* Component: `auth_service.go` login flow
* Location: `validateLoginStatus` (~482-499) + the post-login success PATCH (~366-371)
* Evidence (re-verified code path): when `failed_login_attempts` reaches the cap, `bumpFailedLogin` sets `status='locked'` + `locked_until=now+30min`. `validateLoginStatus` allows login once `LockedUntil` has passed — intended self-expiry. **But the successful-login PATCH resets `failed_login_attempts` and `locked_until` to null WITHOUT resetting `status`** — the row stays `status='locked', locked_until=null`. On the *next* login, `status=='locked' && LockedUntil==nil` hits the indefinite-lock branch → "account locked" forever. Only an admin `UnlockUser` (which does reset status, `rbac_supabase_repository.go:298-300`) frees the account.
* Expected: an auto-expired lock self-clears permanently.
* Actual: first login after expiry succeeds, every subsequent login permanently fails — users get locked out for good after a temporary lockout.
* Production impact: any account that survives the 30-min lockout window is permanently bricked on the next login — support-visible, recurring, and silent (the login just reports "account locked" as if still under the temporary penalty).
* Confidence: HIGH — code trace verified by independent re-read.
* Status: **FIXED — PR #298 (merged, `10025679`).** Successful login after an *expired* `LockedUntil` resets `status='locked'` → `'active'` via typed `platformUserLoginPatch`; indefinite admin locks still refused earlier. Covered by `login_lockout_test.go`.

### AUD-BE-011 — Money-initiate handlers reject the documented `Idempotency-Key` header contract (header-only callers 400)

* Severity: HIGH (money-path API contract broken)
* Component: `backend/internal/finance/transfers/{model,handler}.go` (`WalletTransferRequest`, `BankTransferRequest`, `BankToBankRequest`), `backend/internal/finance/fx/{model,handler}.go` (`ConvertRequest`)
* Evidence (executed on live stack, 2026-09-30): `POST /api/finance/transfers/paymax` with `Idempotency-Key` header and a complete body → `400 Key: 'WalletTransferRequest.IdempotencyKey' ... 'required' tag`. Root cause: `idempotency_key binding:"required"` on the struct runs in `ShouldBindJSON`, and the header merge (`header wins`) executes **after** the bind — so header-only callers never reach it. `fx.Convert` additionally never read the header at all. Contracts tell clients to send the header; conforming clients get a hard 400 on every transfer.
* Fix: fields no longer binding-required; handlers merge the header first, then 400 only when no key exists from either source. `fx.Convert` now merges the header too.
* Status: **FIXED — PR #369 (merged).** Handler-level specs pin header-only acceptance + no-key 400 on all four surfaces.

### AUD-BE-012 — `wallet_transfers` column-name drift: every wallet→wallet transfer 500s

* Severity: HIGH
* Component: `backend/internal/finance/transfers/service.go` (INSERT ~293, replay SELECT ~636) vs `supabase/migrations/20260616100000_wallet_transfers.sql`
* Evidence (executed on live stack): `POST /api/finance/transfers/paymax` → `500 transfers: insert wallet_transfers: ERROR: column "recipient_id" of relation "wallet_transfers" does not exist (SQLSTATE 42703)`. The migration created `receiver_id`; the code used `recipient_id` (the `bank_transfers` column name — that table genuinely has `recipient_id`). The idempotent-replay lookup selected the same wrong column → replays 500'd too. **Every wallet-to-wallet transfer was dead on main.**
* Fix: both sites corrected to `receiver_id`. Verified live: `201` on first send; identical replay returns `200 already_processed:true` with exactly one ledger effect (sender balance 500,000,000 → 499,900,000 kobo, debited once).
* Status: **FIXED — PR #369 (merged)** (same PR; both defects were found by the same endpoint drill).

## Frontend Findings

### AUD-FE-001 — Production EAS build profile lacks required env (API base URL + Supabase)

* Severity: **CRITICAL** (if EAS project-level env does not supply them — not verifiable from repo)
* Component: mobile-app build configuration
* Location: `mobile-app/reactnative/eas.json` — `build.production.env` contains only `EXPO_PUBLIC_SENTRY_ENVIRONMENT`, `EXPO_PUBLIC_CLOUDINARY_CLOUD_NAME`, `SENTRY_DISABLE_AUTO_UPLOAD`. Missing: `EXPO_PUBLIC_API_BASE_URL`, `EXPO_PUBLIC_SUPABASE_URL`, `EXPO_PUBLIC_SUPABASE_ANON_KEY`, `EXPO_PUBLIC_APP_ENV`.
* Evidence (re-verified): `src/api/client.ts:9` defaults the API base URL to `http://localhost:3000` when `EXPO_PUBLIC_API_BASE_URL` is unset, and `getDevUrl` (`src/lib/devUrl.ts:25`) bypasses rewriting outside `__DEV__` — so a release binary literally targets the device's own loopback. `src/lib/supabase.ts:28-31` throws `'Supabase is not configured'` — lazily, on first `createSupabaseClient()` call (not at module init; ~90 call sites, most without try/catch → unhandled rejection on first auth/data call rather than a boot crash). Staging profiles DO set all of these; `app.json` `extra` provides no fallback; only `vercel.json` maps the vars — for the web export, not EAS native builds.
* **Amplifier (new, re-verification)**: `src/config/mockPolicy.ts:13-18` — `isMocklessEnvironment()` defaults `EXPO_PUBLIC_APP_ENV` to `'development'`; a production build missing it is classified as development, so `mockAllowed()` honors mock flags and unset `*_USE_MOCK` vars fall to module defaults (many `true`) → a prod binary could serve **mock data AND localhost** simultaneously. The same localhost-fallback bug class is documented in-code as having shipped before (`connect/constants/connect.constants.ts:24-29` — release APKs resolving to `localhost:8091`).
* Expected: production profile carries production API + Supabase URLs.
* Actual: absent from the committed profile — relies entirely on EAS cloud env vars which are not in the repo.
* Production impact: a production `eas build -p android --profile production` yields an app whose API client targets `http://localhost:3000` and whose Supabase client throws on first call → total app failure at launch; mock-policy misclassification can additionally serve fake data. If EAS project env vars fill the gap, they are undocumented and unauditable here.
* Confidence: HIGH for the repo state; MEDIUM for actual release breakage (EAS dashboard env could compensate).
* Status: **FIXED — PR #311 (merged, `2a5ebae8`).** Release builds fail loudly when the API base URL is unset; the EAS prod profile carries the required `EXPO_PUBLIC_*` vars.

### AUD-FE-002 — Duplicate `staging-aab` key in eas.json — effective profile loses `SENTRY_DISABLE_AUTO_UPLOAD`

* Severity: LOW (revised after independent re-verification — original claim of a lost Supabase anon key was **REFUTED**)
* Component: mobile-app build configuration
* Location: `mobile-app/reactnative/eas.json` — `"staging-aab"` appears at lines ~58 and ~75. JSON parsers keep the LAST occurrence.
* Evidence (re-verified): BOTH definitions carry `EXPO_PUBLIC_SUPABASE_ANON_KEY` (lines ~70 and ~87, same JWT) and identical API/Supabase URLs. The only diff: the losing first definition sets `SENTRY_DISABLE_AUTO_UPLOAD: "true"`; the winning second does not.
* Expected: unique profile keys.
* Actual: duplicate key — the first definition is dead JSON; effective profile runs Sentry sourcemap auto-upload during staging AAB builds (build-time noise/failure risk if SENTRY_AUTH_TOKEN/org vars are absent — not a runtime config loss).
* Production impact: minor — heavier/noisier staging builds, possible Sentry upload failures; NOT an auth break.
* Confidence: HIGH — independently re-verified.
* Status: **FIXED — PR #295 (merged).** Duplicate `staging-aab` block removed; single profile retains `SENTRY_DISABLE_AUTO_UPLOAD`.

### AUD-FE-003 — Client-initiated Paystack charges ("paymax_gateway") fulfil orders on the client callback; webhook only logs

* Severity: HIGH
* Component: mobile food/voting checkout
* Location: `frontend-web/app/api/webhooks/paystack/gateway-handler.ts:108-112` — comment: "the domain fulfilment the client performed on its success callback"; `TODO: when food/voting move to server-initiated orders, look the pending record up by reference here and settle it server-side`.
* Evidence: for `metadata.purpose === 'paymax_gateway'` charges (created by the client-side Paystack Inline SDK), the webhook verifies signature + re-verifies with Paystack, then merely marks `payment_webhook_logs.processed`. Fulfilment (crediting the vote/order) is triggered by the mobile client calling a verify endpoint on its own success callback — if the app crashes / network drops / user backgrounds the app after Paystack collects, the payment is verified but never fulfilled, and no webhook-driven fulfilment exists to close the gap. The code self-documents the gap: `gateway-handler.ts:111-115` contains a TODO acknowledging that fulfilment relies on the client's success callback.
* Re-verification narrowing: the `paymax_gateway` scope is smaller post-ADR-041 — the wallet top-up card rail was re-plumbed to a server-initiated flow (webhook credits wallet → client polls `waitForTopup`). Residual exposed producers are `film-academy/{tuition,apply}` on mobile and `newTransaction` callers in frontend-web (OpenMicVoteModal, RealityTvShowApplicationWizard, ContestRegistrationWizard, film-academy pages) — most don't even set the `paymax_gateway` marker, so the gateway handler doesn't claim them either; they rely entirely on per-domain client verify calls. Also: **no reconciliation/sweep job exists** — `payment_webhook_logs` has only writers, no reader that re-drives orphaned charges.
* Expected: server-authoritative fulfilment for money events (webhook or guaranteed reconcile job).
* Actual: client-triggered fulfilment with a server-side audit log only; no reconciliation job observed for orphaned gateway charges.
* Production impact: paid-but-unfulfilled orders/votes whenever the client fails between charge and callback — a real-money support load and potential double-pay on user retry.
* Confidence: HIGH for the architecture; MEDIUM on frequency (mitigated if verify endpoint is also reachable via retry UI).
* Status: BUG — partial fix merged: **PR #336** (`4ceab866`, webhook fulfils `paymax_gateway` vote charges server-side via the idempotent bridge). Other gateway domains still rely on client verify — residual open.

### AUD-FE-004 — Webhook dispatcher swallows handler failures (always-200) with no dead-letter

* Severity: MEDIUM
* Component: `frontend-web/app/api/webhooks/paystack/route.ts`
* Evidence: `Promise.allSettled` over six handlers; failures produce `processed: false` in a 200 response. Paystack will not retry a 200. A transient DB failure inside `handleWalletTopupWebhook` → event permanently unprocessed by webhook path.
* Re-verification fallback matrix (which domains self-heal vs lose events):
  * **Vote** — fallback: client `POST /api/v2/votes/paid/verify` (same idempotent service). ✅
  * **Wallet topup** — fallback: verify-on-read `GET /api/v1/wallet/topup/[reference]` (fail-closed; mobile polls every 3s). ✅
  * **Utility** — fallback: `POST /api/v1/utility/paystack/verify` + callback use the same verify fn. ✅
  * **DVA inbound** — `creditWallet` with ledger idempotency key, but **no re-verify path found** — a dropped event = uncredited inbound transfer. ❌
  * **Bank transfers** — status updates + balanced reversal legs, but **no status-poll re-verify**. ❌
  * **Gateway** — logs only, no fulfilment at all (AUD-FE-003). ❌
* Bonus defect found on re-verification: the **vote and gateway handlers share one `payment_webhook_logs` row** keyed `(provider, reference, event_type)` — for a `paymax_gateway` `charge.success`, whichever handler marks `processed` first causes the other to return `duplicate:true` at its dedup check and skip verification entirely — a race inside the parallel `allSettled` fan-out.
* Signature nuance: the dispatcher itself does **not** verify — each of the six handlers verifies HMAC-SHA512 as its first act (no state change pre-verification), but the TS comparisons use `===`/`!==` (non-constant-time). The Go pipeline (`/api/webhooks/paystack/go`) verifies with `hmac.Equal` pre-dispatch — correct.
* Production impact: silent settlement gaps for events whose domain lacks a verify/reconcile path.
* Confidence: HIGH.
* Status: **FIXED — PR #310 (merged, `67277290`).** Rejected handler results now surface 500/400 to Paystack for retry instead of a blanket 200. Cross-listed as AUD-REL-002.

### AUD-FE-007 — `vote-callback` page sends no `transactionId`; the `/api/v2/votes/paid/verify` it calls requires one → browser verify is expected to fail every time

* Severity: HIGH (found on re-verification — new finding)
* Component: `frontend-web/app/vote-callback/page.tsx` + `src/components/voting/VoteModal.tsx`
* Evidence: `VoteModal.tsx:86` sets `callbackUrl: ${origin}/vote-callback` with **no `transactionId`**. Paystack's redirect appends only `trxref`/`reference`. The page reads `transactionId` (line 21), gets `null`, sends `transactionId: ''` (line 34), and `/api/v2/votes/paid/verify` 400s at lines 19-24 — the page unconditionally renders "Payment Not Confirmed" + "No votes were added. You have not been charged" even when the webhook already credited the votes. No code path in the repo appends `transactionId` to that callback URL. Compounding: the `failed` branch's "you have not been charged" copy directly contradicts the network-error branch's "your payment may still have processed" — a paid voter is told they weren't charged.
* Expected: the callback URL carries whatever identifier the verify endpoint requires (or the endpoint resolves by `reference`).
* Actual: every browser-redirected paid voter lands on the failure screen; fulfilment relies on the webhook having already won the race (AUD-DB-002 non-atomic path).
* Production impact: every successful paid-vote purchaser sees a failure message telling them they weren't charged — support load, dispute/chargeback risk, duplicate-payment attempts by users retrying.
* Confidence: HIGH on the code path (static); MEDIUM on live behavior — if the deployed Paystack appends extra params or an untraced path injects `transactionId`, the symptom may differ; a live check is recommended.
* Status: **FIXED — PR #308 (merged, `e02e6166`).** The verify route resolves `transactionId` from `payment_reference` server-side when absent; the atomic `credit_paid_vote_transaction` RPC path is unchanged. Duplicate attempt #309 closed.

### AUD-FE-008 — Utility beneficiary routes proxy to Go unconditionally (missed by the fd91af5d dual-path fix)

* Severity: MEDIUM (found during AUD-TEST-001 investigation — new finding)
* Component: `frontend-web/app/api/v1/utility/beneficiaries/route.ts` (GET/POST) and `beneficiaries/[id]/route.ts` (DELETE)
* Evidence: every other utility read route (`categories`, `billers`, `operators`, …) follows the `utilityBillsGoProxyEnabled()` dual-path contract established by `fd91af5d` — local `src/server/utility/service.ts` when the flag is off, Go proxy when on. The three beneficiary operations were missed: they called `proxyToGoBackend` unconditionally, so they 404/5xx in every deployment where the Go utility-bills flag is off (the default).
* Expected: beneficiaries GET/POST/DELETE follow the same flag-gated dual path as sibling routes.
* Actual: unconditional proxy; dead endpoints wherever the Go flag is off.
* Production impact: beneficiary management broken in any environment without the Go flag; invisible because these routes had no spec coverage.
* Confidence: HIGH — direct code read; sibling routes compared side-by-side.
* Status: **FIXED — PR #291 (merged).** All three ops restored to dual-path (local service functions `listUtilityBeneficiaries`/`saveUtilityBeneficiary`/`deleteUtilityBeneficiary` from pre-proxy `c9c5baa7` when flag off; Go proxy when on). Covered by new `tests/unit/utility/beneficiaries.spec.ts` (7 tests).

### AUD-INFRA-010 — Two Paystack webhook receivers exist at different paths; whichever URL the Paystack dashboard points at leaves the other pipeline's fulfilments dead

* Severity: MEDIUM
* Component: payment webhook routing
* Location: Next.js `frontend-web/app/api/webhooks/paystack/route.ts` (six handlers) vs Go `internal/webhooks/paystack.go` mounted at `finance_routes.go:968` → `POST /api/webhooks/paystack/go`
* Evidence (re-verification): both receivers are live code but at *different* paths — they don't compete for a route, they compete for the single Paystack dashboard webhook URL (external config, not repo-verifiable). Docs consistently designate the Next.js route as the live receiver (CLAUDE.md:93, `docs/PLATFORM_OVERVIEW.md:60`, observability/incident runbooks). Consequences either way:
  * If dashboard → Next.js: the Go dispatcher's fulfilments — `feespay:`/`foodorder:`/`rideorder:`/`duespay:` confirmers, DVA `CreditInbound`, Go wallet topup, `transfer.*` status — never fire from Paystack events; those flows survive only on client-polled self-heal endpoints.
  * If dashboard → `/go`: the Next.js Supabase-side fulfilments (vote credits, wallet_topup settle, utility, bank_transfers) never fire.
  * If a proxy fans out to both: wallet top-ups use **different idempotency keys** in the two pipelines (`topup:<intentId>:CREDIT` vs `paystack:topup:<reference>`) → dual delivery would double-post unless a DB constraint catches it.
* Production impact: one entire fulfilment plane is structurally dead depending on one dashboard setting; drift risk is invisible in-repo.
* Confidence: HIGH for the routing structure; the live dashboard URL is UNVERIFIED (external).
* Status: **FIXED — PR #338 (merged, `e42563e1`).** Go-exclusive Paystack events forwarded to the Go receiver.

### AUD-FE-005 — Admin API-key path lets the holder self-declare any admin role

* Severity: MEDIUM
* Component: `frontend-web/src/server/admin/auth.ts` (`assertAdminPermission` path (b))
* Evidence: when `x-admin-key` matches `SPOTLIGHT_ADMIN_API_KEY`, the role is taken verbatim from caller-supplied `x-admin-role`/`x-spotlight-role` headers, and `x-actor-id` populates audit attribution — **no server-side role lookup on this path**. `parseAdminRole` accepts the alias `admin` → `super_admin`, so a key holder sending `x-admin-role: admin` obtains *every* permission including `finance:refund`, `finance:adjust:approve`, `roles:manage`, with forged `x-actor-id` attribution. Mitigating factor (re-verified): the key path is skipped entirely when `SPOTLIGHT_ADMIN_API_KEY` is unset; the admin-proxy (`frontend-admin/app/api/admin-proxy/[...path]/route.ts`) strips `x-admin-key`/`x-admin-role`/`x-actor-id` from outbound headers and enforces a session first — so the hole is reachable only by direct callers holding the shared key.
* Production impact: key compromise = self-declared full admin + spoofed audit identity; legitimate key-holders can inflate attribution; audit trail trust reduced.
* Confidence: HIGH (independently re-verified, including the admin→super_admin alias at `src/server/admin/rbac.ts:107-122`).
* Status: **FIXED — PR #328 (merged, `5cfc3e07`).** API-key admin role capped by the `SPOTLIGHT_ADMIN_API_KEY_ROLE` env ceiling; declared roles may narrow but never exceed; audit actor fixed.

### AUD-FE-006 — Shared `handleApiError` swallows all unexpected errors with no log or Sentry capture

* Severity: HIGH (observability)
* Component: `frontend-web` BFF error handling
* Location: `frontend-web/src/lib/api/responses.ts` `handleApiError()`
* Evidence: `handleApiError` has **1068 call sites** across `app/api/**`. For any error that is not an `ApiError`/`UNAUTHORIZED`/`FORBIDDEN` it returns `{ success:false, error:"Internal server error" }` — and does **zero** `console.error`, no `Sentry.captureException`, no structured log of the original error, stack, or context. The Sentry SDK (`@sentry/nextjs` in package.json) never sees these errors because the helper catches them first.
* Reproduction: `grep -n "console.error\|captureException\|Sentry\|logger" src/lib/api/responses.ts` → no matches.
* Expected: unexpected server errors in API routes must be captured (Sentry or at least `console.error` with route/context) before returning a generic 500.
* Actual: every upstream failure (Supabase down, R2 timeout, Paystack error, unhandled throw) in 500+ routes is invisible server-side; only the client sees a bare 500.
* Production impact: at 3 AM a payment/KYC/vote failure has **no diagnostic trail** — no error fingerprint, no stack, no correlation. Support tickets become un-debuggable.
* Confidence: HIGH.
* Status: **FIXED — PR #287 (merged).** `handleApiError` now logs unexpected errors (`[api] Unhandled route error:`) and calls `Sentry.captureException` behind a try/guard; response contract unchanged. Covered by `tests/unit/api/responses.spec.ts` (7 tests).

## Backend Findings (continued)

### AUD-BE-008 — Notification queue has producers but no consumer is ever started

* Severity: HIGH
* Component: `backend/internal/platform/queue`, `internal/notifications`
* Evidence: `finance_routes.go` (lines 1219, 1655, 3226, 3328) and `health_triage_routes.go:71` create `queue.NewClient` and enqueue push/email/SMS tasks; `notifications.Service.Send` builds tasks with `asynq.MaxRetry(3)`; `notifications.Workers(mux, cfg)` registers handlers for `TypeNotificationPush/Email/SMS`. But `grep -rn "queue.NewServer\|notifications.Workers\|asynq.NewServeMux" cmd/ internal/ --include="*.go" | grep -v _test` → **zero callers**. No binary in `cmd/` (server, marketplace-indexer, marketplace-cron, transport-scheduler, fxsmoke) starts an asynq worker.
* Expected: an asynq server consuming the `critical/default/low` queues the client enqueues to.
* Actual: tasks land in Redis and are never processed — every enqueued push notification, email, and SMS is silently undelivered; Redis accumulates dead tasks.
* Production impact: estate/finance/health notifications that rely on the queue path never reach users; Redis memory grows unboundedly with orphaned tasks; combined with INFRA-006 (no worker deployed anywhere) the entire async notification plane is inert.
* Confidence: HIGH — producers and the worker-registration function exist; the only missing piece is that nothing ever calls them.
* Status: **FIXED — PR #297 (merged, `732d4860`).** New `cmd/notification-worker` binary consumes the asynq queue (push/email/SMS handlers, SIGTERM drain); `in_app` no longer aliases to a duplicate push task; worker HTTP client bounded (15s).

**Amplifier (independent re-verification):** `notifications.Service.Send` defaults `Channels` to `{push, in_app}` and `taskTypeForChannel` maps `in_app` → `TypeNotificationPush` via the `default` branch (`service.go:67,133`) — even once a consumer exists, every default notification produces **two duplicate push tasks**, and no task carries an `asynq.TaskID` dedup key. Also: `ProviderConfig` (Resend/Termii/Expo creds) has no config plumbing — nothing maps env vars to it, so even a started worker would run unconfigured. Producer sites verified live: estate pushes, restaurant order/chat events, invest price alerts, fractionalre notifier, health triage escalations — all gated on `RedisURL != ""`, and `RedisURL` defaults to `redis://localhost:6379` so enqueue attempts happen whenever Redis is reachable.

## Database Findings

### AUD-DB-001 — RLS gate runs in CI but with asymmetric branch coverage (original "manual-only" claim **REFUTED** on re-verification)

* Severity: LOW (revised from MEDIUM — the gate exists and runs; coverage is asymmetric)
* Component: `Makefile` `rls-check`, `integration-verify.yml`, `ci.yml`
* Evidence (independent re-verification overturned the initial claim):
  * `Makefile:84-87` — `migrate-reset` invokes `$(MAKE) rls-check` as its final step; `rls-check` queries live `pg_class.relrowsecurity` with allowlist `spatial_ref_sys`.
  * `integration-verify.yml:174-175` — the `migrate-reset` step ("Migration fresh replay from zero (clean-apply + RLS check)") runs inside a job with a real `postgis/postgis:17` Postgres service — so **rls-check executes on every push to `main` and every PR**. The original finding missed the `migrate-reset → rls-check` indirection.
  * Residual gaps that are real: (a) `ci.yml`'s develop/staging/prod lanes run `make migrate-up` only — **no reset/RLS check on develop**; (b) `check-migration-versions.sh` runs only in ci.yml's `hygiene` lane (develop/staging/prod + dispatch) — **never on `main`**; (c) `make verify` is invoked by no workflow.
* Expected: both the collision check AND the RLS check run on every deployable branch.
* Actual: RLS check runs on main/PRs only; migration-version-collision check runs on develop/staging/prod only — each gate covers a different half of the branch topology.
* Production impact: a version-collision PR merged straight to `main` bypasses `check-migration-versions.sh`; an RLS-less table merged on `develop` is caught only when it reaches `main`/`integration-verify`.
* Confidence: HIGH (re-verified).
* Status: MISSING CONTROL (asymmetric coverage) — corrected. Main-side collision coverage **FIXED — PR #331 (merged, `8384aa80`)**; the deliberate develop-only push gap remains a documented minutes-vs-cost tradeoff.
* Migration version-collision check against the committed tree: **0 duplicate timestamp prefixes across 568 files** — clean at HEAD.

### AUD-DB-002 — Paid-vote fulfilment: credit flag is written BEFORE the votes; crash leaves an **unrecoverable** "credited-but-empty" tx; TOCTOU double-credit on concurrent verify

* Severity: HIGH (revised from MEDIUM on re-verification — self-heal assumption was wrong)
* Component: `frontend-web` paid-vote verify path
* Location: `src/server/voting/paid-vote.service.ts` `verifyAndCreditPaidVote` (lines 158-362)
* Evidence (re-verified, corrected from initial claim):
  * Actual sequence: (1) load tx; (2) `resolveIdempotency`→`lookupCached` reads `vote_credit_status` — **no atomic claim**; (3) Paystack `/verify`; (4) ±₦1 amount match; (5) **UPDATE sets `payment_status='successful', vote_credit_status='credited'`** (lines 268-279) — the credited flag is written *before* any vote exists; (6) `votes.insert` (282-298); (7) `increment_vote_totals` RPC — atomic in SQL (301-304); (8) `issueReceipt`. No `recompute_leaderboard_ranks` step exists in this path (my original claim's step 7 was wrong — stored `rank` goes stale after every paid vote; list order is live-computed, mitigating).
  * **Unrecoverable crash window:** crash between steps 5 and 7 leaves `vote_credit_status='credited'` with no `votes` row and no totals increment. Re-verify sees `'credited'` → returns `{success:true, alreadyProcessed:true}` — a **false success**; the votes are permanently missing until manual SQL.
  * **TOCTOU double-credit:** two concurrent verify calls (webhook + browser redirect — the documented PV-005 race) both read `'pending'`, both pass, both insert + increment. No claim/status predicate closes the window.
  * **Refund replay re-credit:** after admin refund (`payment_status='refunded'`), the guard at line 199 checks only `'failed'|'abandoned'` — a replayed callback re-verifies (Paystack still returns success on refunded charges) and inserts a second `votes` row + totals increment.
  * Mitigation exists but is flag-gated OFF: `/api/v2/votes/paid/verify` → `bridgedVerifyPaidVote` → atomic `credit_paid_vote_transaction` RPC (`FOR UPDATE` + status flip + vote insert + totals upsert in one tx, `supabase/migrations/20270211000000_*.sql`) — only when `VOTES_BRIDGE_ENABLED=true` (default false). The webhook path (`payment/webhook.ts:132`) and the old `/api/votes/paid/verify` always use the legacy non-atomic function regardless of the flag.
* Expected: fulfilment committed atomically, or a recoverable state machine.
* Actual: non-atomic sequence with a poisoned-credit-flag failure mode that self-healing cannot repair.
* Production impact: paid votes permanently lost on a mid-flight crash (financial integrity + support burden); double-credits on webhook+redirect races; re-credit after refund.
* Confidence: HIGH — full function trace verified by independent re-read.
* Status: **FIXED — PR #329 (merged, `73c4916c`).** Unique paid-votes-per-transaction index + terminal-state transition trigger, additive.

### AUD-DB-003 — Voting money math uses NGN floats; ledger path uses integer kobo — two money conventions coexist

* Severity: LOW
* Component: `frontend-web/src/server/voting/*` vs `backend/internal/finance/*`
* Evidence: `amountExpected` in `paid-vote.service.ts` is a `number` in Naira (`amountExpected * 100` for kobo at the Paystack boundary, `Math.round` applied). The ledger iron rule (integer kobo, never floats) applies to `internal/finance` but the Spotlight voting module predates it and keeps float NGN through pricing, comparison, and storage.
* Production impact: bounded float error on vote pricing (sub-kobo) — cosmetic for votes, but two money conventions in one codebase invite copying the wrong one into a wallet-path feature.
* Confidence: HIGH.
* Status: OBSERVATION / RISK (convention drift, not a live bug) — boundary ADR merged: **PR #362** (`e5e17057`, float NGN stays inside protected voting; integer kobo enforced at the adapter seam).

## Security Findings

### AUD-SEC-001 — Frontend rate limiting: in-memory per-instance, spoofable IP keying, dead helper, sparse coverage

* Severity: MEDIUM
* Component: `frontend-web` API layer
* Location: `src/lib/voting/rate-limit.ts` (token-bucket `Map`), `src/lib/rate-limit/server.ts` (`enforceRateLimit` — **0 call sites**, dead code)
* Evidence:
  * Only ~5 route groups limit at all: `votes/free` (+v2), `utility/*`, `registration …/payment/*`, `bills/*`.
  * **`app/api/votes/paid/initiate` has no limiter** — unauthenticated callers can spam payment initializations; each creates a transaction row + Paystack initialize call (upstream cost/quota exposure).
  * Both limiters key on `x-forwarded-for` first value (`getClientIp`) — attacker-controllable on any proxy chain that doesn't sanitize inbound XFF (same class as AUD-BE-004).
  * In-memory `Map` → limits reset on every instance start and multiply by replica count; Cloud Run/Vercel instances each hold their own bucket.
* Re-verification amplifiers (independent agent):
  * **Wider un-limited surface:** `votes/paid/verify` (v1+v2), `votes/paid/wallet`, `v2/votes/wallet` — **wallet-debit money paths** — and all authenticated `/api/finance/*`, `/api/v1/admin/*` routes have no limiter. `votes/paid/initiate` is confirmed unauthenticated *and* un-limited.
  * **Free-vote anti-abuse collapses too:** `free-vote.service.ts:40-42` — when `voting_settings.free_vote_limit_scope='ip'`, the *daily* free-vote cap is keyed on the same XFF-derived IP, so rotating XFF defeats both the minute-bucket limiter and the daily allowance; fraud scoring (`core/fraud.ts`) also keys `duplicate_ip` on it — forged IPs both evade detection and poison the fraud ledger.
  * `voting/rate-limit.ts` has no hard size cap — attacker-rotated keys grow the Map unbounded between 5-min sweeps (and the `setInterval` pruner never fires on frozen serverless instances).
* Production impact: abuse controls weaken exactly under the load they're meant to shed; spoofing gives unlimited retries per request; money paths un-limited; free-vote daily cap bypassable.
* Confidence: HIGH (re-verified).
* Status: RISK + OBSERVATION — partial fixes merged: **PR #315** (`f7ba24de`, backend `SetTrustedProxies`), **PR #327** (`e1ca74ca`, bucket-map cap + proxy-aware IP keys + dead `enforceRateLimit` removed); **PR #346** (merged, `3105dd07`) adds a per-client ceiling at the `proxyToGoBackend` choke point covering ~147 un-limited `/api/v1/*` routes. Residual open: per-instance in-memory buckets reset per replica, and legacy-protected voting routes (`votes/paid/initiate` etc.) still cannot gain limiters without touching protected files.
  * **Backend vote money paths closed (2026-10-02, PR pending):** `POST /api/v1/connect/contests/:id/vote` (30/min), `POST /api/v1/connect/contests/:id/paid-vote` (10/min), and `POST /api/finance/vote-bridge/debit` (10/min) now run behind `middleware.PerUserRateLimit` — the maps limiter generalized with a key prefix, Redis `INCR+EXPIRE` fixed window (cross-instance) when Redis is connected, in-memory per-replica fallback otherwise, keyed on authenticated `user_id` (not spoofable `ClientIP`). Env-tunable via `CONNECT_FREE_VOTE_RATE_PER_MIN` / `CONNECT_PAID_VOTE_RATE_PER_MIN`. Residual narrows to the frontend-web legacy `votes/paid/*` routes.

### AUD-SEC-002 — Dependabot/dependency-audit posture unknown for npm modules; govulncheck blocks for Go

* Severity: LOW
* Component: dependency health
* Evidence: `security.yml` runs blocking `govulncheck` for both Go modules and advisory CodeQL (`continue-on-error: true`, flagged in-file as intentional until backlog clears). No `npm audit`/Dependabot config was found in `.github/` for `frontend-web`, `frontend-admin`, or `mobile-app/reactnative` — three large npm surfaces are unscanned for CVEs.
* Confidence: MEDIUM (absence of config found; GitHub-side Dependabot settings are not visible in-repo).
* Status: **FIXED — PR #342 (merged, `eb767724`).** Dependabot now covers all 16 manifest dirs (+vue-quasar npm, +tools/fakes gomod, +6 Dockerfiles incl. the root image).

### AUD-SEC-002b — `npm audit` on `frontend-web`: 8 advisories, all in dev/test tooling

* Severity: LOW
* Evidence (executed 2026-09-30): `npm audit --audit-level=high` → 8 vulnerabilities (5 high, 3 moderate): `brace-expansion` DoS (eslint/glob chains), `vitest`/`@vitest/mocker` path-traversal, `js-yaml` merge-key DoS, `fast-uri` host normalization, `eslint-config-next` chain. All reachable only through dev dependencies (eslint, vitest, rimraf) — no production-runtime advisories in the output.
* Production impact: none at runtime; CI/dev-machine exposure only. Worth a Dependabot/`npm audit` lane so this doesn't silently accumulate.
* Confidence: HIGH.
* Status: **PARTIALLY FIXED — PR #323 (merged, `1a7d8bd5`); residual reduced by PR #378.** Production advisories cleared in #323. Re-audit 2026-10-01 found 7 dev-tooling advisories; #378 cleared 4 non-breaking (`brace-expansion`, `js-yaml`, `vitest`, `@vitest/mocker`). **3 highs remain** — the `eslint-config-next@14 → @next/eslint-plugin-next → glob@10` chain, fixable only by `eslint-config-next@16.3.8`, a semver-major against Next 14.2 (would need a dedicated eslint-flat-config/Next-16 review, not `npm audit fix --force`). These still fail the `npm audit` CI lanes repo-wide — a known, documented baseline.

### AUD-SEC-003 — `NEXT_PUBLIC_ADMIN_API_KEY` referenced by seven client-side service modules (dead code today, latent secret leak)

* Severity: MEDIUM (latent HIGH)
* Component: `frontend-web/src/services/{analyticsService,handoffService,stemService,realityTvService,leadsService,chatbotService,competitionsService}.ts`
* Evidence: each service attaches `x-admin-api-key: process.env.NEXT_PUBLIC_ADMIN_API_KEY` to requests — the same header `RequireAdmin` compares against `ADMIN_API_KEY` on the backend (`internal/middleware/admin_auth.go:50`). `NEXT_PUBLIC_*` vars are inlined into any client bundle that imports them. Re-verification confirmed the dead-code status **exhaustively**: zero importers anywhere in `frontend-web` (searched module paths, every exported function name, dynamic imports); there is no `app/admin/` tree in frontend-web at all; `frontend-admin/src` has no `x-admin-api-key` client code left — it routes through `/api/admin-proxy` which strips the header. The key is **not** in a shipped bundle today; the `NEXT_PUBLIC_` prefix is a loaded footgun for the first future import.
* Also relevant: `RequireAdmin` warns that unset `ADMIN_API_KEY` leaves admin endpoints UNGATED in dev (`admin_auth.go:38`), and the production layering adds `RequireAdminConsoleRole`/`RequireVerifiedIdentity` — so the leaked key alone is *not* sufficient for `/admin/*` groups, but it is one of two factors on all of them and the sole factor on any route gated only by `RequireAdmin`.
* Expected: a shared admin secret must never carry the `NEXT_PUBLIC_` prefix; client-side code must never know it.
* Actual: naming makes accidental publication one import away.
* Confidence: HIGH (references verified); exposure severity depends on future imports — currently UNVERIFIED as shipped-to-bundle.
* Status: **FIXED — PR #300 (merged, `3a1fee9a`).** All seven dead modules deleted; zero remaining `NEXT_PUBLIC_ADMIN_API_KEY` references.

### AUD-AUTH-001 — Auth-backend outages misreported as `401 invalid token` (session-expiry semantics on infrastructure failure)

* Severity: HIGH
* Component: `backend/internal/integrations/supabase_http.go` (`AuthUser`), `backend/internal/middleware/auth_context.go`, `backend/internal/middleware/admin_console_rbac.go`, `backend/internal/services/auth_service.go`
* Evidence (executed on the live local stack — Supabase + compose API + Redis, first real finding the integration environment produced):
  * 200-VU k6 ramp against the running API: **48.97% of authenticated calls returned 401** (5,874/11,994 requests) — transient GoTrue/Kong blips surfaced as session invalidation.
  * `docker stop supabase_kong_spotlight` → authenticated request answered `401 invalid token` in ~3ms (should have been a service-unavailable signal).
  * Postgres paused → request hung ~10s → `401`.
* Root cause: `AuthUser` collapsed every failure — transport errors, timeouts, GoTrue 5xx, Kong 429 — into a generic error, and both auth middlewares mapped any error to `401 invalid token`. Any SPA that force-logs-out on 401 mass-ejects every logged-in user during a transient Supabase blip.
* Expected: definitive token rejection → 401; upstream/transport failure → 503 so clients retry/back off instead of discarding sessions.
* Fix: `AuthUser` returns `ErrTokenInvalid` only on a definitive GoTrue 401/403; `RequireAuthContext` + `resolveVerifiedIdentity` map that to 401, everything else to `503 authentication service unavailable`; `ChangePassword` distinguishes likewise.
* Verified live: Kong stopped → `503` in 17ms; Kong restored → `200`. Unit specs pin both branches (upstream 5xx → 503, conn-refused → 503, definitive 401 → 401).
* Status: **FIXED — merged via PR #367.**

## Infrastructure / DevOps Findings

### AUD-INFRA-001 — World-open Redis and Postgres in render.yaml

* Severity: HIGH (risk) / MEDIUM (if unused)
* Component: deployment blueprint
* Location: `render.yaml` lines 154-157, 181-183
* Evidence: `spotlight-redis` (type: redis, starter plan) has `ipAllowList: [{source: 0.0.0.0/0}]`; `spotlight-db` Postgres (starter, PG15, user `postgres`) has `ipAllowList: [{source: 0.0.0.0/0}]`. CLAUDE.md states the real DB is Supabase-hosted PG17 — so this blueprint either (a) creates an internet-exposed Redis with no documented auth, and (b) creates a world-open Postgres database that the app may or may not actually use.
* Expected: Redis/Postgres never exposed to `0.0.0.0/0`; single documented DB authority.
* Actual: blueprint defaults to open allowlists with only a comment "restrict in production".
* Production impact: if applied, an unauthenticated (Render Redis has no ACL auth by default) Redis reachable from the internet exposes the idempotency/asynq/SSE data plane; the Postgres is reachable with a single `postgres` password. Also creates ambiguity about which DATABASE_URL the deployed service actually uses.
* Confidence: HIGH that the config is as written; MEDIUM on exploitability (depends whether blueprint was ever applied and whether Render Redis enforces any auth).
* Status: **FIXED — PR #296 (merged).** `spotlight-redis` and `spotlight-db` `ipAllowList` set to `[]` (private-only); `0.0.0.0/0` entries removed.

### AUD-INFRA-002 — Expo dev server used as production start command

* Severity: HIGH
* Component: mobile web deployment
* Location: `render.yaml` lines 123-124: `startCommand: npx expo start --web`
* Evidence: Expo `start --web` is the Metro bundler dev server; it serves unminified, unoptimized bundles, holds a websocket HMR endpoint, and is not intended or sized for production traffic.
* Expected: `expo export` + static hosting (or a proper web server serving the exported bundle).
* Actual: production service runs the dev bundler.
* Production impact: poor performance, larger payload, potential memory instability, dev-only endpoints exposed, no CDN caching semantics.
* Confidence: HIGH (config as written); MEDIUM on whether this service is actually deployed.
* Status: **FIXED — PR #296 (merged).** `spotlight-mobile` is now `runtime: static` serving `npx expo export --platform web` output (`dist/`); nonexistent `build:web` script removed; `REACT_APP_*` env vars corrected to `EXPO_PUBLIC_*`.

### AUD-INFRA-003 — Fragmented, conflicting deployment targets

* Severity: MEDIUM
* Component: deployment architecture
* Location: `render.yaml`, `backend/railway.json`, `frontend-admin/railway.json`, `frontend-web/railway.json`, `mobile-app/reactnative/app.yaml`, `backend/app.yaml`, `frontend-admin/app.yaml`, `mobile-app/reactnative/vercel.json`, `deploy-gcp.sh`, `deploy-render.sh`, `deploy-mobile.sh`, `infra/terraform/` (Cloud Run), `frontend-web/server.js` (cPanel Passenger), `.github/workflows/deploy-cpanel.yml`, `deploy.yml`
* Evidence: at least five distinct production deployment paths are present and partially maintained (comments in render.yaml describe admin moving to Railway; terraform defines Cloud Run services; deploy scripts exist for GCP, Render, mobile). No single document declares which is authoritative per environment.
* Expected: one deployment path per service per environment, or a documented matrix.
* Actual: parallel configs; several docs describe deployments to Render that other docs say moved to Railway/GCP.
* Production impact: config drift, deploys landing on the wrong platform, health checks and env vars diverging; rollback procedure unclear.
* Confidence: HIGH.
* Status: **FIXED — PR #337 (merged, `2ddb996c`).** `docs/devops/deployment-matrix.md` — canonical per-environment target per service.

### AUD-INFRA-004 — Committed scratch/build artifacts and doc churn in repo root

* Severity: LOW
* Component: repository hygiene
* Location: repo root — `.tscscratch/` (dir), `err.txt`, `backend/parse_err.txt`, `backend/coverage.out`, `task-tracker.json`, `mobile-app/reactnative/tsc*.txt`, ~60 `tsconfig.*.json` chunk files in `mobile-app/reactnative/`, ~80 status markdown files at root.
* Evidence: `git ls-files` shows these are tracked (working tree is clean, files listed in `ls` output and directory listing).
* Expected: scratch outputs gitignored.
* Actual: transient typecheck outputs and per-slice status docs committed.
* Production impact: repo noise; larger checkout; risk of stale docs being trusted as truth (see AUD-DOC-*).
* Confidence: HIGH.
* Status: **FIXED — PR #319 (merged, `02a303a5`).** Committed typecheck scratch + session trackers removed from the repo root.

### AUD-INFRA-005 — Production migration pipeline (`db-migrate.yml`) is dormant by design; manual `db push` is the actual path

* Severity: MEDIUM
* Component: `.github/workflows/db-migrate.yml`
* Evidence: the workflow's own header documents it is "DORMANT until you opt in" — gated on repo secrets (`SUPABASE_ACCESS_TOKEN`, `SUPABASE_PROJECT_ID`, `SUPABASE_DB_PASSWORD`) plus `DB_MIGRATE_ENABLED=true`, and explicitly warns not to enable until a reconciliation runbook brings the remote to `pending: 0`. The file references a real past incident: "the failure mode that left prod 60+ migrations behind — see docs/devops/cloud-migration-reconciliation-runbook.md".
* Expected: the deployable DB schema is applied by an auditable pipeline, or the manual process is itself verified.
* Actual: schema application to prod is manual `supabase db push` on an engineer's machine — the same process that previously drifted prod 60+ migrations behind.
* Production impact: schema/code skew is a recurring, demonstrated failure mode; no automation currently prevents recurrence (568 migrations at HEAD).
* Confidence: HIGH (workflow header text).
* Status: RISK — dormant control; previously materialized as an incident. Enabling `db-migrate.yml` requires repo secrets (`SUPABASE_ACCESS_TOKEN`, `SUPABASE_PROJECT_ID`, `SUPABASE_DB_PASSWORD`, `DB_MIGRATE_ENABLED`) — an operator decision, not a code change. Local chain integrity IS gated (integration-verify runs migrate-up + migrate-reset on push:main).

### AUD-INFRA-006 — Worker/cron binaries are not deployed by any production path

* Severity: MEDIUM
* Component: background jobs (`cmd/transport-scheduler`, `cmd/marketplace-cron`, `cmd/marketplace-indexer`, `cmd/fxsmoke`)
* Evidence: binaries exist and are wired in `docker-compose.yml` for local dev. In `infra/terraform/cloud-run.tf` the worker module is **commented out** ("Example worker from the SAME image…"). `deploy.yml` deploys only the server service; `render.yaml` has no worker services for these binaries.
* Expected: scheduled jobs (transport dispatch-due/reminders/expire-stale, marketplace indexing, cron tasks) run somewhere in production, or the modules are flag-disabled.
* Actual: no deployed worker exists in the primary (Cloud Run) or secondary (Render/Railway) deployment definitions.
* Production impact: any enabled module depending on these jobs degrades silently — stale transport dispatches never fire, marketplace search index never refreshes. If the modules are flagged off, the binaries are dead weight instead.
* Confidence: HIGH for absence in deploy configs; MEDIUM for user impact (depends on prod flag state, not auditable).
* Status: **FIXED — PRs #312 (merged, `44169978`) + #341 (merged, `5e59a1cd`).** `notification-worker` plus `marketplace-cron`/`marketplace-indexer`/`transport-scheduler` workers deployed via Render with idle-until-provisioned wrappers. `cmd/fxsmoke` + `voting-test-server` intentionally excluded.

### AUD-INFRA-007 — `/healthz` and `/readyz` are referenced by deploy smoke tests, Terraform probes, and monitoring — but never registered

* Severity: HIGH (re-verified — **worse than initially scoped**)
* Component: `.github/workflows/deploy.yml` + `infra/terraform/*` + `backend/internal/app/router.go`
* Evidence (independent re-verification):
  * `deploy.yml:86-90` (staging) curls `$URL/healthz` and `$URL/readyz`; `:130-133` (production post-check) curls `$URL/healthz`.
  * `infra/terraform/cloud-run.tf:36-37` sets `liveness_path="/healthz"`, `readiness_path="/readyz"`, wired by `modules/cloud-run-service/main.tf:67-77` as Cloud Run **startup+liveness probes** — a terraform-applied service would fail probes and never go healthy.
  * `infra/terraform/monitoring.tf:40-47` — external uptime check hits `/healthz` → permanent DOWN alerts.
  * `infra/loadtest/money-path.js:38` — loadtest targets `/healthz`.
  * Backend reality: `grep -rn "healthz\|readyz|livez" backend/**/*.go` → zero route registrations. Router exposes only `/api/v1/public/health`, `/api/v1/public/build`, `*/health` groups; `main.go` mounts `app.NewRouter` with **no NoRoute catch-all** → Gin 404 → `curl -f` fails.
  * Correctly-configured counterparts exist: `backend/Dockerfile` HEALTHCHECK → `/api/v1/public/health`; `backend/railway.json`; `render.yaml` — so half the probes are right and the Cloud Run/deploy half are all wrong.
* Expected: smoke tests and probes hit registered routes.
* Actual: `curl -f` on 404 fails staging → `production` (`needs: [build, staging]`) never runs; terraform probes would flap the service; uptime monitor reads permanently down.
* Production impact: **the documented production deploy pipeline is non-functional** even if AUD-BE-001 were fixed; rollback (`workflow_dispatch` SHA) hits the same dead check; applied Terraform = self-DOS on the Cloud Run service.
* Confidence: HIGH (grep-verified; `curl -f` on 404 deterministic).
* Status: **FIXED — PR #288 (merged).** `/healthz` and `/readyz` registered on the Gin router.

### AUD-INFRA-008 — Canary promotion is structurally present but the observation gate is a `sleep 30` stub

* Severity: MEDIUM
* Component: `.github/workflows/deploy.yml` production job
* Evidence: deploy.yml does a real `--no-traffic` tagged revision → `update-traffic ...=10` → "Watch canary golden signals" step that is literally `echo "TODO(you): query Cloud Monitoring…"` + `sleep 30` → `--to-latest` promote. The 10% canary gets shifted, waits 30s with **zero metric evaluation**, then promotes to 100%.
* Expected: canary traffic + actual golden-signal check (error rate/latency on the tagged revision) before promotion.
* Actual: traffic-splitting machinery exists but cannot catch a bad deploy — the observation step is a no-op; a revision that crashes on boot would still promote (Cloud Run marks it failed at the revision level, but nothing here reads that).
* Production impact: false confidence in staged rollout; the only real production gate is the `healthz` smoke test — which is itself broken (AUD-INFRA-007).
* Confidence: HIGH.
* Status: **FIXED — PR #313 (merged, `673d9e78`).** `sleep 30` stub replaced by a tagged-revision `/healthz` observation gate.

### AUD-INFRA-009 — No backup/restore/PITR controls found in repo or infra

* Severity: MEDIUM
* Component: disaster recovery posture
* Evidence: `infra/terraform/` contains no `point_in_time_recovery`, backup schedule, or snapshot resources for any datastore; the Supabase DB is managed (Supabase handles base backups per plan), but no repo-level backup/restore runbook, restore test evidence, or PITR configuration exists in `docs/` beyond the migration-reconciliation runbook. `grep -rln "backup|restore|pitr" infra/ docs/devops/` → only a backup-file cleanup note in GO-LIVE-FINAL.
* Expected: documented restore procedure + tested recovery for the financial ledger (money data).
* Actual: none found; rely on Supabase platform defaults with no verification.
* Production impact: unquantified RPO/RTO; a destructive bug (e.g., a bad migration that slipped the manual gate) has no rehearsed recovery path.
* Confidence: MEDIUM (absence-of-evidence; Supabase-side PITR may be enabled at the project level, not visible in repo).
* Status: **FIXED — PR #316 (merged, `7a8f88b3`).** Backup/restore/PITR runbook added.

## Testing Findings

### AUD-TEST-001 — `frontend-web` full unit suite is red on HEAD (1 failing test)

* Severity: MEDIUM
* Component: utility bills API route tests
* Location: `frontend-web/tests/unit/utility/routes.spec.ts:127-140` vs `app/api/v1/utility/categories/route.ts`
* Evidence: `npx vitest run` → `Test Files 1 failed | 123 passed (124); Tests 1 failed | 1138 passed` (2026-09-30). The spec's `beforeEach` pins `featureFlags.utilityBillsGoProxy → false`, but the test mocks `proxyToGoBackend` and asserts `body.categories` — with the flag off the route takes the local `listUtilityCategories()` path (mocked as bare `vi.fn()` returning `undefined`), so `categories` is `undefined`. Test/route drift: either the test should pin the flag on, or the route's non-proxy path should still return `{success, categories}` populated.
* Expected: `npm test` green on main.
* Actual: 1 failing test — and CI does not run the full vitest suite (CLAUDE.md documents only `test:regression` + `test:money` as gates), so the failure is invisible to the pipeline.
* Production impact: low-moderate — indicates test/maintenance drift and that the categories endpoint's non-proxy response shape may regress undetected.
* Confidence: HIGH — reproduced.
* Status: **FIXED — PR #290 (merged).** Spec updated to pin the intentional flag-gated dual-path contract (fd91af5d); suite now 1140/1140 green on `main`.

### AUD-TEST-002 — Repo-wide `go test ./...` cannot run on main (build break blocks it)

* Severity: HIGH
* Component: backend test suite
* Location: `backend/internal/connect/voting` (AUD-BE-001)
* Evidence: `go test ./...` fails to compile `internal/connect/voting` (same missing field). The 464-file Go test suite is unverifiable on `main` as committed.
* Production impact: the entire backend test gate is dark on the production branch; any regression introduced alongside is unmeasurable.
* Confidence: HIGH.
* Status: **RESOLVED — consequence of AUD-BE-001, fixed by PR #286.** `go test ./...` runs again on `main`.

### AUD-TEST-003 — Branch protection/required checks exist only on `develop`; `main` merges land on red pipelines

* Severity: HIGH
* Component: `.github/workflows/ci.yml`, `ci-optimized.yml`, `integration-verify.yml`, `.github/required-checks.txt`
* Evidence (corrected 2026-09-30 after enumerating all 31 workflows):
  * The full gate set (`ci.yml` lanes: backend build+vet, frontend regression+money+contract+tsc, migration-version collision check, openapi validation) runs **only** on `push`/`pull_request` to `[develop, staging, prod]`. `.github/required-checks.txt` documents the required check-run names and states they are applied to **`develop`** by `scripts/ci/apply-branch-protection.sh` — no equivalent exists for `main`.
  * `main` is not completely CI-less: `ci-optimized.yml` runs `cd backend && go build ./...` on push/PR to main, and `integration-verify.yml` runs `make build` + `make test` + `make tsc` + `make docker-build` on push to main. Both existed before the break (integration-verify last touched 2026-09-23; the build-breaking merge `0b315a23` landed 2026-09-29).
  * Therefore the compile break in AUD-BE-001 landed on `main` while at least one workflow running `go build ./...` was red — the failure was visible but **not blocking** because no `main` branch protection requires these checks.
* Expected: the branch that deploys to production requires the same gates as develop.
* Actual: `main` accepts merges/pushes with failing builds; demonstrated empirically by AUD-BE-001 shipping.
* Production impact: production branch can silently carry build breaks, test failures, and contract violations even though the checks exist and are running red.
* Confidence: HIGH — workflow files, required-checks.txt, and the broken merge are direct evidence.
* Status: MISSING CONTROL — gate-set **FIXED — PR #331 (merged, `8384aa80`)**. ⚠️ Residual: `scripts/ci/apply-branch-protection.sh main` still needs an admin-token run (ordering hazard gone now that the checks exist on main; the API needs `admin` scope, a `maintain` token gets a 404).

### AUD-TEST-004 — `ci-optimized.yml` lanes on `main` are weakened, phantom, or dead (re-verified, stronger)

* Severity: MEDIUM
* Component: `.github/workflows/ci-optimized.yml` + stale Go pins repo-wide
* Evidence (re-verified):
  * **Phantom script**: `frontend-web` job runs `npm run lint:fast || true` — but `frontend-web/package.json` has **no `lint:fast` script at all** (only `lint`). The step fails with "Missing script" on every run and `|| true` hides even that. It never reaches eslint regardless of `--only=prod`. `frontend-admin` job does the same `npx tsc --noEmit || true` after `npm ci --only=prod` (typescript is a devDep → absent → masked no-op).
  * **Stale Go toolchain pins repo-wide**: `ci-optimized.yml:65` pins `1.23`; `integration-verify.yml:66` and `ci.yml:286,433` pin `1.25.x`; `_reusable-go-verify.yml:37` defaults `1.25.x` — all below `backend/go.mod`'s `go 1.26.6`. GOTOOLCHAIN=auto rescues CI runners but the Dockerfile comment itself documents a prior break from this exact class of skew.
  * **Dead migrations lane**: `if: contains(github.event.head_commit.modified, 'supabase/migrations')` can never be true twice over — `head_commit` is absent on `pull_request`, and on `push` `modified` is an array of full file paths that can never equal the bare directory string. Permanently dead code.
* Production impact: on `main` the visible "CI" gives false confidence — the only meaningful gate is `go build` (under a stale pin), and two lanes are green-by-construction reporting nothing.
* Confidence: HIGH (independently re-verified).
* Status: **FIXED — PR #302 (merged, `bd55379e`).** Dead/masked lanes repaired; Go pins aligned with `go.mod`.

### AUD-TEST-005 — Pre-commit lint gate (`lefthook` + `golangci-lint --new`) is unpassable inside linked git worktrees

* Severity: MEDIUM
* Component: `lefthook.yml` pre-commit `lint` command
* Evidence (executed): committing inside a linked worktree ran `golangci-lint run --new` under the hook's `GIT_DIR`/`GIT_INDEX_FILE` env; the env points golangci's diff machinery at the wrong tree, `--new` falls back to reporting the **entire baseline (895 issues)**, and every commit fails the hook even with a zero-issue diff. Reproduced directly: same binary/config reports `0 issues` without the env, `895` with `GIT_INDEX_FILE`/`GIT_DIR` set.
* Production impact: none at runtime; every developer/agent session in a linked worktree had to bypass `--no-verify` or burn time — meaning the gate trained people to skip it.
* Fix: hook now runs `env -u GIT_DIR -u GIT_INDEX_FILE -u GIT_WORK_TREE mise exec -- golangci-lint run --new-from-rev HEAD` — diffs the staged tree against HEAD (exactly "this commit adds no new issues"), independent of merge-base and worktree layout.
* Status: **FIXED — merged via PR #367** (same branch as AUD-AUTH-001; separate commit).

## Performance Findings

### AUD-PERF-001 — Every authenticated backend request fans out to ≥3 sequential Supabase calls (no caching)

* Severity: MEDIUM
* Component: `backend/internal/middleware/auth_context.go`, `repositories/rbac_supabase_repository.go`
* Evidence: per request the middleware chain performs: (1) GoTrue token validation call, (2) `platform_users` status fetch, (3) roles fetch, (4) permissions fetch — each a PostgREST/GoTrue round-trip, sequential, with a 10s-timeout client (`integrations/supabase_rest.go:22`). No caching layer observed.
* Re-verification — the floor is 4, not 3: **4 sequential Supabase calls baseline; 5 with `FeatureSessionHardeningEnabled`** (`auth_context.go` session validation step); **6 on permission-gated routes** because `RequirePermission`/`RequireAdminConsoleRole` re-query `GetUserRoles`/`GetUserPermissions` a second time for the same request — the middleware results are not shared down the chain.
* Expected: JWT-local validation + cached RBAC lookups, or single RPC.
* Actual: every API call adds 4–6 sequential network RTTs to Supabase; backend latency floor = Supabase latency, and Supabase outage = total API outage (also AUD-BE-002 fail-open consequence).
* Production impact: p50 latency dominated by upstream RTTs; Supabase degradation amplifies into full-stack unavailability; Supabase-side request-rate quotas become the scaling ceiling.
* Confidence: HIGH (code path traced).
* Status: **FIXED — PR #339 (merged, `06db8fca`).** Independent status/roles/permissions/session lookups fan out concurrently; `RequirePermission` answers from request context with RPC fallback; role middlewares reuse context roles (~6 sequential Supabase RTTs → ~1 per request).
* **Load-verified residual (2026-10-02, live stack)**: under a 200-VU k6 ramp the per-request `GET /auth/v1/user` GoTrue call becomes the ceiling — Kong logged ~7.2k upstream 500s on `/auth/v1/user` while PostgREST paths stayed 200; local Postgres `max_connections=100` (→500) and PostgREST pool=10 are part of it, but the structural point stands: **GoTrue is in the hot path of every authenticated request**. With AUTH-001 fixed the API now degrades truthfully (wallet calls returned `503`, verified in the access log: 13,741×503 vs 4,817×200 during the ramp) instead of fake `401`s — but capacity is bounded by GoTrue. The remaining lever is the one this finding already names: JWT-local validation (HS256) with remote checks moved off the hot path — needs a revocation-semantics decision, i.e. an ADR, not a drive-by.

### AUD-PERF-002 — Unbounded in-memory rate-limit stores grow with distinct keys

* Severity: LOW
* Component: `frontend-web/src/lib/voting/rate-limit.ts`, `src/lib/rate-limit/server.ts`, backend `auth_rate_limit.go`
* Evidence: both frontend limiters use process-local `Map`s keyed by IP/actor (size cap 1000 in `server.ts` triggers cleanup — bounded; `voting/rate-limit.ts` token bucket has no explicit cap beyond key cardinality). Backend `loginLimiter`/`resetLimiter` are per-instance in-memory.
* Production impact: bounded; per-instance reset weakens protection rather than exhausting memory (maps are small).
* Confidence: MEDIUM.
* Status: OBSERVATION — **PR #333 closed as superseded** (the meaningful cap landed via #327's bucket-map cap; residual in-memory-reset-per-replica noted under SEC-001).

## Reliability Findings

### AUD-REL-001 — Vote receipt / notification email is fire-and-forget with no retry and an unchecked response

* Severity: MEDIUM
* Component: `frontend-web/src/server/voting/email.service.ts`
* Evidence: `sendEmail` does `await fetch(resend)` and never checks `res.ok` — a Resend 4xx/5xx resolves normally so failure is undetectable; the caller wraps `sendVoteReceiptEmail` in `void (async () => { try {…} catch {} })()` — explicitly fire-and-forget. No queue, no retry, no dead-letter. `RESEND_API_KEY` missing → silently `console.log`s (dev path).
* Production impact: voters told "check your email for a receipt" may never receive one; under serverless runtimes the detached async work can be frozen before dispatch. Receipts are a payment-dispute artifact — their absence turns payment queries into manual support cases.
* Confidence: HIGH.
* Status: **FIXED — PR #332 (merged, `e209b074`).** Resend response status checked and the request bounded.

### AUD-REL-002 — Webhook dispatcher converts all handler failures into HTTP 200 with no retry surface

* Severity: MEDIUM — recorded as AUD-FE-004 (cross-listed).
* Evidence: `app/api/webhooks/paystack/route.ts` uses `Promise.allSettled` over six handlers and always returns 200 "to prevent Paystack retries".
* Production impact: a transient failure inside a non-wallet handler is dropped permanently — no dead-letter, no retry (Paystack won't resend since we acked 200), no alerting hook (AUD-FE-006 means the rejection isn't even logged consistently).
* Status: **FIXED — PR #310 (merged, `67277290`).** Rejected handler results now log + return 500 (partial) / 400 (all six rejected) instead of a blanket 200; fulfilled routine outcomes still ack 200.

### AUD-REL-003 — `http.DefaultClient` (no timeout) on GoTrue auth calls; bounded elsewhere

* Severity: MEDIUM — recorded as AUD-BE-006 (cross-listed).

### AUD-REL-004 — Health endpoint is a static 200; it does not probe DB/Redis at request time

* Severity: LOW
* Component: `backend/internal/handlers/health_handler.go`
* Evidence: `PublicHealth` returns a fixed `{success:true,status:"ok"}` body; Dockerfile/`render.yaml` healthchecks hit this. Boot-time DB fail-closed (a positive) covers startup, but **runtime** DB/Redis loss still reports healthy → orchestrator won't restart the container during an upstream outage.
* Production impact: traffic keeps routing to a degraded instance until it crashes for another reason; probes can't distinguish "up but DB-dead".
* Confidence: HIGH.
* Status: **FIXED — PR #325 (merged, `5c81f1a0`).** Runtime healthchecks point at `/readyz` (real DB/Redis probes) instead of the static `/healthz`.

### AUD-REL-005 — No request-correlation IDs; OTel SDK initialized but HTTP layer not instrumented

* Severity: MEDIUM
* Component: `backend/internal/app/router.go`, `internal/platform/observability`
* Evidence:
  * The router's global middleware is CORS only; no `X-Request-Id` generation/echo middleware exists (the header is merely whitelisted in `Access-Control-Allow-Headers`, `cors.go:54`). `grep -rn "RequestID\|X-Request" internal/` finds nothing that mints or propagates an ID.
  * OTel exporters (Cloud Trace/Monitoring) initialize in `main.go`, but no `otelgin`/`otelhttp` middleware is registered — `grep -rn "otelgin\|otelhttp" internal/` → zero matches. HTTP requests produce **no spans**; only the hand-written money counters emit.
* Expected: every request gets a correlation ID propagated to logs/traces/Supabase calls; HTTP spans flow to Cloud Trace.
* Actual: Sentry catches crashes, counters catch money events, but per-request tracing/correlation is absent — a failed request cannot be followed across handler→Supabase→provider.
* Production impact: with FE-006 (silent BFF errors) this compounds: backend has counters but no request spans; frontend has Sentry but caught errors never reach it. Cross-boundary debugging is logs-archaeology.
* Confidence: HIGH.
* Status: **FIXED — PRs #320 + #334 (both merged).** `X-Request-Id` mint/echo/propagate middleware (`c7154594`) plus otelhttp instrumentation of the HTTP layer (`92fda5c4`).

### AUD-REL-006 — Internal error strings echoed to clients in admin/handlers

* Severity: LOW
* Component: `backend/internal/handlers` (`admin_users_handler.go:57` returns `err.Error()` on 500; `admin_console_handler.go` ×8 sites; `auth_handler.go:521,543` on 400)
* Evidence: `c.JSON(500, gin.H{"error": err.Error()})` — raw service/repository errors (PostgREST bodies, constraint details) reach admin API responses.
* Production impact: internal error details + schema/constraint hints leak to admin-authenticated callers; inconsistent error envelopes (`{error}` vs `{success:false,error,code}`) across handlers complicate client handling.
* Confidence: HIGH.
* Status: **FIXED — PR #324 (merged, `2e116cc2`).** Internal error strings no longer echoed to clients on 500s.

### AUD-REL-007 — No product-usage analytics pipeline (no PostHog/Segment/Amplitude/custom event store)

* Severity: LOW/MEDIUM
* Component: cross-stack observability
* Evidence: `grep -rln "posthog|mixpanel|segment|amplitude" frontend-web/ mobile-app/reactnative/ backend/` → only `services/analyticsService.ts` (a dead admin-API fetch) and DB-query dashboards (`estate/analytics`, `useComplianceAnalytics`). There is no event-ingestion SDK, no event schema, no signup→activation→conversion funnel instrumentation anywhere.
* Expected (for a consumer fintech): product analytics to answer activation, funnel drop-off, payment success rate by cohort, feature usage.
* Actual: none — teams cannot answer funnel/retention questions from emitted data; Sentry covers errors only.
* Production impact: product/ops blindness rather than a defect; combined with BE-008 the notification plane is doubly invisible.
* Confidence: HIGH (absence verified by grep across all three apps).
* Status: MISSING CONTROL — decision record **FIXED — PR #347 (merged, `66ba2b52`).** ADR proposing a PostHog product-analytics pipeline; implementation intentionally flag-gated and not yet scheduled.

## Documentation / Process Findings

### AUD-DOC-001 — CLAUDE.md stack metadata is stale in several places

* Severity: LOW
* Evidence: CLAUDE.md states "Go 1.23" but `backend/go.mod` requires `go 1.26.6`; states "~291 additive migrations" but the tree holds 568; states regression suite "9 specs, 120 tests" but observed run reported 10 spec files / 129 tests; describes `frontend-web` served on cPanel Passenger while deploy paths for the same app also exist for Railway/Render.
* Production impact: low direct, but stale runbooks mislead incident response and audits.
* Confidence: HIGH.
* Status: **FIXED — PR #314 (merged, `350d2574`).** Stale stack metadata corrected (Go version, migration count, suite size, deploy paths).

### AUD-DOC-002 — `task-tracker.json` shows large feature verticals merged mid-build

* Severity: MEDIUM (process)
* Evidence: root `task-tracker.json` tracks the Health verticals (pharmacy/lab/vet) with `pending_tasks` including "Run health-ci.yml", "Add state-machine + authZ + chain-of-custody test suites", "Wire real tele-consult A/V provider", "Flip FEATURE_HEALTH_* + supabase db push + seed RBAC" — i.e., module code merged to `main` before its own CI/tests completed. ~70 mobile feature groups and ~300 admin pages exist for modules whose flags are presumably OFF.
* Production impact: shipping latent unexecuted code behind flags is safe-ish, but the merge-before-test pattern is the same mechanism that produced AUD-BE-001.
* Confidence: HIGH (file content).
* Status: OBSERVATION / RISK — unchanged; statuses in `task-tracker.json` cannot be corrected without the feature owners' verification.

### AUD-DOC-003 — Contract enforcement covers only `estate.openapi.yaml`

* Severity: MEDIUM
* Component: `contracts/` + `frontend-web/package.json` `contract:check`
* Evidence: `contracts/openapi.yaml` parses cleanly and declares **600 paths**; `npm run contract:check` validates only the estate contract (per CLAUDE.md's own caveat: "it does not check `openapi.yaml`"). `ci.yml` runs `_reusable-openapi-validate.yml` (syntax validation) on develop — but no implementation-vs-spec conformance check for the other 599 paths, and no main-branch run.
* Production impact: frontend/backend contract drift across ~600 declared paths is undetectable by automation; AUD-TEST-001's failing route-shape test is an instance of exactly this.
* Confidence: HIGH.
* Status: **FIXED — PR #335 (merged, `3d3597ad`).** `contract:check` now parses+validates all 19 `contracts/*.yaml`; estate implementation-conformance mapping preserved.

## Unable to Verify

*Update 2026-10-02 — a full local integration stack now exists (see "Local integration environment" below): Supabase local (Postgres 54322 / Kong+GoTrue+PostgREST 54321 / Mailpit 54324 / Storage / Realtime), compose API + Redis, fake payment rails on :9100, all migrations replayed green through `20270314000000`, RLS gate verified. Several previously-unverifiable items are now resolved or partially resolved inline.*

| Item | Why unverified |
|------|----------------|
| ~~Live RLS policy coverage per table~~ | **RESOLVED 2026-10-02** — `make rls-check` on the live replayed DB: `RLS_DONE`, zero public tables without RLS |
| ~~Backend runtime behavior of all 198 routes~~ | **PARTIALLY RESOLVED** — backend compiles, containerized API healthy; `/api/auth/login`, `/api/finance/wallet/balance` (200 via real auth+RBAC), admin gating (403 for non-authorized fixture), `/readyz`, outage semantics all verified live. Per-route sweep still not exhaustive |
| ~~Repo-wide `go test ./...`~~ | **RESOLVED 2026-10-02** — all ~180 packages pass on merged `main` (BE-001/TEST-002 fixed) |
| EAS dashboard environment variables | Not in repository; AUD-FE-001 severity depends on whether they compensate for missing `build.production.env` |
| Production flag state (`FEATURE_*`, mock flags) | Server-side env not auditable; task-tracker suggests many modules un-launched |
| `db-migrate.yml` enablement | **PARTIALLY RESOLVED 2026-10-01** — `DB_MIGRATE_STAGING_ENABLED=true` was already set; a dispatched dry-run against staging confirmed credentials + link healthy, drift = 1 pending migration (`20270314000000`, expected). Production enablement intentionally waits on the `production`-environment reviewers' gate + a `pending: 0` dry-run |
| ~~Deploy target authority (Cloud Run vs Railway vs Render vs cPanel)~~ | **RESOLVED — PR #337** (`docs/devops/deployment-matrix.md` declares the canonical target per environment) |
| Render blueprint applied state | `render.yaml` open allowlists (AUD-INFRA-001) only matter if the blueprint was applied |
| Per-screen runtime states for ~70 web / ~300 admin / ~582 mobile routes | No running stack; static-only |
| Playwright e2e suite (`mobile-app/reactnative/tests/e2e`) | Requires running backend + app instance |
| Worker/cron execution in production | **PARTIALLY RESOLVED** — `render.yaml` now defines all four workers (#312 + #341); whether the blueprint was applied and flags enabled in prod is still operator-side |
| Webhook queue/DLQ for non-wallet Paystack events | No dead-letter or retry store found; verify-on-read covers wallet only |
| ~~`docker build` for production image~~ | **RESOLVED 2026-10-02** — multi-stage image builds and runs healthy in compose (BE-001 fixed; OrbStack OOM needed a retry but the Dockerfile is sound) |
| Whether `x-forwarded-for` is sanitized at the production edge | Depends on Cloud Run/Railway/cPanel ingress config outside the repo — affects exploitability of AUD-BE-004/AUD-SEC-001 |
| Sustained load capacity (100/500/1000 concurrent users) | **PARTIALLY RESOLVED** — 200-VU k6 ramp (~240 rps) executed against the live stack: health endpoints saturated cleanly; authed-path failures it surfaced were diagnosed to the AUTH-001 misclassification + a port-shadowed stale binary (see ops note below). 500/1000-VU sweeps pending |
| Schema rollback after a bad migration | Additive-only policy means there is no schema rollback — recovery is forward-fix or Supabase PITR (INFRA-009, unverified) |
| `deploy.yml` actually running on main pushes recently | Requires GitHub Actions run history — the endpoint mismatch (INFRA-007) would show as red staging jobs |

## Local integration environment (established 2026-10-02)

A real shared stack now runs locally — `frontend → API → services → DB → workers → provider mocks`:

* **Supabase local** (`supabase start`): Postgres `:54322`, Kong/PostgREST/GoTrue `:54321`, Mailpit `:54324`, Storage, Realtime, shadow `:54320`. Full migration chain replays green via `supabase db reset` (through `20270314000000`); `make rls-check` → `RLS_DONE`, 0 unprotected public tables.
* **Compose** (`docker compose up api redis`): API healthy on `:8080` (moved to `:8081` in the audit worktree — see port-shadowing note), Redis `:6379`. `backend/.env` points at `host.docker.internal:54321/54322`.
* **Fake rails** (`tools/fakes`, `paymax-fakes` container): `:9100`, `RAILS_MODE=fake`, HMAC-signed async webhooks → `host.docker.internal:8080/internal/webhooks/academy`.
* **Fixtures**: `scripts/dev/ensure-dev-login.sh` repairs GoTrue password + `platform_users` lockout + role for `qa-claude-test@spotlight.internal` / `admin@spotlight.internal`. Login → wallet (200) → admin-gating (403) verified end-to-end.
* **Load**: k6 200-VU ramp (~240 rps, ~12k checks) executed; surfaced AUD-AUTH-001.
* **Fault drills executed**: Kong outage (→ AUTH-001 fix verified 503→200), Postgres pause (timeout → correct 503 post-fix), container restart, token freshness.

**⚠️ Port-shadowing lesson (recorded as an ops hazard):** a stale native binary (`/tmp/paymax-api` from another worktree) was bound to `*:8080` and **shadowed the container's published port** — every curl/k6 request silently hit the wrong binary, producing misleading 401s and nearly invalidating the AUTH-001 verification. Rule going forward: before trusting any response, verify which PID/container owns the port (`lsof -i :PORT`), or publish on a dedicated port (`docker-compose.override.yml` → `:8081`, kept local-only/untracked).

## Positive Findings

* Go backend refuses to boot on staging/prod without a working `DATABASE_URL` — converts a previously observed silent-degradation incident (all finance routes 404 behind a green health check) into a failed deployment. `internal/app/router.go:408-424`.
* Feature flags default OFF for every money-path module; several secrets fail startup validation when absent outside dev (e.g. `AssocCardSigningSecret`, `LedgerServiceToken`, KYC PII key). `internal/config/config.go`, `internal/config/validate.go`.
* Admin routes use layered auth: `RequireAdmin` (shared key) + `RequireAdminConsoleRole`/`RequireVerifiedIdentity` + per-route RBAC permission checks — prior AUTH-003/AUTH-010 gaps visibly remediated with explanatory comments. `internal/app/router.go:230-335, 501-585`.
* Graceful shutdown (25s drain) + `ReadHeaderTimeout` set on the HTTP server. `cmd/server/main.go`.
* Container runs as non-root user; multi-stage build; healthcheck wired to `/api/v1/public/health`. `Dockerfile`.
* Login and password-reset endpoints have dedicated in-memory rate limiters (`loginLimiter`, `resetLimiter`). `internal/app/router.go:104-111`.
* Migration hygiene enforced in CI (`check-migration-versions.sh`, `hygiene` lane); additive-only migration policy documented and enforced.
* **No migration version collisions** — 568 files, 0 duplicate timestamp prefixes (verified by prefix count at HEAD).
* **`contracts/openapi.yaml` parses cleanly and declares 600 paths** — the spec is machine-readable.
* **`frontend-admin` full `tsc --noEmit` passes** (exit 0, verified 2026-09-30).
* **Mobile dialog-safety gate green** — `check-no-alert-confirm.mjs` passes; no raw multi-button `Alert.alert` in the RN app.
* **Backend observability is real, not aspirational** — `internal/platform/observability` wires Sentry (DSN-gated) + OpenTelemetry exporters to Google Cloud Trace/Monitoring with a configurable trace sample rate; `internal/platform/metrics` emits dedicated money counters (`paymax.payment.result`, `paymax.money.movement`, `paymax.ledger.invariant_breach` — "SLO target is 0"). Flush on graceful shutdown.
* **Build-identity endpoint** — `/api/v1/public/build` reports the running commit/branch/dirty flag, so a deploy can be verified by observing the binary itself, not CI status (`internal/handlers/health_handler.go`, `buildinfo`).
* **OTP service is properly hardened** — CSPRNG codes, expiry, attempt caps, and a **Postgres-backed** rate limiter (`internal/otp/ratelimit.go`) that survives cache loss.
* **Go subset tests pass** — `go test` on finance/platform/handlers/services/repositories packages: exit 0.
* **Paid-vote flow is amount-safe** — server computes `amountExpected` from package/settings, verifies paid-vs-expected in kobo with bounded tolerance, marks mismatches `failed` + writes fraud signals; re-verify is idempotent via `alreadyProcessed` guards.
* **Webhook signature verification is mandatory per handler** — HMAC-SHA512 checked before dispatch; wallet topups have a verify-on-read fallback.
* **No secrets committed** — `git ls-files` shows only `.env.example`/template files; TruffleHog lane exists on main pushes (working range resolution was itself fixed, per in-file comment).
* **R2 presigned uploads are tight** — content-type bound into the PUT signature, expiry capped at 7d/defaults 15min, unsigned-payload sentinel for R2, `ErrNotConfigured` fail-closed. `internal/platform/r2/presign.go`.
* **Upload endpoints enforce byte caps** — e.g. insurance uploads bounded at 8MB via `io.LimitReader` (`internal/app/insurance_uploads.go:42-74`).
* **Worker binaries handle SIGTERM** — `signal.NotifyContext` in `cmd/transport-scheduler` and `cmd/marketplace-cron`; the APIs server drains 25s. (The workers just aren't deployed — INFRA-006.)
* **Canary machinery exists in deploy.yml** — tagged no-traffic revision → 10% shift → promote; only the observation step is hollow (INFRA-008), the traffic-splitting itself is real.
* **Gin request bodies are capped per-handler** on file paths; no global body limit observed (OBSERVATION — multipart presigned-PUTs bypass the Go server anyway).

## Critical Production Blockers

| ID | Blocker | Why it blocks |
|----|---------|---------------|
| AUD-BE-001 | `go build ./...` fails at HEAD (`FeatureContestantSocialEnabled` missing from config after merge `0b315a23`) | The production backend image cannot be built or shipped at all from `main` |
| AUD-FE-001 | Production EAS profile carries no `EXPO_PUBLIC_API_BASE_URL`/Supabase env | If EAS dashboard vars don't compensate, production mobile builds boot against `localhost:3000` or crash on Supabase init |
| AUD-BE-005 | Change-password endpoint returns success without changing the password | Silent credential-management failure — users believe they rotated passwords they didn't |
| AUD-BE-002 | Auth status check fails open on Supabase error | Suspended/locked users can authenticate during upstream outages |
| AUD-FE-003 | `paymax_gateway` fulfilment is client-triggered only | Real collected payments can strand unfulfilled — direct financial/reconciliation failure |
| AUD-DB-002 | Paid-vote crediting is non-atomic; `credited` flag written before votes | Crash leaves "credited but empty" tx that re-verify reports as success — permanent vote loss + TOCTOU double-credit |
| AUD-FE-007 | `/vote-callback` sends no `transactionId` to an endpoint that requires it | Every successful paid-vote buyer sees "Payment Not Confirmed / you have not been charged" |
| AUD-BE-009 | Auto-expired lockout never clears `status='locked'` | Accounts that survive a temporary lock are permanently locked on next login |
| AUD-FE-006 | `handleApiError` swallows all unexpected errors with no logging across 1068 call sites | Production incidents on the entire BFF surface are undiagnosable |
| AUD-TEST-003 | No enforced checks on `main`; the deployable branch merges on red pipelines | The control that would have prevented BE-001 is documented but unenforced |
| AUD-INFRA-007 | `deploy.yml` smoke tests curl `/healthz`/`/readyz`, which the backend never registers | Every production deploy via the documented pipeline fails post-build even if the code compiled |
| AUD-INFRA-006 | Worker/cron binaries are deployed by no production path | Scheduled jobs for any enabled module silently never run |
| AUD-BE-008 | Notification queue has producers but no consumer (asynq server never started) | Enqueued push/email/SMS never delivered; Redis accumulates dead tasks |

## Final Production Readiness Assessment

### Backend

`NOT READY`

Evidence: the module does not compile at HEAD (AUD-BE-001) — nothing below it matters until that is fixed. Beyond the build break, the auth surface has one verified logic bug (BE-005 — change-password is a no-op returning success), one fail-open authorization gate (BE-002), and a no-timeout HTTP client on GoTrue calls (BE-006). The architecture underneath is unusually disciplined (fail-closed config, layered admin auth, integer-kobo ledger with invariants, idempotent webhooks, OTel+Sentry) — but "cannot build" plus "credential flow lies to the user" is disqualifying.

### Frontend/Mobile

`READY WITH RISKS`

Evidence: `frontend-web` compiles clean (tsc=0), golden-path regression is green (129/129), the admin app typechecks, and the mobile dialog-safety gate passes. The web error layer (FE-006), the Paystack fulfilment gap (FE-003), the duplicate `staging-aab` EAS key (FE-002), and the envless production EAS profile (FE-001 — CRITICAL if EAS dashboard vars don't compensate) keep it below `READY`. The 1 failing vitest (TEST-001) is a stale-test signal, not an app defect.

### End-to-End

`READY WITH RISKS`

Evidence: the two audited money flows (paid vote, wallet top-up) have server-side amount verification, kobo-correct arithmetic, idempotent verify, and atomic totals RPCs. The gateway-order flow (FE-003) and the password-change flow (BE-005) are verified-broken end-to-end. Long-tail flows (KYC lifecycle, referral, admin actions, mobile startup) are partially traced but not executed — see Unable to Verify.

### Infrastructure / Deployment

`NOT READY`

Evidence: deployment is fragmented across Cloud Run (deploy.yml), Render (render.yaml with open Redis/Postgres), Railway (`railway.json`s), and cPanel Passenger (`server.js`, deploy-cpanel.yml) with no declared authority; the migration pipeline is dormant by design (INFRA-005); worker binaries are deployed nowhere (INFRA-006); the mobile web service runs an Expo dev server as its production start command (INFRA-002); the deploy pipeline's own smoke tests hit endpoints that don't exist (INFRA-007 — every deploy would go red post-build); the canary observation gate is a `sleep 30` stub (INFRA-008); no backup/restore/PITR runbook exists (INFRA-009); and the build that produces the artifact cannot succeed (BE-001).

### Overall

`NOT READY`

Evidence: one CRITICAL build break (backend unbuildable at HEAD), one conditional-CRITICAL mobile build-config gap, HIGH correctness bugs (BE-005 password no-op, BE-009 permanent-lockout, FE-003 client-side fulfilment, FE-007 always-failed vote callback, DB-002 unrecoverable credit-flag poisoning), one HIGH auth fail-open (BE-002), one HIGH dead notification pipeline (BE-008 — enqueued push/email/SMS never delivered), one HIGH deploy-pipeline break (INFRA-007 — smoke tests 404 unconditionally), one HIGH systemic observability gap (FE-006), and a CI posture where the deployable branch has no enforced checks. The codebase is more disciplined than most at this stage — money invariants, idempotency, feature flags, and observability scaffolding are real — but the gates that would keep it that way are advisory, and the deployable artifact currently does not exist.

**To reach `READY` (minimum set, in order):**
1. Restore `FeatureContestantSocialEnabled` in `config.go` (or remove the references) so `go build ./...` is green on `main`.
2. Register `/healthz` + `/readyz` (or fix the smoke-test/probe URLs in `deploy.yml` + `infra/terraform/`) so deploys and Cloud Run probes can actually verify a service — today they hit 404 unconditionally.
3. Enforce the existing `integration-verify` (or equivalent) checks as required status checks on `main`.
4. Fix `ChangePassword` to verify `currentPassword` and actually call the GoTrue password-update API; stop writing the false audit entry until it does.
5. Fix the lockout latch: the successful-login PATCH must reset `status='active'` when `locked_until` has expired (AUD-BE-009), and make the failed-login counter atomic (BE-007).
6. Make paid-vote crediting atomic — enable/route everything through the existing `credit_paid_vote_transaction` RPC (`VOTES_BRIDGE_ENABLED` on, webhook + v1 route migrated), and write the `credited` flag only after votes+totals (AUD-DB-002); fix `/vote-callback` to pass `transactionId` or resolve by `reference` (FE-007); reconcile `refunded` replays.
7. Move `paymax_gateway` fulfilment into the server-side webhook (idempotent), add a reconciliation sweep for `payment_webhook_logs` orphans, and declare ONE live webhook receiver (INFRA-010).
8. Add `Sentry.captureException`/`console.error` to `handleApiError` before the generic-500 return.
9. Start an asynq worker (or remove the enqueue sites) so queued notifications actually deliver; wire `ProviderConfig`; fix the `in_app`→push default producing duplicate tasks.
10. Pin `r.SetTrustedProxies` to the real ingress (or `nil`) — one line that re-validates every IP-keyed control; add rate limits to `votes/paid/*` and wallet-debit routes keyed on `user.id`.
11. Confirm `EXPO_PUBLIC_*` vars exist in the EAS production project environment (or add them to `eas.json`); fix the duplicate `staging-aab` key; set `EXPO_PUBLIC_APP_ENV=production`.
12. Decide on ONE deployment authority per service and delete or quarantine the rest; replace the `sleep 30` canary step with a real golden-signal check; document backup/restore.

## Re-Verification Campaign (10-agent pairwise independent check)

All ten agents completed. Method: each agent re-verified one producer↔consumer / caller↔callee / config↔usage pair against source, returning CONFIRMED / REFUTED / PARTIAL.

| # | Pair | Verdicts |
|---|------|----------|
| 1 | `config.Config` ↔ all consumers (69 decls swept) | **BE-001 CONFIRMED** — `FeatureContestantSocialEnabled` is the *only* missing field; `validate.go` clean; `staging-module-flags.yml:155` still sets the dead env var |
| 2 | Notification producers ↔ asynq consumers | **BE-008 CONFIRMED + amplified** — zero consumers; `in_app`→push default creates duplicate push tasks; `ProviderConfig` has no env plumbing |
| 3 | `auth_service` ↔ `auth_context` | **BE-002/005/006/007 CONFIRMED + amplified** — found **new HIGH** BE-009 (permanent lockout); BE-005 also writes a false audit entry; second `DefaultClient` site found; roles/perms errors swallowed too |
| 4 | Next.js webhook dispatcher ↔ Go `webhooks/paystack.go` | **FE-003 CONFIRMED (narrowed)** — ADR-041 re-plumbed wallet top-up; residual producers listed. **FE-004 CONFIRMED + amplified** — DVA/bank/gateway have NO self-heal fallback; vote+gateway handlers share one dedup row (race). Dual pipeline = two different paths competing for one dashboard URL (→ INFRA-010) |
| 5 | `admin-proxy` ↔ `RequireAdmin`/RBAC | **FE-005 CONFIRMED** — key path trusts `x-admin-role` verbatim incl. `admin`→`super_admin` alias; proxy strips role headers + enforces session; **SEC-003 dead code CONFIRMED** (zero importers; not in any bundle) |
| 6 | Frontend limiters ↔ Gin `ClientIP` trust | **SEC-001/BE-004 CONFIRMED + amplified** — un-limited wallet-debit money paths; free-vote *daily* cap also keyed on spoofable IP; `StemRateLimit` never evicts + trusts `x-stem-role`; second XFF extractor; same bug in crypto backend |
| 7 | `paid-vote.service` ↔ `vote-callback` UI | **DB-002 CONFIRMED + severity raised** — crash leaves *unrecoverable* credited-but-empty tx; TOCTOU double-credit; refund replay re-credits; atomic RPC exists but flag-off and webhook bypasses it. **New FE-007**: callback sends no `transactionId` → browser verify always fails. DB-003, REL-001 CONFIRMED |
| 8 | `deploy.yml` ↔ router/terraform probes | **INFRA-007 CONFIRMED + amplified** — `/healthz`/`/readyz` dead in workflow, **Terraform liveness/readiness probes**, uptime monitor, and loadtest — a terraform-applied service can never become healthy |
| 9 | CI workflows ↔ `Makefile` gates | **DB-001 REFUTED** — RLS check *does* run on main/PRs via `integration-verify → make migrate-reset` (gap is asymmetric branch coverage, not absence). **TEST-004 CONFIRMED + amplified** — `lint:fast` is a phantom script; stale Go pins repo-wide; dead migrations-lane condition |
| 10 | `eas.json` ↔ mobile API/Supabase consumers | **FE-001 CONFIRMED + amplified** — envless prod profile → `localhost:3000` + lazy Supabase throw + `mockPolicy` treats prod as `development`. **FE-002 PARTIAL/REFUTED** — duplicate `staging-aab` is real but loses only `SENTRY_DISABLE_AUTO_UPLOAD`, not the anon key (severity lowered to LOW) |

Net effect: 3 claims corrected/narrowed (DB-001 refuted, FE-002 refuted, FE-003 narrowed), ~15 confirmed, 8 amplified with worse detail, 4 new findings (BE-009, FE-007, INFRA-010 + the shared-dedup-row race folded into FE-004). Overall verdict unchanged and reinforced: **NOT READY**.

## Fix Records (Remediation Log)

Running ledger of finding → fix → PR → verification → merge. Statuses are authoritative GitHub state at the time each row was last updated; "OPEN" rows are in review/CI.

### New finding surfaced during remediation

* **AUD-BE-010 (HIGH)** — `internal/maps` `olcCodec.Encode` panicked with `index out of range [-1]` on `main` (`TestMS3_CoverageOrderAndConfidenceEscalation` → `pluscode.go:74`, reached via `Service.forwardV2`). Root cause: successive subtraction drift leaves `latVal` at `-1e-16`, so `floor()` yields `-1`; non-finite inputs additionally bypassed the clamps (NaN slips every comparison, ±Inf spins the longitude loop). **FIXED — PR #307 (merged, `da5a71c5`)**: digit clamped to `[0,19]`, non-finite coords return `""`; `config_pluscode_test.go` pins the edge cases.

### Merged

| Finding | PR | Merge commit | Change | Evidence |
|---------|----|--------------|--------|----------|
| (meta) audit document | #285 | `bd431bae` | This file landed on `main` | merged 2026-09-30 |
| AUD-BE-001 | #286 | `0433100f` | Restored `FeatureContestantSocialEnabled` field + env loader per `2b24b802` | `go build`/`go vet` green; `backend` CI lane green; full `verify` lane (migrate-reset + RLS + tsc + go test -race) green |
| AUD-INFRA-007 | #288 | `d24d3db7` | Registered `GET /healthz` (liveness) + `GET /readyz` (DB-pool ping, 2s bound, 503 when unconfigured/unhealthy) matching deploy.yml/Terraform/uptime-monitor/loadtest callers; `/api/v1/public/health` unchanged | Runtime-verified on :8080; `verify` lane green |
| AUD-FE-008 | #291 | `66608372` | Dual-path utility beneficiaries routes for flag-off mode | CI green; `verify` lane green; new `beneficiaries.spec.ts` 7/7 |
| AUD-BE-005 | #292 | `94954419` | `ChangePassword` verifies current password via GoTrue password grant, updates via `AdminSetPassword`, revokes sessions | `change_password_test.go` pins verify→update→revoke; `verify` lane green |
| AUD-BE-002 | #294 | `c391eebf` | `RequireAuthContext` fails closed (503) on `GetUserStatus` errors; restricted statuses still 403 | `auth_context_test.go` error case; `verify` lane green |
| AUD-FE-002 | #295 | `fac712fa` | Removed duplicate `staging-aab` profile in eas.json (restores `SENTRY_DISABLE_AUTO_UPLOAD`) | JSON parse-validated; no CI lane exercises EAS config |
| AUD-INFRA-001/002 | #296 | `bb585cd4` | Restricted Render datastore allowlists (`ipAllowList: []`); mobile → `runtime: static` + `expo export` (`dist/`); `EXPO_PUBLIC_*` env names; dropped nonexistent `build:web` script | Config parse-validated; no CI lane exercises render.yaml |
| AUD-BE-008 | #297 | `732d4860` | `cmd/notification-worker` asynq consumer binary; `in_app`→push duplicate removed; worker HTTP client bounded | `service_internal_test.go` pins channel→task mapping; `verify` lane green |
| AUD-BE-009 | #298 | `10025679` | Expired-lock login unlatches `status='locked'` → `'active'` | `login_lockout_test.go` pins latch-clearing + revoked-session rejection |
| AUD-SEC-003 | #300 | `3a1fee9a` | Deleted 7 dead client service modules referencing `NEXT_PUBLIC_ADMIN_API_KEY` | 0 importers verified; tsc + regression green |
| (meta) audit bookkeeping | #301/#306 | `d0f11a1b`/`d17cd487` | Remediation log + fix-record passes | merged 2026-09-30 |
| AUD-TEST-004 | #302 | `bd55379e` | Repaired dead/masked CI lanes; aligned Go pins with `go.mod` | CI lanes now execute on `main` |
| AUD-REL-003 / AUD-BE-006 | #304 | `96278884` | Bounded `http.Client` (10s) for GoTrue auth calls; R2 upload PUT bounded (30s) | `go vet`/`go build` green; `verify` lane green |
| AUD-BE-010 | #307 | `da5a71c5` | Plus-code digit clamped to `[0,19]`; non-finite lat/lng return `""` | `TestMS3_*` panic gone; `internal/maps` suite green; edge-case tests added |
| AUD-FE-007 | #308 | `e02e6166` | Paid-vote verify route resolves `transactionId` from `payment_reference` when absent | Route-layer resolution; atomic RPC path unchanged; duplicate #309 closed |
| AUD-REL-002 / AUD-FE-004 | #310 | `67277290` | Webhook dispatcher surfaces handler rejections: 500 partial / 400 all-rejected, rejection reasons logged; fulfilled routine outcomes still 200 | `webhook.spec.ts` 7/7 pins all five status paths; regression 131/131 |
| AUD-DOC-001 | #314 | `350d2574` | CLAUDE.md stale stack metadata corrected | docs-only |
| AUD-FE-006 | #287 | `3c99d83d` | `handleApiError`: tagged `console.error` + guarded `Sentry.captureException` for unexpected errors; response contract unchanged | `verify` green; new `responses.spec.ts` 7/7; regression 129/129; tsc clean (superset of closed duplicate #293) |
| AUD-TEST-001 | #290 | `780a3635` | Categories spec rewritten to pin the intentional flag-gated dual-path contract both directions | `verify` green; spec 16/16; full suite 1140/1140; regression 129/129 |
| AUD-FE-001 | #311 | `2a5ebae8` | Release builds fail loudly when API base URL unset; EAS prod profile env present | merged 2026-09-30 |
| AUD-INFRA-006 (partial) | #312 | `44169978` | Render worker service for `notification-worker` | config-only; workers for cron/indexer/scheduler in #341 |
| AUD-INFRA-008 | #313 | `673d9e78` | Tagged-revision `/healthz` probe replaces `sleep 30` canary stub | deploy gate now observes the real revision |
| AUD-SEC-001 (partial) | #315 | `f7ba24de` | `TRUSTED_PROXIES` env → `SetTrustedProxies`; proxy-aware `ClientIP()` | backend IP keying un-spoofed |
| AUD-INFRA-009 | #316 | `7a8f88b3` | Backup/restore/PITR runbook | docs-only |
| AUD-BE-003 | #318 | `6162e995` | PostgREST `or` pattern quoted/sanitized; over-fetch under scoped filters | httptest-driven repository spec; alt approach #330 open |
| AUD-INFRA-004 | #319 | `02a303a5` | Removed committed typecheck scratch + session trackers | repo root clean |
| AUD-REL-005 | #320 | `c7154594` | `X-Request-Id` mint/echo/propagate middleware; CORS exposes header | 4 specs; invalid inbound IDs rejected |
| AUD-SEC-002b (partial) | #323 | `1a7d8bd5` | Cleared production npm advisories blocking the audit gate | dev-tooling advisories residual |
| AUD-REL-006 | #324 | `2e116cc2` | Internal error strings no longer echoed on 500s | handler responses sanitized |
| AUD-REL-004 | #325 | `5c81f1a0` | Runtime healthchecks point at `/readyz` (DB/Redis probes) | static-200 no longer used for readiness |
| AUD-BE-007 | #326 | `39a502bc` | Atomic `bump_failed_login_attempts` RPC replaces read-modify-write PATCH | `login_lockout_test.go` green; additive migration |
| AUD-SEC-001 (frontend) | #327 | `e1ca74ca` | Rate-limit bucket-map cap, un-spoofed IP keys, dead helper dropped | coverage gaps on protected routes residual |
| AUD-FE-005 | #328 | `5cfc3e07` | Admin API-key role capped by env ceiling; audit actor `api-key` | 31 specs green; regression green |
| AUD-REL-001 | #332 | `e209b074` | Resend response status checked; request bounded | email send failures now surface |
| AUD-REL-005 | #334 | `92fda5c4` | otelhttp instrumentation of the HTTP layer | traces correlate with X-Request-Id |
| AUD-BE-004 | #322 | `dd4787ad` | `TRUSTED_PROXY_CIDRS` → `SetTrustedProxies`; `none` distrusts all | un-spoofed IP keying for all backend IP-derived controls |
| AUD-DB-002 | #329 | `73c4916c` | Unique paid-votes-per-transaction index + terminal-state trigger | DB-layer backstop against double-credit / refund-replay |
| AUD-BE-003 (alt) | #330 | `88bd959d` | Scoped admin user-list filters pushed into PostgREST (`!inner`) | composes correctly with merged #318 — `!inner` only when a scoped filter is present |
| AUD-TEST-003 (gate set) | #331 | `8384aa80` | Full CI gate set now runs on `main` | residual: `apply-branch-protection.sh main` needs an admin token |
| AUD-DOC-003 | #335 | `3d3597ad` | `contract:check` validates all 19 `contracts/*.yaml` | estate conformance mapping preserved |
| AUD-FE-003 (partial) | #336 | `4ceab866` | Webhook fulfils `paymax_gateway` vote charges server-side | other gateway domains still client-verify-only |
| AUD-INFRA-003 | #337 | `2ddb996c` | `docs/devops/deployment-matrix.md` — canonical target per env | resolves parallel-config drift by documentation |
| AUD-INFRA-010 | #338 | `e42563e1` | Go-exclusive Paystack events forwarded to the Go receiver | dual-pipeline dead-half closed |
| AUD-PERF-001 | #339 | `06db8fca` | Request-local RBAC reuse + concurrent post-token fan-out | ~6 sequential Supabase RTTs → ~1 per authed request |
| AUD-INFRA-006 | #341 | `5e59a1cd` | marketplace-cron / indexer / transport-scheduler workers | indexer idles until ES_URL provisioned |
| AUD-SEC-002 | #342 | `eb767724` | Dependabot covers all 16 manifest directories | previously-unscanned npm/gomod/docker surfaces now tracked |
| AUD-SEC-001 (residual) | #346 | `3105dd07` | Per-client rate limit at the `proxyToGoBackend` choke point | ~147 un-limited `/api/v1/*` proxy routes covered |
| AUD-REL-007 | #347 | `66ba2b52` | ADR proposing PostHog product-analytics pipeline | decision record; implementation flag-gated, unscheduled |
| AUD-DB-003 | #362 | `e5e17057` | ADR pinning money-convention boundary at the voting adapter seam | float NGN contained inside protected voting; kobo at the seam |
| (meta) audit bookkeeping | #345 | `a5c62953` | Remediation log sync — 16 newly-merged fixes, open lanes mapped | merged 2026-10-01 |
| AUD-TEST-007 + mobile pre-auth 401s | #365 | `9f9649e0` | Pre-auth 401s kept off session-expired path; e2e logout/consent mocks repaired | merged — Playwright suite 148/148 |
| AUD-BE-013 (route + dedupe DDL) | #366 | `6a84c029` | Academy webhook doubled path `/internal/webhooks/internal/webhooks/academy/*` fixed; dedupe-table DDL failure now loud; gitleaks allowlist for fixture placeholders; `academy_rail_webhook_events` deny-all RLS | merged — verify + live-DB green |
| AUD-AUTH-001 + AUD-TEST-005 | #367 | `dabf165e` | `503` on auth-backend outage (401 reserved for real rejection); worktree-safe pre-commit lint | merged — live-verified: kong down → 503, recovery → 200 |
| (meta) audit bookkeeping | #368 | `5abbbb0d` | Remediation log sync — AUTH-001/TEST-005 findings, merged PRs, local stack | merged 2026-10-02 |
| AUD-BE-011 + AUD-BE-012 | #369 | `4fe0a084` | Header-only `Idempotency-Key` accepted; `wallet_transfers` column drift fixed | merged |
| AUD-TEST-006 | #370 | `354bd7e4` | k6 `URLSearchParams` (absent in goja) replaced with manual query builder | merged — 200-VU run green (0% fail, p95 10ms) |
| (meta) local-stack verification | #371 | `6bc65abe` | Local integration-stack verification run + findings OPS-001, TEST-006/007, QA-001/002 | merged 2026-10-02 |
| AUD-BE-013 (escrow guard) | #372 | `41c1e99c` | Settle legs require matching obligation in terminal-success state; ledger priced by ROW's amount, not wire; non-settle events record but never reconcile; dedupe key includes rail | merged — phantom-ref leg live-verified as no-op |
| (hygiene) committed symlink | #373 | `76642ef2` | Removed committed `frontend-web/node_modules` symlink (landed via #327; self-referential outside `spotlight-latest1` checkout) | merged |
| (meta) findings recorded | #374 | `23bd16ed` | AUD-BE-013 + TEST-008/009 recorded | merged 2026-10-02 |
| AUD-TEST-009 (API half) | #375 | `69891095` | All 7 transport `bookings:` list responses emit `[]` not `null` on empty | merged — live-DB test asserts non-nil |
| AUD-TEST-008 | #376 | `074a4e4d` | Stale `checkout_mutation_load.js` removed (routes deleted by ADR-023) | merged |
| AUD-OPS-001 | #377 | `5b2643d6` | Six drifted `platform_modules.env_flag` values corrected (migration 20270320000000) + `envflag_contract_test.go` replay guard | merged |

### In review

_(none — the campaign's open lanes are all merged; remaining open PRs belong to other sessions)_

### Closed unmerged (superseded / no unique change)

| PR | Reason |
|----|--------|
| #289 | Lockout fix auto-closed when its base branch was deleted; replaced by #298 |
| #293 | FE-006 duplicate — closed in favor of the stronger #287 |
| #303 | Fix-log bookkeeping — superseded by #306 |
| #305 | FE-007 duplicate — closed in favor of the merged #308 |
| #309 | FE-007 duplicate — closed in favor of the merged #308 |
| #321 | REL-005 duplicate — closed in favor of the merged #320 |
| #333 | PERF-002 hard cap — superseded; the meaningful cap landed via merged #327 |
| #343 | Audit sync — superseded by merged #345 |

### Baseline CI failures (not merge-blocking, tracked as findings)

`npm audit (frontend-web)`, `npm audit (mobile-app/reactnative)`, `trivy (filesystem)` are red on every PR including docs-only #285 — pre-existing dependency/IaC advisories, see AUD-SEC-002 and infra findings. Everything else (backend, frontend-*, CodeQL, govulncheck, secrets-scan, gitleaks, verify) is expected green before merge.

## Local Integration Stack Verification (live run, 2026-09-30)

Full local stack exercised end-to-end: mobile web (Metro :8083) → Next.js gateway (:3002, all `FEATURE_*` on) → Go API (:8090, all 36 modules published + all env flags on) → local Supabase (:54321/:54322) + Redis (:6380) + fake rails (:9100). Fixture `qa-claude-test@spotlight.internal` driven through **real GoTrue login** (no seeded session) with KYC tier 3 and a transaction PIN set via the live `POST /api/v1/transfers/pin`.

### Verified working under the live stack

| Area | Evidence |
|------|----------|
| Auth | UI login → GoTrue JWT via `POST /api/auth/login` (Next → Go); bad-password 401 renders inline error without a session-reset loop |
| Module gating | `GET /api/v1/modules/visibility` → 36 published modules; deep-link guard + module catalog agree |
| Transaction-PIN gate | Money routes (`/wallet`, `/services/*` money paths, `/fx`, `/savings`, `/invest`, `/crypto`, `/dues`, `/ai-trading`, `/spotlight-wealth`) hold a PIN-less user on `/security/set-pin`; live `pin/status` honored once set |
| Wallet read path | `GET /api/v1/wallet/balance` → real ledger projection (`available_kobo`, integer minor units) |
| Money mutation + provider failure | `POST /api/v1/utility/pay` (₦100 airtime, `Idempotency-Key` set): wallet DEBIT 10,000 + clearing CREDIT 10,000 posted; VTPass creds absent upstream → txn auto-`reversed` with REVERSAL_DEBIT/REVERSAL_CREDIT pair; balance restored. Replay with the same key → `already_processed:true`, no re-debit |
| Ledger integrity | `ledger_entries` shows balanced pairs only; `idempotency_key` UNIQUE enforced (replay rejected before write) |
| Failure tolerance | Redis stopped → `GET /api/finance/wallet/balance` still 200 in ~240ms (DB path, not cache-dependent); Elasticsearch absent → `GET /v1/marketplace/search` returns 200 `{"degraded":true}` rather than 5xx |
| Concurrency | k6 `marketplace/search_load.js` ramped to ~200 VUs: **15,574 requests, 0% failed, p95 = 10.04ms** (budget 250ms) |
| Playwright | mobile-chrome suite green against the live stack (incl. transaction-PIN, auth, bills, insurance, wallet specs) |

### New findings from the live run

| ID | Severity | Finding | Evidence |
|----|----------|---------|----------|
| AUD-OPS-001 | MED | **Module env-flag drift**: `platform_modules.env_flag` is resolved by free-form `os.Getenv` at runtime, but six registry values don't match any `getEnvBool` name in `config.go`. `association` is the sharpest: registry gate reads `FEATURE_ASSOCIATION_ENABLED` (singular) while the route mount gate reads `FEATURE_ASSOCIATIONS_ENABLED` (plural) — ops enabling either alone gets a module that is "visible" but 503s, or mounted but hidden. Same class: `beneficiaries`, `fintechAdmin`, `kyc` (vs `FEATURE_KYC_VERIFY_ENABLED`), `utilityPayments` (vs `FEATURE_UTILITY_BILLS_ENABLED`), `votesBridge` (`VOTES_BRIDGE_ENABLED`) | Reproduced locally: registry `visible` + `FEATURE_ASSOCIATIONS_ENABLED=true` → `GET /api/finance/associations` → 503 `{"module":"association"}`; adding `FEATURE_ASSOCIATION_ENABLED=true` cleared it. FIXED → PR #377: migration 20270320000000 corrects the six rows to the flags the code actually reads (fintechAdmin → '' — RBAC-gated, no kill switch exists); `envflag_contract_test.go` replays migrations and fails if any effective env_flag names a var no Go code reads |
| AUD-TEST-006 | LOW | k6 `marketplace/search_load.js` was never runnable — `URLSearchParams` doesn't exist in goja; every iteration threw `ReferenceError` | `ReferenceError: URLSearchParams is not defined` on first VU; fixed (manual query builder) → PR #370 |
| AUD-TEST-007 | LOW | e2e helpers left `**/auth/v1/logout` and `**/api/v1/insurance/consent**` unmocked — against a live backend the 401s trip the global axios interceptor and sign the fake session out mid-test | insurance `protection.spec.ts` 106/116 landed on /login; fixed on PR #365 (logout → 204, consent GET → `{granted:false}`) |
| AUD-QA-001 | INFO | Virtual-account provisioning (`GET /api/v1/virtual-accounts/me`) requires a live Paystack key; with the local placeholder it returns a clean 502 "couldn't reach our banking partner" — graceful, but the VA flow is UNVERIFIED end-to-end | `502` with friendly message; needs `PAYSTACK_SECRET_KEY` test value or a Paystack fake rail |
| AUD-QA-002 | INFO | `insurance_products` is empty in local seed data — insurance catalog renders `{"data":null}`; purchase path exercised only through mocks | `GET /api/v1/insurance/products` → 200 `data:null` |
| AUD-BE-013 | HIGH | **Academy rail webhooks posted escrow→settlement legs unconditionally** — a validly-signed `settled` event for ANY provider ref (incl. refs owning no obligation) debited the pooled `escrow` standing account and credited `settlement`, priced by the WIRE's `amount_minor`. Live-verified: phantom ref moved 50,000 kobo; a 50,000-kobo payout ref carrying `amount_minor: 50_000_000` moved 50,000,000. `payout` had no owning-row interaction at all; disburse/billing UPDATEs ignored RowsAffected. | Synthetic signed webhook to :8090 → `{"data":"ok"}` + `DEBIT escrow 50000 / CREDIT settlement 50000` for a fabricated ref. FIXED → PR #372: leg requires the obligation row in its terminal settle state and posts the ROW's amount; non-settle events record but never reconcile; idem key uses route rail. Residual: transient PostJournal failure leaves terminal row + no leg + dedupe consumed (no retry path) → outbox/redrive follow-up |
| AUD-TEST-008 | LOW | `marketplace/checkout_mutation_load.js` targets `POST /v1/marketplace/orders` — removed by ADR-023 (marketplace is now a contact directory, no escrow orders). Script can never pass; it is stale against shipped behavior | `POST /v1/marketplace/orders` → 404 on :8090. FIXED → PR #376: script deleted; `docs/prd/marketplace/QA_REPORT.md` + transport QA report updated (section collapsed to historical note). If a marketplace money surface returns (`POST /boosts`), rewrite mutation coverage against it |
| AUD-TEST-009 | LOW | `transport_scheduled/list_read_load.js` asserts `Array.isArray(bookings)` but the endpoint serializes empty as `{"bookings":null}` — 0% of responses could ever pass the shape check; also `RIDER_TOKENS` JWTs expire mid-run (>1h runs) causing mass 401s | 14,462 reqs: 7,143×200 / 7,319×401 (token expired mid-run); `has bookings array` 0% against `bookings:null`. API half FIXED → PR #375: all 7 transport `bookings:` list responses now emit `[]` on empty (nil-slice accumulators normalized in ListScheduled, ListScheduledAdmin, ListCarHire, ListCarHireBookings, ProviderBookings, ListEventBookings, ListEventBookingsAdmin; live-DB test asserts non-nil). k6 half open: tokens still expire mid-run — refresh inside the script |
