# CLAUDE.md — Paymax Super-App: Top-5 Expansion Modules

> Repo guidance for Claude Code. Read this in full before generating or editing code in any of the
> five expansion modules. It encodes the architecture, the **no-new-licence safety invariants**, and the
> engineering standards every change must meet. When in doubt, prefer correctness, security, and
> auditability over cleverness or speed.

---

## 1. What we are building

Five expansion modules on top of the **existing Paymax super-app**, chosen because they ride existing
rails and require **no new financial licence** beyond Paymax's current payment/wallet authorisation:

| # | Module | Code name | Path (proposed) |
|---|--------|-----------|-----------------|
| 1 | Event Ticketing & Cashless Event Wallet | `events`   | `/modules/events` |
| 2 | Social Payments & P2P Escrow            | `social`   | `/modules/social` |
| 3 | Group & Goal Savings (Ajo/Esusu)        | `savings`  | `/modules/savings` |
| 4 | Creator & Talent Monetisation           | `creators` | `/modules/creators` |
| 5 | Unified Loyalty & Paymax Black          | `loyalty`  | `/modules/loyalty` |

Full product detail lives in **`Paymax_Top5_Product_Pack.docx`** (the PRD pack). This file governs *how*
they are built; the PRD governs *what*. The phased task plan lives in **`BUILD-PLAN.md`**.

---

## 2. Stack & existing platform (REUSE — never re-implement)

- **Backend:** Go. **Mobile:** React Native. **DB:** PostgreSQL (PostGIS already present for geo).
- **Identity model:** ONE user identity that **accumulates capabilities** (consumer, organiser, vendor,
  creator, agent…). Effective permissions are *computed* from active, approved capabilities. At most one
  capability per `(domain, type)` — enforce with a unique constraint. Do **not** create parallel accounts.
- These platform services already exist. **Call them; do not rebuild them:**
  - SSO / single identity / KYC (tiered verification)
  - Wallet + wallet **sub-balances** (the savings/event-wallet primitive)
  - Virtual accounts
  - Bill-pay & airtime
  - Payouts / disbursement
  - Direct-debit & auto-debit (built for BNPL — reuse for auto-save & subscriptions)
  - Agent cash-in/out network
  - Push / SMS notifications
  - Referral engine (`§7A` default-referrer / house-capture)

If a task seems to need one of the above, **find and wire the existing service** before writing anything new.

---

## 3. Shared net-new components (build ONCE, reuse across modules)

Only ~7 new shared primitives unlock all five modules. Build each once, in its own package, with a clean
interface; every module consumes them.

| Component | Package | Consumed by |
|-----------|---------|-------------|
| Unified admin shell + RBAC + audit log | `/internal/admin` | all |
| Recurring-billing / scheduler          | `/internal/scheduler` | savings (auto-save), creators (subs) |
| Escrow / funds-hold state machine      | `/internal/escrow` | events, social, creators |
| Cashtag / @username directory          | `/internal/cashtag` | social, events, creators, loyalty |
| QR / NFC issue + validate              | `/internal/credential` | events, loyalty (perks) |
| Spray engine + animation contract      | `/internal/spray` | social, creators |
| Points / earn-rules ledger             | `/internal/points` | loyalty (earns from all) |

**Rule:** a module must not fork a shared component. If a module needs different behaviour, extend the
shared component via config, not a copy.

---

## 4. NO-NEW-LICENCE SAFETY INVARIANTS (non-negotiable)

These keep the five modules outside lending / deposit-taking / securities / e-money licensing. **Any code
that violates one of these is a release blocker.** Treat them like the Paymax Connect safety invariants.

- **NL-1 — No own-capital lending.** Paymax never advances its own funds in these modules. No credit, no
  overdraft, no negative wallet balance.
- **NL-2 — No yield.** Vaults, Ajo pools, group savings, escrow holds and event-wallet float earn **zero**
  interest for the user. Paying yield = deposit-taking. Forbidden here.
- **NL-3 — Closed-loop value only.** Event wallets and points are spendable **inside the ecosystem**;
  residual event-wallet balance refunds to the user's own main wallet. No open-loop card issuance.
- **NL-4 — Points are not cash.** Points redeem only to airtime, bill credits, discounts, and perks —
  **never** to a cash withdrawal. (Keeps them promotional, not e-money.)
- **NL-5 — Perks, not returns.** Creator income and any fan/production crowdfunding deliver goods, content,
  or perks — **never** a financial return or revenue share. No securities.
- **NL-6 — Escrow holds, never lends.** Escrow funds sit in the buyer's held sub-balance and release on
  confirmation or arbitration. Paymax never takes principal risk and never funds the gap.
- **NL-7 — Ajo is peer rotation.** Members fund each other; Paymax is **ledger + escrow only**, never a
  party to the credit and never a guarantor of a defaulting member.
- **NL-8 — Money is a ledger.** Every balance (wallet, sub-balance, event wallet, escrow hold, creator
  earnings, points) is **derived from an append-only transaction ledger**. Never mutate a balance integer.
- **NL-9 — Idempotent + transactional money.** Every money/grant movement carries an idempotency key and
  runs in one transaction. Retries and double-submits must never double-apply.
- **NL-10 — KYC gates & AML limits.** Organiser/vendor/creator **payouts** require the right KYC tier.
  Apply velocity/structuring limits on P2P transfers, spray, and escrow.
- **NL-11 — Content & age safety.** All creator/event content passes moderation with age-appropriate
  controls. The Spotlight audience skews young — never ship a path that could expose minors to unsafe or
  adult content, and never weaken these controls for engagement.
- **NL-12 — Immutable audit.** Every state transition, payout, dispute decision, refund, and config change
  writes an immutable audit entry (actor, entity, action, before/after, timestamp).

---

## 5. Engineering standards (apply to every change)

### Backend (source of truth)
- **Model the domain first** — entities, lifecycle states, invariants — before designing endpoints.
- **State machines, not status fields.** Onboarding, escrow, Ajo cycles, disputes, subscriptions are
  state machines. Enumerate states and **allowed transitions**; reject anything not explicitly allowed;
  attach side effects (grant, notify, audit) to transitions and make the whole transition atomic.
- **AuthZ is a feature.** Every endpoint declares who may call it. Enforce **object-level** authorization
  (can *this* user act on *this* record), not just route-level. Compute roles from durable capability
  grants; never trust a client-supplied role.
- **Invariants in schema AND code** — unique keys, FKs, checks encode business rules at the DB level.
- **Config/schema-driven variation.** Ticket tiers, savings rules, subscription tiers, earn-rules, form
  variants are **versioned config**, validated against the exact version submitted. Adding a variant is a
  data change, not a deploy.
- **Idempotency + transactions** on all multi-write and money operations (see NL-8/NL-9).

### Frontend (resilient by default)
- **Reuse before you build** — existing components, hooks, routing, data-fetching conventions. No second
  way to do a thing that already has a way.
- **Model every state**: idle / loading / empty / partial / success / error / unauthorized / not-approved.
  Discriminated state, not a tangle of booleans. A spinner-less fetch is a bug.
- **Unhappy path is first-class** — handle no-data, slow-data, bad-data, not-allowed before "done".
- **Schema-driven wizards** for onboarding/KYC/checkout flows (organiser, vendor, creator). One renderer +
  N schemas; persist drafts; map server validation errors back to the field.
- **Server vs client state** are separate; cache server state with proper invalidation; guard double-submit.
- **Capability/context switching** explicit (consumer ↔ organiser ↔ creator views), scoped data/permissions.
- Never trust the client; the API re-validates everything.

### Testing & CI gates
- **Test risk, not lines.** Deepest coverage on the critical paths: **money movement, escrow, payouts,
  approvals/grants, auth, data integrity.**
- **State machines:** test every allowed transition (right next state + side effects + audit) AND every
  disallowed transition (rejected). Approving an already-approved thing is idempotent (no double grant).
- **AuthZ:** test allowed AND denied callers, including object-level ("user A cannot act on B's record").
- **Money/ledger:** balances reconcile to the ledger; no disallowed negative balance; retries don't
  double-charge.
- Pyramid: many unit, fewer integration (real test DB via containers; mock only true third parties),
  few e2e smoke journeys. No "ice-cream cone".
- CI blocks merge on unit+integration failure; runs security/dependency scans + smoke e2e on deploy.
- Every fixed bug gets a reproducing regression test.

---

## 6. Definition of Done (per task)

- [ ] Domain invariants enforced in **schema (constraints) AND code**
- [ ] Every endpoint has explicit authN + **object-level** authZ
- [ ] Status changes go through **guarded transitions**, not raw updates
- [ ] Multi-write/money operations **transactional + idempotent**
- [ ] Money modeled as a **ledger**; balances derived, not mutated
- [ ] All relevant **NL-1…NL-12 invariants** verified for this change
- [ ] Frontend handles loading/empty/error/unauthorized; no double-submit; no dead-end screens
- [ ] Secrets/PII never logged; sensitive data encrypted; signed-URL storage for documents
- [ ] **Audit log** written for decisions, payouts, disputes, config changes
- [ ] Tests cover the state machine + authorization paths; CI green

---

## 7. Conventions & "where things live"

- New module code under `/modules/<name>`; shared primitives under `/internal/<name>`.
- One migration per schema change; never edit a shipped migration.
- API: resource + intent oriented, versioned, stable contracts; field-level validation errors.
- Feature flags for every new module so rollout is staged and reversible.
- Money amounts are integer minor units (kobo); currency explicit on every ledger entry.
- Do not introduce a new dependency without justifying it against what already exists in the repo.

---

## 8. Build order

Follow **`BUILD-PLAN.md`**. Summary: **Phase 1** Savings + Social core (fastest, rails-heavy) →
**Phase 2** Ticketing + Loyalty (the moat) → **Phase 3** Creators + full Escrow/Dispute + Spray + Black
perks. Shared components are built just-in-time as the first epic of the phase that first needs them.
