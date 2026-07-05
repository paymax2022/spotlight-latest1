# Referral Earning System — Build & Consolidation Plan

Implements `docs/prd/referal/referral-PRD.md` **v1.1** (incl. **§7A Attribution & Default-Referrer Policy**)
to production grade via an agent swarm. Module name: **Referral** (Earn hub).

## 1. What exists today (verified on disk)
- **Backend seed:** `backend/internal/finance/referrals/` — `Code`, `Event`, `GetOrCreateCode`,
  `ResolveCodeToReferrer`, `ProcessReward` (credits ₦500 via ledger, idempotent), `GetSummary`.
  Route: `GET /api/finance/referrals/me` (gated `FeatureReferralsEnabled`). Ledger account
  `AccountReferralReward` exists. Migration `20260616140000_referrals.sql`
  (`finance_referral_codes`, `referral_events`).
- **Frontend-web:** `src/server/referrals/service.ts` (mirror of the Go logic + outbox drain),
  routes `app/api/v1/referrals/{me,outbox}`. Feature flag `featureFlags.referrals()`.
- **Signup:** `app/api/auth/register/route.ts` — **does NOT capture a referral code today.**
- **Mobile/Admin:** no referral Earn-hub yet (doctor "referrals" is unrelated medical referrals).

This is a small seed; the PRD is a full earning engine (~126 screens). We **build a new
`backend/internal/referral/` engine** that reuses finance ledger/wallet/kyc, keep the seed,
and add the full mobile Earn hub + admin console.

## 2. Reconciliation decisions
- **Names/paths:** mobile `app/referral/*` + `src/features/referral/*`; admin `app/admin/referral/*`;
  backend `backend/internal/referral/*`; member API `/api/finance/referral/*` (frontend-web proxy
  `/api/v1/referral/*`); admin API `/api/referral/admin/*` (RBAC `referral.*`).
- **Money:** rewards/overrides/payouts route through existing `finance/{ledger,wallet,tiers,kyc}` —
  kobo, idempotency keys, balanced double-entry, audit, server-side checks. Never new balances.
- **Default-referrer (§7A):** every signup is attributed. Fallback chain: valid code → deep-link →
  context (agent/estate/campaign) → regional house → **global house/Super-Admin**. The house
  destination is a **dedicated system account the Super Admin owns** (NOT a personal wallet),
  seeded by migration, overridable by env `SUPER_ADMIN_REFERRAL_CODE` / `SUPER_ADMIN_USER_ID`.
- **House invariants:** house accruals are a **separate, non-withdrawable ledger**, **excluded from
  override chains and from K-factor**, tagged `house_default`; reassignments that benefit the house
  need **separation-of-duties co-sign**; everything audited.
- **Mock/live switch:** mobile `EXPO_PUBLIC_REFERRAL_USE_MOCK`, admin `NEXT_PUBLIC_REFERRAL_USE_MOCK`,
  backend `FeatureReferralsEnabled` — default mock (matches crowdfunding/connect).

## 3. Shared DB contract (RB0 owns; RB1/RB2 reference — do not redefine)
Authoritative tables created by **RB0** in its migration; other backend agents reference by these
names/columns. All additive-only, RLS-enabled, FKs to `auth.users(id)`, money BIGINT kobo.

- `referral_house_accounts(id, scope ['global'|'regional'], region, owner_user_id, code UNIQUE,
  non_withdrawable bool DEFAULT true, created_at)` — seeded with one global house (`SPOT-HOUSE`).
- `referral_attributions(id, referred_user_id UNIQUE, referrer_id, attribution_type
  ['code'|'deeplink'|'context'|'regional_house'|'global_house'], code_used, is_house bool,
  status ['grace'|'locked'], grace_expires_at, reassigned_from, reassigned_at, created_at)`.
- `referral_reward_ledger(id, beneficiary_id, referred_user_id, campaign_id, kind
  ['referrer'|'referee'|'override'|'mission'|'manual'], state
  ['earned'|'pending'|'vesting'|'eligible'|'paid'|'clawed_back'], amount_kobo, currency
  DEFAULT 'NGN', is_house bool DEFAULT false, excluded_from_override bool, excluded_from_kfactor
  bool, vesting_schedule_id, ledger_entry_id, idempotency_key UNIQUE, created_at, updated_at)`.
- `referral_reassignments(id, attribution_id, from_party, to_party, reason, requested_by,
  cosigned_by, benefits_house bool, status ['pending'|'approved'|'rejected'], created_at, decided_at)`.
- `referral_engine_events(id, event_type, user_id, referrer_id, campaign_id, payload jsonb,
  idempotency_key UNIQUE, created_at)` — the event stream (`signup`, `kyc_completed`,
  `qualifying_action`, `reward_*`, `attribution_*`, etc.).
- `referral_config(id bool PK DEFAULT true, attribution_window_hours, grace_window_hours,
  fallback_chain jsonb, house_account_code, budget_neutral bool DEFAULT true,
  welcome_reward_enabled bool DEFAULT false, updated_at)` — singleton.

RBAC perms seeded by RB0: `referral.config.view/manage`, `referral.attribution.view/reassign`,
`referral.house.view`, `referral.ledger.view`, `referral.payout.*`, `referral.risk.*`,
`referral.compliance.*`, `referral.campaign.*`, `referral.gam.*`, `referral.amb.*`,
`referral.merchant.*`, `referral.analytics.view`, `referral.users.view`.

## 4. Swarm work split (disjoint files)
| Agent | Layer | Deliverable |
|---|---|---|
| **RB0** | Backend core | Attribution engine + §7A resolver/fallback→house, house account (seeded), reward ledger states, late-claim + reassignment (co-sign), event stream, config, RBAC seed, **core migration**; wire signup default-referrer in frontend-web register route + attribution write. |
| **RB1** | Backend econ | Campaigns + budget governor, gamification (missions/ranks/leaderboards), **activity-based capped** ambassador/agent overrides (house excluded), merchant-funded campaigns + partner API. New pkgs + migration. |
| **RB2** | Backend trust/fin | Risk/fraud (KYC dedup, device, velocity, blocklists, clawback exec, review queue), compliance (disclosures/AML/consent), finance (payouts/reconciliation/budget-burn/float), analytics (K-factor excl. house, funnel, CAC). New pkgs + migration. |
| **RM1** | Mobile foundation | 5-tab Earn hub, onboarding M-ONB-01..04/10 (signup code entry), M-INV-10 late-claim, role switcher, M-ACC-*, M-NOT-01, shared components + feature constants. |
| **RM2** | Mobile invite/earn | M-HOME-*, M-INV-*, M-ERN-* (ledger/detail/vesting/withdraw/currency/catalog/statement/clawback/appeal). |
| **RM3** | Mobile engage/zones | M-GAM-*, M-CMP-*, M-AMB-*, M-AGT-* (override displays + disclosures), M-MER-* lite. |
| **RA1** | Admin core/money | A-SADM-* (+A-SADM-07 attribution config), A-CMP-*, A-RWD-*, A-USR-05 house ledger, A-USR-06 reassignment (co-sign). |
| **RA2** | Admin ops | A-FIN-*, A-RSK-*, A-CMPL-*, A-USR-01..04, A-GAM-*, A-BI-* (+A-BI-08 organic vs referred), A-AMB-*, A-MER-*. |

Orchestrator wires: mobile module-registry + nav, backend route registration, admin sidebar,
end-to-end signup default-referrer, `referral-ci.yml`, trackers.

## 5. Production-grade bar (DoD)
- Full PRD screen coverage, loading/empty/error/success; every money screen shows state + amount kobo.
- Real backend contracts + additive migrations + RLS + audit; money path kobo/idempotency/ledger.
- **§7A enforced:** no unattributed signup; house default works; non-withdrawable + override/K-factor
  exclusion; late-claim reassignment with co-sign + audit; self/invalid-code → house + flagged.
- Mock/live switch; TypeScript + gofmt clean (Go build via CI); CI runs build/test + tsc + migration guard.
