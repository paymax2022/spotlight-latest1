# SP-3b: Pricing & Platform-Fee Admin Console (Next.js) — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:subagent-driven-development or superpowers:executing-plans. Steps use checkbox (`- [ ]`). This is the admin-UI slice of SP-3; it **depends on SP-3a's real backend endpoints**. No money mutation happens in the UI, but it CONFIGURES money behavior — maker-checker, permissions, and simulator fidelity are the safety surface.

**Goal:** Turn the mostly-mock `frontend-admin` FX section into a real, permissioned **Pricing & Platform-Fee Console**: rate card (L0), Platform-Fee schedule, spread rules, pricing simulator, profit/recon/treasury dashboards — all backed by the SP-3a endpoints.

**Architecture:** Extend `frontend-admin/src/services/fxAdminService.ts` to call the now-real `/api/finance/admin/fx/*` routes (remove `NO_BACKEND_YET` for them), build pages under `frontend-admin/app/admin/fx/*` on the shared `vuexy.tsx` + `app/admin/fx/_ui.tsx` kit, gate every route + action with the permission bundles (`routeGuard.ts`, `hasPermission`, `PermissionGuard`), and mirror the maker-checker/effective-dating from the backend.

**Tech Stack:** Next.js 15.1 (frontend-admin), TypeScript strict; existing `vuexy.tsx`/`_ui.tsx`; `fxAdminService.ts` + `idempotency.ts`; RBAC in `src/features/auth/{routeGuard,rbac}.ts`.

**Spec:** [`docs/superpowers/specs/2026-10-16-sp3-pricing-platform-fee-commission-design.md`](../specs/2026-10-16-sp3-pricing-platform-fee-commission-design.md) (§10) · Backend: [`2026-10-16-sp3a-pricing-commission-backend.md`](2026-10-16-sp3a-pricing-commission-backend.md)

## Global Constraints
- Every console route AND every mutating action is permission-gated (define the bundles: Admin / Finance / Compliance / Support-L1/L2 / Read-only → permission sets layered on the existing string permissions). A read-only admin can view but not mutate.
- **Money shown in integer minor units** via the existing `money()`/`moneyFull()` helpers; native currency + NGN roll-up both displayed where the backend returns them.
- **Dangerous actions are slow:** pricing changes require maker-checker (a second approver) + a reason + effective date; the UI must not let a maker self-approve.
- **Simulator fidelity:** the pricing simulator calls the SAME backend `pricing.Resolve` (SP-3a Task 9), never a client reimplementation — it must match a real quote byte-for-byte.
- No route/service may call an endpoint that still throws `NO_BACKEND_YET`; only wire the routes SP-3a made real.
- `tsc --noEmit` and `npm run lint` clean for `frontend-admin`.

## Review Focus
- **Permission bypass:** a Read-only or Support role must not be able to invoke a mutate (schedule edit, rate-card edit, approve) — both route-level and per-action. → Task 1/3 tests.
- **Maker-checker self-approval:** the UI must block the same admin approving their own pricing change. → Task 3.
- **Simulator divergence:** the simulator must render exactly the backend decomposition; no client-side fee math. → Task 5.
- **Stale/mock calls:** no console action may hit a `NO_BACKEND_YET` path. → Task 1.
- **Money formatting:** amounts use `money()`/currency metadata, never float string concat. → all tasks.

---

### Task 1: Service layer de-mock + RBAC permission bundles
**Files:** Modify `frontend-admin/src/services/fxAdminService.ts`; Modify `src/features/auth/{routeGuard.ts,rbac.ts}` (or a bundles module); Test: service + guard unit tests.
- Remove `NO_BACKEND_YET` / `USE_MOCK` for the routes SP-3a made real (rate card, platform-fee schedule, spread, simulator, fee-collection settings, refund-fee policy, profit/recon/treasury); keep mocks only for still-unbuilt surfaces. Writes carry `Idempotency-Key` via `idempotency.ts`.
- Define permission bundles mapping the 5 roles → existing permission strings (`finance.admin.fx_markup`, a new `finance.admin.pricing`, `audit.logs.view`, etc.); add `routeGuard` prefix rules for the new pages.
- [ ] Failing tests: the service calls the real path (not the mock) for each now-real route; a Read-only bundle fails `hasPermission` for a mutate; a Finance bundle passes. → RED → implement → GREEN (`tsc --noEmit`, lint) → commit.

### Task 2: Rate Card editor (L0 Verto costs)
**Files:** `frontend-admin/app/admin/fx/rate-card/*` (or extend `app/admin/commission`).
- CRUD the Verto cost rate card per corridor/rail with validity dates + source-doc attachment; an "unknown cost" row blocks go-live (banner). Permission-gated; money cells via `money()`.
- [ ] Acceptance: create/edit/expire a card; unknown-cost warning; read-only cannot edit. `tsc`/lint clean. Commit.

### Task 3: Platform-Fee schedule editor (maker-checker, effective-dated)
**Files:** `frontend-admin/app/admin/fx/pricing/*`.
- Edit the fee schedule by service × corridor × plan × tier × amount band (flat/pct/min/max, payer mode); every change is a maker-checker proposal with a reason + effective date; a second approver (different admin) commits; instant rollback to a prior version.
- [ ] Acceptance: a maker creates a change (pending); the SAME admin cannot approve it (blocked); a checker approves; rollback restores the prior version; guardrail violations from the backend surface as inline errors. `tsc`/lint clean. Commit.

### Task 4: Spread rules (sync to Verto markup config)
**Files:** extend `frontend-admin/app/admin/fx/spread/page.tsx`.
- Make the existing spread page real against the SP-3a spread endpoints; show last-sync + diff vs Verto `/fx/markup/config`; universal / per-pair / per-trade override.
- [ ] Acceptance: edit a spread rule → persists + shows sync status; permission-gated. `tsc`/lint clean. Commit.

### Task 5: Pricing simulator + margin heatmap
**Files:** `frontend-admin/app/admin/fx/pricing/simulator/*`.
- Pick corridor + service + amount + plan/tier → call the backend simulator (SP-3a Task 9) and render the exact line-item decomposition (platform fee, spread, provider cost, tax, est. profit, margin). Margin heatmap by corridor. NO client-side fee math.
- [ ] Acceptance: the simulator output matches a real quote for the same inputs (assert against the backend response, not a client calc); heatmap renders from backend data. `tsc`/lint clean. Commit.

### Task 6: Profit, reconciliation & treasury dashboards
**Files:** `frontend-admin/app/admin/fx/{profit,reconciliation,treasury}/*` (extend existing where present).
- Profit by service/corridor/plan/provider: **native currency + NGN roll-up**, accrued vs settled, waiver cost, variance vs Verto statement; drill to ledger/commission rows; CSV export. Recon dashboard + break management (assign/resolve, runbook link). Treasury: NGN master balances, unswept fees, low-balance alerts, sweep run history.
- [ ] Acceptance: dashboards render from the real endpoints; native+NGN both shown; drill-down resolves to a transaction; export works; read-only can view, not resolve breaks. `tsc`/lint clean. Commit.

---
## Done when
The FX admin section is real (no `NO_BACKEND_YET` on wired routes), permission-bundled (read-only can't mutate; maker can't self-approve), the simulator matches production quotes byte-for-byte, and profit/recon/treasury dashboards render native + NGN from the SP-3a endpoints; `tsc --noEmit` + lint clean; `ADR-PR<pr#>-pricing-admin-console.md` records the role→permission-bundle mapping.

## Verification note
`frontend-admin` uses `npm run type-check` (`tsc --noEmit`) + `npm run lint`; there is no heavy admin component-test suite, so gate on type-check + lint + the service/guard unit tests + a Browser-pane visual check of each page against the running backend (SP-3a) behind the flag. Do not claim a page works without loading it against real endpoints.

## Deliberately NOT here
Backend pricing/fee/commission/ledger/recon/treasury logic (SP-3a); mobile fee UX (SP-4); the KYC-queue / transaction-explorer admin modules (SP-5).
