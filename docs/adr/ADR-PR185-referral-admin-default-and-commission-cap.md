# ADR-PR185 — Refer & Earn: Admin default referrer, signup points, and a 100-event commission cap per code

**Date:** 2026-09-18
**Status:** Accepted
**Deciders:** Product (spec Q&A sign-off), Platform/Finance (integration decision)
**Scope:** `backend/internal/finance/referrals/{admin_default_and_cap.go,rewards_service.go,rewards_model.go,rewards_handler.go}`,
`supabase/migrations/20270206000000_referral_admin_default_and_commission_cap.sql`,
`backend/tests/referrals/admin_default_and_cap_live_db_test.go`.

## Context

A new modification spec for Module 8 (Refer & Earn) was signed off via Q&A
(restated in the UAT test plan this ADR accompanies): every user always has a
referrer (Admin by default), a code is permanent and one-per-user, purchases by
a referred user earn the referrer 20% of profit, capped at 100 commission
events per code (across every referred user under it, not per individual),
after which the 20% defaults to Admin permanently for that code, and refunds
reverse paid commission without freeing the consumed slot.

This repo already has **three** independently-live referral/reward systems
(documented in the prior Module 8 sign-off, `SPOTLIGHT_UAT_BUG_TRACKER.md`),
one of which (`REF-002`) was a real, previously-shipped defect where two
referral engines' code resolvers disagreed and silently routed genuine
referrals to the house account. Discovery for this spec found NONE of the
three implement the new rules — this was net-new work, not a bug fix.

## Decision

**1. Extend the existing "Direct Referral Rewards" engine (tiered 5/8/12/15%
share of margin) rather than build a fourth parallel system, AND keep its
existing tiered rate rather than the spec's literal "20%".** Two decisions,
confirmed explicitly with the user before writing any code:

- *Which engine*: the Direct Referral Rewards engine already has the exact
  infrastructure this spec needs — a purchase-settled hook every module already
  calls, a UNIQUE `source_transaction_id` idempotency anchor, a refund-reversal
  path, and a durable per-referrer code table (`referral_links`, already
  one-per-user-forever with no regenerate path — satisfying that part of the
  spec with zero changes). Building a fourth system risked exactly the
  REF-002 failure mode again: two engines each independently deciding whether
  a purchase earns a referrer money.
- *Which rate*: introducing a flat 20% would have been a live monetization
  policy change for every existing referrer (20% exceeds all four existing
  tiers, so it's a strict increase, uncapped-to-capped) applied silently across
  every purchase in every module. Asked directly; the product decision was to
  keep the existing tiered rate and treat the modification as ONLY the
  attribution-default and the 100-event cap, not the rate itself.

**2. Admin resolution reuses `SUPER_ADMIN_USER_ID`, the same env var the
pre-existing `referral/house` package already resolves the platform owner
from** (§7A Attribution & Default-Referrer Policy) — not a new mechanism.
Deliberately **not** the same code path, though: `referral/house`'s account is
explicitly `non_withdrawable`, `excluded_from_override`, `excluded_from_kfactor`
— a notional accrual, not real money. This spec wants Admin to receive a REAL,
spendable wallet credit exactly like any other referrer once a code caps. So
Admin is treated as an ordinary referrer user id for this engine's purposes,
credited via the same `ledger.Credit` call as any human referrer — no new
"non-withdrawable" ledger concept was introduced. Fails closed
(`ErrAdminUserNotConfigured`) if the env var is unset, rather than guessing.

**3. `attribution_type`'s CHECK constraint is widened to add `'admin_default'`**
rather than reusing `'global_house'` — the existing house/global_house rows
carry `is_house=true` and feed the *other*, non-withdrawable house-ledger
reporting surface; reusing that type for a real, withdrawable Admin credit
would have silently corrupted that reporting's own invariants.

**4. An empty code, an unknown code, and a self-referral attempt ALL fall back
to Admin without failing the signup request** (`AttributeOrDefault`). The spec
didn't explicitly answer the self-referral/invalid-code UX question (open in
the drafted test plan's A3/A4), so this ADR makes it explicit: signup must
never hard-fail over a referral code problem — "every user has a referrer" is
an invariant the attribution call always satisfies, and the caller is told
`invalid_code`/`used_admin_default` so the client can show a notice without
blocking the account creation.

**5. The 100-event cap is enforced by ONE atomic SQL statement**
(`tryConsumeCommissionSlot`): `INSERT ... ON CONFLICT (referrer_id) DO UPDATE
SET commission_events_used = commission_events_used + 1 WHERE
commission_events_used < 100 RETURNING commission_events_used`. Postgres
row-locks the conflicting row for the statement's duration, so two concurrent
purchases under the same code — the highest-risk case in the spec's own test
plan (§C4) — cannot both observe "under 100" when only one slot remains: the
second transaction's `WHERE` guard evaluates against the FIRST transaction's
already-committed count, not a stale read. Verified with a real two-goroutine
concurrent test (`TestLiveDB_CommissionCap_ConcurrentEventsNearCapOnlyOnePaysReferrer`),
not just reasoned about.

**6. A refund does not free the consumed slot, and a capped code never
un-caps.** The spec doesn't explicitly answer this (flagged as an open
question in the drafted test plan's §C6); the decision here is that
`commission_events_used`/`capped_at` represent "slots the code has consumed,"
not "slots currently paying out" — so reversing the money on a refund
(handled correctly, reusing the existing reversal path, now keyed off
`payee_id` instead of always `referrer_id`) does not also reverse the counter.
Rationale: allowing a refund to un-cap a code would make the cap's permanence
("permanently, for that code" — spec point 6) conditional on refund timing,
which is a much harder guarantee to reason about and audit than a one-way
counter.

**7. Rate computation, tier tables, and milestones are untouched** — this
modification is additive to `OnPurchaseSettled`/`OnPurchaseRefunded`, not a
rewrite. `referral_rewards` gained two nullable/defaulted columns
(`payee_id`, `capped`) rather than a parallel table, so every existing
report/dashboard reading that table keeps working, and the new columns are
simply zero-value (`payee_id NULL`, `capped false`) on every pre-existing row.

## Consequences

- Existing referrers keep earning at their current tier rate; the only change
  to their earnings is a lifetime ceiling of 100 events per code, and that a
  previously-unattributed (no-code) referred user's purchases now generate
  commission at all (previously: silently no-op, no reward to anyone).
- `SUPER_ADMIN_USER_ID` must be configured in every environment that expects
  this feature to actually award Admin's fallback share — an unconfigured
  environment doesn't fail purchases, it just can't apply the cap or the
  default-referrer behavior (documented fail-open choice, §2).
- **Explicitly out of scope for this pass** (follow-up work, not silently
  dropped): (a) wiring `AwardKYCPoints` into the actual KYC-completion event —
  which module/hook owns that event wasn't obvious enough to guess correctly
  without risking wiring it to the wrong trigger; (b) confirming every client
  (frontend-web, both mobile apps) calls `POST /v1/referrals/attribute`
  unconditionally at signup, even with an empty code — the backend now
  supports "no code" as a first-class default-to-Admin case, but if a client
  only calls this endpoint when a code IS entered, "every user has a referrer"
  is not actually true end-to-end; (c) admin-portal UI surfacing the per-code
  cap status/history (`GetCommissionCapStatus` exists as a backend read, no
  admin screen consumes it yet); (d) CSV export and the remaining Phase 2 test
  plan sections D/E from the drafted UAT plan.
