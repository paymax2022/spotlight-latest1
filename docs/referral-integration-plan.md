# Referral System — Backend Integration Plan

**Status:** In progress · **Author:** engineering · **Date:** 2026-07-05
**Goal:** Make the Referral / "Earn" system rely on the Go backend end-to-end
(both `frontend-web` and `mobile-app/reactnative`), removing reliance on
offline mock data.

---

## 1. What actually exists today

### 1.1 Two parallel backend referral systems

| System | Prefix (Go) | Proxy (Next) | Maturity |
|---|---|---|---|
| **Direct Rewards engine** (single-level, purchase-triggered revenue share, PRD §5) | `/v1/referrals/*` | `/api/v1/referrals/*` | **Complete** member API (link, attribute, dashboard, referrals, earnings, milestones) + admin + internal hooks |
| **Referral Earning System** (RB0 core / RB1 econ / RB2 trust) | `/api/finance/referral/*` | `/api/v1/referral/*` | **Partial** member API; rich **admin** API |
| Legacy summary | `/api/finance/referrals/me` (plural) | `/api/v1/referrals/me` (Supabase-direct, not Go) | summary only |

Both proxies forward the Supabase JWT (`Authorization`) and `Idempotency-Key`
verbatim via `proxyToGoBackend`. Both are gated by `FEATURE_REFERRALS_ENABLED`.
Mobile talks to the backend **through** the frontend-web proxy
(`EXPO_PUBLIC_API_BASE_URL` → port 3000), so wiring the proxy once serves both
clients.

### 1.2 Frontend state

- **mobile-app**: a large 10-module referral feature (`src/features/referral/*`,
  ~76 screens). All modules are **mock-first** (`USE_MOCK`, default ON).
  - `rewards/` module → live paths **match** the Direct Rewards engine exactly. ✅
  - The other 9 modules (`home`, `earnings`, `ambassador`, `agent`, `invite`,
    `merchant`, `foundation`, `gamification`, `campaigns`) call an
    **aspirational** `/api/v1/referral/*` surface that largely does not exist.
- **frontend-web**: **no** member referral UI at all (only server proxies +
  admin payments-finance mention). Greenfield.

---

## 2. Member endpoint inventory (backend, live)

### 2.1 Direct Rewards engine — `/api/v1/referrals/*` → Go `/v1/referrals/*` (bare JSON)

| Method | Path | Response (snake_case, money = kobo int64) |
|---|---|---|
| POST | `/link` | `{id, referrer_id, code, created_at}` |
| POST | `/attribute` | `{referrer_id, referred_user_id}` (body `{code}`) |
| GET | `/me/dashboard` | `{code, current_tier, current_rate, active_referral_count, this_month_earned_kobo, lifetime_earned_kobo, next_milestone?{threshold,bonus_kobo,remaining}}` |
| GET | `/me/referrals?limit&offset` | `{referrals:[{referred_user_id, masked_contact, joined_at, active, lifetime_earned_kobo}]}` |
| GET | `/me/earnings?limit&offset` | `{earnings:[{id, referred_user_id, source_transaction_id, module, margin_kobo, applied_rate, reward_kobo, status, config_version, created_at, credited_at?, reversed_at?}]}` |
| GET | `/me/milestones` | `{achieved:[Milestone], upcoming:[Milestone]}` |

Only `POST /gamification/missions/:id/claim` (other system) requires an
`Idempotency-Key`. `link`/`attribute` are safe to retry (engine is idempotent).

### 2.2 Referral Earning System — `/api/v1/referral/*` → Go `/api/finance/referral/*`

Member reads that exist: `config`, `my-attribution`, `POST claim-code`,
`my-rewards`, `withdraw-eligible`, `campaigns`, `campaigns/:id`,
`gamification/{missions,missions/progress,ranks,my-rank,badges,leaderboard,contests}`,
`POST gamification/missions/:id/claim`, `network/{ambassador,teams,teams/:id/members,overrides}`,
`POST network/ambassador/apply`, `risk/{my-status,POST report-abuse}`,
`compliance/{disclosures/:slug, GET/POST consents}`.
Full request/response shapes captured in the DTO audit (see task notes).

---

## 3. Gap: frontend live path → backend reality

| Mobile module | Frontend live path | Backend truth | Action |
|---|---|---|---|
| `rewards/` | `/api/v1/referrals/*` | **exists** ✅ | Flip live (Phase 1) |
| `campaigns/` | `/campaigns`, `/campaigns/:id` | exists; **no** `/campaigns/featured` | Remap; derive "featured" client-side |
| `gamification/` | `/missions/:id`, `/streak`, `/contests/:id/join`, `/rank-up` | backend has `/missions/progress`, `/missions/:id/claim`, `/my-rank`; **no** streak/join/detail | Remap to real; hide unsupported |
| `foundation/` | `/attribution/me`, `/attribution/claim`, `/account/report-abuse`, `/consent`, `/roles/*`, `/notifications/*` | backend `/my-attribution`, `/claim-code`, `/risk/report-abuse`, `/compliance/consents`; **no** roles/notifications | Remap the 4; build or defer roles/notifications |
| `ambassador/` | `/ambassador/*` | backend `/network/ambassador`, `/network/ambassador/apply` only | Remap dashboard/apply; **build** creatives/audience/analytics/payouts |
| `agent/` | `/agent/*` | backend `/network/teams`, `/network/teams/:id/members`, `/network/overrides` | Remap; **build** invites/training/disclosure/leaderboard |
| `home/` | `/home/{dashboard,code,activity}` | **none** | Assemble from Direct Rewards `/me/dashboard` + `/my-rewards`, or **build** |
| `earnings/` | `/earnings/*` (ledger, withdraw, vesting, catalog, currency, statement, clawback) | **none** as member | **Build** (money-path: tests-first + ledger-auditor) |
| `invite/` | `/invite/*` | **none** | **Build** or defer |
| `merchant/` | `/merchant/*` | **admin-only** on backend | **Build** member merchant endpoints or defer |

---

## 4. Phased execution

**Phase 1 (this change) — ship the real core, both clients, no mock:**
1. `frontend-web`: new **Earn page** (`/earn`) wired live to `/api/v1/referrals/*`
   (Direct Rewards engine). Greenfield, zero mock.
2. `mobile-app`: keep `rewards/` module; document/enable live via
   `EXPO_PUBLIC_REFERRAL_USE_MOCK=false`. Its paths already match the backend.

**Phase 2 — remap mobile modules that have real backends (no new backend):**
`campaigns`, `gamification`, `network`→`ambassador`/`agent`, `risk`,
`compliance`, `foundation` core. Rewrite live-branch paths + response mappers to
the real snake_case shapes; turn `USE_MOCK` off per-function where fully backed;
keep mock fallback only where the screen needs data the backend lacks.

> **Progress (2026-07-05):** live branches remapped to real backend paths/shapes
> and type-checked clean for: `campaigns` (`/campaigns`), `gamification`
> (`/gamification/*`), `foundation` (`/my-attribution`,`/claim-code`,
> `/risk/my-status`,`/compliance/consents`), `home` (Direct Rewards engine
> `/api/v1/referrals/me/*`), `ambassador` (reads from `/network/ambassador`),
> `agent` (reads from `/network/{teams,teams/:id/members,overrides}`). Plus
> `rewards` already matched the engine. Functions with no backend endpoint
> (streak, contest-join, rank-up, code-resolve, roles, notifications,
> campaign-featured, ambassador creatives/audience/analytics/payouts, agent
> invites/training/leaderboard) return safe derived/empty values marked
> `TODO(referral phase3)` instead of hitting a 404. Money mutations with no
> backend (`ambassador.withdrawPayout`, `agent.onboardSubReferrer`) throw a clear
> "not available yet" rather than fabricating success.
>
> **Remaining = net-new backend build** (Phase 3, iron rules): member `earnings`
> (ledger/withdraw/vesting/catalog/currency — money-path), `invite`
> (share/vanity/tracking), member `merchant`, ambassador payouts/analytics,
> agent onboarding/training, `roles`, `notifications`.

**Phase 3 — build missing member backend (spec-first + iron rules):**
Prioritize `earnings` (ledger/withdraw — money-path, needs failing tests first +
`ledger-auditor` review), then `home` aggregate, `invite`, member `merchant`,
`roles`/`notifications`. Each: OpenAPI spec PR → additive migration → handler →
tests → wire frontend → flip live.

> **Progress (2026-07-05) — earnings withdraw shipped (money-path):**
> New member endpoint **`POST /api/finance/referral/withdraw`** (proxy alias
> `/api/v1/referral/withdraw`) that sweeps the caller's eligible reward-ledger
> rows into their wallet. Reuses the audited `ledger.Transition(→paid)` primitive
> (balanced double-entry DR `referral_reward_expense` / CR `user_wallet`), so
> **no new migration** was needed. Iron rules honoured: (1) `Idempotency-Key`
> header required (400 if missing); (2) balanced double-entry per row; (3) durable
> audit event `referral_withdraw` via the referral events sink; (4) fail-closed
> KYC gate (`MinWithdrawTier=1`, verified only). Concurrency-safe via a per-user
> `pg_advisory_lock` (the pay primitive credits before the guarded flip, so a
> naked concurrent double-withdraw could double-credit — the lock closes that).
> Files: `backend/internal/referral/ledger/{service,handlers}.go`,
> `backend/internal/app/referral_routes.go`, spec in `contracts/openapi.yaml`,
> unit test `ledger/withdraw_test.go`. Mobile `earnings.getWithdrawQuote`/`withdraw`
> rewired to `/withdraw-eligible` + `/withdraw`.
>
> **Verification caveat:** the sandbox has no Go toolchain and no test DB, so
> `go build ./... && go vet ./... && go test ./internal/referral/ledger/...`
> must be run locally, and a human **`ledger-auditor`** pass is still required
> before merge per CLAUDE.md (the automated subagent isn't available here). The
> concurrent-double-credit reasoning on `Transition` (credit-before-flip) should
> be a focus of that review — consider moving the guarded flip before the credit
> in the primitive as a follow-up hardening.
>
> **Still TODO (net-new backend):** `earnings` ledger rows/vesting/catalog/
> currency/statement/clawback, `invite`, member `merchant`, ambassador
> payouts/analytics, agent onboarding/training, `roles`, `notifications`.

**Phase 4 — decommission mock:** once every screen has a backend, default
`USE_MOCK=false`; keep mock only behind an explicit dev override.

> **Progress (2026-07-05) — all 10 mobile modules wired; `invite` + `merchant` done:**
> `invite` now builds its share payload / contextual prompts / vertical copy from
> the caller's REAL referral code (Direct Rewards `/me/dashboard`) and derives the
> tracked-invitee funnel from `/me/referrals`; device-contacts, vanity-links and
> nudge are safe-stubbed (`createVanityLink` throws rather than fabricating a
> non-persisted alias). `merchant` (admin-only backend) returns an empty dashboard/
> performance and its funding money-mutation throws "not available yet" instead of
> faking a wallet debit. Referral type-check clean. **Net effect: with
> `EXPO_PUBLIC_REFERRAL_USE_MOCK=false`, no mobile referral screen hits a 404** —
> every call either uses a real endpoint or returns a safe derived/empty value;
> money mutations with no backend fail loudly rather than fabricating success.
>
> **Truly net-new backend still to build** (each = spec→migration→handler→tests→
> wire→flip): device-contact matching, vanity-link/UTM service, invite tracking
> channel/last-activity, member merchant zone, ambassador payouts/analytics/
> creatives, agent onboarding/training/leaderboard, `roles`, `notifications`, and
> the richer `earnings` surfaces (per-row ledger, vesting, catalog, currency,
> statements, clawback appeals).

---

## 5. Iron-rule checklist for Phase 3 money-path work

- [ ] Amounts integer kobo; never float/string math.
- [ ] Every money mutation: requires `Idempotency-Key`, posts balanced
      double-entry, emits audit event, passes tier-limit checks fail-closed.
- [ ] Wallet balance = ledger projection (never direct UPDATE).
- [ ] Additive-only migrations.
- [ ] Failing tests first (`test-engineer`), then implement to green.
- [ ] `ledger-auditor` review before marking complete; `security-reviewer` for
      any auth/PII surface.
- [ ] Feature-flag every new module; spec in `contracts/openapi.yaml` first.
