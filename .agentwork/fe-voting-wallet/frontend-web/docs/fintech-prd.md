# Product Requirements Document (PRD)
## Spotlight → Fintech Super App Transformation

**Version:** 1.0 (Draft for review)
**Date:** June 2026
**Status:** Pending stakeholder review
**Document owner:** Product / Engineering Leadership

> **How to read this document:** Every unverified assumption about the existing Spotlight codebase is tagged `[ASSUMPTION]`. Every decision requiring legal/regulatory counsel is tagged `[LEGAL REVIEW]`. Replace assumptions with facts after the codebase audit (Section 10.1).

---

## 1. Executive Summary & Goals

### 1.1 Background
Spotlight is a live production platform where applicants register for contests and the public votes on contestants. This PRD defines the transformation of Spotlight into a fintech super app by introducing eight core financial modules — Wallet, Virtual Bank Accounts, Transaction Management, Tier Management, KYC, Referral & Rewards, User Profile, and RBAC — plus the foundational financial infrastructure (ledger, reconciliation, fraud controls, audit) required to operate them safely.

### 1.2 The strategic bridge: why fintech + contests is a natural fit
The existing contest/voting engine is not a legacy liability — it is the launch wedge for the fintech layer:

- **Paid voting:** Votes become a monetized product purchased from wallet balance, converting existing engagement directly into transaction volume from day one.
- **Contestant earnings & payouts:** Contestants accumulate winnings/gifts that settle into their wallets, creating a two-sided money flow (fans fund in, contestants cash out).
- **Referral loops:** Contestants are natural growth agents — they already campaign for votes; referral rewards formalize and incentivize this behavior.
- **Built-in audience:** Existing registered users become the seed base for wallet adoption, lowering CAC versus a cold-start fintech.

### 1.3 Goals
1. Launch a regulatory-compliant wallet + virtual account system without breaking any existing contest/voting functionality.
2. Convert ≥ 30% of monthly active voters into funded-wallet users within 6 months of GA.
3. Establish a double-entry ledger as the single source of financial truth before any money movement goes live.
4. Achieve zero unreconciled transactions older than 24 hours in steady state.
5. Ship behind feature flags with per-module kill switches and a tested rollback path.

### 1.4 Non-goals (this phase)
Lending/credit, card issuing, international remittance, crypto, investment products, agency banking. (See Section 13 and the roadmap in Section 14 for future consideration.)

---

## 2. Success Metrics

### North-star metric
**Monthly Transacting Users (MTU):** unique users completing ≥ 1 successful financial transaction per month.

### Per-feature KPIs
| Module | Primary KPI | Guardrail metric |
|---|---|---|
| Wallet | Funded-wallet conversion rate | Wallet balance discrepancy count (target: 0) |
| Virtual Accounts | VA funding success rate ≥ 98% | Webhook processing lag p95 < 30s |
| Transactions | Transaction success rate ≥ 99% | Duplicate transaction incidents (target: 0) |
| KYC | Tier-1 KYC completion rate ≥ 70% of funnel entrants | Median verification time < 5 min |
| Tiers | % users upgrading T0→T1 within 7 days | Limit-breach incidents (target: 0) |
| Referrals | K-factor ≥ 0.3 | Fraudulent referral rate < 1% of paid rewards |
| Profile | Profile completeness ≥ 80% for transacting users | PII exposure incidents (target: 0) |
| RBAC | 100% sensitive ops behind maker-checker | Privileged-action audit coverage = 100% |

### Existing-system guardrails (must not regress)
- Contest registration completion rate: no decline > 2% vs. pre-launch baseline.
- Voting throughput and p95 latency: within 10% of baseline.
- Zero data loss/corruption in existing applicant, contest, and vote tables.

---

## 3. Personas & User Journeys

### Personas
1. **The Fan/Voter ("Ada"):** Votes for favorite contestants. New behavior: funds wallet via virtual account transfer, buys vote bundles, earns referral rewards for inviting friends.
2. **The Contestant ("Tobi"):** Registers for contests, campaigns for votes. New behavior: receives gift/winning credits to wallet, completes KYC to withdraw, shares referral code to grow voter base.
3. **The Contest Organizer / Internal Ops ("Kemi"):** Manages contests today. New behavior: configures vote pricing, prize pools, payout schedules — gated by RBAC.
4. **Compliance Officer ("Femi"):** New role. Reviews KYC queues, investigates flagged transactions, files regulatory reports.
5. **Finance Ops ("Ngozi"):** New role. Runs reconciliation, approves payouts (maker-checker), manages settlement.
6. **Support Agent ("Sade"):** Handles user issues. Needs read-scoped views of transactions/KYC status without ability to move money.

### Critical journeys (each must have full UX + API spec before build)
- J1: New user signup → profile → Tier-0 wallet auto-created → fund via VA → buy votes.
- J2: Existing Spotlight user (pre-fintech) logs in → migration prompt → wallet backfilled → optional KYC upsell.
- J3: Contestant completes Tier-2 KYC → receives prize payout to wallet → withdraws to bank.
- J4: User refers friend → friend signs up + funds wallet → both receive reward → reward redeemed against votes.
- J5: Compliance officer reviews flagged transaction → freezes wallet → user notified → resolution workflow.

---

## 4. Feature Epics

> Format per epic: Overview → User stories → Acceptance criteria (AC) → Edge cases → Error states → Non-functional requirements (NFR).

---

### EPIC 1: Wallet

**Overview:** Every user gets exactly one primary wallet (NGN at launch; multi-currency-ready data model). Balances are *derived from the ledger*, never stored as independently mutable fields. Wallet exposes three balance views: **available** (spendable now), **ledger** (settled total), **pending** (incoming not yet settled / holds).

**User stories**
- As a voter, I can fund my wallet so that I can purchase votes.
- As a contestant, I can receive winnings into my wallet so that I can withdraw them.
- As a user, I can see available vs. pending balance so that I understand what I can spend.
- As compliance, I can freeze a wallet so that suspicious funds cannot move.

**Acceptance criteria**
- AC1: Wallet auto-created at signup (and backfilled for existing users) in `ACTIVE` state, balance 0.
- AC2: Wallet states: `ACTIVE`, `FROZEN` (no debits, credits allowed), `SUSPENDED` (no debits or credits), `CLOSED` (terminal; requires zero balance). State transitions are audited and RBAC-gated.
- AC3: All debit operations check available balance atomically (row-level lock or optimistic concurrency with retry) — concurrent debits can never overdraw.
- AC4: Every wallet operation requires an idempotency key; replays return the original result, not a duplicate movement.
- AC5: Balance displayed to user always reconciles to SUM of ledger entries; a scheduled invariant-check job alerts on any drift.
- AC6: Currency stored as ISO 4217 code; amounts stored as integer minor units (kobo). No floats anywhere in money paths.

**Edge cases**
- Concurrent vote purchases draining the same wallet (race) → exactly one wins per available funds; others fail cleanly with `INSUFFICIENT_FUNDS`.
- Credit arriving for a `FROZEN` wallet → accepted, flagged for compliance review.
- Credit arriving for a `CLOSED` wallet → routed to an unclaimed-funds suspense account `[LEGAL REVIEW: dormant/unclaimed funds treatment]`.
- Reversal of a transaction the user has already partially spent → wallet may go negative in ledger terms; define negative-balance policy (block debits, recover from next credit).

**Error states:** `INSUFFICIENT_FUNDS`, `WALLET_FROZEN`, `WALLET_NOT_FOUND`, `LIMIT_EXCEEDED`, `IDEMPOTENCY_CONFLICT`, `CURRENCY_MISMATCH`.

**NFRs:** Debit path p95 < 300ms; wallet service availability 99.95%; all money mutations within DB transactions; zero tolerance for balance drift.

---

### EPIC 2: Virtual Bank Account (VA)

**Overview:** Each KYC-verified user receives a dedicated NUBAN virtual account; any transfer into it auto-credits their wallet. This is the primary funding rail (bank transfer is the dominant funding method in Nigeria `[ASSUMPTION: Nigeria-first launch]`).

**Provider strategy `[LEGAL REVIEW + commercial decision]`**
| Option | Pros | Cons |
|---|---|---|
| Paystack (Titan/VA) | Strong API/docs, fast integration, good webhook tooling | Fees; dependency on aggregator |
| Flutterwave | Wide rails, multi-product | Historical webhook reliability complaints; do diligence |
| Providus / Wema (9PSB) direct | Lower per-transaction cost at scale, bank-grade | Heavier integration, slower onboarding |
| **Recommendation** | **Launch on one aggregator (Paystack-class) behind a provider-abstraction interface; add a second provider for redundancy in Phase 2.** | |

**User stories**
- As a user, once I complete Tier-1 KYC, I get a personal account number I can share/fund from any bank app.
- As finance ops, I can see VA-to-wallet credit mappings and provider fees per transaction.

**Acceptance criteria**
- AC1: VA provisioned automatically on reaching the KYC tier that permits it; provisioning failures retried with backoff and surfaced to support if exhausted.
- AC2: Inbound webhook → signature verified → event persisted (raw) → idempotently processed → ledger credit → wallet balance reflects → user notified. End-to-end p95 < 60s.
- AC3: Webhook replay/duplicate delivery never double-credits (dedupe on provider event ID + amount + account).
- AC4: VA lifecycle: `PROVISIONING`, `ACTIVE`, `BLOCKED`, `RETIRED`; user-facing display only when `ACTIVE`.
- AC5: Daily reconciliation: provider settlement report vs. internal credits; any orphan (provider says paid, no wallet credit) or ghost (credit without provider record) raises a P1 alert.

**Edge cases**
- Transfer received with amount below provider minimum or above user tier limit → credit held in suspense, compliance notified, user messaged.
- Sender name mismatch / sanctioned sender `[LEGAL REVIEW]` → hold + review queue.
- Provider outage → funding degraded-mode banner; queue provisioning; no data loss.
- Webhook arrives before provisioning record commits (race) → retry with backoff against persisted raw event.

**Error states:** `VA_PROVISIONING_FAILED`, `WEBHOOK_SIGNATURE_INVALID`, `DUPLICATE_EVENT`, `SUSPENSE_HOLD`.

**NFRs:** Raw webhook payloads retained ≥ 7 years `[LEGAL REVIEW: retention period]`; webhook endpoint isolated and rate-limited; provider credentials in secrets manager, rotated quarterly.

---

### EPIC 3: Transaction Management

**Overview:** A **double-entry ledger** is the system of record. Every money movement posts balanced debit/credit entries across accounts (user wallets, platform revenue, provider settlement, suspense, fees, reward liability). User-facing "transactions" are projections over ledger postings.

**Core design**
- **Accounts:** every user wallet is a ledger account; plus internal accounts: `PLATFORM_REVENUE`, `PROVIDER_SETTLEMENT_{provider}`, `FEES`, `REWARD_LIABILITY`, `SUSPENSE`, `PRIZE_POOL_{contest}`.
- **Posting rule:** a transaction = 2+ entries; SUM(debits) = SUM(credits) enforced at write time; entries immutable (corrections via reversing entries only).
- **Transaction state machine:** `INITIATED → PENDING → PROCESSING → SUCCESS | FAILED | REVERSED`; explicit allowed-transition table; illegal transitions rejected and alerted.

**User stories**
- As a user, I can view a paginated, searchable history of all my transactions with clear statuses.
- As a user, I can download a statement (PDF/CSV) for a date range.
- As support, I can trace any transaction end-to-end (initiation → provider → ledger → notification).
- As finance, I can reverse an erroneous transaction with maker-checker approval, producing a linked reversing entry.

**Acceptance criteria**
- AC1: Every state-changing endpoint requires an `Idempotency-Key`; same key + same payload → cached response; same key + different payload → `409 IDEMPOTENCY_CONFLICT`.
- AC2: Each transaction carries a globally unique, human-readable reference (e.g., `SPT-20260613-XXXXXX`) usable by support and in provider disputes.
- AC3: Reversals create a new linked transaction; the original remains immutable with status `REVERSED`.
- AC4: List endpoints support cursor pagination, filtering (type, status, date range, amount range), and full-text on reference/narration.
- AC5: Vote purchases post as: debit user wallet → credit `PRIZE_POOL_{contest}` and/or `PLATFORM_REVENUE` per configured split. **This is the integration point with the existing voting system** (see Section 10.3).

**Edge cases**
- Partial failure: wallet debited but downstream (vote credit) failed → saga/outbox pattern with compensating reversal; user never silently loses money.
- Provider says SUCCESS, internal record FAILED (or vice versa) → reconciliation catches; auto-heal where deterministic, queue for ops otherwise.
- Clock skew/out-of-order webhook events → order by provider event sequence where available; otherwise state machine guards.

**Error states:** `TXN_NOT_FOUND`, `INVALID_STATE_TRANSITION`, `REVERSAL_NOT_ALLOWED`, `STATEMENT_RANGE_TOO_LARGE`.

**NFRs:** Ledger writes strictly serializable per wallet; read replicas for history queries; statement generation async with notification on completion.

---

### EPIC 4: KYC

**Overview:** Tiered KYC mapped to CBN-style tiering `[LEGAL REVIEW: confirm exact category & current CBN circulars for your license type]`. Verification via third-party identity providers (BVN/NIN lookup, liveness, document OCR) with a manual review queue for failures/edge cases.

**Tier ↔ KYC mapping (baseline; legal to confirm)**
| Tier | Requirements | Unlocks |
|---|---|---|
| Tier 0 | Phone + email verified | View-only wallet, receive rewards (capped), no VA |
| Tier 1 | BVN or NIN verified + selfie/liveness match | VA issuance, funding, vote purchases within limits |
| Tier 2 | Govt ID document + address verification | Higher limits, withdrawals to bank |
| Tier 3 | Enhanced due diligence (source of funds, etc.) | Max limits, contestant prize payouts above threshold |

**User stories**
- As a user, I can complete KYC in-app in under 5 minutes with clear progress and failure reasons.
- As a compliance officer, I can review a queue of failed/flagged verifications with all evidence in one screen, then approve/reject with reason codes.
- As a user whose KYC was rejected, I can see why (where legally permitted) and resubmit.

**Acceptance criteria**
- AC1: KYC state machine per level: `NOT_STARTED → IN_PROGRESS → PENDING_REVIEW → VERIFIED | REJECTED`; resubmission allowed up to N attempts (configurable) before mandatory manual review.
- AC2: Provider abstraction layer (same pattern as payments) so identity vendors are swappable; provider raw responses stored encrypted.
- AC3: Manual review queue with SLA timers, assignment, four-eyes option for high-risk approvals, and full audit trail.
- AC4: Changing verification-sensitive profile fields (phone, BVN-linked name) after verification triggers re-verification of affected level.
- AC5: PII (BVN, NIN, ID images) encrypted at rest with field-level encryption; access logged; visible only to roles with explicit permission.

**Edge cases**
- Name mismatch between BVN record and entered profile (e.g., marriage, typo) → fuzzy-match threshold + manual review path.
- Same BVN attempted across multiple accounts → block + investigate (identity-sharing fraud).
- Minor detected (DOB from BVN) `[LEGAL REVIEW: minimum age policy]` → reject with specific flow.
- Provider downtime mid-flow → save progress, resume later, never lose uploaded documents.

**Error states:** `VERIFICATION_PROVIDER_TIMEOUT`, `DOCUMENT_UNREADABLE`, `LIVENESS_FAILED`, `DUPLICATE_IDENTITY`, `MAX_ATTEMPTS_EXCEEDED`.

**NFRs:** Data retention & deletion policy per NDPA (Nigeria Data Protection Act) `[LEGAL REVIEW]`; KYC images served via short-lived signed URLs only; provider keys in secrets manager.

---

### EPIC 5: Tier Management System

**Overview:** Tiers are the policy layer binding KYC status to financial limits. Limits are configuration, not code — changeable by authorized ops without deploys, with versioned history.

**Limit dimensions per tier (all configurable):** single-transaction max, daily debit cap, monthly debit cap, max wallet balance, withdrawal allowed (bool), VA issuance allowed (bool), reward-redemption cap.

**User stories**
- As a user, I can see my current tier, my limits, my usage against them, and exactly what unlocks the next tier.
- As ops, I can adjust tier limits (maker-checker) and the change takes effect without deployment.
- As compliance, I can manually downgrade a user's tier with reason, notifying the user.

**Acceptance criteria**
- AC1: Tier upgrade is automatic and immediate upon KYC level verification; downgrade paths: compliance action, KYC revocation, document expiry.
- AC2: Every debit/credit is checked against tier limits atomically with the balance check; limit-usage counters reset on Africa/Lagos calendar boundaries `[ASSUMPTION: NGN/Lagos market]`.
- AC3: Limit checks fail closed: if the limit service is unreachable, money movement is blocked (with alerting), never allowed through unchecked.
- AC4: Tier/limit configuration is versioned; every transaction records the limit-config version it was evaluated under (auditability).

**Edge cases**
- In-flight transaction when a downgrade lands → evaluate limits at authorization time; settle in-flight as authorized.
- Pending credits that would breach max balance on settlement → settle into pending/suspense and notify, or reject per configured policy.
- Timezone/DST handling for daily caps (Nigeria has no DST, but design must not assume that for future markets).

**Error states:** `TIER_LIMIT_EXCEEDED`, `TIER_DOWNGRADE_BLOCKED_PENDING_TXNS`, `CONFIG_VERSION_CONFLICT`.

---

### EPIC 6: Referral & Reward Management

**Overview:** Formalizes the organic campaigning behavior contestants already exhibit. Users get unique referral codes; qualified events (signup, first funding, first vote purchase — configurable) trigger rewards (cash credit, points, vote bundles) with anti-abuse controls baked in from day one.

**User stories**
- As a contestant, I can share my referral code/link so that I earn rewards when fans join and vote.
- As a referred user, I can enter a code at signup (or via deep link auto-attribution) and see my pending reward.
- As growth ops, I can configure campaigns: reward type, amount, qualifying event, caps, expiry, and eligible cohorts.
- As risk, I can review a fraud queue of suspicious referral clusters before rewards pay out.

**Acceptance criteria**
- AC1: Referral codes globally unique, non-guessable, human-shareable; attribution window configurable (e.g., 14 days from click).
- AC2: Reward states: `PENDING_QUALIFICATION → QUALIFIED → PAID | EXPIRED | REVOKED`; payouts post to ledger against `REWARD_LIABILITY`.
- AC3: Anti-fraud controls (all must ship at launch, not later):
  - Self-referral blocked (same device fingerprint, BVN, bank account, phone, or payment instrument).
  - Circular-referral detection (A→B→A and longer cycles).
  - Velocity rules: max referrals/day per user; cool-down on new accounts.
  - Reward payout only after the referred user passes Tier-1 KYC **and** completes a real funded action (not just signup) `[recommended default]`.
  - Cluster scoring: shared IP/device/bank-detail graphs feed a risk score; above threshold → manual review.
- AC4: Rewards expire after a configurable period if not redeemed; expirations sweep back from `REWARD_LIABILITY`.
- AC5: Full campaign analytics: referrals, qualification rate, fraud-block rate, cost per acquired transacting user.

**Edge cases**
- Referred user signs up but funds 30 days later (outside window) → no reward; ensure messaging never over-promises.
- Reward earned, then qualifying transaction is reversed → reward auto-revoked if unpaid, clawback entry if paid `[LEGAL REVIEW: clawback T&Cs]`.
- Code shared publicly goes viral (thousands of attributions) → campaign-level caps and circuit breaker.

**Error states:** `INVALID_REFERRAL_CODE`, `SELF_REFERRAL_BLOCKED`, `ATTRIBUTION_WINDOW_EXPIRED`, `REWARD_CAP_REACHED`, `FRAUD_HOLD`.

---

### EPIC 7: User Profile

**Overview:** Single canonical profile extending the existing Spotlight user record `[ASSUMPTION: a users table exists with auth credentials, basic info, and contestant/voter role flags]`. Adds PII fields, verification statuses, preferences, and completeness scoring — without altering existing columns (additive-only).

**User stories**
- As a user, I can manage my profile, see completeness, and understand which fields are locked post-verification.
- As a user, changing my phone/email requires re-verification of that channel before it becomes active.
- As support, I can view a redacted profile (masked BVN/NIN) sufficient to help without exposing raw PII.

**Acceptance criteria**
- AC1: New profile data lives in new tables keyed to existing user ID (`user_financial_profile`, `user_kyc_documents`, etc.) — zero schema changes to existing user columns.
- AC2: Sensitive-field change flow: request → verify ownership of new value (OTP) → step-up auth on the account → swap → notify old + new channels → audit.
- AC3: Field-level encryption for BVN/NIN/document refs; masked-by-default rendering everywhere; unmask is a logged, permissioned action.
- AC4: Profile completeness score drives contextual nudges (e.g., "Add your BVN to unlock your account number").

**Edge cases**
- Existing Spotlight users with sparse/dirty data (no email, shared phone numbers) → migration dedupe & verification campaign (Section 10.4).
- Account takeover attempt via email change → step-up auth + 24h cool-down on withdrawals after credential-channel changes.

---

### EPIC 8: RBAC (Role-Based Access Control)

**Overview:** Replaces/extends the current admin model `[ASSUMPTION: existing system has a simple admin flag or a basic roles table]` with granular permissions, least-privilege defaults, and **maker-checker (dual approval)** on all sensitive money/compliance operations.

**Baseline role matrix**
| Role | Scope examples |
|---|---|
| Super Admin | Role assignment, feature flags, config (cannot self-approve own maker requests) |
| Admin | Contest config, vote pricing, user management (non-financial) |
| Compliance Officer | KYC queue, wallet freeze/unfreeze (checker for freezes), STR filing |
| Finance Ops | Reconciliation, payout initiation (maker), reversals (maker) |
| Finance Approver | Payout/reversal approval (checker) |
| Support Agent | Read-only transactions/KYC status (masked PII), raise cases |
| Read-only Auditor | Read-everything (masked), export audit logs |

**Acceptance criteria**
- AC1: Permissions are granular verbs on resources (`wallet:freeze`, `txn:reverse:approve`, `kyc:document:view_unmasked`); roles are permission bundles; direct permission grants possible but audited and discouraged.
- AC2: Maker-checker enforced server-side for: payouts, reversals, tier-limit changes, wallet state changes, reward campaign launches, role assignments. Maker ≠ checker enforced at the identity level.
- AC3: Every privileged action writes an immutable audit event: actor, action, target, before/after, justification, IP/device, timestamp.
- AC4: Existing admin users mapped to new roles via migration with explicit review — no silent privilege escalation.
- AC5: Session controls for staff: mandatory 2FA, short session TTL, IP allowlisting option for finance/compliance roles.

**Edge cases**
- Role removed while user holds pending maker requests → requests auto-expire, checker notified.
- Emergency "break-glass" access → time-boxed, dual-authorized, loudly alerted, auto-revoked.

---

## 5. System Architecture Overview

### 5.1 Recommended shape: **Modular monolith with hard module boundaries** (not microservices yet)
`[ASSUMPTION: Spotlight is a single deployable backend + DB — typical for a contest platform]`. Rationale:
- Fintech correctness depends on transactional integrity; a single DB transaction across wallet+ledger is dramatically simpler and safer than distributed sagas at launch scale.
- Microservices add failure modes (partial failures, network partitions) precisely where you can least afford them pre-product-market-fit.
- Hard module boundaries (separate schemas/packages, no cross-module table access, interfaces only) preserve a clean extraction path to services later (strangler-fig per module, starting with the webhook ingestor and notification engine, which are naturally async).

**Exception:** the **webhook ingestion endpoint** should be a thin, separately deployable service from day one (isolation from main-app deploys; independent scaling; security blast-radius reduction).

### 5.2 High-level data flow (funding example)
```
User's bank app → transfer to VA (provider) → provider webhook
  → Webhook Ingestor (verify signature, persist raw, enqueue)
  → Payment Processor (dedupe, validate, tier-limit check)
  → Ledger (balanced postings: dr PROVIDER_SETTLEMENT / cr USER_WALLET)
  → Wallet projection updated → Notification engine (push/SMS/email)
  → Reconciliation engine (T+0 continuous + T+1 batch vs provider report)
```

### 5.3 Module map
```
[Existing: Auth | Contests | Voting | Applicants]  ← untouched core
            │ (interfaces only — no new direct table writes from fintech modules)
[New: Profile+ | KYC | Tier | Wallet | Ledger | Transactions
      | Virtual Accounts | Referral/Rewards | RBAC+]
[Foundations: Idempotency | Outbox/Event bus | Audit log | Feature flags
      | Notification | Reconciliation | Fraud rules | Secrets | Observability]
```

---

## 6. Data Model (key entities)

> All new tables; additive-only. Money = BIGINT minor units. All tables: `created_at`, `updated_at`, soft-delete only where legally permitted.

- **wallets** (id, user_id FK→existing users, currency, status, version, …)
- **ledger_accounts** (id, type [USER_WALLET|PLATFORM_REVENUE|SUSPENSE|…], owner_ref, currency)
- **ledger_transactions** (id, reference UNIQUE, type, status, idempotency_key UNIQUE, metadata JSONB, limit_config_version)
- **ledger_entries** (id, transaction_id FK, account_id FK, direction [DEBIT|CREDIT], amount, balance_after) — *immutable; insert-only*
- **virtual_accounts** (id, user_id, provider, provider_ref, nuban, bank_name, status)
- **webhook_events** (id, provider, provider_event_id UNIQUE per provider, raw_payload, signature_valid, processing_status, attempts)
- **kyc_levels** (id, user_id, level, status, provider, provider_ref, reviewed_by, reason_code)
- **kyc_documents** (id, user_id, type, storage_ref [encrypted], status)
- **tiers / tier_limits** (versioned config) + **limit_usage_counters** (user_id, window, dimension, used)
- **referral_codes** (id, user_id, code UNIQUE) / **referral_attributions** (referrer_id, referee_id UNIQUE, source, attributed_at) / **rewards** (id, user_id, campaign_id, type, amount, status, expires_at)
- **roles / permissions / role_permissions / user_roles** (+ grants audit)
- **maker_checker_requests** (id, action_type, payload, maker_id, checker_id, status, expires_at)
- **audit_events** (append-only: actor, action, target_type/id, before, after, context) — *consider WORM storage tier*
- **outbox_events** (for reliable async: event_type, payload, status, attempts)

Key relationships: `users 1—1 wallets`; `wallets 1—1 ledger_accounts(USER_WALLET)`; `ledger_transactions 1—N ledger_entries (balanced)`; `users 1—N kyc_levels`; `referral_attributions` unique on referee (one referrer per user, ever).

---

## 7. API Surface Summary (per module)

> Versioned under `/api/v2/…` — existing `/api/v1` (or current unversioned routes) remain untouched `[ASSUMPTION: current API is v1 or unversioned]`. All mutating endpoints require `Idempotency-Key` header.

- **Wallet:** `GET /wallets/me` · `GET /wallets/me/balance` · `POST /wallets/me/freeze` (admin) · internal: `debit/credit` (never public)
- **Virtual Accounts:** `POST /virtual-accounts` (auto-triggered) · `GET /virtual-accounts/me` · `POST /webhooks/{provider}` (ingestor service)
- **Transactions:** `GET /transactions` (cursor, filters) · `GET /transactions/{ref}` · `POST /transactions/{ref}/reverse` (maker) · `POST /statements`
- **Votes (bridge):** `POST /votes/purchase` (wallet-funded; wraps existing vote-recording call — see 10.3)
- **KYC:** `POST /kyc/levels/{n}/start` · `POST /kyc/documents` · `GET /kyc/status` · admin: `GET/POST /kyc/review-queue/...`
- **Tiers:** `GET /tiers/me` (limits + usage) · admin: `PUT /tiers/config` (maker-checker)
- **Referrals:** `GET /referrals/me/code` · `POST /referrals/attribute` · `GET /referrals/me/stats` · `GET /rewards/me` · `POST /rewards/{id}/redeem`
- **Profile:** `GET/PATCH /profile/me` · `POST /profile/me/phone/change` (OTP flow) · etc.
- **RBAC (admin):** roles/permissions CRUD · `POST /maker-checker/{id}/approve|reject`

---

## 8. Foundational Infrastructure Requirements

1. **Double-entry ledger (build first).** Nothing that moves money ships before the ledger + invariant checks are live and tested. Balances are projections; the ledger is truth.
2. **Idempotency framework.** Middleware: key + request-hash storage, configurable TTL, conflict semantics standardized across all modules.
3. **Audit logging.** Append-only, tamper-evident (hash-chained or WORM bucket), covering user-sensitive and all staff actions. Audit write failure on a privileged action = action fails.
4. **Outbox pattern + event bus.** All cross-module side effects (notifications, analytics, reward qualification) via transactional outbox — no dual-writes.
5. **Webhook infrastructure.** Signature verification per provider, raw persistence before processing, dedupe, retries with DLQ, replay tooling for ops.
6. **Notification engine.** Channels: push, SMS, email, in-app. Templated, localized-ready, user preferences, transactional vs marketing separation `[LEGAL REVIEW: marketing consent]`. Critical money alerts (debit, withdrawal, login from new device) are non-optional.
7. **Reconciliation engine.** Continuous (event-level) + daily batch (provider reports vs ledger). Output: matched / orphaned / ghosted / amount-mismatch buckets with an ops workflow. **Launch blocker — not a fast-follow.**
8. **Fraud & risk hooks.** Rules engine evaluated pre-authorization: velocity, device fingerprint, geo-anomaly, blocklists (BVN/device/bank account), configurable actions (allow, step-up, hold, block). Start rules-based; ML later.
9. **Rate limiting & abuse prevention.** Per-user and per-IP on auth, OTP, KYC attempts, referral attribution; CAPTCHA/step-up on anomalies.
10. **Feature flags.** Every module and risky sub-feature behind flags with percentage rollout + kill switch. Flag state changes audited.
11. **Compliance & reporting.** STR/CTR generation workflow `[LEGAL REVIEW: thresholds & format per NFIU]`, regulator data-request tooling, data-residency confirmation (Nigeria hosting requirements `[LEGAL REVIEW]`).
12. **Dispute & chargeback workflow.** Case object linked to transactions; SLA timers; provider dispute API integration where available.
13. **Settlement engine.** Config-driven T+N movement from provider settlement accounts to platform/prize-pool accounts with maker-checker on manual adjustments.
14. **Secrets & key management.** Central secrets manager; field-level encryption keys with rotation; no secrets in env files/repos; least-privilege DB credentials per module.
15. **Observability.** Structured logs with correlation IDs end-to-end (request → ledger → webhook), RED metrics per endpoint, money-specific alerting: failed-transaction spike, webhook lag, reconciliation breaks, balance-invariant violations, limit-service errors. On-call runbooks per alert.

---

## 9. Security, Compliance & Regulatory

- **Licensing `[LEGAL REVIEW — decision gate before build]`:** Determine operating model: (a) partner/BaaS model riding on a licensed bank/MMO (fastest), (b) own CBN license (PSSP/Super Agent/MMO depending on activities), or (c) hybrid. Holding customer funds in your own right without appropriate licensing is not viable; the wallet may need to be structured as funds held with the partner bank. **This decision materially shapes the ledger/settlement design — resolve in week 1.**
- **NDPA compliance:** lawful basis mapping, DPO designation, privacy notice update, data-subject request workflow, breach-notification runbook.
- **PCI-DSS:** out of scope at launch (no card data) — keep it that way by using provider-hosted card pages if cards are added later.
- **AppSec baseline:** OWASP ASVS L2 target; mandatory pen test before GA; dependency scanning in CI; SAST/DAST; threat model per module (STRIDE) with money-movement paths prioritized.
- **Authentication hardening:** step-up auth (PIN/biometric/OTP) for withdrawals, beneficiary changes, credential changes; device binding; new-device alerts.
- **Insider risk:** RBAC + maker-checker + audit (Sections 4.8, 8.3); production data access via gated, logged tooling only — no direct DB access for support.

---

## 10. Brownfield Integration & Migration Plan

### 10.1 Step zero: codebase audit (1–2 weeks, blocks detailed design)
Deliverables: current ERD, route inventory, auth/session model, background-job inventory, test-coverage report, deployment pipeline map, data-quality profile of users table. Every `[ASSUMPTION]` in this PRD gets confirmed or corrected here.

### 10.2 Integration impact analysis (initial, to be validated)
| Touchpoint | Change | Risk | Mitigation |
|---|---|---|---|
| Users table / auth | None to columns; new FK'd tables | Low | Additive-only migrations; FK with no cascade-delete |
| Voting flow | New wallet-funded purchase path **alongside** existing flow | **High** | Adapter pattern (10.3); old path remains default until flag flip |
| Contest admin | New pricing/prize-pool config screens | Med | Separate admin module; RBAC-gated |
| Existing admin auth | Mapped into RBAC | Med | Explicit migration review; parallel-run old checks during transition |
| Notifications | New engine | Low–Med | Existing notification paths untouched; new engine only for fintech events initially |
| Database | New schemas/tables, new indexes | Med | Migrations rehearsed on prod-sized snapshot; off-peak windows; rollback scripts per migration |

### 10.3 The voting bridge (most critical integration)
- Introduce a `VotePurchaseService` adapter. Old path: existing vote recording (however currently paid/free) — unchanged. New path: wallet debit (ledger txn) → on success, call the **existing** vote-recording function/API unchanged → on vote-recording failure, compensating wallet reversal.
- The existing voting module's code is **not modified**; it is wrapped. Contract tests pin its current behavior before any wrapping begins.
- Rollout: internal users → 1% of voters → ramp; old path remains available behind the flag for instant fallback.

### 10.4 User migration & backfill
1. **Dry run** on masked prod snapshot; publish expected counts.
2. Backfill: wallet (Tier 0, zero balance) + ledger account + referral code for every existing user — idempotent batch job, resumable, throttled.
3. Data-quality campaign: prompt users with missing/duplicate phone/email to verify on next login (soft prompt; never block existing contest features).
4. No KYC required to keep doing everything users do today — fintech features are opt-in upsell.
5. **Rollback:** backfilled rows are tagged with migration batch ID; rollback = feature-flag off + (if needed) batch-tagged purge. Old functionality has zero dependency on new tables, so flag-off is always safe.

### 10.5 Regression safety net
- Golden-path E2E suite for existing flows (registration, contest entry, voting, results) written and green **before** the first fintech commit merges.
- Contract tests freezing existing internal interfaces the bridge will call.
- Synthetic monitoring on legacy critical paths in production through the rollout.
- Load test: confirm new tables/indexes don't degrade existing query plans (especially anything joining users).

### 10.6 Rollout plan
Per-module flags; sequence: Profile+ → RBAC (staff-only) → KYC (sandbox provider) → Wallet (no funding) → Ledger invariants soak → VA funding (allowlist) → Vote-purchase bridge (1% → 100%) → Withdrawals → Referrals. Each stage: exit criteria + kill switch + on-call rota.

---

## 11. Risks, Assumptions, Dependencies, Open Questions

**Top risks**
1. **Regulatory model unresolved** → blocks wallet/VA design. *Mitigation: legal engagement week 1; default to BaaS-partner model for speed.*
2. **Voting-bridge regression** breaks core revenue/engagement. *Mitigation: 10.3 adapter + flags + contract tests.*
3. **Referral fraud at launch** (contest audiences are organized and incentivized). *Mitigation: anti-fraud ACs are launch-blocking, not fast-follow.*
4. **Reconciliation treated as fast-follow** → silent money drift. *Mitigation: declared launch blocker.*
5. **Legacy data quality** (duplicate/shared contacts) corrupts identity uniqueness. *Mitigation: audit + dedupe campaign before KYC GA.*

**Key open questions (answer before build)**
1. Confirmed regulatory/licensing path and banking partner?
2. Current stack, DB engine, and deployment model? (Determines migration tooling and the modular-monolith details.)
3. Is voting currently paid (and how), or free? (Shapes the bridge and pricing model.)
4. Existing user count and data-quality state?
5. Who are the named Compliance and Finance Ops owners? (RBAC needs real humans.)

---

## 12. Out of Scope (explicit)
Lending, card issuing, FX/remittance, crypto, savings/investments, agency banking/POS, payroll, USSD channel (Phase 3 candidate), white-labeling.

---

## 13. Phased Delivery Roadmap

**Phase 0 — Foundations (Weeks 1–6):** codebase audit; legal/licensing decision; regression suite green; ledger + idempotency + audit + flags + outbox; RBAC for staff; observability baseline.
**Phase 1 — MVP money-in (Weeks 7–14):** Profile+, KYC T0–T1, Tier engine, Wallet (read + credit), VA funding on allowlist, notification engine, reconciliation v1, webhook ingestor service.
**Phase 2 — Monetization bridge (Weeks 15–20):** wallet-funded vote purchases (ramped), prize-pool ledger accounts, statements, support tooling, fraud rules v1.
**Phase 3 — Money-out + growth (Weeks 21–28):** KYC T2, withdrawals with maker-checker, contestant payouts, referral & rewards GA with anti-fraud, dispute workflow, second VA provider.
**Phase 4 — Super-app expansion (post-GA):** bill payments, airtime, P2P transfers between users, USSD, savings partnerships — each as a flagged module on the same foundations.

---

## 14. Appendix: Definition of Done (every fintech module)
Idempotency on all mutations · ledger postings balanced & tested · tier-limit checks fail-closed · audit events emitted · feature-flagged with kill switch · runbook written · alerts configured · contract tests vs existing system green · security review passed · reconciliation coverage confirmed.
