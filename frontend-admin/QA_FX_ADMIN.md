# QA Report — FX Orchestration Admin Console (web)

**App:** `frontend-admin/` (Next.js 15.1, React 19, no Tailwind/Refine — inline-style convention).
**Scope built:** spec §13 sections **A** (Overview), **B** (Transactions & Orders), **C** (Routing config),
**D** (Provider management), **E** (Treasury & Liquidity), **F** (Spread & Pricing), **I** (Reconciliation).
**Deferred:** G (admin KYC/KYB — partially exists under `/admin/finance/kyc`), H (Compliance), J, K, L, M, N.
**Gate:** `npx tsc --noEmit` → **0 errors** (whole admin app).

## Pattern reuse
- Followed the existing admin conventions exactly: `'use client'` pages under `app/admin/<section>/page.tsx`,
  a `USE_MOCK` service in `src/services` (mirrors `crowdfundingAdminService` / `fintechService` — same
  `adminBase()` / `authHeaders()` / `delay()` shape), types in `src/types`, inline light-card styling, and the
  section-grouped `AdminSidebar` registry.
- Added one shared helper module `app/admin/fx/_ui.tsx` (Card, Kpi, Badge, PageHeader, FxTabs, money helpers)
  to avoid the per-page style-helper duplication present elsewhere — net reduction in repetition.
- Sidebar: new **"FX Orchestration"** section with 7 links, registered in the `sections` array.

## Pages & capabilities
- **Overview** (`/admin/fx`): GMV, margin, success/failure, float health, recon breaks, incidents KPIs;
  routing mix bars; breaker status; top corridors table.
- **Transactions** (`/admin/fx/transactions` + `/[id]`): filter by type/status/provider + search; detail shows
  both rates, itemized fees, provider ref, **scoring snapshot** (chosen route highlighted), status history, and
  **manual retry / force-reverse** actions (state-gated).
- **Routing** (`/admin/fx/routing`): editable `w_cost/cover/liq/rel` per corridor, provider enable toggles,
  bias select, Save (audit-logged note); **Simulate route** what-if panel (size-aware result).
- **Providers** (`/admin/fx/providers`): directory with latency/success/exposure, enable/disable, **trip/reset
  breaker**, adapter status.
- **Treasury** (`/admin/fx/treasury`): float buckets with low/high-water + status, **rebalance now**
  (stablecoin/fiat) on low/critical buckets, rebalance history.
- **Spread** (`/admin/fx/spread`): editable bps per corridor×tier with min/max **guard enforcement** (invalid
  edits blocked), activate/pause, version display.
- **Reconciliation** (`/admin/fx/reconciliation`): daily runs per provider + break queue with
  investigate/resolve/escalate.

## States
- Every page: loading text, error line (where fetched), empty-state copy. Action buttons disable while busy and
  reload on success. Mutations are optimistic-by-reload against the mock service.

## Money & correctness
- All amounts integer **minor units**; display conversion only in `money()` / `moneyFull()` helpers. No floats
  in the data layer.
- Mock service exposes the real endpoint shape (`/api/fx/admin/...`) behind `USE_MOCK`; flip the flag to wire
  the backend with no page changes.

## Fix during QA
- `simulateRoute` mock literal inferred `provider: string`; cast to `Provider` so the ranked list matches
  `RouteSimResult['ranked']`. Re-verified `tsc` clean.

## Verdict (first batch)
**PASS.** Seven FX control-plane sections shipped to the V1 admin scope (§18: transactions, routing, provider
mgmt, recon + overview, treasury, spread), consistent with existing admin patterns, 0 type errors.

---

## Addendum — second batch (sections G, H, L, M)

Added four more control-plane sections; `tsc --noEmit` → **0 errors** (whole admin app).

- **Customers / KYC-KYB (G)** — `/admin/fx/customers` (+ `/[id]`): directory with verification filter + queue
  count; detail shows profile, documents, directors/UBOs, risk score, and **approve / request-resubmit / reject**
  and **suspend / reinstate** actions.
- **Compliance & Risk (H)** — `/admin/fx/compliance`: sanctions/PEP/AML/velocity screening queue with severity,
  and **clear / block / file-SAR** case actions. Notes `compliance_block` as a first-class outcome.
- **Webhooks & Developer (L)** — `/admin/fx/webhooks`: delivery monitor with **replay**, endpoint enable/disable
  (live/sandbox), and API-key registry (prefix-only display).
- **Analytics & Reports (M)** — `/admin/fx/analytics`: margin by corridor, provider reliability scorecard,
  routing efficiency (chosen-vs-best), and retention cohorts.

All four reuse `_ui.tsx` (Card/Badge/PageHeader/FxTabs/money), follow the `USE_MOCK` service pattern (new
methods in `fxAdminService.ts`, types in `fxAdmin.ts`), and are registered in `FxTabs` + the sidebar's "FX
Orchestration" section (now 11 links). One additional type touch: `getCustomers` strips detail-only fields to
return the `AdminCustomer` summary shape.

**FX admin console now covers §13 A, B, C, D, E, F, G, H, I, L, M.**

---

## Addendum — third batch (sections J, K)

`tsc --noEmit` → **0 errors** (whole admin app).

- **Beneficiaries & Collections (J)** — `/admin/fx/collections`: virtual-account / IBAN registry, recent
  collection events, and beneficiary validation issues by corridor.
- **Cards (K)** — `/admin/fx/cards`: issued-card registry with freeze/unfreeze/terminate program controls,
  issuing-provider column, and a suspicious-card-activity feed.

Both reuse `_ui.tsx`, follow the `USE_MOCK` service pattern (new methods + types), and are registered in
`FxTabs` + the sidebar (now 13 links).

**The FX admin console now covers §13 A–M (all except N).** N (admin users / RBAC / system settings) is
intentionally left to the platform-wide Roles / RBAC Settings / Permissions pages that already exist in this
app. The FX control plane is functionally complete for V1–V2 scope.
