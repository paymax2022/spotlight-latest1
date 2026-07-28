# Module Integration Checklist — Referral Reward Engine (required downstream consumer)

**Status:** Standing requirement · **Owner:** Platform · **Ref:** ADR-022,
Master PRD §2.5 / §7.1 / §8.

> This is not a one-time list. **Every new revenue-bearing module — and every
> existing one — MUST integrate with the Referral Reward Engine** by emitting the
> two common events below. The engine is a central, reusable, provider-agnostic
> consumer; no module implements referral logic itself. A module that silently
> stops emitting costs referrers their rewards, so the wiring is mandatory and
> monitored (admin screen A7 — Module Integration Status).

## When this applies

Any module that **generates platform margin from a settled user purchase**:
Wallet/Bill Payments, Marketplace, Micro-Insurance, Transport/Logistics, EdTech
(Academy), Connect, Hotel Booking (Stays), Fractional Real Estate, Global Stocks
(Invest), Restaurant delivery, and **any future revenue-bearing module**.

If your module can take money from a user for a service and book margin, it is in
scope. When in doubt, integrate — an emitted event with zero attribution is a
cheap no-op; a missing event is silent referrer loss.

## The contract (emit these two events)

The module emits into the Referral Reward Engine. It does **not** compute rewards,
look up attribution, or touch referral tables — that is the engine's job.

```
Event: PurchaseSettled            // on final settlement of a margin-bearing purchase
  module            string        // stable module key, e.g. "bills", "marketplace", "stays"
  transaction_id    uuid          // your module's settled transaction id (the reward's idempotency anchor)
  payer_user_id     uuid          // the user who paid
  margin_amount     numeric       // PLATFORM MARGIN in kobo (not gross), integer minor units
  currency          string
  settled_at        timestamp

Event: PurchaseRefunded           // on refund / chargeback of a previously-settled purchase
  transaction_id    uuid          // MUST match a previously emitted PurchaseSettled
  refunded_at       timestamp
```

## Checklist (add to every new-module PR)

- [ ] **Emit `PurchaseSettled`** at the point of final settlement, with
      `margin_amount` in **integer kobo** (platform margin, not gross revenue),
      and a **stable `module` key** (never rename it once live — A7 keys on it).
- [ ] **Emit `PurchaseRefunded`** on any refund/chargeback, with the **same
      `transaction_id`** as the original settle. The engine reverses the linked
      reward automatically, in the same transaction as the refund — never a
      manual clawback.
- [ ] **Idempotent emission.** `transaction_id` is the reward idempotency anchor
      (`referral_rewards.source_transaction_id` is unique) — re-emitting the same
      `transaction_id` must never double-reward. Safe to retry.
- [ ] **Emit exactly once per settled purchase**, and only for margin > 0.
- [ ] **Do not implement referral logic in the module.** No attribution lookups,
      no rate math, no referral tables. One event out; the engine does the rest.
- [ ] **Verify the module appears on A7 (Module Integration Status)** with a
      recent `last_event_at` after go-live. A module that goes quiet
      (> 24h without an event under normal traffic) raises the A7 quiet-alert —
      treat that as a P2 integration incident.
- [ ] **Feature-flag the emitter** like every new module (no flag, no merge).

## Where the engine lives

- **Contract:** `contracts/openapi.yaml` — user mount `/v1/referrals/*`
  (tag `[Referral]`), admin mount `/v1/admin/referrals/*` (tag `[Referral Admin]`).
- **Internal event ingress (service-to-service):**
  `POST /internal/referrals/purchase-settled`,
  `POST /internal/referrals/purchase-refunded` (per PRD §7.2).
- **Admin console:** `frontend-admin/app/admin/referral-rewards/**` — A7 is the
  operational view for integration health.
- **Design rationale:** `docs/adr/ADR-022-direct-referral-rewards.md`.

---

**Reminder for the `/new-module` scaffold:** the Referral Reward Engine is a
**required downstream consumer** of every revenue module. Emitting
`PurchaseSettled` / `PurchaseRefunded` is part of "done" for a revenue module,
alongside the ledger, audit, and tier-limit obligations in the money-handling
iron rules.
