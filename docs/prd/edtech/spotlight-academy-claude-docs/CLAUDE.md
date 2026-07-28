# Spotlight Academy — Claude Code Guide

> K-12 EdTech capability on the **Paymax** super-app. Full **Primary 1 → SSS3** learning spine,
> crowned with gamified national-exam prep (**Common Entrance · BECE · WASSCE · NECO · UTME**),
> wired to a **learn-to-earn** loop. Mobile app + admin console.

This file is the lean entry point. **Read the focused doc for the area you're working in before writing code** — do not load everything at once (progressive disclosure).

---

## What we're building (one screen at a time)

A mobile-first learner/parent app (single identity, role-aware) and a web admin console.
The financial surface **reuses existing Paymax rails**; the genuinely new build is the
**learning engine** (content, adaptivity, gamification), the **exam-arena CBT simulator**,
and **credentialing**. Distribution leans on offline bundles + the agent network.

## Golden rules (non-negotiable)

1. **Reuse rails, don't rebuild them.** Identity/KYC, wallet/ledger, BNPL, virtual accounts,
   payouts, agent network, loyalty, creator monetisation, streaming (LiveKit), MapService are
   **existing Paymax services**. Integrate via their contracts — see `docs/paymax-rails.md`.
2. **Single identity, additive capability.** One Paymax user carries learner/parent/tutor roles.
   Never create parallel auth. Minors require guardian consent + tiered KYC gating.
3. **Append-only ledger for all value.** Every reward credit, redemption, charge, refund and
   disbursement is an immutable ledger entry. No balance is ever mutated in place.
4. **Idempotency on every money/reward operation.** All credits, charges, redemptions and
   disbursements take an idempotency key and are safe to retry. See `docs/conventions.md`.
5. **Guarded state machines.** Learner progression, exam attempts, reward issuance, BNPL,
   EduPay, and credentials are explicit state machines. Only declared transitions are legal.
   See `docs/state-machines.md`.
6. **Provider-agnostic gateways.** Payments, SMS/push, streaming, content CDN all sit behind
   abstractions. No vendor SDK leaks into domain logic.
7. **Offline-first, low-data by default.** Lessons, practice and CBT mocks work offline;
   progress/attempts/reward events queue locally and reconcile deterministically. See `docs/nfr.md`.
8. **Child-safety & NDPR are requirements, not features.** Guardian consent, content gating,
   moderation, least-privilege RBAC, and full audit trails apply everywhere.
9. **Rewards are sponsor-funded.** No reward is minted without a funded `RewardPool`. Protects
   unit economics — see `docs/gamification-rewards.md`.
10. **Everything auditable.** Every staff action and money movement is written to an immutable
    audit log.

## Doc map (open what's relevant)

| Working on… | Read |
|---|---|
| Core principles, boundaries | `docs/architecture.md` |
| Coding/API/idempotency/testing conventions | `docs/conventions.md` |
| Entities, schema, relationships | `docs/data-model.md` |
| Progression / exam / reward / BNPL / EduPay / credential flows | `docs/state-machines.md` |
| Any mobile screen (stable IDs A1…Z13) | `docs/screens.md` |
| Admin console modules | `docs/admin-console.md` |
| Curriculum versioning (NERDC new/legacy) | `docs/curriculum.md` |
| Exam arenas & CBT engine | `docs/exam-arena.md` |
| Gamification + learn-to-earn rewards | `docs/gamification-rewards.md` |
| Integrating a Paymax rail | `docs/paymax-rails.md` |
| Performance/offline/security/child-safety | `docs/nfr.md` |
| Sprint sequence & milestones | `BUILD-PLAN.md` |

## Stack

Match the **existing Paymax stack and service conventions**. Where this module stands alone,
defaults are: PostgreSQL (+ PostGIS where geo is needed), a typed backend (services exposing
REST/JSON with the conventions in `docs/conventions.md`), and a cross-platform mobile client
(React Native or Flutter — follow the existing Paymax client). Confirm against the live platform
before scaffolding; **do not introduce a second auth, ledger, or payments stack.**

## How to work

- Start from a **screen ID** (`docs/screens.md`) or an **admin module** (`docs/admin-console.md`);
  trace it to its **state machine** and **entities** before coding.
- Touching value (rewards/payments/fees)? Re-read **golden rules 3–5** and `docs/conventions.md`
  first. Idempotency keys + ledger entries are mandatory, not optional.
- Prefer extending a Paymax rail over writing new financial logic.
- Keep curriculum as **versioned data**, never hardcoded subject/trade lists (`docs/curriculum.md`).

## Definition of done

- [ ] Maps to a screen ID / admin module / documented flow.
- [ ] State transitions are guarded; illegal transitions rejected and logged.
- [ ] Money/reward ops are idempotent and produce append-only ledger entries.
- [ ] Reuses the relevant Paymax rail (no parallel implementation).
- [ ] Offline/low-data behaviour handled where applicable.
- [ ] Child-safety/consent + RBAC + audit applied.
- [ ] Tests per the pyramid in `docs/conventions.md` (state machines, authz, money paths covered).
- [ ] Analytics events emitted per `docs/nfr.md` taxonomy.
