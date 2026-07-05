# ASSOCIATION MODULE — PRODUCTION INTEGRATION CONTRACT (read first)

Goal: bring the **association** module to production-grade — every feature on **mobile**
and the **admin portal** wired to real backend endpoints, with data that **binds and
persists**. The module is already substantially built; this is an audit + gap-fill +
verification effort, NOT greenfield. House doctrine (`CLAUDE.md`) applies: kobo integers,
Idempotency-Key on money endpoints, additive-only migrations, double-entry ledger, OLA,
audit trail.

## Current state (verified)
- **Backend** `backend/internal/association/` (Go, Gin, pgxpool — DB-backed, no stubs). ~70
  endpoints registered in `backend/internal/app/finance_routes.go`:
  `assocSvc := association.NewService(pool, ledgerSvc); association.RegisterRoutes(finance.Group("/associations"), assocHandler)`.
  `finance := r.Group("/api/finance")` → **routes live at `/api/finance/associations/...`**.
- **DB**: `supabase/migrations/*association*.sql` (4 migrations, `assoc_*` tables).
- **Mobile** `mobile-app/reactnative/src/features/association/` — api (`*.api.ts`) + mocks
  (`*.mock.ts`), hooks, types, components; screens in `app/association/**` (~40 screens:
  home, join, dues/pay, chat, committees, ai-notes, tasks, announcements, events, card,
  member, settings/*, admin/*). Mock toggle: `USE_MOCK` in
  `constants/association.constants.ts` = `EXPO_PUBLIC_ASSOCIATION_USE_MOCK !== 'false'`;
  `.env` sets it **false** (live).
- **Admin** `frontend-admin/app/admin/association/` — ONLY `dashboard`, `approvals`, `dues`
  + `src/services/associationAdminService.ts` (~6 methods). MISSING vs backend admin
  endpoints: members mgmt (suspend/transfer/role/restore), offline-finance decisions UI,
  bulk import (preview/confirm), audit log, KPIs surfacing.

## �︎ CRITICAL GAP #1 — base-path mismatch (fix first, coordinate A↔B)
Mobile association api calls **`/associations/...`** (e.g. `/associations/me/dashboard`) but
the backend serves **`/api/finance/associations/...`**. So live calls do not resolve.
RESOLUTION (frozen): the mobile association api base becomes **`/api/finance/associations`**
to match the backend and the other working finance modules. Agent B prefixes every mobile
association live path accordingly (a single shared base const). Agent A confirms the backend
serves them and that the dev proxy (frontend-web on :3000) forwards `/api/*` to Go (it already
does for other modules); add a rewrite only if missing. Verify against a known-working module
(e.g. `src/api/wallet.api.ts`) to copy the exact base convention.

## CRITICAL GAP #2 — mobile persistence gaps
- `api/association.createdStore.ts` + `orgCreate.api.ts` keep created organisations in a
  CLIENT-SIDE store when `USE_MOCK`. In live mode, org creation MUST persist via
  `POST /api/finance/associations` and subsequent reads MUST come from the backend, not the
  client store. Audit every api file: no feature may silently depend on a mock/local store in
  live mode. Each create/update/pay/decision must round-trip to the backend and re-fetch.

## FILE OWNERSHIP (disjoint — do not cross)
- **A · Backend + proxy + migrations**: `backend/internal/association/**`,
  the wiring line in `backend/internal/app/finance_routes.go`, additive
  `supabase/migrations/2026*_association_*.sql` if a column/table is missing, and (only if
  needed) a frontend-web rewrite for `/api/finance/associations`. Audit that EVERY path the
  mobile (see below) and admin call has a persisting handler; add any missing endpoint
  (additive). Must `go build ./internal/association/... ./internal/app/...` clean.
- **B · Mobile integration**: entire `mobile-app/reactnative/src/features/association/**`
  and `mobile-app/reactnative/app/association/**`. Fix base path (Gap #1), close persistence
  gaps (Gap #2), ensure every screen binds to live data via hooks and that create/update
  mutations persist + invalidate/refetch. Keep mocks as offline fallback but never as the
  live source of truth. Do NOT edit backend or admin.
- **C · Admin portal**: `frontend-admin/app/admin/association/**` +
  `frontend-admin/src/services/associationAdminService.ts` (+ types under existing admin
  types dir). Build the MISSING admin pages to full parity with backend admin endpoints
  (members list/detail with suspend/transfer/role/restore; offline-finance decisions;
  import preview/confirm; audit log; KPIs), each wired live via the service, RBAC-gated like
  existing admin pages, mutations requiring reason where the backend does, money in kobo→₦
  display only. Reuse existing admin `_ui.tsx` patterns.
- **D · QA**: `backend/tests/association/**` — black-box Go integration tests (external test
  package, exported API only) for the persistence + money paths (dues pay → ledger + receipt;
  approval decision; offline payment decision; member suspend/transfer/role; org publish;
  ai-note approve/publish). Assert idempotency on money endpoints and audit-trail writes.
  Document which need a live DB (skip-gated on DATABASE_URL). + `docs/prd/association/QA_REPORT.md`.
- **E · DevOps + final verification** (runs LAST): `go build`/`go vet` across
  `internal/association` + `internal/app` + `tests/association`; best-effort admin/mobile
  typecheck scoped to association; reconcile any base-path/endpoint mismatches the builders
  left; write `docs/prd/association/INTEGRATION_VERIFICATION.md` with a prioritized punch-list
  (live DB apply, endpoints still missing, anything not persisting).

## Rules
- Additive migrations only. Money in kobo. OLA + audit on admin mutations. Idempotency-Key on
  money POSTs (dues pay). Don't run git checkout/commit/branch/stash. Stay in your boundary.
  Use portable Go 1.25 for builds (install to /tmp/go125 if absent;
  PATH=/tmp/go125/go/bin:$PATH GOFLAGS=-buildvcs=false GOCACHE=/tmp/gocache GOMODCACHE=/tmp/gomod).
