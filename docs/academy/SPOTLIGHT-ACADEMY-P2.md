# Spotlight Academy — Phase 2 (curriculum spine + parent layer + EduPay v1)

Built on the Phase 0+1 base. Adds the learning backbone (adaptive progression),
the content/CMS production pipeline, the full parent layer, and EduPay v1 (school
fees, save-for-school pots, disbursement, scholarships). Gated by two new flags:
`FEATURE_ACADEMY_SPINE_ENABLED` (progression + content + parent) and
`FEATURE_ACADEMY_EDUPAY_ENABLED` (EduPay) — both under `FEATURE_ACADEMY_ENABLED`.

## What shipped

Backend — 4 new sub-packages under `internal/academy/` (each model/repo/service/
handler/Register + pure-function tests), wired into `RegisterAcademy` and gated:
- **progression** — builds learning paths from the curriculum tree (guarded step SM
  locked→available→in_progress→done), adaptive practice that targets weak objectives
  (mastery < configurable threshold), recommendations. Reuses `academy_mastery_records`
  **read-only** — no duplicated mastery logic; emits `academy_progress_events`.
- **edupay** — schools + fee schedules, save-for-school pots (append-only contributions,
  derived balance), disbursement SM `fee_due→funding→collected→disbursed→reconciled`
  (sources: pay / BNPL / pot / scholarship), scholarships. Money flows through
  **injected rails** (CollectRail / DisburseRail / BNPLRail — wire `finance/va` +
  payout at root; dev stubs otherwise); idempotent end-to-end; reconcile + audit.
- **content** — CMS publish SM `draft→review→approved→live→archived` (approved→live
  repackages the offline bundle manifest), content-production board
  (script→storyboard→shoot→edit→qa→publish), localizations.
- **parent** — child dashboards (mastery + progress + exam readiness across subjects),
  parent controls (screen-time/age/allowed-hours), progress reports, purchase
  approvals. Every guardian endpoint is **fail-closed** on the active guardian link.

Migration `20260815001100_academy_spine_edupay.sql` — additive: progression, EduPay,
content-production/localization, parent (controls/reports/approvals), notification
templates + RLS + RBAC (`academy.edupay`, `academy.notifications`).

Mobile (mock-first) — academy app grew 24→46 screens: learner L-set completed
(L2 streak, L7 transcript/notes, L8 interactive, L10 results, L11 adaptive practice,
L14 search, L15 bookmarks, L16 notes, L17 downloads, + "My path"), full parent set
P1–P13 incl. EduPay pay/pot, a Parent-area entry + recommendations rail on the hub.

Admin — academy console grew 8→13 modules: content/CMS, content-production board,
offline bundle builder, deepened full curriculum management, EduPay (schools/fees/
disbursements+reconcile/pots/scholarships), notifications/messaging. RBAC-gated;
sidebar + AcademyTabs updated.

## Golden rules honored

Reuse rails (wallet/VA/payout via injected interfaces; mastery records reused, not
forked); guarded state machines (path-step, disbursement, publish, production —
unit-tested allowed+illegal); append-only + idempotent money paths (pot contributions,
disbursements via `academy_idempotency_keys`); child-safety fail-closed guardian gate;
curriculum-as-data; RLS owner/guardian-scoped; full audit.

## Phase 2 DoD

A parent monitors a child across subjects (parent dashboards aggregate mastery +
progress + readiness), pays/saves school fees (EduPay pay + save-for-school pots →
disbursement SM), and the learner follows an adaptive path on curriculum content
(progression paths + adaptive practice on weak objectives). ✓ (UI is mock-first;
content corpus remains the representative entry-class seed from Phase 0.)

## Verification

Migrations dedup-checked (no duplicate timestamps); 65 academy backend files
brace-balanced, 11 Register functions, no within-package symbol collisions;
aggregator gated by `spineEnabled`/`eduPayEnabled`; admin `tsc --noEmit` exit 0;
mobile scoped `tsc` clean. Go `build/vet/test ./internal/academy/...` deferred to CI
(no Go toolchain in sandbox).

## Follow-ups

- Inject real `finance/va` + payout adapters into `edupay.RegisterAcademyEduPay`
  (currently dev stubs at the aggregator).
- Commerce should read `academy_purchase_approvals` state to actually gate minor
  orders (parent decision is recorded; the commerce gate wiring is the remaining seam).
- Phases 3–4 (trade credentials/earning-bridge, live/community, B2B2C schools/tutors)
  remain out of scope.
