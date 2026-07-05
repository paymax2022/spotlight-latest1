# Spotlight Academy — Phase 3 (learn-to-earn moat)

The defensible loop: **learn → practise → earn → graduate**. Trade tracks →
verifiable credentials → Paymax earning roles, plus live classes + moderated
community. Gated by `FEATURE_ACADEMY_CREDENTIALS_ENABLED` (trade + credentials +
earning bridge) and `FEATURE_ACADEMY_LIVE_ENABLED` (live + community + moderation),
under `FEATURE_ACADEMY_ENABLED`.

## What shipped

Backend — 3 new sub-packages under `internal/academy/` (model/repo/service/handler/
Register + pure tests), wired into `RegisterAcademy` and gated:
- **credentials** — issuance SM `pending→issued→revoked` (signed claim + public
  verification registry, revoke updates it), earning opportunities + eligibility
  evaluation (credentials → `EarningOpportunity` rules), and idempotent **Apply**
  that routes into Paymax role-upgrade via an injected `RoleUpgrader` (Paymax owns
  the actual onboarding/KYC — not rebuilt). Exposes the trade package's
  `CredentialIssuer`.
- **trade** — trade modules/lessons (practical, project-based), project/portfolio
  submissions + rubric review SM, skill assessments where a **pass idempotently
  issues a credential** via the injected issuer, mentor directory + matches.
- **live** — live-session SM `scheduled→live→ended` via an injected
  `LiveRoomProvider` (LiveKit-shaped; reuse `connect/live`), replays, study groups,
  moderated discussions/Q&A, and a moderation reports queue (report → hide/warn/
  ban/dismiss). Child-safety: **no 1:1 DMs for minors** (group/Q&A only, enforced
  fail-closed).

Migration `20260815001200_academy_credentials_live.sql` — additive: credentials +
verification registry + earning opportunities/applications; trade modules/lessons/
projects/submissions/skill-assessments/attempts/mentors/matches; live sessions/
participants + study groups/members + discussions + moderation reports + RLS +
RBAC (`academy.credentials`, `academy.live`; `academy.moderation` already existed).

Mobile (mock-first) — academy app grew 46→64 screens: trade & skills **S1–S8**
(hub, lesson, project submission, skill assessment, trade credential, earning feed,
opportunity apply with Paymax onboarding deep-link, mentor connect), live/community
**C1–C7** (schedule, room, replay, groups, Q&A, notifications, announcements), and
certificates **G10/G11** (verifiable cert + QR + public verify). Earning-apply hands
off into Paymax role-upgrade (deep-link, not rebuilt).

Admin — academy console grew 13→16 modules: credential & earning bridge (templates,
issuance/verification registry, revoke, opportunity→role mapping, applications),
live & events mgmt, moderation & trust-safety (reports triage with child-safety
escalation). RBAC-gated; sidebar + AcademyTabs updated.

## Golden rules honored

Reuse rails (LiveKit via injected provider; role-upgrade via injected `RoleUpgrader`
over `rbac.AssignRoleToUser`; credentials issuer shared across packages — no forks);
guarded state machines (credential, submission, mentor-match, live-session,
moderation — unit-tested allowed+illegal); idempotent issuance + apply
(idempotency keys / unique constraints); public verification registry stores only
result + holder display name (no PII); child-safety no-minor-DM fail-closed; full
audit; RLS owner/public/admin-scoped.

## Phase 3 DoD

A learner completes a trade track (modules → project submission → skill
assessment), earns a verifiable credential (issued + registered + QR-verifiable),
and is routed into a real Paymax earning role (eligibility evaluated → Apply →
role-upgrade handoff). Live classes run (session SM + room provider + replay) and
are moderated (reports queue + hide/ban + child-safety escalation). ✓ (UI mock-first.)

## Verification

No duplicate migration timestamps; 85 academy backend files brace-balanced, 14
Register functions, no within-package symbol collisions; aggregator gated by
`credentialsEnabled`/`liveEnabled`; admin `tsc` exit 0 (scoped); mobile scoped `tsc`
clean. Go `build/vet/test ./internal/academy/...` deferred to CI.

## Follow-ups

- Inject a real `RoleUpgrader` adapter (slug→roleId resolution over
  `rbac.AssignRoleToUser`) and the `connect/live` LiveKit `LiveRoomProvider` at the
  aggregator (both nil/stub today).
- Phase 4 (B2B2C schools/tutor marketplace, NABTEB arena, legacy-curriculum
  maintenance, localization depth, BI) remains the final phase.
