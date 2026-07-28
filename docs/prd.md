# Spotlight Fintech Transformation — Product Requirements

**Version:** 1.0  
**Date:** 2026-06-13  
**Status:** Active

---

## Vision

Transform Spotlight from a contest/voting platform into a fintech super app where fans can hold a wallet balance, buy vote packs with that balance, earn rewards through referrals, and eventually receive virtual account numbers for direct bank transfers — all without disrupting the live contest experience.

---

## Epics

### EPIC 1 — Wallet & Ledger

Users hold an NGN balance inside Spotlight. Every credit and debit is a double-entry ledger record; the balance column is never updated directly. Idempotency keys are mandatory on all mutation endpoints.

**Acceptance criteria:**
- `GET /api/v1/wallet/balance` returns real-time balance derived from ledger
- `POST /api/v1/wallet/topup` initiates a Paystack payment; webhook credits the ledger on `charge.success`
- `POST /api/v1/wallet/debit` debits the ledger; fails closed if balance insufficient
- All ledger entries immutable; corrections via reversing entries only
- Amounts stored as BIGINT kobo; never floats; never strings for math
- Every mutation: (1) Idempotency-Key required, (2) double-entry ledger, (3) audit event, (4) tier-limit check fail-closed

### EPIC 2 — KYC & Tiers

Three progressive tiers unlock higher daily wallet limits and new features.

| Tier | Daily wallet limit | Daily vote limit | Requirements |
|------|-------------------|-----------------|--------------|
| 0 (Unverified) | ₦0 — wallet disabled | existing free-vote limit | None |
| 1 (Basic) | ₦50,000 | 500 paid votes/day | Verified phone + BVN name match |
| 2 (Standard) | ₦200,000 | 2,000 paid votes/day | Tier 1 + NIN or Passport |
| 3 (Premium) | ₦5,000,000 | Unlimited | Tier 2 + Proof of address + manual review |

KYC status: `unverified` → `pending` → `verified` | `failed` | `suspended`.  
All limit checks fail-closed (deny on error).

### EPIC 3 — Virtual Accounts

On KYC Tier 1 approval, auto-assign a dedicated Paystack virtual bank account. Users pay via bank transfer; Paystack webhook credits the ledger.

**Acceptance criteria:**
- Auto-provisioned on `kyc_tier` → 1 transition
- `GET /api/v1/virtual-accounts/me` returns account number + bank name
- Inbound transfer webhook: verify HMAC → dedup → credit ledger
- No manual re-trigger needed; idempotent provisioning

### EPIC 4 — Vote Bridge

Wraps the existing vote-recording functions (protected legacy code) to add:
- KYC tier gate before paid votes
- Idempotency key check before `castFreeVote()` (fixes TOCTOU — VB-2)
- `SELECT FOR UPDATE` lock on `vote_transactions` before `verifyAndCreditPaidVote()` (fixes VB-3)
- Outbox events for referral rewards and analytics

Feature-flagged: `VOTES_BRIDGE_ENABLED`. Off = falls through to existing functions.

### EPIC 5 — Referrals

Users get a unique share code. When a referred user makes their first paid vote purchase, the referrer earns ₦500 (50,000 kobo) credited to their wallet ledger.

**Acceptance criteria:**
- Share code persisted on `user_profiles` — generated on first login
- `GET /api/v1/referrals/me` returns code + earnings + count
- Referral reward: single ledger credit, idempotent (at-most-once per referred user)
- Anti-gaming: referrer cannot be the referred user; no self-referral

### EPIC 6 — Admin Fintech RBAC

Maker-checker model for financial operations above ₦100,000.

- **Maker:** initiates a manual credit/debit
- **Checker:** approves or rejects it
- No self-approval
- Full audit trail with actor IDs and timestamps
- Roles: `finance_maker`, `finance_checker`, `finance_viewer`

---

## Decision Gates (block delivery until resolved)

| Gate | Question | Status |
|------|----------|--------|
| DG-1 | Regulatory: do we need a CBN Payment Service Bank licence before wallet goes live? | OPEN |
| DG-2 | Which user table is the canonical FK anchor for all new fintech tables? | RESOLVED → `auth.users(id)` |
| DG-3 | Which vote engine is active in production — legacy or universal? | OPEN (confirm via prod query before bridge ships) |

---

## Out of scope (v1)

- Card issuance
- Crypto rails
- International transfers
- Merchant payments
- Loan products

---

## Non-functional requirements

- All money-path mutations < 800ms p95 under 50 RPS load
- Ledger entries must survive a Next.js cold restart (Supabase-persisted, not in-memory)
- Zero-downtime migrations only (additive SQL)
- Feature flags on every new module — `FEATURE_<MODULE>_ENABLED=true/false`
