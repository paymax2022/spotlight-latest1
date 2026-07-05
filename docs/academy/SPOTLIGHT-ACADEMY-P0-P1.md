# Spotlight Academy — Phase 0 + Phase 1 (implemented)

K-12 EdTech on the Paymax super-app: full identity/curriculum foundation + the
exam beachhead (assessment, CBT exam arenas, gamification, sponsor-funded rewards,
commerce/BNPL/access-cards). Built backend + mobile + admin, all behind
`FEATURE_ACADEMY_ENABLED` (exam crown behind `FEATURE_ACADEMY_EXAM_ENABLED`).
Implemented per `docs/prd/edtech/` (CLAUDE.md golden rules + BUILD-PLAN phases).

## Reuse vs net-new

REUSE (Paymax rails — integrated, not rebuilt): single identity / KYC / tiers
(`finance/kyc`), wallet **ledger** for reward credits (`finance/ledger.Credit`,
idempotent — no shadow ledger), points, RBAC + `audit_logs`, scheduler, the
`RegisterX(member, adminGroupTop5, pool, rbac)` module pattern, mobile design
tokens + Services grid, admin `_ui` + service auth stack. Payments/BNPL/agent
rails are injected into commerce behind interfaces (stubs in dev).

NET-NEW (this module owns — the learning engine):
- **Migrations** (`20260815000800/000900/001000`): ~48 tables — identity-bridge
  (roles/profiles/guardian_links/immutable consent), versioned curriculum, content,
  assessment + exam (items/arenas/blueprints/attempts/responses/mastery/progress),
  gamification, rewards (funded pools + reward ledger), commerce
  (plans/subs/entitlements/orders/bundles/access-cards), sponsors, analytics +
  RLS + `academy.*` RBAC + commerce idempotency/sync/audit.
- **Backend** `internal/academy/{identity,curriculum,assessment,exam,gamification,rewards,commerce}`
  — 7 sub-packages, each model/repo/service/handler/Register + tests; aggregator
  `app/academy_routes.go` (`RegisterAcademy`) wired into `finance_routes.go`.
- **Mobile** `app/learn/academy/*` (24 screens) + `src/features/academy/*` (mock-first
  data layer, offline CBT, child-safety consent gate); Services-grid tile → `/learn/academy`.
- **Admin** `app/admin/academy/*` (8 modules: dashboard, curriculum, question bank,
  exams, gamification, rewards, commerce, sponsors) + sidebar (RBAC `academy.*`).

## Golden rules enforced

1. Reuse rails — wallet ledger funds reward credits; no parallel auth/ledger/payments.
2. Single identity, additive roles; minors gated by GuardianLink + immutable consent + KYC tier.
3. Append-only ledgers — `academy_reward_ledger_entries` (+ wallet ledger); balances summed, never mutated.
4. Idempotency on every money/reward op (unique idempotency keys; replay = original effect).
5. Guarded state machines — learner progression, CBT attempt, reward issuance, purchase/BNPL, content publish; illegal transitions rejected + audited (unit-tested per package).
6. Provider-agnostic — payments/BNPL/agent rails injected via interfaces.
7. Offline-first — content bundle manifest + deterministic, idempotent sync; CBT runs offline; server-authoritative timer + scoring on reconcile.
8. Child-safety/NDPR — consent gate fail-closed before purchase/community; RBAC + audit everywhere; RLS owner-scoped.
9. Rewards sponsor-funded — no credit without a funded `RewardPool` (atomic balance + per-user/campaign caps + anti-fraud gate before credit).
10. Everything auditable — staff/money actions → `audit_logs` / `academy_commerce_audit`.

## Phase DoD check

Phase 0 — sign up via Paymax + role/consent (identity), minor consent-linked
(GuardianLink + ConsentRecord), curriculum loads from versioned data
(NERDC-2025 + LEGACY seeded), audit + flags live. ✓
Phase 1 — candidate preps + sits a full offline CBT mock (X7) with server-authoritative
timer + immutable attempt, gets a score breakdown, earns a sponsor-funded reward
(funded pool → idempotent wallet credit), buys a bundle via BNPL or activates an
agent access-card; staff author items + configure an arena. ✓ (UI is a representative
mock-first slice of the screen/module inventory; remaining screens are later passes.)

## Verification

Admin `tsc --noEmit` exit 0; mobile scoped `tsc` exit 0; backend verified
structurally (no duplicate symbols within packages, Register signatures consistent,
braces balanced, SQL columns matched to migrations) — Go toolchain unavailable in
sandbox, so `go build/vet/test ./internal/academy/...` is deferred to CI.

## Assumptions / follow-ups

- Member-action audits write to `audit_logs` whose `actor_user_id` FKs
  `platform_users`; learner ids not in that table would null/fail the FK — confirm
  the audit target table or relax the FK for member-scoped academy audits in CI.
- Admin route paths are functional but not perfectly uniform (identity/curriculum/
  commerce mount under `/api/academy*`; gamification/rewards/exam/assessment under
  `/api/academy/admin/*`) — harmonize in a follow-up if desired.
- Curriculum/content/question seeds are representative (entry classes P1/P4/JSS1/SS1),
  not the full P1→SSS3 corpus (Phase 2+). Phases 2–4 (full spine, EduPay, trade
  credentials/earning-bridge, live, B2B2C) are not in this scope.
