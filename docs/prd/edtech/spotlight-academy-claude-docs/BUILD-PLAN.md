# BUILD-PLAN

Phased, screen-anchored build sequence. Each phase ends shippable. Screen IDs ref `docs/screens.md`;
console modules ref `docs/admin-console.md`. **Do not start a phase's money/reward work without
re-reading `docs/state-machines.md` and `docs/conventions.md`.**

## Phase 0 — Foundations (enablement)
**Goal:** the rails and skeletons everything else stands on.
- `identity-bridge`: Paymax SSO/KYC integration, role model, **GuardianLink + consent** (A3–A7).
- Curriculum service with **versioned** schema (`docs/curriculum.md`); seed NERDC-2025 + LEGACY.
- Adapters for payments/wallet/BNPL/notifications/streaming (provider-agnostic).
- Audit-log + RBAC + feature-flag infrastructure (admin §1).
- Analytics event pipeline (`docs/nfr.md` taxonomy).
**DoD:** a user can sign up via Paymax, a minor can be consent-linked, curriculum loads from data,
audit + flags live.

## Phase 1 — Exam beachhead (revenue first)
**Goal:** one–two exam arenas, gamified, monetised, distributable offline. Commercial proof.
- Screens: **A (all), L (core L1–L13, L17), X (X1–X13), G (G1–G9), W (W1–W9), Z (core)**.
- `assessment` (question bank, attempts) + `exam-arena` (blueprints, CBT simulator X7,
  scoring, readiness) — server-authoritative timer, immutable attempts.
- `gamification` (XP/streaks/badges/leaderboards) + `rewards` (funded pools, idempotent ledger
  credits) — sponsor-funded only.
- `commerce` (plans, exam bundles, **access cards** via agent rail, BNPL entitlement).
- Offline: bundles + offline CBT + sync.
- Console: ops, CMS(lite), question bank, exam-arena mgmt, gamification, rewards/wallet ops,
  payments, **TV-funnel attribution**.
**DoD:** a candidate can prep + sit a full offline mock, earn a sponsor-funded reward, and buy a
bundle via BNPL or an agent card; staff can author items and configure an arena.

## Phase 2 — Curriculum spine
**Goal:** the P1→SSS3 learning backbone + parent layer + EduPay v1.
- Content for **new-curriculum entry classes (P1, P4, JSS1, SS1)** as edutainment.
- `progression` (mastery, adaptive practice L11, paths) wired to curriculum.
- Screens: **L (full), P (P1–P13)**; parent dashboards, controls, reports, approvals.
- `edupay` (fee schedules, pay/BNPL, save-for-school pots, disbursement).
- Console: full curriculum mgmt, content production tracker, CMS publish workflow, EduPay,
  notifications/messaging.
**DoD:** a parent monitors a child across subjects, pays/saves school fees, and the learner
follows an adaptive path on real new-curriculum content.

## Phase 3 — Learn-to-earn moat
**Goal:** trade tracks → credentials → Paymax earning roles; live/community.
- Screens: **S (S1–S8), C (C1–C7)**.
- `credentials` (issuance, verification registry, revocation) + earning-bridge eligibility.
- Wire trade credentials → `EarningOpportunity` → **route apply into Paymax role-upgrade/KYC**.
- `live` on LiveKit (classes, replays); community + moderation.
- Console: credential & earning bridge, live/events, moderation/trust-safety.
**DoD:** a learner completes a trade track, earns a verifiable credential, and is routed into a
real Paymax earning role; live classes run and are moderated.

## Phase 4 — Scale & B2B2C
**Goal:** breadth, institutions, marketplace.
- Full P1–SSS3 coverage; **legacy-curriculum maintenance**; NABTEB arena; ECCE (optional, E1–E3).
- Screens: **T (T1–T8)**; tutor onboarding/payouts, school admin lite.
- `schools` (licences, bulk enrolment, white-label); tutor marketplace.
- Console: school/institution mgmt, tutor marketplace ops, localization depth, BI depth.
**DoD:** schools onboard under licence, tutors earn payouts, full curriculum + legacy coverage live.

## Cross-phase definition of done (every ticket)
- [ ] Anchored to a screen ID / admin module / documented flow.
- [ ] Guarded state transitions; illegal ones rejected + audited.
- [ ] Money/reward ops idempotent + append-only ledger entries.
- [ ] Reuses the relevant Paymax rail (no parallel impl).
- [ ] Offline/low-data handled where applicable.
- [ ] Child-safety/consent + RBAC + audit applied.
- [ ] Tests per `docs/conventions.md` pyramid (state machines, authz, money paths).
- [ ] Analytics events emitted.

## Sequencing rationale
Exam crown first = fastest revenue and clearest demand. Spine second = retention + breadth. Trade
moat third = the defensible learn-to-earn loop. B2B2C last = scale once the consumer loop is proven.
Override the beachhead order only by changing locked assumption #6 (see PRD §1.3).
