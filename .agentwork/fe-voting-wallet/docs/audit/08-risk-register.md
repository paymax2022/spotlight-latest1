# Spotlight — Fintech Integration Risk Register
> Audit date: 2026-06-13 | Source: docs/prd.md cross-referenced against codebase audit

Format: **[ID] Risk · Severity · Existing code/table touched · Recommended mitigation**

---

## Decision Gates (Resolve Before Any Build)

| ID | Risk | Severity | Details |
|---|---|---|---|
| DG-1 | **Regulatory/licensing model unresolved** | 🔴 BLOCKER | CBN license type (PSSP/MMO/Super Agent) or BaaS partner determines whether wallet design holds customer funds in Spotlight's own right. Shapes ledger, settlement, and VA design entirely. Resolve Week 1 before any wallet schema is written. |
| DG-2 | **Parallel user identity systems** | 🔴 BLOCKER | `user_profiles` (auth.users–linked) vs `platform_users` (standalone RBAC) vs `profiles` (RBAC alt) — three systems with no clear authority. Wallet must FK to exactly one user identity. Resolve before wallet schema. |
| DG-3 | **Dual vote storage systems** | 🔴 BLOCKER | `contestant_votes` (legacy, trigger-maintained) vs `votes` + `vote_totals` (universal) both exist. Voting bridge (PRD §10.3) cannot wrap a function if two functions do the same thing. Audit which is live; deprecate the other. |

---

## EPIC 1 — Wallet

| ID | Risk | Severity | Touched Code | Mitigation |
|---|---|---|---|---|
| W-1 | `mobile_fintech_accounts.available_balance` is not ledger-backed | 🔴 CRITICAL | `supabase/migrations/20260423190000_mobile_fintech_persistence.sql` | Replace mutable balance column with derived balance from new `ledger_entries` table. Do NOT migrate old mobile_fintech_accounts rows as authoritative; treat as display cache only. |
| W-2 | No ACID guarantee on concurrent wallet debits | 🔴 CRITICAL | mobile_fintech_accounts single-row balance update | Implement row-level lock (SELECT FOR UPDATE) or optimistic concurrency (version column) on every debit. |
| W-3 | Currency amounts stored as `numeric` (float risk) | 🟡 HIGH | `mobile_fintech_transactions.amount`, `vote_transactions.amount_expected` | New fintech tables must use BIGINT minor units (kobo). Migrate existing numeric fields with explicit cast. Never pass float to money path. |
| W-4 | No wallet state machine | 🟡 HIGH | No existing wallet_state column | New `wallets` table needs status enum (ACTIVE\|FROZEN\|SUSPENDED\|CLOSED) with transition table + audit log on every change. |
| W-5 | No idempotency key on mobile_fintech_transactions | 🟡 HIGH | `mobile_fintech_transactions` | New transactions table needs UNIQUE idempotency_key; existing mobile table has no dedup mechanism. |

---

## EPIC 2 — Virtual Bank Accounts

| ID | Risk | Severity | Touched Code | Mitigation |
|---|---|---|---|---|
| VA-1 | `/api/webhooks/paystack` already exists for voting | 🟠 MEDIUM | `frontend-web/app/api/webhooks/paystack/route.ts` | VA webhook uses same provider (Paystack) but different event types (transfer.success vs. charge.success). The existing webhook handler must be extended — not replaced — to route on event type. Add raw-persist-before-process pattern. |
| VA-2 | No webhook dedup mechanism | 🔴 CRITICAL | Existing webhook handler | Paystack retries webhooks. Current handler has no idempotency key; double-credit is possible. Add `webhook_events` table with (provider, provider_event_id) UNIQUE before processing. |
| VA-3 | Paystack secret key in env, not secrets manager | 🟡 HIGH | `PAYSTACK_SECRET_KEY` in .env.local | Webhook HMAC verification uses this key. Rotation requires redeploy. Migrate to secrets manager before GA. |
| VA-4 | No provider abstraction layer | 🟡 HIGH | Paystack client hardcoded in voting service | PRD requires provider-abstraction interface so second VA provider can be added in Phase 2. New payments module must introduce this before first Paystack VA integration. |

---

## EPIC 3 — Transaction Management / Ledger

| ID | Risk | Severity | Touched Code | Mitigation |
|---|---|---|---|---|
| L-1 | No double-entry ledger exists | 🔴 BLOCKER | All payment tables | PRD: ledger ships first; nothing that moves money goes live before it. New `ledger_accounts` + `ledger_entries` tables needed. Existing `mobile_fintech_transactions` is single-entry only. |
| L-2 | `vote_transactions` uses `numeric(12,2)` (float) | 🔴 CRITICAL | `supabase/migrations/20260602100000_universal_voting_engine.sql:vote_transactions` | Paid votes are already live with float amounts. Backfill as kobo integers when migrating to unified payments table. |
| L-3 | vote_totals can drift from votes table | 🔴 CRITICAL | `increment_vote_totals()` RPC called from application code | If frontend crashes after vote insert but before RPC call, totals drift. Fintech bridge must call increment_vote_totals() in a saga with compensating rollback, not a fire-and-forget. |
| L-4 | Existing payment references lack human-readable format | 🟡 LOW | `payment_ref_prefix = 'SPT-VOTE'` in voting_settings | PRD requires globally unique human-readable reference (e.g. SPT-20260613-XXXXXX). New reference generator must not collide with existing SPT-VOTE-* namespace. |
| L-5 | No reconciliation job | 🔴 BLOCKER | No scheduler | PRD declares reconciliation a launch blocker. Must be built before any live money movement. |

---

## EPIC 4 — KYC

| ID | Risk | Severity | Touched Code | Mitigation |
|---|---|---|---|---|
| KYC-1 | No KYC fields in user_profiles | 🔴 BLOCKER | `supabase/migrations/20260401004207_create_user_profiles.sql` | New `user_kyc_profiles` table keyed to auth.users.id (additive-only per PRD). Do NOT alter existing user_profiles columns. |
| KYC-2 | mobile_fintech_accounts.kyc_status exists but is stub | 🟡 HIGH | `mobile_fintech_accounts` | This enum column ('not_started'\|'in_review'\|'verified'\|'rejected') is the right intent but has no document storage, no verification history, no provider reference. New KYC module supersedes it. |
| KYC-3 | phone field not unique and unverified | 🔴 CRITICAL | `user_profiles.phone` | Phone is the Tier-1 KYC anchor in Nigerian fintech (BVN lookup uses phone). Add UNIQUE constraint after dedup campaign, then add phone_verified_at. |
| KYC-4 | Same BVN across multiple accounts not detected | 🔴 CRITICAL | No existing check | PRD AC: duplicate BVN = identity fraud. Requires BVN uniqueness index on new kyc table before any BVN collection begins. |
| KYC-5 | No minor detection | 🟡 HIGH | date_of_birth nullable in user_profiles | PRD: minor detected via DOB from BVN → reject flow. date_of_birth must be populated and validated before Tier-1 KYC proceeds. |

---

## EPIC 5 — Tier Management

| ID | Risk | Severity | Touched Code | Mitigation |
|---|---|---|---|---|
| T-1 | No tier system exists | 🟡 MEDIUM | — | New `tiers`, `tier_limits`, `limit_usage_counters` tables needed. No existing table conflicts. |
| T-2 | Daily limit resets use UTC; Nigerian market uses WAT (+1) | 🟡 MEDIUM | `voter_daily_limits.vote_date` (UTC date) | Existing vote limits already use UTC dates. New fintech limits must use Africa/Lagos timezone boundaries. Ensure consistency — do not mix UTC and WAT in same product. |

---

## EPIC 6 — Referral & Rewards

| ID | Risk | Severity | Touched Code | Mitigation |
|---|---|---|---|---|
| R-1 | referral_code exists in platform_users but platform_users is being deprecated | 🟡 HIGH | `platform_users.referral_code`, `platform_users.referred_by` | New `referral_codes` table must not conflict with platform_users.referral_code values. Migrate any existing codes to new table on platform_users deprecation. |
| R-2 | cast_referral_vote() in legacy voting engine has no dedup | 🟡 HIGH | `cast_referral_vote()` in 20260404240000 | Legacy referral votes can be double-awarded. New referral system must use UNIQUE (referrer_id, referee_id) constraint and require referee KYC before payout (PRD AC3). |
| R-3 | Contest audiences are organized; referral fraud is high-risk | 🟡 HIGH | Contestant voter bases are coordinated campaigners | PRD correctly identifies this as launch-blocking. Anti-fraud controls (self-referral, circular, velocity, cluster scoring) must ship before any rewards go live. |

---

## EPIC 7 — User Profile

| ID | Risk | Severity | Touched Code | Mitigation |
|---|---|---|---|---|
| UP-1 | Existing users have sparse/dirty data | 🟡 HIGH | user_profiles rows with empty phone, empty full_name | Dedup and verification campaign before KYC GA. Never block existing contest features — KYC is opt-in upsell (PRD §10.4). |
| UP-2 | profile_completion integer recomputed differently in multiple places | 🟡 MEDIUM | user_profiles.profile_completion, /api/me/profile-completion route | New fintech fields (phone_verified, kyc_tier, etc.) should contribute to profile_completion score. Centralize computation. |
| UP-3 | Changing phone/email — no re-verification flow | 🔴 HIGH | /api/me/profile PATCH | PRD AC: credential-channel change must trigger re-verification and 24h withdrawal cool-down. No such flow exists today. |

---

## EPIC 8 — RBAC

| ID | Risk | Severity | Touched Code | Mitigation |
|---|---|---|---|---|
| RBAC-1 | Existing admin users not mapped to new RBAC roles | 🟡 HIGH | `user_profiles.role = 'admin'` + JWT app_metadata.role | PRD AC4: existing admins must be explicitly mapped to roles via migration with review. No silent privilege escalation. |
| RBAC-2 | votes.override permission exists in seeded permissions | 🔴 HIGH | `permissions` seed: permission slug 'votes.override' | This is a very high-risk permission. Must be gated with maker-checker. Not currently enforced — anyone with this permission can override vote totals. |
| RBAC-3 | /api/v1/admin/* uses shared API key, not RBAC | 🟡 HIGH | `backend/internal/middleware/admin_auth.go` | All admin dashboard ops have no per-user audit trail. Must be migrated to JWT + RequirePermission before fintech ops (payouts, reconciliation) are exposed on this surface. |
| RBAC-4 | No Compliance Officer or Finance Ops roles seeded | 🟡 HIGH | `supabase/seeds/rbac_seed.sql` | PRD requires named real humans for these roles. Finance Ops (maker), Finance Approver (checker), Compliance Officer roles need permissions seeded before fintech modules ship. |
| RBAC-5 | Maker-checker not implemented | 🔴 BLOCKER | No maker_checker_requests table | PRD requires maker-checker for payouts, reversals, tier-limit changes, wallet state changes. Table + workflow must be built in Phase 0. |

---

## Voting Bridge (PRD §10.3) — Most Critical Integration

| ID | Risk | Severity | Touched Code | Mitigation |
|---|---|---|---|---|
| VB-1 | Which vote-recording function does the frontend call? | 🔴 BLOCKER | `cast_free_vote()` (legacy RPC) vs `castFreeVote()` (universal TS service) | Audit confirmed frontend uses universal TS service (`free-vote.service.ts`). Legacy RPCs remain in DB but are not actively called for web voting. Confirm and document. |
| VB-2 | castFreeVote() is NOT idempotent | 🔴 CRITICAL | `frontend-web/src/server/voting/free-vote.service.ts` | Calling twice inserts two vote rows. The bridge must introduce an idempotency key at the HTTP layer before wallet debit is wired. |
| VB-3 | verifyAndCreditPaidVote() has a race condition | 🔴 CRITICAL | `frontend-web/src/server/voting/paid-vote.service.ts` | Paystack webhook + browser redirect can both trigger `verifyAndCreditPaidVote()` concurrently. The vote_credit_status guard (step 2) handles most cases but is not atomic with the vote insert in step 7. Use SELECT FOR UPDATE on vote_transactions row. |
| VB-4 | No contract test pinning existing vote-recording behavior | 🔴 BLOCKER | `free-vote.service.ts`, `paid-vote.service.ts` | PRD §10.3: contract tests must be written and green before any wrapping begins. |
| VB-5 | Saga/outbox pattern absent | 🔴 HIGH | Wallet debit → vote credit pathway | If wallet is debited but vote credit fails, user loses money silently. PRD §EPIC 3 edge case: compensating wallet reversal must be implemented as saga. |
| VB-6 | increment_vote_totals() called after vote insert (not in same tx) | 🟡 HIGH | `free-vote.service.ts` step 11 | Application crash between insert and RPC call = vote counted but totals wrong. In the bridge, vote insert + increment_vote_totals must be in a single database transaction or outbox-backed. |

---

## Infrastructure / Deployment

| ID | Risk | Severity | Details |
|---|---|---|---|
| INF-1 | cPanel shared hosting unsuitable for fintech | 🔴 HIGH | No process isolation, no container orchestration, shared resources. A fintech product handling real money requires dedicated compute, isolated networking, and a platform with SLAs. |
| INF-2 | No staging environment | 🟡 HIGH | All changes go to production. Fintech requires a staging environment with test Paystack keys and a test Supabase instance before GA. |
| INF-3 | SUPABASE_SERVICE_ROLE_KEY in .env.local | 🔴 CRITICAL | If .env.local is ever committed or leaked, all RLS is bypassed. Rotate immediately; move to secrets manager. |
| INF-4 | No automated database migration step in CI | 🟡 HIGH | Schema and code can diverge silently. Add supabase migration step to deploy pipeline with rollback. |
| INF-5 | No backend CI/CD | 🟡 HIGH | Go backend deployed manually; no automated test, build, or deploy pipeline. |

---

## Summary Scorecard

| Category | Blockers 🔴 | High 🟡 | Medium 🟠 |
|---|---|---|---|
| Decision Gates | 3 | — | — |
| Wallet | 2 | 3 | — |
| Virtual Accounts | 2 | 2 | 1 |
| Ledger | 3 | 1 | 1 |
| KYC | 4 | 1 | — |
| Tier Management | — | 1 | 1 |
| Referrals | — | 3 | — |
| User Profile | 1 | 2 | — |
| RBAC | 1 | 4 | — |
| Voting Bridge | 3 | 3 | — |
| Infrastructure | 2 | 3 | — |
| **Total** | **21** | **23** | **3** |

**21 blocker-severity issues must be resolved before any fintech module goes live.**  
The three Decision Gates (regulatory licensing, user identity consolidation, dual vote system) must be resolved first as they shape all subsequent design decisions.
