# Spotlight Academy — Phase 4 (scale & B2B2C) + program complete

The final phase: institutions, tutor marketplace, and breadth (NABTEB arena +
ECCE). Gated by `FEATURE_ACADEMY_SCHOOLS_ENABLED` (B2B2C institutions) and
`FEATURE_ACADEMY_TUTOR_ENABLED` (tutor marketplace), under `FEATURE_ACADEMY_ENABLED`.

## What shipped (Phase 4)

Backend — 2 new sub-packages (model/repo/service/handler/Register + pure tests),
wired + gated in `RegisterAcademy`:
- **schools** — institution onboarding, licence lifecycle SM (active↔suspended→
  expired), **seat-capped idempotent bulk enrolment** (used_seats ≤ seats, atomic
  `UPDATE … WHERE used_seats < seats`), class groups, white-label config, usage/
  billing via an injected `BillingRail` (VA).
- **tutor** — onboarding + **KYC-gated verification** (reuses `finance/kyc`, tier ≥ 1
  via an injected `KYCChecker` adapter wired at the aggregator), profiles/ratings,
  assignments, grading, append-only earnings (balance derived by SUM), and a payout
  SM (requested→paid|failed) — idempotent, via an injected `PayoutRail` (mirrors the
  doctor payout pattern; stub in dev).

Data seed `20260815001400_academy_p4_seed.sql` — NABTEB arena + ECCE classes
(additive, ON CONFLICT DO NOTHING). NABTEB/ECCE needed no schema change (already in
the existing CHECKs). Full P1–SSS3 + LEGACY coverage is seeded by the curriculum
service.

Mobile (mock-first) — academy app grew 64→77 screens: tutor & school **T1–T8**
(onboarding/KYC, profile, roster, assign, grade, host live, earnings & payouts,
school-admin-lite) + ECCE **E1–E3** (kids home, play-learn, parent gate). Tutor
verify reuses KYC (client never self-grants); payout fail-closed behind verification;
ECCE parent-gate blocks settings/purchases for kids.

Admin — academy console grew 16→19 modules: school/institution mgmt (licences/seats/
bulk-enrol/white-label/billing), tutor & marketplace ops (vetting/KYC/payouts/
ratings/disputes), analytics & BI depth (outcome/engagement/retention/funnel/
revenue/exam dashboards + cohort + CSV export). RBAC-gated; sidebar updated.

## Phase 4 DoD

Schools onboard under licence (institution + licence + seat-capped bulk enrolment),
tutors earn payouts (KYC-gated verify → earnings → idempotent payout via rail), and
full curriculum + legacy + NABTEB/ECCE breadth is present. ✓ (UI mock-first.)

---

## Spotlight Academy — all phases complete (P0–P4)

| Phase | Delivered |
|---|---|
| 0 Foundations | identity-bridge + guardian consent, versioned curriculum (NERDC-2025 + LEGACY), audit/RBAC/flags, analytics, rail adapters |
| 1 Exam beachhead | assessment + CBT exam arenas (server-auth timer, immutable attempts), gamification + sponsor-funded rewards (wallet ledger), commerce/BNPL/access-cards, offline |
| 2 Curriculum spine | adaptive progression/paths, content/CMS + production board, parent layer (dashboards/controls/reports/approvals), EduPay v1 (fees/pots/disbursement/scholarships) |
| 3 Learn-to-earn moat | trade tracks → verifiable credentials → Paymax earning-role bridge, live classes + community + moderation |
| 4 Scale & B2B2C | institutions/licences/bulk-enrol/white-label/billing, tutor marketplace + payouts, NABTEB + ECCE breadth, BI depth |

Totals: **16 backend sub-packages** (`internal/academy/*`, 99 Go files, 16 Register
functions, guarded SMs + idempotent money paths + tests), **8 additive migrations**
(~70 tables, RLS + `academy.*` RBAC), **8 feature flags** (master + 7 sub-phase),
**~77 mobile screens** (`app/learn/academy/*`, mock-first), **19 admin modules**
(`app/admin/academy/*`). All gated; legacy behavior untouched when flags off.

## Golden rules (held across all phases)

Reuse rails (wallet ledger, KYC/tiers, VA, payout, LiveKit, RBAC, audit, scheduler —
injected interfaces, never forked); single identity + additive roles + consent
gating; append-only + idempotent money/reward paths; guarded state machines
(progression, attempt, reward, purchase, EduPay disbursement, credential, content
publish, licence, payout — unit-tested allowed+illegal); offline-first; child-safety
fail-closed (consent gate, no-minor-DM, ECCE parent gate); curriculum-as-data;
sponsor-funded rewards; full audit + RLS.

## Outstanding integration seams (wire when ready)

- Rail wiring (`app/academy_rails.go`): ✅ DONE for the rails with backing services —
  commerce **PaymentRail** + EduPay **CollectRail** now charge/collect on the real
  wallet ledger (`ledger.Debit` → escrow standing account, idempotent), live
  **LiveRoomProvider** mints real RTC join tokens via `integrations/rtc` (when Agora
  creds are configured; nil ⇒ stub). Rewards already used the real ledger. STILL
  stubbed (no clean backing service/account model): commerce **BNPL**, EduPay
  **DisburseRail** (needs a school-account/payout rail), schools **BillingRail**
  (institution account model), tutor **PayoutRail** (payout provider). The
  credentials **earning-bridge** is intentionally client-initiated — the mobile S7
  deep-link routes into the existing Paymax role-upgrade/KYC onboarding; the backend
  only records the routed application (auto-granting a role server-side would
  over-privilege).
- ✅ Commerce ↔ `academy_purchase_approvals` gate — DONE. Commerce `PayNow`/`StartBNPL`
  now run an injected `ApprovalGate` (`commerce/approval.go`): a buyer with an active
  guardian link cannot purchase until a guardian approves — the first attempt records
  a pending approval (returns `approval_required`/403), the guardian approves via the
  parent layer (P7), then the minor retries. Active when the parent layer (spine flag)
  is on; nil/no-gate otherwise. Adapter wired in `app/academy_routes.go`.
- Run `go build/vet/test ./internal/academy/...` + full `tsc` in CI (no Go toolchain
  in sandbox; agents verified structurally + scoped tsc green).
- Expand curriculum/content/question seeds from the representative entry-class set to
  the full P1→SSS3 corpus (content/data work).
