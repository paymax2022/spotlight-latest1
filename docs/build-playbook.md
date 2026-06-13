# Spotlight Fintech Build Playbook

**Rule:** One block per branch per session. Each block must leave tests green and the feature flagged off before merge. Blocks are strictly ordered — later blocks depend on earlier ones.

---

## Block 0 — Golden-path E2E baseline ✅ DONE
**Branch:** `main`  
**Gate:** Nothing fintech merges until this suite is green.

Deliverables:
- `frontend-web/tests/unit/golden-path/` — 40 tests covering free vote, paid vote, webhook, registration, academy apply
- All 112 existing tests passing

---

## Block 1 — Platform scaffold ✅ THIS BRANCH
**Branch:** `feat/fintech-platform-scaffold`  
**Gate:** No new fintech module ships without feature flags.

Deliverables:
- `docs/prd.md` — fintech product requirements (EPIC 1–6, decision gates)
- `docs/build-playbook.md` — this document
- `docs/adr/ADR-000-template.md` — ADR template for design decisions
- `contracts/openapi.yaml` — initial OpenAPI 3.1 spec: wallet + KYC + VA + referral endpoints
- `frontend-web/src/lib/config/env.ts` — env contract: fails fast with clear error on missing secrets
- `frontend-web/src/lib/feature-flags.ts` — env-var feature flags for every new module
- `frontend-web/tests/unit/config/feature-flags.spec.ts` — flag tests

Acceptance criteria:
- [ ] `npx vitest run` still green (112 → 112+ passing)
- [ ] `npx tsc --noEmit` passes in `frontend-web/`
- [ ] Feature flag module exported; existing code unchanged

---

## Block 2 — KYC schema
**Branch:** `feat/kyc-schema`  
**Depends on:** Block 1  
**Flag:** `FEATURE_KYC_ENABLED`

Deliverables:
- `supabase/migrations/YYYYMMDDHHMMSS_kyc_fields.sql` — additive: `kyc_tier`, `kyc_status`, `kyc_submitted_at`, `kyc_verified_at`, `phone_verified`, `bvn_hash`, `nin_hash`, `document_type`, `document_ref` on `user_profiles`
- `supabase/migrations/YYYYMMDDHHMMSS_kyc_audit.sql` — additive: `kyc_events` table (immutable audit trail)
- `frontend-web/src/server/kyc/service.ts` — KYC state machine: `getKycTier()`, `initiateKyc()`, `approveKyc()`, `failKyc()`
- API route: `GET /api/v1/kyc/me`, `POST /api/v1/kyc/initiate`
- ADR: `docs/adr/ADR-001-kyc-tier-model.md`
- Tests: tier-gate unit tests; state-machine transitions

Acceptance criteria:
- [ ] Migration is additive-only (no DROP, no RENAME, no type narrowing)
- [ ] `browfield-guardian` PASS on all new files
- [ ] `getKycTier()` returns 0 for new users
- [ ] All golden-path tests still green

---

## Block 3 — Ledger & wallet schema
**Branch:** `feat/ledger-schema`  
**Depends on:** Block 2  
**Flag:** `FEATURE_WALLET_ENABLED`

Deliverables:
- `supabase/migrations/YYYYMMDDHHMMSS_ledger_accounts.sql` — `ledger_accounts` (id, user_id FK auth.users, type, created_at)
- `supabase/migrations/YYYYMMDDHHMMSS_ledger_entries.sql` — `ledger_entries` (id, account_id, type ENUM, amount_kobo BIGINT, reference, idempotency_key UNIQUE, created_at) — immutable, no UPDATE/DELETE RLS
- `supabase/migrations/YYYYMMDDHHMMSS_wallet_view.sql` — `wallet_balance` view: `SUM(CASE WHEN type IN ('CREDIT','REVERSAL_DEBIT') THEN amount_kobo ELSE -amount_kobo END)`
- ADR: `docs/adr/ADR-002-double-entry-ledger.md`
- Tests: ledger invariant test (`SUM(entries) = balance`)

Acceptance criteria:
- [ ] `ledger_entries` has no UPDATE/DELETE permission (service_role INSERT only)
- [ ] Amounts BIGINT kobo — no numeric/float columns
- [ ] `browfield-guardian` PASS
- [ ] Invariant test: insert CREDIT + DEBIT entries; view shows correct net

---

## Block 4 — Wallet service
**Branch:** `feat/wallet-service`  
**Depends on:** Block 3  
**Flag:** `FEATURE_WALLET_ENABLED`

Deliverables:
- `frontend-web/src/server/wallet/service.ts` — `getBalance()`, `creditWallet()`, `debitWallet()`, `listTransactions()`
- `frontend-web/src/server/wallet/idempotency.ts` — `checkAndClaimKey()` using `ledger_entries.idempotency_key` UNIQUE constraint
- API routes: `GET /api/v1/wallet/balance`, `GET /api/v1/wallet/transactions`
- `supabase/migrations/YYYYMMDDHHMMSS_topup_intents.sql` — `wallet_topup_intents` (Paystack payment tracking before webhook)
- Paystack topup flow: `POST /api/v1/wallet/topup` → initiate → webhook credits ledger
- Tests: balance projection, idempotency (duplicate key → cached result), tier-limit enforcement

Acceptance criteria:
- [ ] `debitWallet()` fails closed (throws) if balance < amount
- [ ] `creditWallet()` and `debitWallet()` require Idempotency-Key
- [ ] Two concurrent `creditWallet()` calls with same key → one DB row
- [ ] All golden-path tests still green

---

## Block 5 — Virtual accounts
**Branch:** `feat/virtual-accounts`  
**Depends on:** Block 4  
**Flag:** `FEATURE_VIRTUAL_ACCOUNTS_ENABLED`

Deliverables:
- `supabase/migrations/YYYYMMDDHHMMSS_virtual_accounts.sql` — `virtual_accounts` (id, user_id, provider, account_number, bank_name, bank_code, provisioned_at)
- `frontend-web/src/server/virtual-accounts/service.ts` — `provisionVirtualAccount()`, `getVirtualAccount()`
- Paystack Dedicated Virtual Account API integration
- Webhook handler for inbound transfers (`transfer.success`) → credit ledger
- Auto-trigger: provision on `kyc_tier` → 1 event
- API route: `GET /api/v1/virtual-accounts/me`
- ADR: `docs/adr/ADR-003-virtual-account-provisioning.md`

Acceptance criteria:
- [ ] Provisioning is idempotent (second call returns existing account)
- [ ] Inbound transfer deduped via webhook idempotency key
- [ ] Tier 0 users cannot provision (403)
- [ ] `browfield-guardian` PASS

---

## Block 6 — Vote bridge
**Branch:** `feat/vote-bridge`  
**Depends on:** Block 4  
**Flag:** `VOTES_BRIDGE_ENABLED`

Load skill: `.claude/skills/vote-bridge/SKILL.md` before starting.

Deliverables:
- `supabase/migrations/YYYYMMDDHHMMSS_vote_bridge_idempotency.sql`
- `supabase/migrations/YYYYMMDDHHMMSS_vote_bridge_outbox.sql`
- `frontend-web/src/server/voting-bridge/bridge.ts`
- `frontend-web/src/server/voting-bridge/idempotency.ts`
- `frontend-web/src/server/voting-bridge/kyc-gate.ts`
- `frontend-web/src/server/voting-bridge/outbox.ts`
- `frontend-web/src/server/voting-bridge/feature-flag.ts`
- API routes: `app/api/v2/votes/free/route.ts`, `app/api/v2/votes/paid/verify/route.ts`
- Tests: concurrency (TOCTOU fixed), KYC gate, feature flag bypass, outbox enqueue
- ADR: `docs/adr/ADR-004-vote-bridge-idempotency.md`

Acceptance criteria:
- [ ] No edits to any protected file (hook enforces this)
- [ ] Two concurrent free-vote calls → one `votes` row
- [ ] Webhook + redirect race on verify → one `votes` row
- [ ] `VOTES_BRIDGE_ENABLED=false` → original paths called directly
- [ ] All golden-path tests still green

---

## Block 7 — Tiers & limits
**Branch:** `feat/tiers-and-limits`  
**Depends on:** Blocks 2, 4  
**Flag:** `FEATURE_TIER_LIMITS_ENABLED`

Deliverables:
- `frontend-web/src/server/tiers/service.ts` — `enforceWalletLimit()`, `enforceVoteLimit()`, `getTierConfig()`
- `supabase/migrations/YYYYMMDDHHMMSS_tier_limit_events.sql` — `tier_limit_events` audit table
- Middleware: plug `enforceWalletLimit()` into wallet debit path
- Tests: each tier's limits; limit check fails closed on DB error

Acceptance criteria:
- [ ] Tier 0: wallet debit → 403 (wallet disabled)
- [ ] Tier 1: debit > ₦50,000 in a day → 429
- [ ] Limit check error → deny (fail-closed), not allow
- [ ] `browfield-guardian` PASS

---

## Block 8 — Referrals
**Branch:** `feat/referrals`  
**Depends on:** Blocks 4, 6  
**Flag:** `FEATURE_REFERRALS_ENABLED`

Deliverables:
- `supabase/migrations/YYYYMMDDHHMMSS_referrals.sql` — `referral_codes` (user_id, code UNIQUE), `referral_events` (referrer_id, referred_id, rewarded_at, amount_kobo)
- `frontend-web/src/server/referrals/service.ts` — `getOrCreateCode()`, `processReferralReward()`
- Triggered from vote-bridge outbox on first paid vote of referred user
- `GET /api/v1/referrals/me` — code + total earnings + referral count
- Tests: no self-referral, at-most-once reward per referred user, ledger credit correct

Acceptance criteria:
- [ ] Referrer cannot be referred user
- [ ] Second paid vote by referred user does NOT trigger second reward
- [ ] Reward = 50,000 kobo credited via ledger (idempotent)
- [ ] `browfield-guardian` PASS

---

## Block 9 — Fintech admin RBAC
**Branch:** `feat/fintech-admin-rbac`  
**Depends on:** Blocks 4, 7  
**Flag:** `FEATURE_FINTECH_ADMIN_ENABLED`

Deliverables:
- `supabase/migrations/YYYYMMDDHHMMSS_fintech_roles.sql` — seed `finance_maker`, `finance_checker`, `finance_viewer` roles + permissions
- `frontend-web/src/server/admin/fintech/` — maker-checker service: `initiateCreditAdjustment()`, `approveAdjustment()`, `rejectAdjustment()`
- No self-approval enforcement
- API routes: `POST /api/v1/admin/adjustments`, `POST /api/v1/admin/adjustments/[id]/approve`
- ADR: `docs/adr/ADR-005-maker-checker.md`
- Tests: no self-approval, adjustment > ₦100k requires checker, audit log written

Acceptance criteria:
- [ ] `finance_maker` cannot approve their own adjustment
- [ ] Manual credit ≥ ₦100,000 requires checker approval
- [ ] Full audit trail: initiator, approver, amount, timestamp
- [ ] `browfield-guardian` PASS

---

## Cross-cutting rules (apply every block)

1. **Additive migrations only.** No DROP, RENAME, or type narrowing. Load `db-migrations` skill.
2. **Feature flag every module.** `FEATURE_<NAME>_ENABLED=false` by default in `.env.example`.
3. **Money amounts = BIGINT kobo.** Never float, never string math.
4. **Idempotency-Key on every mutation.** `checkAndClaimKey()` before the operation.
5. **Audit event on every money mutation.** Write to `audit_logs` before returning.
6. **`browfield-guardian` PASS before merge.** Run the agent on every diff.
7. **Golden-path suite must stay green.** Run `npx vitest run` before every commit.
8. **PR < 400 lines** where possible. Split if larger.
9. **No DG-3 mixing.** Do not write to `contestant_votes` from new code.
10. **All new FKs → `auth.users(id)`.** Not `platform_users`.
