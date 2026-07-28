# BUILD-PLAN.md — Paymax Top-5 Expansion

> Execution plan for Claude Code. Pairs with `CLAUDE.md` (standards + safety invariants) and
> `Paymax_Top5_Product_Pack.docx` (PRDs). Work top-to-bottom. Each epic lists scope, tasks, the state
> machine(s) involved, test gates, and **story points (SP)** on a 1/2/3/5/8/13 scale. Build shared
> components just-in-time as the first epic of the phase that needs them.

**Legend:** `[S]` shared primitive · `[BE]` backend · `[FE]` React Native · `[ADM]` admin console ·
`[T]` test gate. SP = relative effort, not days.

---

## 0. Dependency graph (what each module needs)

```
                 admin-shell ──────────────┐ (all)
 scheduler ── savings(auto-save), creators(subs)
 escrow ───── social(P2P), events(cashless residual), creators(refunds)
 cashtag ──── social, events(gift), creators(pay), loyalty(referral)
 credential ─ events(QR/NFC), loyalty(perk redemption)
 spray ────── social, creators
 points ───── loyalty (earns from events, savings, social, creators)
```

Phase 1 unlocks: admin-shell, scheduler, cashtag, escrow(core) → Savings + Social core.
Phase 2 unlocks: credential, points → Ticketing + Loyalty.
Phase 3 unlocks: spray, escrow(dispute) → Creators + full P2P escrow + Black perks.

**Total ≈ 233 SP** across 3 phases (shared ≈ 58, Phase 1 ≈ 71, Phase 2 ≈ 63, Phase 3 ≈ 41).

---

## PHASE 1 — Foundation & frequency (Savings #3 + Social core #2)

Goal: ship the fastest, most rails-heavy modules to drive daily frequency, while standing up the shared
spine. Exit when a user can auto-save into a vault, run an Ajo cycle, send to a cashtag, split a bill, and
fund a group pool — all visible in the admin shell with full audit.

### EPIC 1.0 — Shared spine `[S]` — 26 SP
- [ ] `[S][BE]` **Admin shell + RBAC + audit log** `/internal/admin` — role model, object-level guards,
      immutable audit (actor/entity/action/before-after/ts), exportable. **NL-12.** — 8 SP
- [ ] `[S][BE]` **Scheduler** `/internal/scheduler` — durable recurring jobs (auto-save, subs), retry with
      backoff, idempotent run records, missed-run handling. — 5 SP
- [ ] `[S][BE]` **Escrow core** `/internal/escrow` — funds-hold state machine `HELD → RELEASED | REFUNDED`,
      ledger-backed (NL-6, NL-8), idempotent (NL-9). Dispute states added Phase 3. — 8 SP
- [ ] `[S][BE]` **Cashtag directory** `/internal/cashtag` — unique `@handle` per identity, reserved/abuse
      list, impersonation guard, resolve handle→identity. — 5 SP
- [ ] `[T]` State-machine + idempotency + authZ tests for escrow & scheduler; audit-log assertions. — incl.

### EPIC 1.1 — Savings: Goal Vaults `[savings]` — 13 SP
PRD §3. State machine: `Vault: OPEN → (LOCKED|FLEX) → MATURED | CLOSED`; early-break guarded.
- [ ] `[BE]` Vault entity on wallet **sub-balance**; lock/flex rules as versioned config. **NL-2 (no yield).** — 3 SP
- [ ] `[BE]` Auto-save via scheduler (frequency rules); round-up deferred to v2. Idempotent debits. — 3 SP
- [ ] `[FE]` Screens: Savings home, Create vault, Vault detail, Auto-save setup, Early-withdraw confirm. — 3 SP
- [ ] `[FE]` All states (loading/empty/error); streak/progress nudges (basic). — 2 SP
- [ ] `[ADM]` Savings oversight + float reconciliation + force-unlock (audited). — 2 SP
- [ ] `[T]` Vault transitions, no-yield invariant, ledger reconciliation, auto-save idempotency.

### EPIC 1.2 — Savings: Ajo / Esusu circles `[savings]` — 13 SP
PRD §3. State machine: `Circle: FORMING → ACTIVE → (CYCLE×n) → COMPLETED`; `Member: INVITED → ACTIVE → DEFAULTED|EXITED`.
- [ ] `[BE]` Ajo rotation engine: cycle scheduling, per-cycle auto-debit, payout to scheduled member,
      rotate order. **NL-7 (peer rotation; Paymax = ledger/escrow only).** — 5 SP
- [ ] `[BE]` Default policy: missed-contribution handling, member removal, make-good rules (config). — 3 SP
- [ ] `[FE]` Screens: Ajo discover/create, Circle detail, Contribute, Payout view. — 3 SP
- [ ] `[ADM]` Ajo monitoring (collections, payout queue, health), default handling. — 2 SP
- [ ] `[T]` Full cycle incl. a defaulting member; payout-order correctness; no-credit-from-Paymax invariant.

### EPIC 1.3 — Savings: Group Target `[savings]` — 5 SP
- [ ] `[BE]` Group-target ledger + withdrawal rule (on-date / majority-approval). — 2 SP
- [ ] `[FE]` Screens: Group target create + detail/contribute. — 2 SP
- [ ] `[T]` Withdrawal-rule enforcement; held-funds invariant. — 1 SP

### EPIC 1.4 — Social: P2P core `[social]` — 8 SP
PRD §2. Reuses wallet transfers + cashtag.
- [ ] `[BE]` In-chat payment object (send/request) on cashtag; AML velocity limits (**NL-10**). — 3 SP
- [ ] `[FE]` Screens: Cashtag pay, Send + note, Request money, Activity feed. — 3 SP
- [ ] `[ADM]` Limits/velocity config, reversal tooling (audited). — 2 SP
- [ ] `[T]` Limits, idempotency, object-level authZ (can't request as someone else).

### EPIC 1.5 — Social: Split & Pools `[social]` — 6 SP
- [ ] `[BE]` Split-bill engine (equal/custom shares, tracking) + group-pool ledger + payout rule. — 3 SP
- [ ] `[FE]` Screens: Split create/track, Pool create/detail. — 2 SP
- [ ] `[T]` Collection completion logic; pool payout-rule enforcement. — 1 SP

**Phase 1 exit criteria:** vault auto-save running; one full Ajo cycle (incl. default path) green;
cashtag send + split + pool working end-to-end; admin shell shows audit for all of it; CI green with
state-machine + money + authZ coverage on every epic above.

---

## PHASE 2 — The moat (Ticketing #1 + Loyalty #5)

Goal: ship the differentiation layer. Exit when an organiser can sell tiered tickets, attendees enter via
rotating-QR and tap-pay vendors cashless with post-event refunds, and points are earned across all live
modules with a 3-tier ladder.

### EPIC 2.0 — Shared: Credential + Points `[S]` — 13 SP
- [ ] `[S][BE]` **Credential service** `/internal/credential` — issue/validate rotating QR (anti-screenshot)
      and NFC tokens; single-use + re-entry rules; offline-tolerant validation queue. — 8 SP
- [ ] `[S][BE]` **Points ledger** `/internal/points` — append-only points ledger, earn-rules engine
      (per action/module), expiry. **NL-4 (points ≠ cash), NL-8.** — 5 SP
- [ ] `[T]` QR single-use + replay rejection; points earn/expire correctness.

### EPIC 2.1 — Ticketing: Events & Tickets `[events]` — 18 SP
PRD §1. State machines: `Event: DRAFT → SUBMITTED → APPROVED → LIVE → CLOSED | SUSPENDED`;
`Ticket: ISSUED → TRANSFERRED? → USED | REFUNDED`.
- [ ] `[BE]` Event CMS + approval workflow (organiser **capability** via single-identity model). — 5 SP
- [ ] `[BE]` Ticket inventory, tiers, promo codes (versioned config); order + issuance via credential. — 5 SP
- [ ] `[FE]` Schema-driven organiser create-event wizard; tier select; checkout (wallet). — 3 SP
- [ ] `[FE]` Attendee: discovery feed, event detail, My Tickets, ticket pass (QR), transfer/gift (cashtag). — 3 SP
- [ ] `[FE]` Steward scan-and-validate mode (offline-tolerant). — 2 SP
- [ ] `[T]` Ticket lifecycle; double-scan rejection; transfer authZ; promo-code validation.

### EPIC 2.2 — Ticketing: Cashless Event Wallet `[events]` — 13 SP
State machine: `EventWallet: OPEN → SPENDING → CLOSED(residual refunded)`.
- [ ] `[BE]` Closed-loop event balance (wallet sub-balance) + top-up (wallet/agent/card). **NL-3, NL-2.** — 3 SP
- [ ] `[BE]` Vendor POS-lite tap-charge; vendor float ledger; settlement net of fees via payouts. — 5 SP
- [ ] `[FE]` Screens: top-up, tap-to-pay, spend history, withdraw unspent, venue map. — 3 SP
- [ ] `[ADM]` Cashless float & liability, vendor mgmt, settlement & recon, fraud (dup-scan/abnormal top-up). — 2 SP
- [ ] `[T]` Residual-refund correctness; closed-loop invariant (no open-loop cash-out); settlement recon.

### EPIC 2.3 — Loyalty: Points, Tiers, Catalog `[loyalty]` — 13 SP
PRD §5. State machine: `Membership: TIER1 → TIER2 → TIER3(→ BLACK in Phase 3)`.
- [ ] `[BE]` Wire earn-rules to live modules (payments, savings, tickets, referral `§7A`). — 3 SP
- [ ] `[BE]` Tier engine (thresholds, benefits, re-evaluate on earn); rewards catalog + redemption via
      bill-pay/airtime/ticket-discount. **NL-4.** — 5 SP
- [ ] `[FE]` Screens: Rewards home, Earn history, Catalog, Redeem, Tier & benefits, Referral hub (reuse). — 3 SP
- [ ] `[ADM]` Earn-rule + tier config, catalog CRUD, liability & expiry dashboard, redemption fraud. — 2 SP
- [ ] `[T]` Earn/redeem ledger correctness; points-≠-cash invariant; tier re-evaluation; liability totals.

**Phase 2 exit criteria:** a real Spotlight event sells tiered tickets, validates entry by QR, runs
cashless vendors with correct post-event residual refunds and settlement; points accrue across modules and
a 3-tier ladder is live; full admin oversight + audit; CI green.

---

## PHASE 3 — Flywheel & depth (Creators #4 + full Escrow/Spray + Black)

Goal: turn the audience into supply and add the high-engagement extras. Exit when creators earn via tips/
subs/gated content, fans spray on lives, P2P escrow has a working dispute/arbitration loop, and Paymax
Black unlocks Spotlight perks redeemable at events.

### EPIC 3.0 — Shared: Spray + Escrow disputes `[S]` — 8 SP
- [ ] `[S][BE]` **Spray engine** `/internal/spray` — instant transfer + animation contract + leaderboard;
      AML limits (**NL-10**). — 5 SP
- [ ] `[S][BE]` **Escrow disputes** — extend state machine `HELD → DISPUTED → (RELEASED|REFUNDED)` with
      evidence, arbitration decision, audit. — 3 SP
- [ ] `[T]` Spray limits; dispute transitions + arbitration authZ + audit.

### EPIC 3.1 — Creators: Storefront, Tips, Content `[creators]` — 13 SP
PRD §4. State machines: `Subscription: ACTIVE → PAST_DUE → CANCELLED`; `Entitlement: GRANTED → REVOKED`.
- [ ] `[BE]` Creator capability + storefront; tip jar; paid-content gating + entitlements. **NL-5 (perks not
      returns).** — 5 SP
- [ ] `[BE]` Subscription tiers via scheduler (recurring, retry on fail); creator earnings ledger + payout. — 3 SP
- [ ] `[FE]` Screens: storefront, become-a-creator (schema wizard + payout KYC), tip, subscribe, gated viewer,
      earnings, payout, my-subscriptions, discover. — 3 SP
- [ ] `[ADM]` Creator verification, **content moderation + age controls (NL-11)**, billing, payout, fee config,
      abuse/self-tip fraud. — 2 SP
- [ ] `[T]` Subscription lifecycle + failed-renewal; entitlement gating; payout KYC gate; moderation path.

### EPIC 3.2 — Social: P2P Escrow marketplace + Spray `[social]` — 12 SP
- [ ] `[BE]` P2P listings + escrow checkout (consume escrow core + disputes); seller ratings. — 5 SP
- [ ] `[FE]` Screens: listing create, browse/detail, escrow checkout, confirm/release, dispute raise/status. — 3 SP
- [ ] `[FE]` Spray sender + feed/leaderboard (shared engine), wired into lives & events. — 2 SP
- [ ] `[ADM]` Escrow oversight + dispute arbitration console; fraud/AML/mule detection. — 2 SP
- [ ] `[T]` Full escrow incl. dispute→refund and dispute→release; spray limits; mule-pattern checks.

### EPIC 3.3 — Loyalty: Paymax Black + perks + partners `[loyalty]` — 8 SP
- [ ] `[BE]` Black tier + benefit config; perk entitlements redeemable via **credential** at events
      (early tickets, lounge). Partner-offer mgmt + settlement. — 5 SP
- [ ] `[FE]` Screens: Paymax Black landing/upgrade, Partner offers, Perk redemption. — 2 SP
- [ ] `[T]` Black eligibility; perk redemption single-use via credential; partner settlement. — 1 SP

**Phase 3 exit criteria:** creators earn and withdraw with moderation + payout-KYC enforced; spray live on
events/lives; P2P escrow dispute loop resolves both ways with audit; Black perks redeem at a real event;
CI green across all critical-path suites.

---

## Cross-cutting acceptance gates (every phase)

- [ ] All **NL-1…NL-12** invariants verified for shipped code (checklist in PR template).
- [ ] State machines: allowed + rejected transitions tested; side effects + audit asserted.
- [ ] Money: ledger reconciliation + idempotency/double-submit tests on every money path.
- [ ] AuthZ: allowed + denied + object-level tests on every protected action.
- [ ] Feature-flagged rollout; reversible; staged to a cohort before GA.
- [ ] Admin oversight + immutable audit present for every state-changing flow.

## Suggested team shape & cadence
- 2 BE, 2 FE, 1 mobile/infra, 1 QA, shared PM. Phase 1 ≈ 4–6 sprints, Phase 2 ≈ 4–5, Phase 3 ≈ 3–4
  (team-dependent; SP totals are the planning anchor, not calendar promises).
- Build shared primitives first within each phase; never let a module fork a shared component.

## First three Claude Code tasks (start here)
1. Scaffold `/internal/admin` (RBAC + audit) and the PR template embedding the NL-1…NL-12 checklist.
2. Scaffold `/internal/escrow` core state machine with ledger + idempotency + full test suite.
3. Implement Savings Goal Vaults (EPIC 1.1) end-to-end as the reference module for conventions.
