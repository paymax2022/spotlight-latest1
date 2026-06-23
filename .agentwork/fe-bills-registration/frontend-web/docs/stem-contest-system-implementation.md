# STEM Contest System Implementation (Phase Foundation)

## Existing Stack Inspection
- Frontend framework: Next.js 14 App Router + React 18 (`frontend-web`).
- Backend framework: Go + Gin (`backend`).
- Database: Supabase Postgres (via migrations and REST integration).
- Auth: Supabase auth patterns (`src/contexts/AuthContext.tsx`, `src/lib/auth/server.ts`).
- Existing STEM module: strong backend STEM service/repository coverage (`backend/internal/services/stem_service.go`, `backend/internal/repositories/stem_supabase_repository.go`).
- Existing payments: Paystack utilities in frontend (`src/lib/payments/*`) and payment fields in existing modules.
- Existing voting/contests: contest/voting tables and services already present in migrations and services.

## What This Phase Adds
- Admin-configurable STEM engine in frontend app APIs (`/api/stem/*`, `/api/admin/stem/*`) with reusable model primitives:
  - Contest configuration
  - Category configuration
  - Price category configuration
  - Prize category configuration
  - School onboarding and verification review hooks
  - Student school-join request flow
  - School/student/innovator STEM application draft + submit lifecycle
  - Application review and timeline events
- Dedicated STEM application wizard for `/apply/stem-contest` using existing template styles.

## New Code Areas
- `src/features/stem/*`:
  - `types.ts`
  - `constants.ts`
  - `validation.ts`
- `src/server/stem/*`:
  - `store.ts`
  - `auth.ts`
- `app/api/stem/*` public/applicant routes.
- `app/api/admin/stem/*` admin control routes.
- `components/forms/StemContestApplicationWizard.tsx`.

## Database Foundation Added
- Migration: `supabase/migrations/20260521212000_stem_admin_configurable_contest_system.sql`
- Adds configurable STEM contest tables for:
  - contest configs
  - contest categories
  - price categories
  - prize categories
  - school join requests
  - contest applications
  - application status history

## Next Delivery Phases
1. Wire frontend admin dashboard UI to `/api/admin/stem/*`.
2. Persist stem store logic to Supabase tables (replace in-memory store adapter).
3. Integrate real authz guards with Supabase role checks for admin endpoints.
4. Add payment provider-agnostic payment adapter for STEM registration/voting prices.
5. Add school admin dashboard pages (join requests approval, cohort view, bulk payment handoff).
6. Add anti-fraud checks and full audit log writes for every admin mutation.
