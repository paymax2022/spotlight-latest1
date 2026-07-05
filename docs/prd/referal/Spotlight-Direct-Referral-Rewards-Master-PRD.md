# SPOTLIGHT/PAYMAX DIRECT REFERRAL REWARDS — MASTER PRD
## Single-level, purchase-triggered revenue share with volume accelerator (B) + milestone bonuses (C)

**Status:** Build-ready. Supersedes the tiered-downline version entirely — no network depth anywhere in this design.

---

# 1. VISION

Reward the people who bring real, paying users onto Spotlight/Paymax — proportional to their own direct effort, triggered only by actual purchases, with no network-depth mechanics anywhere in the design. Two reinforcing mechanisms: a **volume accelerator** (the referrer's ongoing revenue-share rate increases as their own active referral count grows) and **milestone bonuses** (one-time cash rewards at count thresholds, giving early motivation before the recurring share has compounded into something meaningful).

**Everything numeric in this program — tier thresholds, rates, milestone amounts — is config-driven, versioned, and admin-editable without a code deploy.** The numbers below are the locked v1 defaults; treat them as launch parameters to validate against real margin data, not as hardcoded constants.

---

# 2. REWARD MECHANICS (LOCKED)

## 2.1 Core rule
Reward is created **only** when a referred user completes a **settled** purchase on any revenue-bearing Paymax/Spotlight module. Never on referral, signup, or KYC completion.

## 2.2 Volume accelerator (ongoing share rate)

| Tier | Active direct referrals | Ongoing share of platform margin |
|---|---|---|
| Starter | 1–49 | 5% |
| Growth | 50–249 | 8% |
| Pro | 250–999 | 12% |
| Elite | 1,000+ | 15% |

**"Active"** = made at least one qualifying purchase in the trailing 30 days. Tier is recalculated on a rolling basis (see §5.2) — it can move up as a referrer's active count grows, and the *rate applied to future transactions* can move down if active count drops, but **rewards already credited are never clawed back for a tier recalculation** (only fraud/refund triggers a reversal — see §2.4).

## 2.3 Milestone bonuses (one-time, stacks on top of the ongoing share)

| Milestone (active direct referrals) | One-time bonus |
|---|---|
| 10 | ₦5,000 |
| 50 | ₦20,000 |
| 250 | ₦100,000 |
| 1,000 | ₦500,000 |

Paid once, the first time a referrer's active count crosses the threshold. Not reversed by later churn (a milestone, once genuinely earned, stays earned) — only reversed if the achievement itself is later found fraudulent (see §7).

## 2.4 Refund/reversal invariant
If a source purchase is refunded or charged back, the reward it generated reverses automatically in the same transaction as the refund — never a manual clawback process. This applies to ongoing-share rewards; milestone bonuses are not affected by a single transaction reversing (they're based on referral *count*, not any specific transaction).

## 2.5 Cross-module coverage
Every revenue-bearing module (Wallet/Bills, Marketplace, Insurance, Transport, EdTech, Connect, and any future module) emits a single common `PurchaseSettled` event into the Referral Reward Engine. No module implements referral logic itself — this is a central, reusable service, matching the provider-agnostic pattern already established elsewhere in this stack.

---

# 3. DATA MODEL

```
referral_links
  id                uuid PK
  referrer_id       uuid FK -> users
  code              text unique
  created_at

referral_attributions
  id                    uuid PK
  referrer_id           uuid FK -> users
  referred_user_id      uuid FK -> users, unique   -- permanent, one attribution per referred user, for life
  attributed_at         timestamp

referral_rewards
  id                     uuid PK
  referrer_id            uuid FK -> users
  referred_user_id       uuid FK -> users
  source_transaction_id  uuid FK -> transactions, unique   -- idempotency: one reward per purchase, ever
  module                 text
  margin_amount          numeric
  applied_rate           numeric        -- the tier rate in effect at time of this transaction
  reward_amount          numeric        -- margin_amount * applied_rate
  status                 enum (PENDING, CREDITED, REVERSED)
  created_at / credited_at / reversed_at

referral_tier_status
  referrer_id            uuid PK FK -> users
  active_referral_count  int            -- recalculated on a rolling schedule, see §5.2
  current_tier           enum (STARTER, GROWTH, PRO, ELITE)
  current_rate           numeric
  last_recalculated_at   timestamp

referral_milestones
  id                     uuid PK
  referrer_id            uuid FK -> users
  threshold              int
  bonus_amount           numeric
  status                 enum (ACHIEVED, PAID, VOIDED)
  idempotency_key        text unique    -- one payout per (referrer_id, threshold), ever
  achieved_at / paid_at / voided_at

referral_program_config
  id              uuid PK
  version         int
  tier_table      jsonb    -- [{tier, min_count, max_count, rate}, ...]
  milestone_table jsonb    -- [{threshold, bonus_amount}, ...]
  is_active       boolean
  effective_from  timestamp
```

**Invariants:**
- `source_transaction_id` unique in `referral_rewards` — never double-rewarded, even on retry.
- A reward can only be created where a matching `referral_attributions` row exists for the payer.
- Config changes create a new versioned row and apply only to transactions from `effective_from` onward — never retroactively recompute past rewards.

---

# 4. STATE MACHINES

## 4.1 Per-reward
```
(purchase settles + attribution exists + margin > 0) → PENDING → CREDITED
                                                                       │
                                                (source txn refunded) → REVERSED
```

## 4.2 Per-milestone
```
(active_referral_count crosses threshold) → ACHIEVED → PAID
                                                            │
                                          (fraud confirmed) → VOIDED
```

## 4.3 Tier recalculation (not a reward-affecting state machine — a rate-lookup input)
```
Nightly job: recompute active_referral_count per referrer
   → determine current_tier from referral_program_config.tier_table
   → update referral_tier_status
   → new rate applies to transactions from this point forward only
```

---

# 5. MOBILE UI/UX — SCREEN INVENTORY & WORKFLOWS

## 5.1 Screens (referrer-facing, 9)

**1. Referral Hub (home)**
- *Purpose:* One-glance status — this is the emotional center of the whole program.
- *Key UI:* Current tier badge, active referral count with a progress bar to the next tier threshold, this-month earnings, lifetime earnings, next milestone preview ("47 of 50 — ₦20,000 bonus incoming").
- *Primary actions:* Tap "Invite" → Share screen; tap earnings → Earnings History; tap tier → Tier Explainer.
- *States:* Zero-referral state is an invitation, not a blank dashboard ("Invite your first person and start earning when they make their first purchase").

**2. Share / Invite**
- *Purpose:* Remove all friction from sharing.
- *Key UI:* Personal referral code + shareable link, QR code, one-tap share buttons (WhatsApp first — dominant share channel in Nigeria — then SMS, other social).
- *Primary actions:* Tap a share channel → native share sheet pre-filled with message + link.

**3. My Referrals**
- *Purpose:* See who's in the network and whether they're active.
- *Key UI:* List of referred users (first name + avatar, masked contact info for privacy), status chip (Active / Inactive — based on the 30-day rolling rule), join date, lifetime contribution to the referrer's earnings.
- *States:* Inactive referred users shown plainly, not hidden — transparency on why the count might be lower than expected.

**4. Earnings History**
- *Purpose:* Full transparency, transaction-level.
- *Key UI:* Chronological ledger: date, referred user (masked), module, reward amount, status (Credited/Reversed) — this is the `referral_rewards` table made visible, filterable by module and date range.
- *Exit:* Wallet hand-off [reuse existing Paymax wallet screen] for actually spending/withdrawing the credited balance.

**5. Tier & Rewards Explainer**
- *Purpose:* Make the mechanics fully transparent — the strongest trust signal this program can offer, especially after the model change.
- *Key UI:* Full tier table (Starter→Elite) with current tier highlighted, full milestone table with achieved ones checked off, plain-language explanation ("You earn when someone you referred makes a purchase — never just for referring them").

**6. Milestone Achieved (celebration moment)**
- *Purpose:* The single best retention/motivation moment in the whole flow.
- *Entry:* Triggered by push notification the instant a milestone is crossed.
- *Key UI:* Full-screen celebratory state, bonus amount, running total of lifetime milestone earnings, share-your-achievement prompt (optional, privacy-respecting — no forced social posting).

**7. Tier Upgraded (moment)**
- *Purpose:* Separate from the milestone moment — this is about the *rate* increasing.
- *Key UI:* "You're now Growth tier — 8% on every future referral purchase" — explicit about the fact that this applies going forward, not retroactively (avoids confusion/complaints).

**8. Notification Preferences [reuse: existing pattern]**
- *Key UI:* Toggles: new referral joined, referral's first purchase, milestone achieved, tier upgraded, monthly earnings summary.

**9. Wallet hand-off [reuse: existing Paymax wallet screen, unmodified]**
- *Purpose:* Referral earnings land directly in the existing wallet — no separate referral balance/currency to manage.

## 5.2 Screen (referred-user-facing, 1)

**10. Apply Referral Code** — a single field in the existing signup flow (not a new flow), captures the code, creates the `referral_attributions` row on successful registration. No reward, no visible change to the referred user's experience — attribution is invisible to them by design.

## 5.3 Cross-cutting workflows

**Workflow A — First reward**
```
Share code → Referred user signs up with code → Attribution recorded (silent)
   → Referred user's first settled purchase (any module)
   → Reward computed & credited → Push: "Chidinma made her first purchase — you earned ₦[X]"
```

**Workflow B — Milestone crossing**
```
Nightly recalculation → active_referral_count crosses threshold
   → Milestone bonus computed & credited → Push notification
   → Milestone Achieved celebration screen on next app open
```

**Workflow C — Tier upgrade**
```
Nightly recalculation → active_referral_count crosses tier boundary
   → referral_tier_status updated → Push notification
   → Tier Upgraded screen on next app open → future transactions use new rate
```

**Workflow D — Refund reversal (invisible to the referrer unless it affects a specific line item)**
```
Source purchase refunded → linked reward auto-reverses → Earnings History reflects REVERSED status
   → no push notification needed for small amounts; batch into monthly summary
```

---

# 6. ADMIN CONSOLE

## 6.1 Screens (7)

**A1. Referral Program Configuration**
- *Purpose:* Edit tier thresholds, rates, and milestone amounts without a deploy.
- *Key UI:* Editable tier table and milestone table, versioned (shows current live config + draft), effective-date scheduler.
- *Guarded write:* publishing a new version never retroactively touches already-computed rewards — only affects transactions from the effective date forward. This constraint is enforced in the UI (a warning banner: "Changes apply to future transactions only") as well as the backend.
- *RBAC:* Product/Finance admin role only.

**A2. Referral Analytics Dashboard**
- *Purpose:* Program health at a glance.
- *Key UI:* Total active referrers, total active referred users, total rewards paid (period-over-period), reward cost as % of total platform margin (the single most important number for financial sustainability tracking), breakdown by module, breakdown by tier.
- *RBAC:* Finance, Product, Executive roles.

**A3. Fraud & Anti-Abuse Review Queue**
- *Purpose:* Human-in-the-loop review of flagged patterns.
- *Key UI:* Queue of flagged referrer/referred pairs (self-referral suspicion via device/KYC dedup, circular-funding pattern flags), evidence shown (shared device ID, fund-transfer timing relative to purchase), actions: clear / void reward / suspend referrer from program.
- *RBAC:* Trust & Safety / Fraud role.

**A4. Referral Ledger & Reconciliation**
- *Purpose:* Full audit trail, exportable for finance reconciliation.
- *Key UI:* Every `referral_rewards` row, filterable by status/module/date/referrer, export to CSV.
- *RBAC:* Finance role.

**A5. Referrer Case View (support tool)**
- *Purpose:* Resolve individual support tickets ("why didn't I get credited for my referral?").
- *Key UI:* Single referrer's full picture — attribution list, reward history, tier history, milestone history. Manual reward adjustment action available but requires a logged reason (audit trail), never a silent edit.
- *RBAC:* Support (view-only) / Support Lead (adjustment rights).

**A6. Milestone Payout Log**
- *Purpose:* Dedicated view for the one-time bonus payouts specifically, since these are larger, less frequent, and worth tracking separately from the high-volume ongoing-share ledger.
- *Key UI:* Chronological list of milestone payouts, status, linked referrer.
- *RBAC:* Finance role.

**A7. Module Integration Status**
- *Purpose:* Operational visibility into which modules are correctly emitting `PurchaseSettled` events — catches a silently-broken integration before it silently costs referrers their rewards.
- *Key UI:* Per-module last-event-received timestamp, event volume trend, alert if a module goes quiet unexpectedly.
- *RBAC:* Engineering/Platform role.

## 6.2 Admin workflows

**Runbook 1 — Adjust tier rates for cost control**
```
A2 (analytics show reward cost trending above target %) → A1 (draft new tier_table version)
   → set effective_from date → publish → A7/A2 monitored post-change for cost trend correction
```

**Runbook 2 — Resolve a fraud flag**
```
A3 (flagged pair appears) → review evidence → decision:
   clear (false positive, no action) | void specific reward (fraud confirmed on one transaction)
   | suspend referrer from program (pattern of abuse) — each action logged with reviewer ID and reason
```

**Runbook 3 — Support ticket resolution**
```
A5 (search referrer) → inspect full history → identify gap (e.g. referred user's purchase pending, not yet settled)
   → either explain to support agent (no action needed, will resolve automatically) or manually adjust with logged reason
```

---

# 7. ENDPOINT INTEGRATION SCOPE

## 7.1 Internal event contract (every revenue-bearing module implements this)

```
Event: PurchaseSettled
  module            string   (e.g. "bills", "marketplace", "insurance")
  transaction_id    uuid
  payer_user_id     uuid
  margin_amount     numeric
  currency          string
  settled_at        timestamp

Event: PurchaseRefunded
  transaction_id    uuid     -- must match a previously emitted PurchaseSettled
  refunded_at       timestamp
```

**Modules required to integrate:** Wallet/Bill Payments, Marketplace, Micro-Insurance, Transport/Logistics, EdTech, Connect, Hotel Booking, Fractional Real Estate, Global Stocks, and any future revenue-bearing module. This is a standing integration requirement for all new modules going forward, not a one-time list — the Referral Reward Engine should be documented as a required downstream consumer in the module-creation checklist.

## 7.2 Referral service API surface (Go/Chi)

| Method | Path | Purpose | Auth |
|---|---|---|---|
| `POST` | `/v1/referrals/link` | Generate/fetch the caller's referral code | User |
| `POST` | `/v1/referrals/attribute` | Apply a referral code (called once, at signup) | User, idempotent per user |
| `GET` | `/v1/referrals/me/dashboard` | Tier, active count, earnings summary | User (own data only) |
| `GET` | `/v1/referrals/me/referrals` | List of referred users + status | User (own data only) |
| `GET` | `/v1/referrals/me/earnings` | Paginated reward transaction history | User (own data only) |
| `GET` | `/v1/referrals/me/milestones` | Achieved + upcoming milestones | User (own data only) |
| `POST` | `/internal/referrals/purchase-settled` | Consumes `PurchaseSettled` events | Service-to-service only |
| `POST` | `/internal/referrals/purchase-refunded` | Consumes `PurchaseRefunded` events | Service-to-service only |
| `GET/PUT` | `/v1/admin/referral-config` | Manage tier/milestone config (A1) | Product/Finance admin |
| `GET` | `/v1/admin/referrals/analytics` | Program-level metrics (A2) | Finance/Product/Exec |
| `GET/POST` | `/v1/admin/referrals/fraud-queue` | Review and action flags (A3) | Fraud/Trust & Safety |
| `GET` | `/v1/admin/referrals/ledger` | Full exportable ledger (A4) | Finance |
| `GET/POST` | `/v1/admin/referrals/{referrerId}/case` | Support case view + manual adjustment (A5) | Support / Support Lead |
| `GET` | `/v1/admin/referrals/milestones-log` | Milestone payout log (A6) | Finance |
| `GET` | `/v1/admin/referrals/module-status` | Integration health per module (A7) | Engineering/Platform |

All state-changing endpoints require idempotency keys; every user-facing GET is scoped to the caller's own data via object-level authorization, never trusting a referrer ID passed from the client alone.

---

# 8. ROLLOUT PLAN

**Phase 1:** Ship the reward engine + event contract against 2–3 highest-volume modules first (Bills, Marketplace) to validate the mechanics and real cost-as-%-of-margin before wiring every module in.
**Phase 2:** Wire remaining modules; ship the full mobile screen set (§5); ship A1–A4 admin screens.
**Phase 3:** Ship fraud queue (A3) and module integration monitoring (A7) once there's real usage volume to validate anti-abuse rules against.
**Phase 4:** Calibrate tier/milestone numbers against 60–90 days of real cost data via A1, without a redeploy.

**North-star metric:** reward cost as a percentage of the total margin generated by referred users — not total rewards paid in isolation. This is the number to watch on A2 to know whether the program is sustainable at scale.
