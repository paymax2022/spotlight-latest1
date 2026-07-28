# PAYMAX-HEALTH-BUILD.md
### Build spec for Claude Code — Veterinary, Pharmacy & Laboratory verticals

> **Purpose.** A self-contained, executable specification for building the three Paymax Health verticals
> **into the existing Spotlight/Paymax super-app**. Read this with the repo's root **`CLAUDE.md`**
> (architecture + base safety invariants `NL-1…NL-12`) and the engineering skills
> (`backend-engineering`, `frontend-engineering`, `qa-engineering`). Where this file says "reuse", call
> the existing platform service — do **not** re-implement it. Work top-to-bottom; build the shared health
> platform (Phase 0) before any vertical.

---

## 0. How Claude Code should use this file

1. Read root `CLAUDE.md` first (single-identity capability model, ledger-money, RBAC, idempotency,
   audit, NL invariants). This file **extends** it with health-specific rules.
2. Build in phase order: **Phase 0 (shared health platform) → Phase 1 Pharmacy → Phase 2 Laboratory →
   Phase 3 Veterinary.** Do not start a vertical before its shared dependencies exist.
3. For every task follow the **Definition of Done** (§10) and verify the **Health invariants `HL-1…HL-12`**
   (§4). Any violation is a release blocker.
4. New code lives under `/modules/health/<vertical>` and `/internal/health/<component>`. Reused platform
   services are imported, never copied.
5. Everything is **feature-flagged** (`health.pharmacy`, `health.lab`, `health.vet`) for staged rollout.

---

## 1. What we are building

Three verticals that form one **connected care loop**:

```
 Consult (vet / pharmacist)
        │  produces
        ├──► e-Prescription ──► PHARMACY ──► dispense ──► last-mile delivery / pickup
        └──► Lab Order ───────► LABORATORY ─► sample collect (home/walk-in) ─► result
                                                              │
   Health Records Vault ◄───────────────────────────────────┘  (consent-gated)
        │
        └──► shared back to clinician ──► follow-up booking
```

**Posture:** Paymax is the **marketplace/booking/payment/logistics/records** layer. Licensed partners
(VCN vets, PCN pharmacies, MLSCN labs) deliver all regulated care. Paymax never diagnoses, dispenses,
or tests.

---

## 2. Architecture & integration into the existing super-app

- **Stack:** Go backend, React Native client, PostgreSQL + **PostGIS (already present)**.
- **Identity:** ONE user identity that accumulates **capabilities**. Add new provider capabilities
  `vet`, `pharmacy`, `pharmacist`, `lab`, `lab_scientist`, `phlebotomist` — each gated on credential
  verification. At most one capability per `(domain, type)` (unique constraint). Patients use the base
  consumer identity. **Do not create parallel provider accounts.**
- **Code layout (proposed):**
  ```
  /modules/health/
     pharmacy/   lab/   vet/        # vertical features (BE + FE)
     shared/                        # health hub, records vault UI, consent, intake forms
  /internal/health/
     providers/   # onboarding + credential vault
     records/     # patient/pet records vault (NDPA)
     consult/     # tele-consult engine
     rx/          # e-prescription engine
     scheduling/  # appointment + slots
     intake/      # schema-driven questionnaires
     consent/     # consent + data-sharing manager
  ```

### REUSE MAP — existing rails to call (never rebuild)

| Need | Reuse this existing service |
|------|------------------------------|
| Patient payments | Wallet + **append-only ledger** (NL-8) |
| Provider settlement | Payouts / disbursement (+ payout KYC) |
| Hold payment until service delivered | **Escrow/funds-hold primitive** (`/internal/escrow` from Top-5): hold on order → release on completion → refund on cancel |
| Identity / verification | SSO + tiered KYC |
| Nearby provider, home-visit dispatch, courier routing | **MapService abstraction + PostGIS** (transport module) |
| Medication delivery, sample pickup, results courier | **Last-mile delivery + partner/driver app** (transport module) |
| Reminders (refill, appointment, fasting, results) | Notifications (push/SMS) |
| Recurring reminders / scheduled jobs | Scheduler (`/internal/scheduler` from Top-5) |
| Earn points on health spend, referral capture | Points ledger + Referral §7A (Top-5) |
| Admin RBAC + immutable audit | Admin shell (`/internal/admin` from Top-5) |
| Assisted booking / cash | Agent network |

> The transport module already gives us routing + last-mile fulfilment. That is the single biggest reuse:
> medication delivery, phlebotomist dispatch, and results courier are **dispatch jobs on the existing
> delivery rail**, not a new build.

---

## 3. Shared health platform (Phase 0 — build first)

Net-new shared components every vertical depends on:

| Component | Package | Responsibility |
|-----------|---------|----------------|
| Provider onboarding + credential vault | `/internal/health/providers` | License capture & verification (VCN/PCN/MLSCN), NAFDAC mapping, expiry tracking, capability grant on approval |
| Health records / patient vault | `/internal/health/records` | Patients **and pets**, prescriptions, results, history; NDPA-controlled, consented, signed-URL docs |
| Tele-consult engine | `/internal/health/consult` | Video/voice/chat, lobby, in-call notes, recording policy (off by default) |
| E-prescription engine | `/internal/health/rx` | Issue → send → verify → **dispense-once**; POM gating; controlled-substance controls; audit |
| Scheduling engine | `/internal/health/scheduling` | Provider availability, slots, tele/home/clinic types, reschedule/cancel, reminders |
| Schema-driven intake forms | `/internal/health/intake` | Versioned triage/symptom & test-prep questionnaires |
| Consent & data-sharing manager | `/internal/health/consent` | Granular, revocable consent for cross-vertical sharing (vet ↔ pharmacy ↔ lab ↔ owner) |

---

## 4. HEALTH SAFETY INVARIANTS (`HL-1…HL-12`) — non-negotiable

Extend the base `NL-1…NL-12` in `CLAUDE.md`. Any violation blocks release.

- **HL-1 Marketplace, not provider.** Paymax never diagnoses, prescribes, dispenses, or tests. Every
  clinical action is performed by the verified licensed partner.
- **HL-2 Credential-gated supply.** No provider is discoverable or active until verification passes
  (VCN / PCN+premises / MLSCN+scientist; products mapped to NAFDAC registration). Auto-suspend on expiry.
- **HL-3 Prescription discipline.** POM items require a valid e-prescription **verified by a licensed
  pharmacist** before fulfilment. `dispense-once` enforced server-side (a prescription cannot be filled twice).
- **HL-4 Controlled substances.** Restricted or **excluded at MVP**. If enabled later: extra auth, statutory
  register, and immutable audit are mandatory.
- **HL-5 NAFDAC-only catalog.** Only NAFDAC-registered products may be listed; unregistered/banned items
  are rejected at write time, not just hidden.
- **HL-6 Chain-of-custody integrity.** Every lab sample is tracked collection → accession with an immutable
  custody log; any break forces re-collection. No result without an unbroken chain.
- **HL-7 Critical-result escalation.** Abnormal/critical values trigger a defined **human** escalation
  protocol (notify patient + clinician), never a silent in-app flag.
- **HL-8 Health data = sensitive (NDPA 2023).** Explicit consent, data minimisation, encryption at
  rest/in transit, signed-URL document delivery, access logging, right-to-erasure. Cross-vertical sharing
  requires an active consent grant.
- **HL-9 Money is held then released.** Patient payment is captured to a held balance on order, released to
  the provider **on completion**, refunded on cancellation — all ledger-backed and idempotent (inherits
  NL-8/NL-9).
- **HL-10 Payout gating.** Provider payouts require the correct KYC tier; AML checks on settlements.
- **HL-11 Emergency safety.** Tele-consult is not a substitute for emergency care; SOS/emergency paths
  route to the nearest in-person option with clear disclaimers.
- **HL-12 Immutable audit.** Every clinical note, prescription, dispense, result release, state transition,
  and config change writes an immutable audit entry (actor/entity/action/before-after/timestamp).

> **Health-BNPL** ("pay later" on a bill) is **off by default**; it triggers the FCCPC DEON regime and
> must be partner-powered and separately approved (see NL invariants).

---

## 5. Data model & state machines

### Core entities
`Patient` (consumer identity) · `Pet` · `Provider` (capability: vet/pharmacy/lab + sub-roles) ·
`ProviderApplication` · `CredentialDoc` · `Appointment` · `Consult` · `ClinicalNote` · `Prescription` ·
`PrescriptionItem` · `Product` (NAFDAC ref) · `PharmacyOrder` · `OrderLine` · `DispenseRecord` ·
`Test` / `TestPackage` · `LabOrder` · `Sample` · `ChainOfCustodyEvent` · `Result` · `Phlebotomist` ·
`Delivery` (ref to transport) · `Consent` · `Payment`/`LedgerEntry` · `Payout` · `AuditEntry`.

Model identity/capabilities and separate the **application** (review state) from the **capability** it
grants. Enforce invariants in schema (unique keys, FKs, checks) AND code.

### State machines (implement as guarded transitions; side effects atomic; audit every transition)

```
ProviderApplication: DRAFT → SUBMITTED → UNDER_REVIEW
                     UNDER_REVIEW ↔ NEEDS_INFO
                     UNDER_REVIEW → APPROVED → (SUSPENDED ↔ APPROVED)
                     UNDER_REVIEW → REJECTED
   on APPROVED: idempotently grant provider capability + role, unlock discoverability, audit.

Appointment: REQUESTED → ACCEPTED → CONFIRMED → IN_PROGRESS → COMPLETED
             (any) → CANCELLED | NO_SHOW ; CONFIRMED → RESCHEDULED → CONFIRMED

Consult: SCHEDULED → IN_PROGRESS → COMPLETED
   on COMPLETED: persist ClinicalNote; optionally emit Prescription and/or LabOrder.

Prescription: ISSUED → SENT_TO_PHARMACY → VERIFYING → VERIFIED → DISPENSED → FULFILLED
              VERIFYING → REJECTED ; invariant: DISPENSED is terminal-once (no re-dispense).

PharmacyOrder: CREATED → [RX_PENDING_VERIFICATION] → CONFIRMED → DISPENSED
               → IN_DELIVERY | READY_FOR_PICKUP → DELIVERED | COLLECTED → CLOSED
               (any pre-DISPENSED) → CANCELLED → REFUNDED
   payment: HELD on CREATED → RELEASED on DELIVERED/COLLECTED → REFUNDED on CANCELLED.

LabOrder: CREATED → SCHEDULED → SAMPLE_COLLECTED → IN_TRANSIT → ACCESSIONED
          → PROCESSING → RESULT_READY → RELEASED → CLOSED
          RESULT_READY(critical) → ESCALATED → RELEASED
   payment: HELD on CREATED → RELEASED on RELEASED → REFUNDED on CANCELLED.

Sample / ChainOfCustody: COLLECTED → IN_CUSTODY → HANDED_OVER → ACCESSIONED
          (break detected) → BREACHED → RECOLLECT_REQUIRED
```

---

## 6. API surface (resource + intent; versioned; field-level validation; object-level authZ on all)

**Shared**
```
POST /v1/health/providers/applications            # start onboarding
POST /v1/health/providers/applications/{id}/submit
POST /v1/health/providers/applications/{id}/decision   # admin: approve/reject/need-info
GET  /v1/health/records/{subjectId}               # consent-checked
POST /v1/health/consent                           # grant/revoke sharing
POST /v1/health/intake/{schemaId}/responses
POST /v1/health/consults/{id}/notes
POST /v1/health/prescriptions                      # issue (vet/clinician)
```
**Pharmacy**
```
POST /v1/health/pharmacy/prescriptions/upload
POST /v1/health/pharmacy/prescriptions/{id}/verify   # pharmacist: approve/clarify/reject
GET  /v1/health/pharmacy/products                    # catalog (NAFDAC-gated, Rx flag)
POST /v1/health/pharmacy/orders                      # payment HELD
POST /v1/health/pharmacy/orders/{id}/dispense        # pharmacist
POST /v1/health/pharmacy/orders/{id}/dispatch        # creates Delivery on transport rail
POST /v1/health/pharmacy/orders/{id}/complete        # release payment
```
**Laboratory**
```
GET  /v1/health/lab/tests
POST /v1/health/lab/orders                           # walk-in or home; payment HELD
POST /v1/health/lab/orders/{id}/collect              # phlebotomist: sample + custody
POST /v1/health/lab/samples/{id}/accession           # lab intake
POST /v1/health/lab/orders/{id}/results              # scientist enter + validate
POST /v1/health/lab/orders/{id}/release              # sign-off → vault; release payment
```
**Veterinary**
```
POST /v1/health/vet/pets
GET  /v1/health/vet/vets                              # map/list discovery
POST /v1/health/vet/appointments                      # tele/home/clinic; payment HELD
POST /v1/health/vet/appointments/{id}/accept
POST /v1/health/vet/consults/{id}/start | /complete
POST /v1/health/vet/appointments/{id}/dispatch        # home visit on transport rail
```

---

## 7. Module specifications

### 7A. Pharmacy (`health.pharmacy`)

**Customer screens (~18):** Pharmacy home · Upload/scan Rx · Rx status · Medicine search · Product detail
(NAFDAC, Rx flag) · Cart · Pharmacy selection (map) · Checkout (delivery/pickup) · Delivery tracking ·
Pickup code/QR · Pharmacist consult · Medication list/adherence · Refill management · Rx wallet · Order
history · Reorder · Ratings · Health-BNPL (flagged/off).

**Provider screens (~11):** Onboarding & PCN/premises verify · Catalog/inventory · Orders queue · Rx
verification (approve/clarify/reject) · Controlled-substance log · Dispense & pack · Handoff to delivery/
pickup · Pharmacist consult · Stock alerts · Earnings & payouts · Reviews.

**Admin:** PCN audit · catalog/NAFDAC governance · Rx & controlled audit · order/delivery oversight ·
pricing policy · pharmacovigilance/recall · payouts · reporting.

**Invariants enforced:** HL-1,2,3,4,5,8,9,10,12. **Flows:** Rx fulfilment; OTC order; refill loop.

### 7B. Laboratory (`health.lab`)

**Customer screens (~17):** Lab home · Test catalog · Test/package detail (prep, TAT) · Health packages ·
Lab/collection selection (map) · Book test · Home-collection scheduling · Checkout · Phlebotomist tracking ·
Collection confirmation · Test status · Results viewer (reference ranges) · Results interpretation handoff ·
Share results (consent) · Reports/records vault · Reorder/screening reminders · Ratings.

**Provider screens (~13):** Lab onboarding & MLSCN verify · Test catalog & pricing · Orders/samples queue ·
Sample accessioning · Result entry & validation · Result release (sign-off) · Earnings & payouts · Reviews ·
*(Phlebotomist)* onboarding · assignments/route (map) · collection checklist · chain-of-custody · drop-off.

**Admin:** MLSCN audit · catalog governance · chain-of-custody oversight · results audit & release controls ·
critical-result escalation · phlebotomist management · payouts · reporting.

**Invariants enforced:** HL-1,2,6,7,8,9,10,12. **Flows:** home collection; walk-in; critical-result escalation.

### 7C. Veterinary (`health.vet`)

**Customer screens (~20):** Vet hub/My Pets · Add/edit pet · Pet health record · Find a vet (map) · Vet
profile · Triage intake · Book appointment · Checkout · Tele-consult lobby · Tele-consult (A/V+chat) ·
Consult summary · E-prescription view · Order pet lab test · Vaccination scheduler · Home-visit tracking ·
Follow-up booking · Appointments/history · Emergency vet (SOS) · Ratings · Pet meds & refills.

**Provider screens (~13):** Onboarding & VCN verify · Profile & services · Availability/calendar ·
Appointment requests · Patient (pet) chart · Tele-consult screen · Consult notes (SOAP) · Issue
e-prescription · Order lab test · Home-visit navigation (map) · Earnings & payouts · Reviews · Specialist referral.

**Admin:** VCN audit · service/fee governance · appointment oversight · e-prescription audit · payouts ·
content/credential moderation · reporting.

**Invariants enforced:** HL-1,2,3,8,9,10,11,12. **Flows:** tele-consult; home visit; care handoff.

---

## 8. Build plan (phases · epics · story points)

SP scale 1/2/3/5/8/13. Build shared platform first; then verticals in rollout order. **Total ≈ 200 SP.**

### PHASE 0 — Shared health platform — ≈ 60 SP
- `[S]` Provider onboarding + credential vault (state machine, license verify, expiry, capability grant) — **13**
- `[S]` Health records / patient+pet vault (NDPA: encryption, signed-URL, access log, erasure) — **13**
- `[S]` Consent & data-sharing manager (granular, revocable) — **5**
- `[S]` Scheduling engine (availability, slots, types, reschedule, reminders) — **8**
- `[S]` E-prescription engine (issue→verify→dispense-once; POM gating; audit) — **8**
- `[S]` Tele-consult engine (lobby, A/V, in-call notes) — **8**
- `[S]` Schema-driven intake forms (versioned) — **5**
- `[T]` State-machine + authZ + NDPA-access tests across all shared components.
**Exit:** a provider can onboard + get verified; a patient/pet record exists with consent and access logging;
a prescription can be issued and is dispense-once; CI green.

### PHASE 1 — Pharmacy — ≈ 50 SP
- `[BE]` Catalog + NAFDAC gating + Rx-required flag (config-driven) — **8**
- `[BE]` PharmacyOrder state machine + **payment HELD→RELEASE→REFUND** on escrow primitive — **8**
- `[BE]` Pharmacist Rx verification workflow (HL-3) + controlled-substance guard (HL-4) — **5**
- `[BE]` Dispense + **dispatch on last-mile rail** + pickup code — **5**
- `[FE]` Customer: upload-Rx, search, product, cart, checkout, tracking, refills (~18 screens) — **8**
- `[FE]` Provider: orders queue, Rx verify, dispense, handoff, consult (~11 screens) — **5**
- `[ADM]` PCN audit, catalog governance, Rx/controlled audit, recall, payouts — **5**
- `[T]` Rx-verification gating, dispense-once, NAFDAC block, payment hold/release, delivery handoff — **3**
**Exit:** upload-Rx → pharmacist verify → dispense → last-mile delivery/pickup → payment released; refills fire.

### PHASE 2 — Laboratory — ≈ 50 SP
- `[BE]` Test catalog + packages (prep, TAT, price) — **5**
- `[BE]` LabOrder state machine + payment hold/release — **5**
- `[BE]` Sample + **chain-of-custody** engine (HL-6) + breach→recollect — **8**
- `[BE]` Result entry/validation + scientist **sign-off & release** (HL-7 critical escalation) — **8**
- `[BE]` Phlebotomist dispatch + route on **MapService/last-mile** — **5**
- `[FE]` Customer: catalog, book, home-collection, tracking, secure results viewer, share (~17) — **8**
- `[FE]` Provider/phlebotomist: queue, accession, result entry/release, collection/custody (~13) — **5**
- `[ADM]` MLSCN audit, custody oversight, release controls, escalation, payouts — **5**
- `[T]` Chain-of-custody integrity, critical-result escalation, results access-control (NDPA) — **3**
**Exit:** home/walk-in booking → collection w/ custody → accession → result → sign-off release to vault;
critical results escalate; payment released.

### PHASE 3 — Veterinary — ≈ 40 SP
- `[BE]` Pet profiles + pet health records (reuse vault) — **5**
- `[BE]` Vet discovery (map) + Appointment state machine (tele/home/clinic) + payment hold/release — **8**
- `[BE]` Tele-consult wiring + SOAP notes + e-prescription + pet lab order — **5**
- `[BE]` Vaccination scheduler + reminders — **3**
- `[FE]` Customer: My Pets, find-a-vet, booking, tele-consult, Rx view, SOS (~20) — **8**
- `[FE]` Provider: availability, requests, chart, consult, prescribe, home-nav (~13) — **5**
- `[ADM]` VCN audit, service/fee governance, e-Rx audit, payouts — **3**
- `[T]` Appointment lifecycle, prescribe→pharmacy handoff, emergency routing — **3**
**Exit:** find vet → book tele/home → consult → Rx/lab order → handoff to Pharmacy/Lab → follow-up.

### Care-loop integration (run continuously, finalise after Phase 3) — ≈ tracked in each phase
- Consult → Prescription → Pharmacy handoff (live after P1+P3).
- Consult → LabOrder → Lab handoff → result → vault (live after P2).
- Consent-gated result share back to clinician → follow-up booking.

---

## 9. Cross-cutting acceptance gates (every phase)
- [ ] `HL-1…HL-12` + base `NL-1…NL-12` verified for shipped code (PR-template checklist).
- [ ] State machines: allowed + rejected transitions tested; side effects + audit asserted.
- [ ] Money: hold/release/refund ledger reconciliation + idempotency/double-submit tests.
- [ ] AuthZ: allowed + denied + **object-level** ("patient A can't read patient B's results") on every route.
- [ ] NDPA: access-logging on every record read; consent enforced on cross-vertical share; signed-URL docs.
- [ ] Credential gating: unverified/expired provider cannot be discoverable or transact (negative tests).
- [ ] Feature-flagged + staged rollout; reversible.

## 10. Definition of Done (per task)
- [ ] Domain invariants in schema (constraints) AND code · guarded transitions, no raw status writes
- [ ] AuthN + object-level AuthZ on every endpoint · input validated at boundary, field-level errors
- [ ] Money on ledger; held→released→refunded; transactional + idempotent
- [ ] Relevant `HL-`/`NL-` invariants verified · immutable audit written
- [ ] Sensitive data encrypted; documents via signed URL; PII/secrets never logged; access logged
- [ ] FE handles loading/empty/error/unauthorized/not-approved; no double-submit; no dead-ends
- [ ] Tests cover state machine + authZ + NDPA-access paths; CI green

## 11. Testing strategy
Pyramid: many unit (validation, transitions, calculations), fewer integration (DB, API with real test DB
via containers, transport/wallet adapters mocked at the network edge), few e2e smoke journeys (Rx
fulfilment, home-collection→result, tele-consult→prescription). Deepest coverage on the critical paths:
**payments, prescriptions, results/chain-of-custody, credential gating, consent/NDPA access.** Every fixed
bug gets a regression test. CI blocks merge on unit+integration failure; deploy runs smoke + security scans.

## 12. First Claude Code tasks (start here)
1. Scaffold `/internal/health/providers` — onboarding state machine + credential vault + capability grant,
   with the PR template embedding the `HL-1…HL-12` checklist. Full test suite.
2. Scaffold `/internal/health/records` + `/internal/health/consent` — NDPA-compliant vault (encryption,
   signed-URL, access log, erasure) with consent-gated reads. Full test suite.
3. Scaffold `/internal/health/rx` — e-prescription engine with **dispense-once** + POM gating as the
   reference for invariant enforcement.
4. Then begin **Phase 1 Pharmacy**, using these as the foundation.

---
*Companion files:* root `CLAUDE.md` (base architecture + `NL` invariants), `BUILD-PLAN.md` (Top-5 modules),
and `Paymax_Health_Verticals_PRD.docx` (full product detail & screen rationale).
