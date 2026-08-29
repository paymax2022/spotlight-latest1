# CLAUDE.md — Paymax × Spotlight Super App

## What this project is
Spotlight is a live contest/voting platform being transformed into a **fintech super app**
(wallet, virtual accounts, KYC, tiers, referrals, RBAC, FX, groups, events, telemedicine,
transport, estate, crowdfunding, restaurant delivery, AI care).

Full playbook: `PAYMAX_BUILD_PLAYBOOK.md` (v2 — supersedes v1).  
Architecture audit: `docs/architecture/audit.md`.  
Build sequence (v1 blocks 0-12 done): `docs/build-playbook.md`.  
API source of truth: `contracts/openapi.yaml`.

### Key architecture decisions (from audit)
- **Go backend router**: Gin v1.10 — NOT Chi. Playbook v2 references Chi but CLAUDE.md requires Gin. Keep Gin.
- **Financial DB access**: pgx pool (`backend/internal/platform/db/`) for money-path; Supabase REST for Spotlight modules.
- **Redis**: `backend/internal/platform/redis/` — idempotency cache, Redlock, asynq queue.
- **Finance modules**: `backend/internal/finance/` — ledger, wallet, kyc, tiers, transfers, referrals, va.
- **Provider adapters**: `backend/internal/provider/` — `PaymentProvider` interface, Paystack adapter.

## Iron rules — never violate, no exceptions

### Money handling
- All monetary amounts are **integers in minor units (kobo)**. Never floats. Never strings for math.
- Every money mutation MUST: (1) require an `Idempotency-Key`, (2) post balanced
  double-entry ledger entries, (3) emit an audit event, (4) pass tier-limit checks fail-closed.
- Wallet balances are **projections of the ledger** — never UPDATE a balance column directly.
- Ledger entries are immutable. Corrections = reversing entries only.
- When writing money-path code, load the `money-handling` skill first.

### Brownfield safety
- **NEVER modify files in the existing Spotlight modules** (contests, voting, applicants,
  legacy auth). Wrap them via adapters (see `vote-bridge` skill). Protected paths are
  enforced by a PreToolUse hook — if blocked, you are touching the wrong file.
- All DB migrations are **additive-only**: no DROP, no column renames, no type narrowing.
  Load the `db-migrations` skill before writing any migration.
- **Never reuse a migration version.** `schema_migrations` is keyed on the leading
  timestamp alone, so two files sharing one aborts `supabase start`/`db reset` partway
  through the chain. Re-check for collisions **immediately before merging**, not only when
  authoring — a version free at write time can be claimed by another PR while yours is in
  review, and the break only surfaces on the base branch after your merge. When it happens,
  the migration that reached the base branch **last** renumbers. Enforced by
  `scripts/ci/check-migration-versions.sh` in the `hygiene` CI lane.
- The golden-path regression suite must be green before and after every change:
  `cd frontend-web && npm run test:regression` (9 specs, 120 tests).

### Workflow
- API changes start in `contracts/openapi.yaml` — spec PR first, then implementation.
- New module = run `/new-module` command for the scaffold checklist.
- Money-path code: write failing tests FIRST (delegate to `test-engineer` subagent),
  then implement until green.
- Before marking any money-path task complete, request review from the `ledger-auditor`
  subagent. Before any PR touching auth/PII, request `security-reviewer`.
- Every non-obvious design choice gets a 1-page ADR in `docs/adr/`.
  **Never pick the ADR number yourself.** Name the file `ADR-PR<pr-number>-<slug>.md`
  and cite `ADR-PR<pr-number>` in every reference (prose, Go comments, SQL headers);
  the real number is assigned on merge by `.github/workflows/adr-assign.yml`.
  Hand-picking a number is how the repo collected six duplicate ADRs and three
  renumbering PRs in one day — `adr-guard.yml` now fails the PR if you do.
- Feature-flag every new module. No flag, no merge.
- Conventional Commits. PRs < 400 lines where possible.

## Stack & layout
- **Frontend web:** `frontend-web/` — Next.js 14.2, TypeScript, Tailwind CSS, Supabase SSR;
  served on cPanel Passenger (Node 20 + `frontend-web/server.js` entrypoint).
- **Admin dashboard:** `frontend-admin/` — Next.js 15.1, port 3001 (console at http://localhost:3001/admin). No Refine.
- **Backend API:** `backend/` — Go 1.23, Gin v1.10; module `spotlight/backend`.
- **Mobile:** `mobile-app/reactnative/` (React Native/Expo), `mobile-app/vue-quasar/` (Vue 3).
- **Database:** PostgreSQL 17 via Supabase (cloud-hosted). No ORM — raw Supabase JS client
  + SQL RPCs. ~291 additive-only migrations in `supabase/migrations/`. Local DB port 54322.
- **Auth:** Supabase Auth (managed JWT/HS256). HTTP-only cookie session in Next.js middleware
  (`frontend-web/src/middleware.ts`); Bearer token validated via service-role client in API
  route handlers (`frontend-web/src/lib/auth/request.ts`); Go backend uses
  `RequireAuthContext` + RBAC permission middleware.
- **Storage:** Cloudflare R2 (`@aws-sdk/client-s3` presigned URLs). Bucket: `spotlight-open-mic`.
- **Email:** Resend API (`RESEND_API_KEY`). No queue — fire-and-forget; failures are silent.
- **Payments:** Paystack. HMAC-SHA512 webhook verification. Live webhook handler:
  `frontend-web/app/api/webhooks/paystack/route.ts`.
- **Test runner (frontend):** Vitest 4.1 (`frontend-web/vitest.config.ts`), v8 coverage,
  node environment. ~42 specs under `frontend-web/tests/` (golden-path, finance money-invariants,
  wallet/ledger, tiers). Mobile: Playwright e2e under `mobile-app/reactnative/tests/e2e/`.
- **Test runner (backend):** `go test` (see `Makefile` `test`/`verify`, run `-race`). ~253 Go
  test files incl. `backend/tests/` domain + invariant suites (ledger, settlement split, fees,
  fx, crypto/cryptoaml, arenaquiz, edtechfees…); live-DB integration tests gated on
  `TEST_DATABASE_URL`. NOTE: repo-wide `ci.yml` runs only build+vet — full `go test` runs in
  per-module CI lanes + the Makefile. See `backend/tests/TEST_STRATEGY.md`.
- **⚠️ Separate trading service:** `mobile-app/reactnative/backend/` is a standalone Go module
  (`paymax/crypto-backend`, its OWN Postgres via golang-migrate) housing crypto + stocks + invest
  trading. It is distinct from `backend/internal/crypto` (the ledger-integrated crypto in the main
  module). See `docs/audit/PHASE-1-FINTECH-PLATFORM-AUDIT.md`.
- **⚠️ No Turborepo, no `apps/` directory, no `packages/` directory.** The previous layout
  description was aspirational. Actual layout: `frontend-web/`, `frontend-admin/`,
  `backend/`, `mobile-app/`, `supabase/`, `docs/`.

## Commands you should know
There is **no root `package.json`** — every `npm run` below must be run from its own
module directory.
- `cd frontend-web && npm run test:regression` — golden-path regression suite
  (must always pass): `tests/unit/golden-path`, 9 specs, 120 tests
- `cd frontend-web && npm run test:money` — money invariants (`tests/unit/estate`,
  `tests/unit/wallet`, `tests/unit/tiers`)
- `cd frontend-web && npm run contract:check` — estate implementation vs
  `contracts/estate.openapi.yaml` (estate only — it does not check `openapi.yaml`)
- `cd frontend-web && npm run lint` — ESLint via Next.js lint config
- `cd frontend-admin && npm run type-check` — TypeScript strict check (`tsc --noEmit`)
- `cd frontend-web && npx tsc --noEmit` — TypeScript check for the web app
- `cd backend && go vet ./...` — Go static analysis
- `cd backend && go build ./...` — Go compile check (no test framework configured yet)
- `cd frontend-web && npx vitest run` — run all unit tests once
- `cd frontend-web && npx vitest run --coverage` — with v8 coverage report
- `supabase db push` — apply pending migrations to the connected Supabase project
- `supabase migration new <name>` — create timestamped migration in `supabase/migrations/`
- `supabase db reset` — reset local Supabase instance and replay all migrations (dev only)
