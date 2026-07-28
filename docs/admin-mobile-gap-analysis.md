# Admin ↔ Mobile Gap Analysis

**Date:** 2026-07-09
**Scope:** Map every mobile business module (`mobile-app/reactnative/app/**`, `src/features/**`)
to its admin counterpart (`frontend-admin/app/admin/**`), flag missing/thin admin oversight
surfaces, prioritise by money/compliance/moderation risk. Analysis only — nothing built.

**Method:** Enumerated mobile routes (Expo Router) and admin routes (Next.js `page.tsx`),
read `frontend-admin/src/components/layouts/AdminSidebar.tsx` (440-line nav map with per-item
RBAC), and grepped `backend/internal/**` for admin route groups and RBAC permission slugs.
Counts are `.tsx` screens (mobile, excluding `_layout.tsx`) vs `page.tsx` files (admin, nested).

**Headline:** The admin console is far richer than "reportedly behind" implies — 447 admin
pages across ~70 modules, with genuinely deep consoles for FX (16), Referral (39), Health
(34), Connect (33), Stays (30), Insurance (20), Fractional RE (18), Mobility (17), Finance
(16). The real gaps are concentrated in **four clusters**: the **Estate super-app**, the
**Food/Restaurant delivery** operation, **Crypto**, and a handful of read-model surfaces.

---

## 1. Full mapping table

Status legend: **RICH** = admin covers the mobile surface with multiple ops views ·
**THIN** = admin dir exists but stub/overview only while mobile has money/state flows ·
**MISSING** = no admin module.

Gap severity: `none` / `thin` / `missing`.

| Mobile module | Mobile screens | Admin status | Admin pages | Gap | Recommended admin build | Backend admin routes / RBAC to reuse |
|---|---|---|---|---|---|---|
| voting | 17 | RICH (voting + connect/voting + stem/voting) | 1 (+connect integrity) | none | — | `votes:manage`, `connect.voting.view` |
| wallet / services (bills, airtime, cards, transfer, transactions) | 3 + 27 | RICH (finance) | finance 16 | none | — | `finance.admin.transfers`, `finance.admin.kyc`, `audit.logs.view` |
| kyc-verify | 13 | RICH (finance/kyc-verify) | 10 | none | — | `finance.admin.kyc`, kyc-verify cases/aml/fraud/routing |
| fx | 53 | RICH (fx) | 16 | none | — | FX section (treasury, spread, recon, compliance, cards) |
| crowdfunding | 95 | RICH (crowdfunding) | 11 | none | — | `crowdfunding.review/finance/kyc/risk/support/compliance/config` |
| referral | 75 | RICH (referral + referral-rewards) | 39 + 8 | none | — | `referral.*` + `referral.admin.*` (A1–A7) |
| insurance | 43 | RICH (insurance) | 20 | none | — | `insurance.policy/claim/commission/reconciliation/provider.*` |
| stays | 67 | RICH (stays + stays extranet) | 30 | none | — | `stays.admin.*`, `stays.hotelier.*` |
| realtor | 42 | RICH (realtor) | 4 | none | — | realtor moderation/verification/payments |
| fractionalre | 31 | RICH (fractionalre) | 18 | none | — | `fractionalre.*` |
| mobility | 57 | RICH (mobility) | 17 | none | — | `mobility.view`, `transport.admin.scheduled.read` |
| marketplace | 35 | RICH (marketplace) | 9 | none | — | `marketplace.admin.moderation/dispute/flags/audit` |
| health / triage / doctor / telemedicine | 116 + (doctor 174) | RICH (health + intake + telemedicine) | 34 + 13 + 3 | none (telemedicine read-only) | (optional) telemedicine consult-dispute view | `health.pharmacy/lab/vet/doctor/triage.*`, `health.admin.intake` |
| savings | 12 | RICH (savings) | 6 | none | — | `savings.admin.vaults/recon/ajo/defaults` |
| social (Social Pay) | 18 | RICH (social + social-escrow + p2pmarket + spray) | 5 + 4 + 4 + 3 | none | — | `social.admin.*`, `p2p.admin.*`, `spray.read` |
| loyalty | 12 | RICH (loyalty + loyalty-black + points) | 6 + 4 + 3 | none | — | `loyalty.admin.*`, `loyalty.black.admin.*`, `loyalty.read` |
| events | 16 | RICH (events) | 9 | none | — | `events.admin.*` |
| creators | 10 | RICH (creators) | 7 | none | — | `creators.admin.*` |
| arena | 14 | RICH (arena) | 10 | none | — | `arena.admin.manage`, `arena.judge/proctor/reviewer/auditor.*` |
| connect | 119 | RICH (connect) | 33 | none | — | `connect.*` (identity/moderation/finance/aml/voting/rbac) |
| invest / invest-onboarding / invest-settings / invest-ai / stocks / investment | 10+13+9+2+19+1 | RICH (invest) | 9 | none | — | `invest.manage` (assets/orders/settlement/recon/corp-actions) |
| learn / spotlight-wealth (EdTech front) | 98 + 6 | RICH (academy + learn + spotlight) | 27 + 1 + 1 | none | — | `academy.*`, `learn.admin.manage`, `spotlight.admin.manage` |
| association / dues / election / meetings | 69 + 1 + 6 + 3 | RICH (association) | 7 | none (election THIN — see gaps) | election results/audit view | `savings.admin.view/recon/dashboard` (association reuses savings RBAC) |
| **crypto** | 34 | **THIN** | 3 (overview/orders/assets) | **thin** | Add reconciliation, withdrawals/AML review, swap monitoring, address allow-list | `crypto.admin`, `crypto.asset.config`, `crypto.withdraw*`, `crypto.swap` |
| **food / restaurant / rider** | 10 (app/food) + services/food | **THIN** | restaurant 2 (order-monitoring + delivery-fee) | **thin** | Full delivery ops console: live order board, rider dispatch/tracking, restaurant onboarding+payouts, refunds/disputes | `restaurant.manage`, `restaurant.admin.pricing`, `restaurant.order.*` state events |
| **nutrition** | 5 | **THIN** | 2 (list + detail) | **thin** | Plan/coach moderation, consult review, payout/commission | `nutrition.admin.manage`, `nutrition.admin.resolve` |
| **estate-admin + facilities + repairs + security + visitor + guard + meetings + tasks + documents + emergencies + announcements + dues + election + reports** | 2+2+3+1+12+15+3+3+2+2+3+1+6+1 ≈ **58 screens** | **THIN** | estate 5 (dashboard/residents/dues/gates/vendors) | **missing (bulk)** | Estate ops console: gate/guard log oversight, visitor-pass audit, facility booking, repair/work-order queue, emergency/panic monitor, announcements CMS, dues collection recon, election integrity, document vault | Backend has **no `/admin` estate route group**; only `estate`, `estate_admin`, `estate_security` slugs exist — needs backend admin routes first |
| **vendors / vendor-portal** | 2 + 1 | **MISSING** | none | **missing** | Vendor directory + KYC/approval + payout view (may fold into estate/marketplace vendors) | grep `vendor` in `estate`, `marketplace` backends; reuse merchant-onboarding pattern |
| registration | 8 | N/A (onboarding flow) | — | none | — | onboarding routes |
| featured | 3 | RICH (featured-placement) | 2 | none | — | `placement.admin.review` |
| maps | 1 | RICH (maps) | 2 | none | — | `map.admin.review` |
| ai-notes | 3 | none needed (personal) | — | none | — | — |
| properties / property | 2 + 4 | RICH (realtor + estate) | — | none | — | realtor/estate |

---

## 2. Prioritised gap list (highest value first)

Grouped so a swarm can claim disjoint modules. Money/compliance/moderation before read-only.
Size: **S** ≈ 1–3 pages, **M** ≈ 4–8, **L** ≈ 9+ (plus backend admin routes where noted).

### TIER 1 — Money + state-machine surfaces with NO adequate admin oversight

**GAP-1 · Food / Restaurant Delivery ops console — severity: THIN → build M/L**
- Mobile has a full 3-sided flow: customer order → checkout → rider dispatch → rating, with a
  rich `restaurant.order.*` state machine in `backend/internal/restaurant` (placed → confirmed →
  preparing → ready → dispatch → picked_up → delivered / cancelled / no_riders).
- Admin has only `restaurant/page.tsx` (order monitoring) + `restaurant/delivery-fee`. **No rider
  dispatch board, no restaurant onboarding/KYC, no payouts, no refund/dispute handling.**
- Build under `frontend-admin/app/admin/restaurant/`: `orders` (live board), `dispatch`,
  `riders`, `restaurants` (onboarding+status), `payouts`, `refunds`/`disputes`, `config`.
- RBAC: `restaurant.manage`, `restaurant.admin.pricing`; consume `restaurant.order.*` events.
- **Claim: `restaurant` (disjoint).**

**GAP-2 · Crypto reconciliation + AML/withdrawal review — severity: THIN → build M**
- Mobile crypto is 34 screens (buy/sell/swap/withdraw/addresses). Backend has
  `crypto.withdraw`, `crypto.swap`, `crypto.asset.config`, `crypto.admin`.
- Admin has only 3 pages (overview/orders/assets). **No withdrawal approval/AML queue, no
  swap monitoring, no address allow-list review, no reconciliation.**
- Build under `frontend-admin/app/admin/crypto/`: `withdrawals` (approval/AML), `swaps`,
  `addresses` (allow-list review), `reconciliation`.
- RBAC: `crypto.admin`, `crypto.asset.config`, `crypto.withdraw*`.
- **Claim: `crypto` (disjoint).**

### TIER 2 — Super-app cluster missing bulk oversight

**GAP-3 · Estate super-app ops console — severity: THIN/MISSING → build L (+ backend)**
- Largest gap by surface area: ~58 mobile screens across estate-admin, facilities, repairs,
  security, visitor, guard (15), meetings, tasks, documents, emergencies, announcements, dues,
  election, reports. Admin `estate/` has just 5 pages (dashboard/residents/dues/gates/vendors).
- **Backend has no `/admin` estate route group** — only `estate`, `estate_admin`,
  `estate_security`, `estate_id` slugs. Backend admin routes must land first (spec-first per
  CLAUDE.md), then admin pages.
- Recommended admin pages under `frontend-admin/app/admin/estate/`: `visitor-log`/`gate-log`
  (guard + visitor audit), `facilities` (booking oversight), `repairs` (work-order queue),
  `emergencies` (panic/SOS monitor), `announcements` (CMS), `dues-recon` (collection recon —
  money), `elections` (integrity/results), `documents` (vault), `reports`.
- **Sub-claim split for a swarm:** (a) gate/guard/visitor security · (b) dues recon + reports
  (money) · (c) facilities/repairs/tasks (ops) · (d) announcements/documents/elections (content).
- **Claim: `estate` (can be split 4 ways).**

**GAP-4 · Nutrition coach/consult moderation — severity: THIN → build S/M**
- Mobile 5 screens; backend has `nutrition.admin.manage`, `nutrition.admin.resolve`.
  Admin has 2 read pages (list + detail). Add consult-review/resolve queue and payout view.
- RBAC: `nutrition.admin.manage`, `nutrition.admin.resolve`.
- **Claim: `nutrition` (disjoint).**

**GAP-5 · Vendors / vendor-portal directory — severity: MISSING → build S**
- 3 mobile screens (directory/onboard/portal), no admin surface at all. Likely folds into
  estate vendors or marketplace; add a vendor directory + approval/KYC + payout view reusing
  the `merchant-onboarding` pattern. Confirm the owning backend domain (`estate` vs `marketplace`).
- **Claim: `vendors` (coordinate with estate/marketplace owner).**

### TIER 3 — Minor / read-model completeness

**GAP-6 · Association election integrity view — severity: thin → build S**
- Association admin (7 pages) is solid for approvals/dues/members, but the mobile `election`
  (6 screens) and `meetings` flows have no dedicated results/integrity oversight page.
- RBAC reuses `savings.admin.view/recon`.

**GAP-7 · Telemedicine consult-dispute (optional) — severity: none/thin → build S**
- Telemedicine admin is intentionally read-only (3 pages) per sidebar comment ("backend has no
  admin route group yet"). If consult disputes/refunds become a need, add a review page gated on
  `health.doctor.review` — but this is nice-to-have, not a true gap.

---

## 3. Modules explicitly verified as NOT gaps (to prevent re-work)

- **stocks** → covered by admin `invest` (shared backend, `invest.manage`).
- **learn / spotlight-wealth** → covered by admin `academy` (27) + `learn` + `spotlight`.
- **kyc-verify** → covered by admin `finance/kyc-verify` (10 pages).
- **social / spray / p2pmarket / social-escrow** → all present and rich.
- **arena, connect, insurance, stays, fx, crowdfunding, referral, mobility, marketplace,
  fractionalre, savings, loyalty, events, creators, health** → all RICH.

---

## 4. Recommended swarm allocation (disjoint claims)

1. `restaurant` — Food delivery ops console (M/L) — **money + state machine**
2. `crypto` — withdrawals/AML/recon (M) — **money + compliance**
3. `estate` — super-app console (L, backend-first) — split 4 ways
4. `nutrition` — moderation/resolve (S/M)
5. `vendors` — directory/approval (S)
6. `association/election` — integrity view (S)

Tiers 1–2 are the load-bearing gaps; Tier 3 is polish.
</content>
</invoke>
