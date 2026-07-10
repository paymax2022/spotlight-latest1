# GO-LIVE READINESS AUDIT — Paymax × Spotlight Super App

**Date:** 2026-07-09
**Scope:** Full monorepo (`backend/` Go/Gin, `supabase/` Postgres, `frontend-admin/` Next.js, `mobile-app/reactnative/` Expo, `frontend-web/` Next.js gateway).
**Method:** Static, evidence-based. Builds were NOT executed; findings come from reading source. Every claim below cites a file path.
**Verdict:** The platform is **architecturally sound but operationally dark**. The money-path core (ledger, idempotency, audit, reconcilers) is real and well-tested. The blockers to going live are not "missing engineering" so much as **every module ships disabled and mocked by default**, a handful of admin permissions can never be granted to non-super-admins, and a few money features (crypto custody, some payout rails, EdTech fees admin) are still integration seams, not live paths.

---

## Executive summary

The single biggest go-live fact: **nothing is on by default.** All ~70 backend feature flags default `false` (incl. `FEATURE_WALLET_ENABLED`, `FEATURE_KYC_ENABLED`, `FEATURE_TRANSFERS_ENABLED`, `FEATURE_TIER_LIMITS_ENABLED`), and essentially every mobile and admin module defaults to `USE_MOCK=true`. So "going live" is a deliberate, per-module flip of (a) a backend feature flag, (b) required secrets, (c) the frontend/mobile mock flag — in that order, gated by the module actually having a backend surface behind it.

Second-biggest: a small set of **admin permission slugs are enforced at the route but were never seeded**, so they resolve only for the `super-admin` bypass and can never be delegated to an operator role. Third: **a few money features return placeholder/`no_feed` data or lack an external disbursement rail** (crypto on-chain custody, nutrition "payouts", EdTech fees admin console).

### Top 10 go-live blockers (ranked)

| # | Blocker | Severity | Evidence |
|---|---------|----------|----------|
| 1 | **`FEATURE_TIER_LIMITS_ENABLED` defaults `false`.** The Iron Rule says every money mutation must pass tier-limit checks fail-closed. Shipping wallet/transfers with limits OFF means unbounded transaction amounts. Must be `true` in prod *before* any money flag. | **P0** | `backend/internal/config/config.go` (getEnvBool `FEATURE_TIER_LIMITS_ENABLED`, false) |
| 2 | **Crypto custody reconciliation is a stub feed (`no_feed`).** Member crypto holdings cannot be verified against on-chain reality until a real custodian (Fireblocks/BitGo/Anchorage) pushes balances and `CRYPTO_CUSTODY_WEBHOOK_SECRET` is set. No custody feed = unauditable custody = do-not-launch for crypto. | **P0** | `backend/internal/crypto/onchain.go:24,62,90,163` |
| 3 | **Core money flags + secrets all default off/unset.** Wallet, KYC, VA, transfers all `false`; prod boot fails closed if `PAYSTACK_SECRET_KEY`/`MONNIFY_SECRET_KEY`/`KYC_PII_ENC_KEY`/`MAPLERAD_SECRET_KEY` are placeholders. Nothing serves real money traffic until each is set. | **P0** | `config.go`; `backend/internal/config/validate.go:60-95` |
| 4 | **Five money modules have zero tests:** `crypto`, `savings`, `escrow`, `spray`, `loyalty`. Iron Rule requires failing-tests-first for money-path. Launching untested money code violates the playbook. | **P0** | No `*_test.go` in `backend/internal/{crypto,savings,escrow,spray,loyalty}/` |
| 5 | **Unseeded-but-enforced admin permissions 403 all non-super-admins:** `finance.admin.kyc`, `finance.admin.transfers`, `spotlight.admin.manage`, `learn.admin.manage`, `maps:metrics:read`. The permission rows don't exist in any migration, so they can never be assigned to an operator role — only `super-admin`'s hard bypass reaches them. | **P1** | Enforced: `backend/internal/app/{finance_routes.go:275-766,spotlightwealth_routes.go:49,learn_routes.go:43}`, `maps/handler.go:412`. Absent from all `supabase/migrations/*` permission seeds. |
| 6 | **EdTech (Academy) Fees admin console has no admin backend.** The entire `academyFeesService.ts` is stubbed with `TODO(no backend route)` — school/session/class/fee-schedule CRUD, onboarding approval, promotion, hardship all point at member-only or missing routes. Large admin surface, no server. | **P1** | `frontend-admin/src/services/academyFeesService.ts:125-...` (20+ `TODO(no backend route)`) |
| 7 | **Every mobile & admin module defaults to mock.** 55 mobile `EXPO_PUBLIC_*_USE_MOCK` and 40 admin `NEXT_PUBLIC_*_USE_MOCK` flags default `'true'` (only mobile `REGISTRATION` defaults `false`). Real users see fixtures until each is flipped and its backend verified live. | **P1** | mobile `src/features/*/api*.ts`; admin `src/services/*.ts` |
| 8 | **Nutrition "payouts"/oversight are honest placeholders.** Admin oversight returns `{placeholder:true}`, no ledger touch; there is no nutritionist-consult money path. Frontend shows a payout surface that has no backend disbursement. | **P1** | `backend/internal/nutrition/admin_oversight.go:19-116,211` |
| 9 | **Mobile wallet non-cash payout rails are not implemented server-side** ("only 'cash' is real"); manual funding verification removed (no backend route). Users can request rails the server can't fulfil. | **P1** | `mobile-app/reactnative/src/api/wallet.api.ts:80,382` |
| 10 | **Referral invite surface has no backend** (`/api/v1/referral/invite/*` unimplemented); several EdTech member flows are shape-mismatched to the backend (installment plans, disclosure accept, receipts). Frontend promises features the API can't serve. | **P2** | `mobile-app/reactnative/src/features/referral/invite/api.ts:37`; `academy/fees/api.ts:278-763` |

---

## What is actually solid (do not re-litigate)

- **Ledger money-path core is real and tested:** double-entry, idempotency keys, reversals, TOCTOU guard, split-invariant tests all present (`finance/ledger/{service,repository,reversal_test,toctou_test}.go`, `finance/settlement/split_invariant_test.go`).
- **Idempotency** is enforced at the ledger/settlement/transfers layer (`finance/ledger/model.go`, `settlement/service.go`, `transfers/service.go`), not just middleware.
- **Audit logging** present across finance modules (kyc, kycverify, transfers, maplerad, referrals).
- **Reconcilers exist** for restaurant, transport, top5events, academy-fees payments (`*/reconciler.go`, `academy/fees/payment/reconcile/`).
- **Restaurant payout disburses to the provider's internal wallet** (real ledger credit, idempotent, audited, disbursed-once via `uq_restaurant_payout_lines_settlement`) — only the *external bank rail* is out of scope, and the rider-split "stub" is a fallback, not a money leak. `backend/internal/restaurant/payout.go:28-375`.
- **Secret validation fails closed in prod** with placeholder detection and key-prefix guards (`config/validate.go`) — a copied-but-unfilled `.env` will refuse to boot in production.
- **Voting-engine seed bugs are patched:** the invalid-enum-literal bug in `seed_voting_engine.sql` is fixed (lines 18-21 document the fix). Residual caveat only: the `vote_totals` upsert inserts a NULL `round_id` while the ON CONFLICT targets `(contest_id,contestant_id,round_id)`; Postgres treats NULLs as distinct so this is cosmetic, not a break (`supabase/migrations/20260602100000_universal_voting_engine.sql:208-224`).

---

## Per-module readiness table

Legend — **build**: no obvious compile blocker found (assumes team runs `go build`/`npm`); **mock**: default-mock state of its frontend/mobile surface; **backend**: backend surface completeness; **RBAC**: permission seeding status; **tests**: presence of money/critical tests; **sev**: highest blocker severity.

| Module | build | mock-flag (default) | missing backend | RBAC | tests | go-live blockers | sev |
|--------|:---:|---|---|---|:---:|---|:---:|
| **Wallet / Ledger** | ok | mobile `FINANCE`/`TRANSFERS` mock=on | none (core real) | ok | strong | Flag `FEATURE_WALLET_ENABLED`+`TIER_LIMITS`; set Paystack/Monnify | P0 |
| **Tier limits** | ok | n/a | none | ok | `tiers/service_test.go` | **Defaults OFF — must be ON before money** | P0 |
| **KYC / KYC-Verify** | ok | admin `KYC_ADMIN` mock=on | none | `finance.admin.kyc` **unseeded** | strong (`kycverify/*_test.go`) | Flag off; needs provider keys + `KYC_PII_ENC_KEY`; unseeded admin perm | P0 |
| **Transfers (bank/P2P)** | ok | admin `TRANSFERS_ADMIN` mock=on | none | `finance.admin.transfers` **unseeded** | strong (`transfers/*_test.go`) | Flags off; `MONNIFY_SECRET_KEY`; unseeded admin perm | P0 |
| **Crypto** | ok | mobile+admin `CRYPTO` mock=on | custody feed = stub (`no_feed`) | seeded (`20260815001600_crypto.sql`) | **none** | On-chain custody unverifiable; no tests | **P0** |
| **Savings (Ajo/Esusu)** | ok | `SAVINGS` mock=on | check disbursement rail | seeded | **none** | Flag off; **no money tests** | P0 |
| **Escrow / Social-Pay** | ok | `SOCIAL` mock=on | — | seeded (`social`/`connect_money`) | **none** | Flag off; **no money tests** | P0 |
| **Spray / Top5 events** | ok | admin `SPRAY_ADMIN` mock=on | `sprayAdminService` has stubs | seeded (`top5_spray_disputes`) | top5 has `service_money_test.go`; **spray none** | Flag off; spray no tests | P1 |
| **Loyalty / Paymax Black** | ok | `LOYALTY` mock=on | — | seeded (`loyalty`) | **none** | Flag off; **no tests** | P1 |
| **Restaurant** | ok | admin `RESTAURANT_ADMIN` mock=on | external bank rail only | seeded (`restaurant_admin_rbac`) | `split_invariant`,`reconciler_test`,`transitions_test` | Flag off; flip admin mock | P1 |
| **Nutrition** | ok | admin `NUTRITION_ADMIN` mock=on | **payout/oversight = placeholder** | seeded (`nutrition_admin_rbac`) | model_test only | Placeholder money surface; no real payouts | P1 |
| **Academy / EdTech Fees** | ok | mobile+admin `ACADEMY` mock=on | **admin console has no backend** (`TODO(no backend route)`×20) | mixed: `academy.fees.*` seeded, general `academy.*` some **unseeded** | `payment/reconcile/reconcile_test` | Admin backend missing; feature flags off | P1 |
| **Transport / Mobility** | ok | admin `MOBILITY_ADMIN` mock=on | notifications TODO; share-URL TODO | seeded (`mobility_rbac`,`transport_scheduled_rbac`) | strong (`modes_engine`,`split_invariant`,`money_authz`) | Flags off | P2 |
| **Invest (stocks)** | ok | admin `INVEST_ADMIN` mock=on | fee schedule = placeholder defaults | seeded (`invest_rbac`) | `invest_test.go` | Flag off; placeholder fees | P2 |
| **Telemedicine / Doctor / Health** | ok | admin `TELEMEDICINE_ADMIN`/`HEALTH` mock=on | — | `health.*` seeded; `learn.admin.manage` **unseeded** | strong (`doctor/*`,`telemedicine/*`,`pharmacy/*`) | Flags off; unseeded learn perm | P2 |
| **Estate suite** | ok | admin `ESTATE_ADMIN`, mobile estate\* mock=on | vendor rails partly mocked | seeded (`estate_admin_rbac`) | strong (many `estate/*_test.go`) | Flags off | P2 |
| **Connect (dating)** | ok | admin+mobile `CONNECT` mock=on | — | seeded (`connect_rbac`,`connect_money`) | strong (`connect/**/*_test.go`) | Flags off | P2 |
| **Crowdfunding** | ok | mock=on | withdraw-approve real | seeded | `model_test`,`query_test`,`adminext` | Flag off | P2 |
| **Groups / Associations / Events** | ok | admin mock=on | — | seeded (`events`,`association`) | model_test | Flags off | P2 |
| **Marketplace / P2P / Stays / Realtor / FractionalRE / Property / Insurance / Creators / Maps / Spotlight-Wealth / Referral** | ok | mock=on | varies (`stays`/`fx`/`spray` admin svcs have stub notes) | mostly seeded; `spotlight.admin.manage`,`maps:metrics:read`,`referral invite` gaps | mixed (`fractionalre`,`maps` have tests; others thin) | Flags off; unseeded perms; referral-invite no backend | P2 |

---

## Detailed findings by investigation area

### 2. Mock-first flags still defaulting ON
- **Mobile (55 flags, all default `'true'` except `REGISTRATION` = `'false'`):** ACADEMY, ACADEMY_FEES, ADMIN, AI, AINOTES, ANNOUNCEMENTS, ARENA, ASSOCIATION, CONNECT, CREATORS, CRYPTO, DOCTOR, DOCUMENTS, DUES, ELECTION, EMERGENCIES, ESTATEADMIN, ESTATESETTINGS, FACILITIES, FEATURED, FINANCE, FRACTIONALRE, FX, HEALTH, INSURANCE, INVEST, KYC_VERIFY, LEARN, LOYALTY, MARKETPLACE, MEETINGS, MERCHANT, MOBILITY, NOTIFICATIONS, NUTRITION, ONBOARDING, PROPERTIES, PROPERTY, REALTOR, REFERRAL, REPAIRS, REPORTS, SAVINGS, SETTINGS, SOCIAL, SPOTLIGHT, STAYS, STOCKS, TASKS, TELEMEDICINE, TRANSFERS, VENDORS, VISITOR, VOTING. Flipping requires: backend flag on + secrets set + backend route confirmed live for that feature.
- **Admin (40 flags, all default `'true'`):** ACADEMY, ARENA_ADMIN, ASSOCIATION_ADMIN, CONNECT(+_ADMIN), CREATORS, CRYPTO_ADMIN, DELIVERY_FEE_ADMIN, EDTECH_PLATFORM, ESTATE_ADMIN, EVENTS, FEATURED_PLACEMENT_ADMIN, FRACTIONALRE_ADMIN, FX_ADMIN, GROUPS_ADMIN, HEALTH, INSURANCE, INTAKE_ADMIN, INVEST_ADMIN, KYC_ADMIN, LOYALTY, MAPS, MARKETPLACE_ADMIN, MOBILITY_ADMIN, MOBILITY_MODES, NUTRITION_ADMIN, ONBOARDING_ADMIN, POINTS_ADMIN, REALTOR_ADMIN, REFERRAL(+_REWARDS), RESTAURANT_ADMIN, SAVINGS, SCHEDULED_ADMIN, SOCIAL, SPRAY_ADMIN, STAYS, TELEMEDICINE_ADMIN, TRANSFERS_ADMIN, VENDORS_ADMIN.

### 3. Missing backend endpoints the frontends call
- **EdTech Fees admin (biggest):** `frontend-admin/src/services/academyFeesService.ts` — 20+ `TODO(no backend route)`: school/session/class CRUD are member-only, no admin promotion/hardship/onboarding-approval routes as-shaped.
- **EdTech Fees mobile:** `mobile-app/.../academy/fees/api.ts` — no guardian children-list, no installment-plan read/create, no disclosure-accept, no receipts, no vault/hardship/scholarship/competition-challenge/badge/reward endpoints as-shaped.
- **Referral invite:** `mobile-app/.../referral/invite/api.ts:37` — `/api/v1/referral/invite/*` has no backend.
- **Wallet:** `mobile-app/.../api/wallet.api.ts:80,382` — manual funding verification removed; non-cash payout rails not implemented server-side.
- **Admin service stubs:** `sprayAdminService.ts`, `fxAdminService.ts`, `staysExtranetService.ts` contain stub/placeholder notes.

### 4. RBAC — unseeded but enforced (403 everyone except super-admin)
Confirmed enforced at route AND absent from every `supabase/migrations` permission seed:
`finance.admin.kyc`, `finance.admin.transfers`, `spotlight.admin.manage`, `learn.admin.manage`, `maps:metrics:read`.
Impact: `user_has_permission` (`supabase/migrations/20260527100000_enterprise_auth_rbac.sql:218-251`) hard-returns TRUE for `super-admin`, so these routes work for super-admin only. They **cannot be delegated** to `system-admin` or module-operator roles because the permission row does not exist to grant. Fix = additive migration seeding these 5 permissions and mapping them to the appropriate operator roles. (Note: `academy.*` general slugs like `academy.commerce/content/rewards` are seeded within their own module migrations; the five above are the true gaps.)

### 5. Seed / migration health
- `seed_voting_engine.sql`: previously-known invalid-enum-literal bug is **fixed** (documented lines 18-21). Residual NULL-`round_id` upsert caveat is cosmetic (Postgres NULL-distinct semantics), not a break.
- `seed_connect_discovery.sql`: not flagged.
- Additive-ordering: 51+ migrations seed into `public.permissions` after the base RBAC migration; all use `ON CONFLICT DO NOTHING`, so re-runs are safe. No DROP/rename observed in spot checks. Recommend a full `supabase db reset` dry-run in CI before launch to catch any cross-migration column drift not visible statically.

### 6. Money-path placeholders
- **Crypto:** on-chain custody feed is a `stub`/`no_feed` seam (`crypto/onchain.go`). `admin_repository.go:162` screening is a heuristic TODO.
- **Nutrition:** `admin_oversight.go` returns `Placeholder=true` runs, never touches the ledger; no real nutritionist payout path.
- **Invest:** `model.go:373` fee schedule defaults are placeholders.
- **Transfers:** `service.go:287` placeholder recipient code (resolved on disburse leg — acceptable).
- **KYC-Verify:** `handler.go:215-238` SDK token is a documented stub (client-SDK seam).
- **Restaurant:** `service.go:366` rider-split "stubbed to owner if no rider" — a fallback, not a gap.

### 7. Feature flags off by default
**All ~70 `FEATURE_*_ENABLED` default `false`** in `config.go`, including core `FEATURE_WALLET_ENABLED`, `FEATURE_KYC_ENABLED`, `FEATURE_VIRTUAL_ACCOUNTS_ENABLED`, `FEATURE_TRANSFERS_ENABLED`, `FEATURE_BANK_TRANSFERS_ENABLED`, `FEATURE_TIER_LIMITS_ENABLED`, `FEATURE_FX_ENABLED`. Only `TRANSFER_FAILOVER_ENABLED` defaults `true`. No flag → module does not mount.

### 8. Secrets that fail-closed in prod (`config/validate.go`)
Required to boot prod / enable paths: `DATABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY` (always); `PAYSTACK_SECRET_KEY` (`sk_` prefix) when wallet/bank on; `MONNIFY_SECRET_KEY` (bank transfers); `MAPLERAD_SECRET_KEY` (`mpr_`, live not sandbox in prod); KYC provider (Dojah **or** Smile ID **or** Youverify) + `KYC_PII_ENC_KEY` (base64 32-byte AES-256) when KYC-Verify on; `ARENA_SIGNING_SEED_*` (Ed25519, base64 32-byte) when Arena on; `MAPS_GOOGLE_KEY` when Maps on; `CRYPTO_CUSTODY_WEBHOOK_SECRET` to enable crypto custody feed (else 503, `no_feed`).

### 9. Test coverage gaps
- **Strong:** finance/ledger, settlement, transfers, kyc, kycverify, maplerad, tiers, referrals, va, fx; restaurant, transport, top5events, connect (deep), estate (deep), doctor, telemedicine, pharmacy.
- **Money modules with NO tests (P0/P1):** `crypto`, `savings`, `escrow`, `spray`, `loyalty`.
- No backend test *framework* is configured (`backend/tests/` empty per CLAUDE.md), but package-level `*_test.go` (212 files) exist and run via `go test`.

### 10. Observability / Ops
- **Idempotency:** enforced at ledger/settlement/transfers layer. ✅
- **Audit:** emitted across finance modules and admin actions. ✅
- **Reconcilers:** present for restaurant, transport, top5events, academy-fees payments; crypto reconciler exists but is starved of a real custody feed. ⚠️
- **Gaps:** no reconciler/observability for savings, escrow, spray, loyalty (the same modules lacking tests).

---

## Recommended sequencing to a minimally-live state

**Phase 0 — Safety gates (do first, blocks everything):**
1. Set `FEATURE_TIER_LIMITS_ENABLED=true` and verify fail-closed behavior end-to-end.
2. Populate and verify all prod secrets; confirm `config.Validate()` passes in a prod-env dry run.
3. Add the additive RBAC migration seeding `finance.admin.kyc`, `finance.admin.transfers`, `spotlight.admin.manage`, `learn.admin.manage`, `maps:metrics:read` and grant to operator roles.

**Phase 1 — Core money MVP (wallet + fund + P2P):**
4. Write money tests for any core path lacking them; flip `FEATURE_WALLET_ENABLED`, `FEATURE_KYC_ENABLED`, `FEATURE_VIRTUAL_ACCOUNTS_ENABLED`, `FEATURE_TRANSFERS_ENABLED`.
5. Flip the matching admin `KYC_ADMIN`/`TRANSFERS_ADMIN` and mobile `FINANCE`/`TRANSFERS`/`KYC_VERIFY` mock flags to `false`; smoke-test against live backend.

**Phase 2 — Adjacent commerce (real backends, just gated):**
6. Restaurant, transport, connect, estate, crowdfunding — write/confirm tests, flip flags + mock flags. These have real backends and reconcilers.

**Phase 3 — Deferred until real integrations exist:**
7. **Crypto** — do NOT launch until a real custodian feed + `CRYPTO_CUSTODY_WEBHOOK_SECRET` + module tests exist.
8. **Nutrition payouts, EdTech Fees admin console, referral-invite** — build the missing backend before exposing the frontend surfaces.
9. **savings / escrow / spray / loyalty** — add tests + reconcilers before enabling money movement.

**Do-not-ship-with:** any money module where its `USE_MOCK` frontend flag is `false` but its backend flag is off (users would hit dead routes), or where tier limits are off.
