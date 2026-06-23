# Estate super-app — deploy runbook (Block 47d)

Turnkey checklist to take Blocks 29–46 from green-in-CI to live. Everything
except the steps marked **[infra]** has already been prepared in the repo; the
infra steps are the only ones that require a runner / live Supabase / store
build and so could not be executed in the authoring sandbox.

## 0. Preconditions
- All estate feature code merged (Blocks 29–46): 34 handlers, 18 mobile modules,
  17 route groups, 8 estate migrations.
- CI workflow `.github/workflows/visitor-election-ci.yml` is green (it now runs:
  scoped + whole-app tsc, expo-export, frontend tsc + lint, openapi validate,
  **contract-check**, **estate-money-tests**, migration-guard).

## 1. Database migrations  **[infra]**
Apply additively, in timestamp order. All are `CREATE … IF NOT EXISTS` / additive:
```
supabase db push        # applies 20260622010000_estate_modules.sql,
                        #         20260622020000_estate_modules_38_46.sql,
                        #         20260622030000_estate_indexes.sql
```
Verify the additive guard first (no DROP/ALTER COLUMN/narrowing):
```
grep -iE '\b(drop\s+(table|column)|alter\s+column|drop\s+not\s+null)\b' \
  supabase/migrations/*estate_modules*.sql supabase/migrations/*estate_indexes*.sql
# → no matches = safe
```

## 2. Seed reference data  **[infra]**
- `estate_facilities`, `estate_vendors`, and per-resident `estate_dues_invoices`
  are estate-operator data. Seed via the admin tooling or SQL for the pilot estate.
- Confirm each pilot user has an `estate_residents` row (drives `getResidentContext`).

## 3. Backend (frontend-web) deploy  **[infra]**
- Deploy the Next.js route handlers (`/api/v1/estate/*`). They use the
  service-role Supabase client; ensure `SUPABASE_SERVICE_ROLE_KEY` is set
  **server-side only** and never exposed to the mobile bundle.
- Smoke: `GET /api/v1/estate/dues` and `GET /api/v1/estate/finance` (admin) with a
  real bearer token return 200 / 403 as expected.

## 4. Flip the mobile mock flags
Every estate module defaults to mock. Create `.env.production` from the template
and run the guard (already in the repo):
```
cd mobile-app/reactnative
cp .env.production.example .env.production
# set EXPO_PUBLIC_API_BASE_URL to the deployed backend
node scripts/check-estate-mocks.mjs .env.production   # fails if any flag != false
```
The guard covers all 18 estate (+ visitor/election) flags so none can be missed.

## 5. Money-path verification
```
cd frontend-web
npm run test:money      # dues invariants + ai-notes summariser (17 tests)
npm run contract:check  # estate impl ↔ contracts/estate.openapi.yaml in sync
```
Both run in CI; re-run against the release commit before promoting.

## 6. RLS / index verification  **[infra]**
Per `docs/estate/SECURITY-RLS-INDEX-AUDIT.md`:
- With a **non-service-role** (authenticated) token, confirm a resident of estate
  A cannot read estate B's rows, and cannot read another resident's
  `estate_notifications` / `estate_member_settings`.
- `EXPLAIN ANALYZE` the five newly-indexed hot paths against production-scale data.

## 7. Mobile build & e2e smoke  **[infra]**
```
cd mobile-app/reactnative
npx tsc --noEmit -p tsconfig.visitorcheck.json   # scoped estate type-check
npx expo export --platform ios                   # Metro resolves all imports
# then EAS build / store submit
```
e2e smoke on a device against the live backend: pay a dues invoice (idempotent —
re-tap must not double-charge), report an emergency, RSVP a meeting, book a
facility, generate an AI note, toggle a notification setting.

## 8. Rollback
- Mobile: flip the relevant `EXPO_PUBLIC_*_USE_MOCK=true` (or ship the prior
  build) — the dual data layer falls back to mocks with no code change.
- Backend: migrations are additive, so rollback is "stop calling"; no down-migration
  needed. Feature-flag the route group off if required.

---
**Status:** Steps with no **[infra]** tag are repo-ready and CI-enforced. The
**[infra]** steps are the residual Block 47d work that needs a runner / live
Supabase / store build.
