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

## Block 8 — Referrals ✅ DONE
**Branch:** `feat/tiers-and-limits`
**Depends on:** Blocks 4, 6
**Flag:** `FEATURE_REFERRALS_ENABLED`

Deliverables:
- `supabase/migrations/20260616140000_referrals.sql` — `referral_codes` (user_id, code UNIQUE) + `referral_events` (referrer_id, referred_id, amount_kobo, UNIQUE(referrer_id, referred_id) — at-most-once)
- `frontend-web/src/server/referrals/service.ts` — `getOrCreateCode()`, `getReferralSummary()`, `resolveCodeToReferrer()`, `processReferralReward()`, `processReferralOutbox()`
- `frontend-web/app/api/v1/referrals/me/route.ts` — `GET /api/v1/referrals/me` (code + total_referrals + total_earned_kobo)
- `frontend-web/app/api/v1/referrals/outbox/route.ts` — `POST /api/v1/referrals/outbox/process` (drains bridge_outbox, authenticated via `x-outbox-secret` + `REFERRAL_OUTBOX_SECRET` env)

Reward flow:
1. Free vote cast with `shareCode` → bridge enqueues `referral.triggered` event in `bridge_outbox`
2. Cron (or manual call) hits `POST /api/v1/referrals/outbox/process`
3. Processor drains pending events: resolves code → blocks self-referral → credits referrer ₦500 (50,000 kobo) via `creditWallet()` (idempotent on key) → inserts `referral_events` row

At-most-once guarantee: `creditWallet` idempotency key + `referral_events` UNIQUE(referrer_id, referred_id)

Acceptance criteria:
- [x] Referrer cannot be referred user (CHECK constraint + service guard)
- [x] Same referred user rewarded only once (UNIQUE(referrer_id, referred_id))
- [x] Reward = 50,000 kobo credited via ledger (idempotent on same key)
- [x] `browfield-guardian` PASS
- [x] `npx tsc --noEmit` passes

---

## Block 9 — Fintech admin RBAC ✅ DONE
**Branch:** `feat/tiers-and-limits`
**Depends on:** Blocks 4, 7
**Flag:** `FEATURE_FINTECH_ADMIN_ENABLED`

Deliverables:
- `frontend-web/src/server/admin/rbac.ts` — extended with `finance_maker`, `finance_checker`, `finance_viewer` roles; `finance:adjust:initiate` + `finance:adjust:approve` permissions
- `supabase/migrations/20260616150000_admin_adjustments.sql` — `admin_adjustments` table with self-approval CHECK constraint and service_role RLS
- `frontend-web/src/server/admin/fintech/service.ts` — `initiateAdjustment()`, `approveAdjustment()`, `rejectAdjustment()`, `listAdjustments()`
- `frontend-web/app/api/v1/admin/adjustments/route.ts` — `POST` (initiate) + `GET` (list)
- `frontend-web/app/api/v1/admin/adjustments/[id]/approve/route.ts`
- `frontend-web/app/api/v1/admin/adjustments/[id]/reject/route.ts`
- `docs/adr/ADR-005-maker-checker.md`

Acceptance criteria:
- [x] `finance_maker` cannot approve their own adjustment (service guard + DB CHECK)
- [x] Adjustments < ₦100,000 auto-execute; ≥ ₦100,000 require checker
- [x] Full audit trail: initiator_id, initiator_role, checker_id, checker_role, checked_at, ledger_entry_id
- [x] `browfield-guardian` PASS (no protected files touched)
- [x] `npx tsc --noEmit` passes in `frontend-web/`

---

---

## Vote Contest UI Build (Mobile)
**Branch:** `feat/vote-bridge`  
**Design reference:** Google Stitch project `10447845872661572449`  
**Design system:** Premium Glassmorphism — obsidian bg (#0e0e0f), gold (#f2ca50) primary, indigo (#c0c1ff) secondary, emerald (#58e7aa) tertiary. Fonts: Sora (display), Hanken Grotesk (body), JetBrains Mono (labels).  
**Stack:** `apps/mobile-starter/` — Expo Router, React Native, TanStack Query, expo-linear-gradient

### Infrastructure

| # | Task | File | Status |
|---|------|------|--------|
| 1 | Design tokens | `apps/mobile-starter/src/theme/voting.ts` | ✅ DONE |
| 2 | Shared components (GlassCard, Badges, VoteMeter, VoteButton, ContestantCard, ContestCard, VotingScreen) | `apps/mobile-starter/src/components/voting/` | ✅ DONE |
| 3 | Voting API client (types + all fetch/mutate functions) | `apps/mobile-starter/src/api/voting.api.ts` | ✅ DONE |
| 4 | Vote tab in bottom navigation (gold star, active state) | `apps/mobile-starter/app/(protected)/(tabs)/_layout.tsx` | ✅ DONE |

### Screens — Stitch mapping

| # | Stitch Screen | Route | Status |
|---|--------------|-------|--------|
| S1 | Vote Home Dashboard | `(tabs)/vote.tsx` | ✅ DONE |
| S2 | Contest Details | `contest/[id].tsx` | ✅ DONE |
| S3 | Contestants List | `contest/[id]/contestants.tsx` | ✅ DONE |
| S4 | Real-time Leaderboard | `contest/[id]/leaderboard.tsx` | ✅ DONE |
| S5 | Contestant Profile | `contestant/[id].tsx` | ✅ DONE |
| S6 | Vote Selection Modal | `contest/vote-modal.tsx` | ✅ DONE |
| S7 | Buy Votes Packages | `contest/buy-votes.tsx` | ✅ DONE |
| S8 | Select Payment Method | `contest/payment-method.tsx` | ✅ DONE |
| S9 | Vote Success Celebration | `contest/vote-success.tsx` | ✅ DONE |
| S10 | Music Contests Category (`19772dba3e024752974fd3f6a7197ce1`) | `contest/category/[slug].tsx` | ✅ DONE |
| S11 | Contestant Registration (`19318a8f2a6b489380cb80a1eb9a0c58`) | `contest/register.tsx` | ✅ DONE |
| S12 | Share Profile Modal (`d8e046520f3f4f2c9800b35ca0b4f558`) | native `Share.share()` on contestant profile | ✅ DONE (native API) |

### Remaining tasks

All 12 Stitch screens are now built. ✅

### Acceptance criteria

- [x] All screens render correctly without a live API (demo `placeholderData` in every query)
- [x] Vote tab accessible from bottom nav with gold active state
- [x] Free vote → vote-success with contestant name, vote count, remaining free votes
- [x] Paid vote flow: contestant profile → vote-modal → buy-votes → payment-method → vote-success
- [x] Leaderboard auto-refreshes every 30s
- [x] Category chips navigate to `contest/category/[slug]` dedicated filtered screen
- [x] Contestant Registration: 3-step wizard (Personal Info → Upload → Review & Submit)
- [x] All screens pass `apps/mobile-starter` TypeScript check (run `cd apps/mobile-starter && npx tsc --noEmit`)

---

---

## Block 10 — Wallet-to-Wallet Transfer ✅ DONE
**Branch:** `feat/tiers-and-limits`
**Depends on:** Blocks 4, 7
**Flag:** `FEATURE_WALLET_TRANSFERS_ENABLED`

Deliverables:
- `contracts/openapi.yaml` — `PaymaxTransferRecipient`, `WalletTransfer` schemas; `GET /transfers/paymax/resolve`, `POST /transfers/paymax` endpoints
- `supabase/migrations/20260616100000_wallet_transfers.sql` — `wallet_transfers` table with RLS
- `supabase/migrations/20260616110000_transfer_wallet_atomic.sql` — `transfer_wallet_atomic()` RPC: advisory lock → balance check → daily limit check → atomic DEBIT+CREDIT+INSERT
- `frontend-web/src/server/transfers/wallet-to-wallet.ts` — `resolvePaymaxUser()`, `calculateTransferFee()`, `initiateWalletToWallet()`
- `frontend-web/app/api/v1/transfers/paymax/resolve/route.ts` — recipient preview endpoint
- `frontend-web/app/api/v1/transfers/paymax/route.ts` — transfer initiation endpoint
- PRD reference: `docs/prd-wallet-fintech.md` §15 (Wallet-to-Wallet Transfer)

Fee schedule:
- ₦0–₦5,000 (≤ 500,000 kobo): free
- ₦5,001–₦50,000: ₦10 fee (1,000 kobo)
- > ₦50,000: ₦25 fee (2,500 kobo)

Acceptance criteria:
- [ ] `FEATURE_WALLET_TRANSFERS_ENABLED=false` → 503 on both endpoints
- [ ] Resolve returns masked phone — full number never exposed
- [ ] Self-transfer → 422 (blocked at RPC level)
- [ ] Sender with insufficient balance → 402
- [ ] Tier 0 sender → 403 (enforced by `enforceWalletLimit`)
- [ ] Daily limit exceeded → 403
- [ ] Same `Idempotency-Key` submitted twice → second call returns `already_processed: true`, no duplicate DB rows
- [ ] Concurrent calls with same key → exactly one DEBIT + one CREDIT ledger entry
- [ ] `browfield-guardian` PASS
- [ ] `npx tsc --noEmit` in `frontend-web/` passes

---

## Block 11 — Wallet-to-Bank Transfer ✅ DONE
**Branch:** `feat/tiers-and-limits`
**Depends on:** Block 10
**Flag:** `FEATURE_BANK_TRANSFERS_ENABLED`

Deliverables:
- `contracts/openapi.yaml` — `Bank`, `BankTransfer` schemas; `GET /banks`, `POST /banks/resolve`, `POST /transfers/bank`
- `supabase/migrations/20260616120000_bank_transfers.sql` — `bank_transfer_recipients` + `bank_transfers` tables with RLS
- `supabase/migrations/20260616130000_reserve_for_bank_transfer.sql` — `reserve_for_bank_transfer()` RPC (advisory lock → balance → daily limit → DEBIT + bank_transfers row)
- `frontend-web/src/server/transfers/bank.ts` — `listBanks()`, `resolveBankAccount()`, `getOrCreateRecipient()`, `calculateBankTransferFee()`, `initiateWalletToBank()`
- `frontend-web/src/server/transfers/bank-webhook.ts` — `handleBankTransferWebhook()`: success → mark successful; failed/reversed → insert REVERSAL_DEBIT + mark failed
- `frontend-web/app/api/v1/banks/route.ts` — list banks
- `frontend-web/app/api/v1/banks/resolve/route.ts` — account name lookup
- `frontend-web/app/api/v1/transfers/bank/route.ts` — initiate transfer
- `frontend-web/app/api/webhooks/paystack/route.ts` — `handleBankTransferWebhook` added to fan-out

Fee schedule (PRD §18.2):
- ₦0–₦5,000: ₦10 fee (1,000 kobo)
- ₦5,001–₦50,000: ₦25 fee (2,500 kobo)
- > ₦50,000: ₦50 fee (5,000 kobo)
- Minimum transfer: ₦1,000 (100,000 kobo)

Transfer lifecycle: `funds_reserved` → `provider_initiated` → (webhook) → `successful` | `failed` | `reversed`

Acceptance criteria:
- [ ] `FEATURE_BANK_TRANSFERS_ENABLED=false` → 503 on all three routes
- [ ] Invalid account number → 404 from Paystack resolve
- [ ] Insufficient balance → 402
- [ ] Tier 0 → 403 (enforceWalletLimit)
- [ ] Same `Idempotency-Key` → second call returns existing transfer (no double-debit)
- [ ] `transfer.success` webhook: status → successful, no extra ledger entry
- [ ] `transfer.failed` webhook: status → failed, REVERSAL_DEBIT inserted, balance restored
- [ ] Duplicate webhook: `duplicate: true`, no second reversal
- [ ] Paystack call fails after reservation: status stays `funds_reserved` (ops can retry)
- [ ] `browfield-guardian` PASS

---

## Block 12 — Beneficiary Management ✅ DONE
**Branch:** `feat/tiers-and-limits`
**Depends on:** Block 11
**Flag:** `FEATURE_BENEFICIARIES_ENABLED`

Deliverables:
- No new migration — `is_favorite`, `nickname`, `last_used_at` already on `bank_transfer_recipients` (Block 11)
- `frontend-web/src/lib/feature-flags.ts` — `beneficiaries` flag added
- `frontend-web/src/server/transfers/beneficiaries.ts` — `listBeneficiaries()`, `saveBeneficiary()`, `removeBeneficiary()`, `touchLastUsed()`, `autoSaveBeneficiary()`
- `frontend-web/app/api/v1/beneficiaries/route.ts` — `GET` (list) + `POST` (save)
- `frontend-web/app/api/v1/beneficiaries/[id]/route.ts` — `PATCH` (nickname) + `DELETE` (unsave)
- `frontend-web/src/server/transfers/bank.ts` — `save_beneficiary` + `touchLastUsed` wired into `initiateWalletToBank()`
- `frontend-web/app/api/v1/transfers/bank/route.ts` — `save_beneficiary` field accepted
- `mobile-app/reactnative/src/api/beneficiaries.api.ts` — `fetchBeneficiaries()`, `saveBeneficiary()`, `removeBeneficiary()`, `resolveBankAccount()`, `initiateBankTransfer()`, `calculateBankTransferFee()`
- `mobile-app/reactnative/src/types/wallet.ts` — `Beneficiary`, `BankTransferResult` types
- `mobile-app/reactnative/src/components/PaymentActionScreen.tsx` — `withdraw` kind upgraded: beneficiary picker → manual entry → confirm (amount + narration + save toggle) → success receipt

Acceptance criteria:
- [x] `FEATURE_BENEFICIARIES_ENABLED=false` → 503 on all beneficiary routes
- [x] `save_beneficiary: true` on bank transfer → `is_favorite=true` on recipient row
- [x] `DELETE /api/v1/beneficiaries/:id` → soft-remove (sets `is_favorite=false`)
- [x] `last_used_at` updated after every successful bank transfer
- [x] Mobile: saved beneficiaries shown on withdraw screen; tap selects and skips manual entry
- [x] `npx tsc --noEmit` passes in `frontend-web/` and `mobile-app/reactnative/`

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
