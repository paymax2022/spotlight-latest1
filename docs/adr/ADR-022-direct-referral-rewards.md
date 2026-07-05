# ADR-022 — Direct Referral Rewards (single-level, purchase-triggered)

**Date:** 2026-07-05  
**Status:** Accepted  
**Deciders:** Platform team · Finance · Product  
**Supersedes:** the tiered "house"/downline referral model (`/admin/referral/*`,
`referralAdminService`, ADR-none — that model was never given an ADR and is now
frozen). PRD: `docs/prd/referal/Spotlight-Direct-Referral-Rewards-Master-PRD.md`.

## Context

The existing referral console (`frontend-admin/app/admin/referral/**`) implements
a **network-depth** model: house/regional/global default-referrer capture,
attribution reassignment, agent overrides on downline revenue, campaign-funded
rewards, k-factor including house. It rewards *recruitment and network activity*,
which carries pyramid-scheme optics and a reward cost that is hard to bound
against real margin.

The new PRD replaces that entirely with a **single-level, purchase-triggered
revenue share**: you earn only when someone *you* directly referred completes a
**settled** purchase on any revenue-bearing module — never on referral, signup,
or KYC. There is **no network depth anywhere** in the design. Two reinforcing
mechanisms:

1. **Volume accelerator** — the referrer's ongoing share of platform *margin*
   rises with their own active direct-referral count (Starter 5% → Growth 8% →
   Pro 12% → Elite 15%).
2. **Milestone bonuses** — one-time cash rewards at count thresholds
   (10/50/250/1,000 → ₦5k/₦20k/₦100k/₦500k) for early motivation.

Everything numeric — tier thresholds, rates, milestone amounts — is
config-driven, versioned, and admin-editable **without a code deploy**.

## Decision

1. **Purchase-triggered, single-level design supersedes the house model.**
   The old console is not deleted (brownfield safety — its pages, service, nav
   entries, and DB tables stay untouched and frozen behind their existing
   feature flags). The new engine lives beside it under a distinct surface:
   admin pages at `frontend-admin/app/admin/referral-rewards/**`, service
   `frontend-admin/src/services/referralRewardsAdminService.ts`, types
   `frontend-admin/src/types/referralRewardsAdmin.ts`, sidebar section
   **"Referral Rewards"** with RBAC `referral.admin.*`. Mounts:
   user `/v1/referrals`, admin `/v1/admin/referrals` (contract in
   `contracts/openapi.yaml`, tags `[Referral]` / `[Referral Admin]`).

2. **A single common `PurchaseSettled` event feeds a central engine — no module
   implements referral logic itself.** Every revenue-bearing module emits one
   provider-agnostic event (`module, transaction_id, payer_user_id,
   margin_amount, currency, settled_at`) and its refund counterpart
   (`PurchaseRefunded { transaction_id, refunded_at }`). This matches the
   provider-adapter pattern already established in the stack: the reward logic is
   a central, reusable consumer, not N per-module implementations. The engine is
   the sole owner of reward creation.

   ```
   PurchaseSettled
     module            string   (e.g. "bills", "marketplace", "insurance")
     transaction_id    uuid
     payer_user_id     uuid
     margin_amount     numeric  (kobo)
     currency          string
     settled_at        timestamp
   PurchaseRefunded
     transaction_id    uuid     -- must match a previously emitted PurchaseSettled
     refunded_at       timestamp
   ```

3. **Versioned, forward-only config.** `referral_program_config` is a versioned
   row (`tier_table`, `milestone_table` as JSONB, `is_active`, `effective_from`).
   Publishing a new version (admin screen A1) **never** retroactively recomputes
   past rewards — it applies only to transactions from `effective_from` onward.
   This is enforced in two places: the backend (rewards store `applied_rate`, the
   tier rate in effect *at the time of the transaction*) and the UI (A1 renders a
   persistent "Changes apply to future transactions only" warning banner). See §3
   invariants of the PRD.

4. **Reward state machine — per reward.**
   ```
   (purchase settles + attribution exists + margin > 0) → PENDING → CREDITED
                                                                        │
                                            (source txn refunded) → REVERSED
   ```
   `referral_rewards.source_transaction_id` is **unique** — one reward per
   purchase, ever, even on retry. A reward may only be created where a matching
   `referral_attributions` row exists for the payer. A refund/chargeback reverses
   the reward **in the same transaction as the refund** — never a manual clawback
   (§2.4). Milestone bonuses are not affected by a single transaction reversing.

5. **Milestone state machine — per milestone.**
   ```
   (active_referral_count crosses threshold) → ACHIEVED → PAID
                                                             │
                                           (fraud confirmed) → VOIDED
   ```
   `referral_milestones.idempotency_key` is unique per `(referrer_id, threshold)`
   — one payout per threshold, ever. A milestone, once genuinely earned, stays
   earned through later churn; it is only reversed (VOIDED) if the achievement
   itself is found fraudulent (§7 / admin screen A3).

6. **Tier recalculation is a rate-lookup input, not a reward-affecting state
   machine.** A nightly job recomputes `active_referral_count` per referrer
   ("active" = ≥1 qualifying purchase in the trailing 30 days), looks up
   `current_tier`/`current_rate` from the live config `tier_table`, and writes
   `referral_tier_status`. The new rate applies to **future** transactions only;
   rewards already credited are never clawed back for a tier recalculation.

7. **Money-path reuses the existing ledger + wallet — no new money primitives.**
   Reward credits, milestone payouts, refund reversals, and manual case
   adjustments (A5) are all balanced double-entry ledger postings that land in
   the **existing Paymax wallet** (no separate referral balance or currency).
   Every money mutation follows the iron rules: integer kobo, `Idempotency-Key`,
   balanced double-entry, an audit event, and a fail-closed tier-limit check.
   Reversals are reversing entries only (ledger entries are immutable).

8. **Admin console = 7 screens (A1–A7), each gated by its own permission.**
   A1 Config (`referral.admin.config`, Product/Finance), A2 Analytics
   (`referral.admin.analytics`, Finance/Product/Exec), A3 Fraud queue
   (`referral.admin.fraud`, Trust & Safety), A4 Ledger (`referral.admin.ledger`,
   Finance), A5 Referrer case (`referral.admin.case`, Support/Support Lead),
   A6 Milestone log (`referral.admin.milestones`, Finance), A7 Module status
   (`referral.admin.module`, Engineering). The A2 **north-star** is *reward cost
   as a % of the margin generated by referred users* — the sustainability number,
   not total rewards paid in isolation.

## Rollout (per PRD §8)

- **Phase 1** — ship the reward engine + `PurchaseSettled`/`PurchaseRefunded`
  event contract against the 2–3 highest-volume modules (Bills, Marketplace) to
  validate mechanics and real cost-as-%-of-margin before wiring everything in.
- **Phase 2** — wire remaining modules; ship the full mobile screen set (§5);
  ship admin screens A1–A4.
- **Phase 3** — ship the fraud queue (A3) and module-integration monitoring (A7)
  once there is real volume to validate anti-abuse rules against.
- **Phase 4** — calibrate tier/milestone numbers against 60–90 days of real cost
  data via A1, with no redeploy.

## Consequences

### Positive
- No network depth → no pyramid optics; reward is proportional to the referrer's
  own direct, paying effort.
- Reward cost is bounded and observable against real margin (A2 north-star).
- Config is versioned and forward-only, so rate changes are safe by construction
  — past rewards are immutable.
- Central engine + common event contract means new modules integrate by emitting
  one event, not by re-implementing referral logic.
- Fully additive: the legacy house model, its data, and its console are frozen,
  not modified — no regression risk.

### Negative / trade-offs
- Two referral consoles co-exist during migration (legacy `/admin/referral/*`
  frozen, new `/admin/referral-rewards/*` live). Nav shows both sections; the
  legacy one should be retired once cutover completes.
- Every revenue module now carries a standing obligation to emit
  `PurchaseSettled`/`PurchaseRefunded` — a silently-broken emitter costs referrers
  rewards. A7 (module-status quiet-alert) exists specifically to catch this.

### Deferred (frontend-admin scope of this change)
- **Backend Go implementation** of `/v1/referrals/*` and `/v1/admin/referrals/*`,
  the `PurchaseSettled` consumer, the nightly tier/milestone recompute job, and
  the DB migrations (`referral_links`, `referral_attributions`,
  `referral_rewards`, `referral_tier_status`, `referral_milestones`,
  `referral_program_config`). The admin console runs mock-first
  (`NEXT_PUBLIC_REFERRAL_REWARDS_USE_MOCK=true`) until those land.
- **Mobile referrer screens (§5, 9 screens)** and the signup "Apply referral
  code" field (§5.2).
- **Anti-abuse detection rules** that populate the A3 queue (device/KYC dedup,
  circular-funding); A3 renders and actions flags but the detector is backend
  work.
- **RBAC role → permission wiring** for `referral.admin.*` in the RBAC service.
