# Health Verticals — Build & Integration Plan (reconciled to the existing repo)

Executes `docs/prd/health/HEALTH-BUILD.md` (Pharmacy, Lab, Vet on a shared health platform) under the
HL-1…HL-12 + base NL-1…NL-12 invariants, BROWNFIELD into the existing repo. The doc proposes
`/modules/health/*` + `/internal/health/*`; this repo uses `backend/internal/<module>`,
`mobile-app/reactnative/app/<module>` + `src/features/<module>`, `frontend-admin/app/admin/<module>` — we
follow the REPO convention. Mobile design = `DESIGN-Mobile.md` (already encoded in `src/constants/*`).

## 1. Reuse map (verified on disk — DO NOT rebuild)
- **Escrow (HL-9):** `backend/internal/escrow` (Top-5) — `Hold(payer, ref, module, idemKey, amountKobo)` →
  `Release(escrowID, payee)` / `Refund(escrowID)`. Health payment = HELD on order → RELEASED on completion
  → REFUNDED on cancel. Exactly the primitive the doc asks for.
- **Scheduler:** `backend/internal/scheduler` (Top-5) — appointment/refill/fasting/results reminders + recurring jobs.
- **Credential / points / referral §7A:** `backend/internal/{credential,points}`, referral engine — reuse for
  provider credential expiry signalling, health-spend points, referral capture.
- **Money:** `finance/{ledger,wallet,settlement,tiers,kyc}` — ledger-derived balances (NL-8), payout KYC (HL-10).
- **Last-mile (the biggest reuse):** `backend/internal/transport` — medication delivery, phlebotomist
  dispatch, results courier are dispatch jobs on the existing delivery rail (HL-6 logistics legs), + MapService/PostGIS.
- **AuthZ + audit:** `services.RBACService` (`middleware.RequirePermission`/`RequireAuthContext`) +
  `services.audit_service` (immutable audit, HL-12/NL-12). Admin shell reuses these.
- **Routes:** `Register*(member, admin, pool, rbac)` aggregator like referral/stays/top5, wired in
  `app/finance_routes.go` under the health flags. Member `finance.Group("/health/<vertical>")`; admin
  `r.Group("/api/health/<vertical>/admin")` (helper `adminGroupTop5`).
- **Frontend-web proxy:** catch-all `app/api/v1/health/[...path]/route.ts` → `/api/finance/health/*`, gated
  by `featureFlags.health()`.
- **Mobile:** `app/health/*` + `src/features/health/*`; reuse `src/components/*`, `src/features/payments`
  (PaymentSheet), design tokens; repoint the Services-grid `pharmacy`/`laboratory`/`veterinary` entries to the
  new `/health/*` hubs (they're currently comingSoon placeholders).
- **Collision avoidance:** legacy `backend/internal/{doctor,pharmacy,telemedicine}` and `app/(doctor)` are
  LEFT UNTOUCHED. New comprehensive build is namespaced under `internal/health/*` (Go packages prefixed
  `health<x>` where a bare name would clash) and `app/health/*`.
- **Flags (DONE):** Go `FeatureHealthEnabled` + `FeatureHealth{Pharmacy,Lab,Vet}Enabled`; web
  `featureFlags.{health,healthPharmacy,healthLab,healthVet}()`.

## 2. Shared health platform (Phase 0; repo paths under backend/internal/health/)
| Component | Package | Responsibility |
|---|---|---|
| Provider onboarding + credential vault | `internal/health/providers` | VCN/PCN/MLSCN verify, NAFDAC map, expiry, capability grant on APPROVED |
| Records / patient+pet vault | `internal/health/records` | NDPA: encryption, signed-URL docs, access log, erasure; consent-gated |
| Consent & data-sharing | `internal/health/consent` | granular, revocable cross-vertical grants |
| Scheduling | `internal/health/scheduling` | availability/slots/types/reschedule/reminders (on scheduler) |
| E-prescription | `internal/health/rx` | issue→send→verify→**dispense-once**; POM gating; controlled excluded at MVP (HL-4) |
| Tele-consult | `internal/health/consult` | lobby/AV/chat, in-call notes, recording off by default |
| Intake forms | `internal/health/intake` | versioned triage/symptom/test-prep questionnaires |

## 3. HL invariants (release blockers — schema AND code)
HL-1 marketplace-not-provider · HL-2 credential-gated supply (auto-suspend on expiry) · HL-3 Rx discipline
(POM needs pharmacist-verified e-Rx; dispense-once server-side) · HL-4 controlled substances excluded at MVP ·
HL-5 NAFDAC-only catalog (reject at write) · HL-6 unbroken chain-of-custody (break→recollect; no result without
chain) · HL-7 critical-result human escalation (never silent) · HL-8 health data sensitive NDPA (consent,
minimisation, encryption, signed-URL, access log, erasure) · HL-9 money held→released→refunded (ledger,
idempotent) · HL-10 payout KYC + AML · HL-11 emergency safety (tele ≠ emergency; SOS routes in-person) ·
HL-12 immutable audit on every clinical/state/config change. Health-BNPL OFF by default.

## 4. State machines (guarded transitions + atomic side effects + audit; HEALTH-BUILD §5)
ProviderApplication: DRAFT→SUBMITTED→UNDER_REVIEW↔NEEDS_INFO→APPROVED(↔SUSPENDED)|REJECTED (on APPROVED:
idempotent capability grant). Appointment: REQUESTED→ACCEPTED→CONFIRMED→IN_PROGRESS→COMPLETED; →CANCELLED|NO_SHOW;
CONFIRMED→RESCHEDULED→CONFIRMED. Consult: SCHEDULED→IN_PROGRESS→COMPLETED (emit note/Rx/LabOrder).
Prescription: ISSUED→SENT_TO_PHARMACY→VERIFYING→VERIFIED→DISPENSED→FULFILLED; VERIFYING→REJECTED; DISPENSED
terminal-once. PharmacyOrder: CREATED→[RX_PENDING]→CONFIRMED→DISPENSED→IN_DELIVERY|READY_FOR_PICKUP→
DELIVERED|COLLECTED→CLOSED; pre-DISPENSED→CANCELLED→REFUNDED (HELD→RELEASE→REFUND). LabOrder:
CREATED→SCHEDULED→SAMPLE_COLLECTED→IN_TRANSIT→ACCESSIONED→PROCESSING→RESULT_READY→RELEASED→CLOSED;
RESULT_READY(critical)→ESCALATED→RELEASED. Sample/Custody: COLLECTED→IN_CUSTODY→HANDED_OVER→ACCESSIONED;
break→BREACHED→RECOLLECT_REQUIRED.

## 5. Shared DB contract (P0-B owns; verticals reference — additive, RLS, FKs auth.users(id), kobo BIGINT, PostGIS)
health_providers, health_provider_applications, health_credential_docs, health_records (patient+pet subjects),
health_record_docs (signed-URL refs), health_record_access_log, health_consents, health_appointments,
health_consults, health_clinical_notes, health_prescriptions, health_prescription_items, health_intake_schemas,
health_intake_responses. Verticals add: pharmacy_products(NAFDAC), pharmacy_orders, pharmacy_order_lines,
dispense_records; lab_tests, lab_packages, lab_orders, lab_samples, lab_custody_events, lab_results; pets,
vet_appointments (or reuse health_appointments with subject=pet), vaccination_schedules. RBAC: health.*
(provider onboarding/admin), health.pharmacy.*, health.lab.*, health.vet.* (+ object-level checks in services:
patient owns own records; provider scoped to own org).

## 6. Phasing / swarm split
P0: **P0-B** shared backend (7 components) + **P0-M** shared mobile (health hub/records/consent/intake).
P1 **Pharmacy** (BE+M+ADM) · P2 **Laboratory** (BE+M+ADM) · P3 **Veterinary** (BE+M+ADM). Verticals reference
P0 packages + escrow/scheduler/transport. Orchestrator: Register fns in finance_routes.go, frontend-web proxy,
Services grid repoint, admin sidebar, care-loop handoffs, health-ci.yml, trackers.

## 7. DoD (HEALTH-BUILD §10): invariants in schema+code; guarded transitions; object-level authZ + NDPA
access-logging on record reads; money held→released→refunded ledger+idempotent; HL/NL verified; signed-URL
docs, PII never logged; immutable audit; FE all states + no dead-ends; state-machine+authZ+NDPA tests; mock/live
switch; gofmt/tsc clean; CI build/test + tsc + additive-migration guard.
