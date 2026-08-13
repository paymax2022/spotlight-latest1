# ADR-029 — Admin (modules) type debt: port support files to `src/`, keep alias paths

**Date:** 2026-08-12
**Status:** Accepted
**Deciders:** Platform/Web
**Scope:** `frontend-web/src/{services,types,components,features}` (files copied from
`frontend-admin/src`), `frontend-web/tsconfig.json` (exclude entries removed),
13 pages under `frontend-web/app/admin/(modules)` (nullability fixes only). No API change.

## Context

The admin-portal consolidation copied ~70 admin modules from `frontend-admin` into
`frontend-web/app/admin/(modules)`, but not the support code they import. The pages
reference `frontend-admin`-local aliases — `@/components/ui/vuexy`, `@/services/*Service`,
`@/types/*`, `@/features/auth/rbac`, `@/components/rbac` — that resolved nowhere in
`frontend-web`: ~2,450 type errors, parked behind two `tsconfig.json` exclude entries
("INTERIM DEBT") that also kept webpack from ever building those routes successfully.

The transitive import closure of the 131 missing specifiers is 139 files
(72 services, 57 type modules, vuexy UI kit, rbac components, rbac helpers,
`config/env.ts`), and depends on nothing but `react`.

## Decision

1. **Copy the closure into `frontend-web/src/` at the same relative paths** it had in
   `frontend-admin/src/`. Because `frontend-web`'s `@/*` alias already maps to
   `["./*", "./src/*"]`, every import in the (modules) pages resolves with **zero edits
   to the pages themselves** — no 486-site rewrite of `@/components/ui/vuexy`, no churn
   against future re-syncs from `frontend-admin`. This was chosen over an isolated
   `src/admin-kit/` home, which would have required rewriting every import (or adding
   specifier-by-specifier tsconfig path aliases that webpack, vitest, and tsc would each
   need to duplicate).
2. **Skip `config/env.ts`** — `frontend-web` already has one. The admin services only use
   `env.apiBaseUrl`, which it already exports; `legacyAdminBaseUrl` (used by the
   `[...slug]` legacy bridge page) was added to it additively.
3. **`frontend-admin` stays untouched and remains the source of truth** for these files
   until it is retired; the copies are a consolidation step, mirroring how the pages
   themselves were ported.
4. The two tsconfig exclude entries are deleted, so `npx tsc --noEmit` (the CI gate)
   covers the whole tree again. Residual real errors were fixed at the source:
   Next 15's nullable `useParams()`/`useSearchParams()` handled at 13 call sites, and the
   dead copy of `users.test.tsx` deleted (it imports `@testing-library/react`, which
   `frontend-web` doesn't install, and the vitest include pattern never ran it; the
   original still runs in `frontend-admin`).

## Consequences

- `frontend-web` type-checks clean end-to-end; the (modules) routes also become
  buildable by webpack for the first time.
- Duplicate service/type sources exist between the two apps while `frontend-admin`
  is alive. Divergence risk is accepted and bounded: the plan of record is retiring
  `frontend-admin`, at which point the copies become the only source.
- Anyone re-porting a module from `frontend-admin` must also port new support files it
  imports — the pattern is now established (same relative path under `src/`).
