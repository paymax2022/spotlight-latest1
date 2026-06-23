# QA Note — Crowdfunding Admin Module (frontend-admin)

**Date:** 2026-06-19
**Scope:** Admin web — Crowdfunding Overview, Campaign Review (queue + detail), Withdrawals, Fraud & Risk.

## Result

| Area | Result |
|------|--------|
| TypeScript compile (scoped `tsc`) | ✅ Pass — 0 errors |
| Convention match (vs. `finance/disputes`) | ✅ Pass |
| Loading / empty / error / success states | ✅ Pass |
| Nav integration | ✅ Pass |

## Files (7)

- `src/types/crowdfunding.ts` — admin DTOs (kobo amounts).
- `src/services/crowdfundingAdminService.ts` — mock-backed (`USE_MOCK=true`), mirrors
  `fintechService` shape (`adminBase()`, `authHeaders()`, fetch branches ready). Flip the
  flag when `/api/crowdfunding/admin/*` endpoints land.
- `app/admin/crowdfunding/page.tsx` — platform overview (12 KPIs, category breakdown, quick links).
- `app/admin/crowdfunding/review/page.tsx` — approval queue with status filters.
- `app/admin/crowdfunding/review/[id]/page.tsx` — detail review: creator/beneficiary/bank,
  funding, use-of-funds, documents, risk assessment, story; **Approve / Request changes /
  Reject / Freeze** with a required-note modal.
- `app/admin/crowdfunding/withdrawals/page.tsx` — approve/reject with risk flags.
- `app/admin/crowdfunding/fraud/page.tsx` — risk alerts with instant **Freeze / Unfreeze**.
- `AdminSidebar.tsx` — new **Crowdfunding** nav section (4 links).

## Conventions reused (not reinvented)

Matched the existing admin page pattern exactly: `'use client'` + `useState/useEffect/useCallback`
load pattern, `@/services/*` typed service layer, `@/types/*` DTOs, inline-style objects, the
status-badge colour-map idiom, the fixed-overlay action modal with required admin note, and the
filter-button row. No new styling system or component library introduced (the admin app has none).

## Acceptance-criteria adherence (playbook §7.13 / §8)

- ✅ Admin must provide a reason for reject / request-changes / freeze (modal enforces non-empty note).
- ✅ Approve publishes; reject/changes notify creator with actionable feedback (note).
- ✅ Campaign can be **frozen instantly** from both the review detail and the fraud board.
- ✅ Frozen campaigns surfaced as non-decidable; high-risk withdrawals visually flagged.
- ✅ Risk score + signals shown before any approval; budget-vs-goal mismatch highlighted.
- ✅ All amounts integer kobo; display-only ₦ conversion.

## Follow-ups (info)

| Severity | Item |
|----------|------|
| Info | Mock-backed; no real endpoints yet (`USE_MOCK=true`). Fetch branches are written against `/api/crowdfunding/admin/*`. |
| Info | RBAC: nav links are unguarded (no `permissions` key) so the module is visible in this preview. Add permission gates (e.g. `crowdfunding.review`) when the permission catalogue is defined, matching the Finance items. |
| Info | Audit logging of admin decisions happens server-side; the client sends decision + note only. |

---

## Addendum — Finance, Disputes & Configuration

**Date:** 2026-06-19 (later)

Three more admin pages, same conventions (`'use client'` load pattern, typed service layer,
inline styles, status-badge maps, action modals). TypeScript clean (scoped `tsc`, 0 errors).

- **`/admin/crowdfunding/finance`** — finance summary KPIs (GMV, revenue, refunds pending,
  chargebacks, escrow, settled-this-month, reconciliation gaps); refund-request queue with
  approve/reject (reason required to reject); settlement-batch table (gross/fee/net/status).
- **`/admin/crowdfunding/support`** — dispute queue (fake-campaign / refund / reward / payment),
  status filters + SLA countdown, resolve modal (no-action / refund / partial / warn / freeze)
  with required note; each dispute links to the campaign review detail.
- **`/admin/crowdfunding/config`** — category management (enable + enhanced-review toggles),
  fee & limit settings (bps with live ₦/% hints, save), and feature flags. The **investment**
  flag is rendered **locked** (can't be enabled) — enforcing "investment stays off until
  licensed" at the UI layer, matching the mobile `INVESTMENT_ENABLED` flag.

Service extended with mock data + fetch branches for: `getFinanceSummary`, `listRefunds`,
`decideRefund`, `listSettlements`, `listDisputes`, `resolveDispute`, `getCategories`,
`toggleCategory`, `getFees`, `updateFees`, `getFeatureFlags`, `toggleFeatureFlag`.

Nav: Crowdfunding section now has **7** links (Overview, Review, Finance, Withdrawals,
Fraud & Risk, Support & Disputes, Configuration). Co-exists cleanly with the separately-added
FX Orchestration section. All amounts in kobo. No blocking defects.

---

## Addendum 2 — KYC/KYB & Compliance

**Date:** 2026-06-19 (later)

Two more pages, same conventions, TypeScript clean (scoped `tsc`, 0 errors).

- **`/admin/crowdfunding/kyc`** — KYC/KYB verification queue with Individual/Business filters,
  per-case document checklist, **duplicate-identity / duplicate-bank** fraud flags, risk badge,
  and approve/reject (reason required to reject). Approving unlocks publish + withdrawal.
- **`/admin/crowdfunding/compliance`** — compliance KPIs (pending KYC/KYB, open data requests,
  investment-module posture, retention policy, audit events today); regulatory-report export;
  **data-subject requests** table (export/deletion with mark-fulfilled + due dates); and the
  **admin audit log** (actor / action / target / IP). The investment-module KPI reflects the
  locked feature flag — visible confirmation it stays disabled until licensed.

Service extended: `listKycCases`, `decideKyc`, `getComplianceSummary`, `listAuditLogs`,
`listDataRequests`, `fulfilDataRequest`.

**Crowdfunding admin section now has 9 links** — Overview, Campaign Review, KYC/KYB, Finance,
Withdrawals, Fraud & Risk, Support & Disputes, Compliance, Configuration. This covers admin
spec sections B, C, E, F, G, H, I, J. No blocking defects.

---

## Addendum 3 — User & Creator Management + RBAC gates

**Date:** 2026-06-20

- **`/admin/crowdfunding/users`** (admin spec D) — searchable user/creator table (filter by role
  and status), per-user **detail drawer** (campaigns/raised/contributed KPIs + **activity log**),
  and **suspend / restore** with a required-reason modal. Service: `listUsers`, `setUserStatus`.
- **RBAC gates** added to all 10 crowdfunding nav items (`crowdfunding.view` / `.review` /
  `.users` / `.kyc` / `.finance` / `.risk` / `.support` / `.compliance` / `.config`).
  Super-admins bypass (per `rbac.ts`); grant these permissions to non-super-admin roles to
  expose the section. TypeScript clean.

**Crowdfunding admin now has 10 links and covers admin spec sections B, C, D, E, F, G, H, I, J.**
