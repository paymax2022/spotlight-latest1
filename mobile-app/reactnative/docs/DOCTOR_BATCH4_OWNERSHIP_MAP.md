# Doctor Batch 4 — File Ownership Map

Batch 4 = spec **sections O, P, Q, R**. This is **additive** to Phase 1,
Phase 2, Section B, Phase 3, Batch 1, Batch 2 and Batch 3: nothing in earlier
contracts is edited (only the hooks/constants barrels gain new export lines).
Money is always integers in **kobo**.

**Consolidation principle:** granular variants (each status, pending/approved/
rejected, sent/accepted/rejected, completed/missed, every escalation kind) are
modelled as **states/data** on top of a small set of entities, not as separate
entities or screens. The tables below mark each entry as a **full screen**, a
**STATE of** an existing/sibling screen, a **SHEET on** a screen, or a
**REUSES existing** route/hook. Sections O, P and Q lean heavily on **reuse of
Phase 2** (claims, referrals, follow-ups). Section R (emergency) is **DEMO and
non-actionable** — every screen must surface `EMERGENCY_DISCLAIMER`.

## Ownership boundaries (do not cross)

### BACKEND (data/type contract) — owns
- `src/types/doctor.batch4.ts`                          *(new)*
- `src/api/doctor.batch4.api.ts`                         *(new)*
- `src/features/doctor/hooks/useHmo.ts`                  *(new — Section O)*
- `src/features/doctor/hooks/useCollaboration.ts`        *(new — Section P)*
- `src/features/doctor/hooks/useFollowUpCare.ts`         *(new — Section Q)*
- `src/features/doctor/hooks/useEmergency.ts`            *(new — Section R)*
- `src/features/doctor/constants/batch4.ts`              *(new)*
- `src/features/doctor/hooks/index.ts`                   *(edited — additive export lines only)*
- `src/features/doctor/constants/index.ts`             *(edited — additive export line only)*

> Backend continues to own the Phase 1 / 2 / Section B / Phase 3 / Batch 1 / 2 / 3
> files unchanged.

### FRONTEND (screens/UI) — owns
- `app/(doctor)/**` (all route files), in particular the screens Batch 4 extends
  or adds (see "Proposed new routes" below):
  - `app/(doctor)/consult/[id]/hmo.tsx`        (Section O — covered-consult / coverage / co-pay, REUSE base)
  - `app/(doctor)/claims/*`                     (Section O — claims, REUSE Phase 2)
  - `app/(doctor)/referrals/*`                  (Section P — outgoing referrals, REUSE Phase 2)
  - `app/(doctor)/follow-ups/*`                 (Section Q — base follow-ups, REUSE Phase 2)
- `src/features/doctor/components/**`

### QA — owns
- `docs/QA_DOCTOR_BATCH4_REPORT.md`

> Frontend consumes Backend's hooks/types only — never imports from
> `doctor.batch4.api.ts` directly (use the hooks; `formatKobo` re-exported via
> the api is the exception). All money is kobo; format with `formatKobo`.

---

## Proposed new routes (genuinely new for Batch 4)

| Route | Section | Purpose |
|-------|---------|---------|
| `app/(doctor)/hmo/plan-coverage.tsx`        | O | Plan coverage summary (benefits / limits / co-pay) |
| `app/(doctor)/hmo/pre-auth.tsx`             | O | Pre-auth request list + new request |
| `app/(doctor)/hmo/pre-auth/[id].tsx`        | O | Pre-auth detail (pending/approved/rejected/limit) |
| `app/(doctor)/hmo/support.tsx`              | O | HMO support chat thread |
| `app/(doctor)/referrals/incoming.tsx`       | P | Incoming referrals inbox |
| `app/(doctor)/referrals/incoming/[id].tsx`  | P | Incoming referral case detail (accept/reject) |
| `app/(doctor)/referrals/[id]/care-team.tsx` | P | Care-team chat + shared case summary |
| `app/(doctor)/care-plans/index.tsx`         | Q | Long-term care plans + chronic monitoring + adherence list |
| `app/(doctor)/care-plans/new.tsx`           | Q | Create long-term care plan |
| `app/(doctor)/emergency/index.tsx`          | R | Emergency hub: red-flags, facilities, escalations (DEMO) |
| `app/(doctor)/emergency/[caseId].tsx`       | R | Emergency case record + documentation + follow-up (DEMO) |

> Opinion (specialist / second) requests REUSE `referrals/incoming.tsx` +
> `referrals/[id]/care-team.tsx` (no dedicated route). Adherence checks and
> chronic monitoring live as sections/sheets within `care-plans/index.tsx`.

---

## Reused existing work (do NOT recreate)

| Area | Existing asset | Reused hook / type |
|------|----------------|--------------------|
| HMO eligibility (base) | Phase 1 | `HmoEligibility`, `EligibilityStatus`, eligibility view on `consult/[id]/hmo.tsx` |
| HMO claims | Phase 2 | `HmoClaim`, `ClaimStatus`, `ClaimLineItem`, `ClaimEvent`, `useHmoClaims`, `useSubmitClaim`, `useDisputeClaim`, `app/(doctor)/claims/*` |
| Outgoing referrals + specialists | Phase 2 | `SpecialistReferral`, `ReferralStatus`, `ReferralAttachment`, `ReferralAttachmentKind`, `Specialist`, `useReferrals`, `useReferral`, `useCreateReferral`, `useSpecialists`, `app/(doctor)/referrals/*` |
| Base follow-up CRUD | Phase 2 | `FollowUpPlan`, `FollowUpKind`, `FollowUpStatus`, `useFollowUps`, `useCreateFollowUp`, `useReviewFollowUpRequest`, `app/(doctor)/follow-ups/*` |
| Red-flag warnings | Batch 2 | `RedFlagWarning`, `RedFlagSeverity` (extended by `RedFlagAlert`), `RED_FLAG_OPTIONS` |
| Patient / chat primitives | Phase 1 | `PatientSummary`, `ChatAuthor`, `SoapNote`, `DoctorPrescription`, `LabResult` |
| Constants (reused via barrel) | Phase 2 / Batch 2 / profile | `FOLLOW_UP_STATUS_LABELS`, `FOLLOW_UP_KIND_OPTIONS`, `REFERRAL_STATUS_LABELS`, `REFERRAL_URGENCY_OPTIONS`, `REFERRAL_ATTACHMENT_KIND_LABELS`, `REFERRAL_SPECIALTY_OPTIONS`, `CLAIM_STATUS_LABELS`, `HMO_PROVIDER_OPTIONS`, `RED_FLAG_OPTIONS`, `FREE_FOLLOW_UP_WINDOW_OPTIONS` (all re-exported from `batch4` for a single import site) |

---

## SECTION O — HMO / Insurance (19)

REUSE: HMO eligibility (Phase 1) on `consult/[id]/hmo.tsx`; claims via Phase 2
`useHmoClaims` / `useSubmitClaim` / `useDisputeClaim` on `claims/*`. NEW: plan
coverage, pre-authorisation, covered-service status, HMO support chat, fraud
warnings. Hooks: `useHmoPlanCoverage`, `usePreAuthRequests`, `usePreAuthRequest`,
`useCoveredServices`, `useHmoSupportThread`, `useHmoFraudWarnings`,
`useRequestPreAuth`, `useSendHmoSupportMessage`, `useAcknowledgeFraudWarning`.

| # | Spec entry | Ownership | Data / hook |
|---|-----------|-----------|-------------|
| O1 | HMO-covered consult detail | full screen `consult/[id]/hmo` (REUSE base) | `HmoEligibility` + `useCoveredServices` |
| O2 | eligibility view | STATE of `consult/[id]/hmo` | REUSES `HmoEligibility`, `EligibilityStatus` (Phase 1) |
| O3 | plan coverage summary | full screen `hmo/plan-coverage` | `useHmoPlanCoverage` (`HmoPlanCoverage`, `HmoBenefitLine[]`) |
| O4 | covered consult status | STATE of `consult/[id]/hmo` | `CoveredService` kind `consultation` + `COVERED_STATUS_LABELS` |
| O5 | co-pay notice | STATE (banner) of `consult/[id]/hmo` | `HmoPlanCoverage.coPayKobo` / `CoveredService.coPayKobo` (kobo) |
| O6 | pre-auth request | SHEET on `hmo/pre-auth` | `useRequestPreAuth` + `PREAUTH_SERVICE_OPTIONS` |
| O7 | approval pending | STATE of `hmo/pre-auth/[id]` | `PreAuthStatus === 'pending'` + `PREAUTH_STATUS_LABELS` |
| O8 | approval approved | STATE of `hmo/pre-auth/[id]` | `PreAuthStatus === 'approved'` |
| O9 | approval rejected | STATE of `hmo/pre-auth/[id]` | `PreAuthStatus === 'rejected'` |
| O10 | coverage-limit exceeded | STATE (banner) of `hmo/pre-auth/[id]` | `PreAuthStatus === 'limit_exceeded'` |
| O11 | covered rx status | STATE of `consult/[id]/hmo` | `CoveredService` kind `prescription` + `COVERED_STATUS_LABELS` |
| O12 | covered lab status | STATE of `consult/[id]/hmo` | `CoveredService` kind `lab` + `COVERED_STATUS_LABELS` |
| O13 | claim submission preview | SHEET on `claims` | REUSES Phase 2 `useSubmitClaim`, `HmoClaim`, `ClaimLineItem` |
| O14 | doctor service claim status | STATE of `claims` | REUSES `ClaimStatus` + `CLAIM_STATUS_LABELS` |
| O15 | claim approved | STATE of `claims` | REUSES `ClaimStatus === 'approved'` |
| O16 | claim rejected | STATE of `claims` | REUSES `ClaimStatus === 'rejected'` |
| O17 | claim dispute | SHEET on `claims` | REUSES Phase 2 `useDisputeClaim` |
| O18 | HMO support chat | full screen `hmo/support` | `useHmoSupportThread` + `useSendHmoSupportMessage` (`HmoSupportThread`, `HmoSupportMessage`) |
| O19 | HMO fraud warning | STATE (banner) / SHEET on `hmo/*` | `useHmoFraudWarnings` + `useAcknowledgeFraudWarning` (`HmoFraudWarning`) + `FRAUD_WARNING_SEVERITY_LABELS` |

---

## SECTION P — Referral & Specialist Collaboration (16)

REUSE: outgoing referrals + specialists via Phase 2 `useReferrals` /
`useCreateReferral` / `useSpecialists` on `referrals/*`. NEW: INCOMING referrals
(accept/reject), opinion requests, care-team chat, shared case summary. Hooks:
`useIncomingReferrals`, `useIncomingReferral`, `useOpinionRequests`,
`useOpinionRequest`, `useCareTeamThread`, `useSharedCaseSummary`,
`useAcceptReferral`, `useRejectReferral`, `useRequestOpinion`,
`useSendCareTeamMessage`.

| # | Spec entry | Ownership | Data / hook |
|---|-----------|-----------|-------------|
| P1 | refer to specialist | full screen `referrals` (REUSE) | REUSES Phase 2 `useCreateReferral` |
| P2 | select specialist | STATE of `referrals` | REUSES `useSpecialists`, `Specialist` + `REFERRAL_SPECIALTY_OPTIONS` |
| P3 | reason | STATE of `referrals` | REUSES `SpecialistReferral.reason` + `REFERRAL_URGENCY_OPTIONS` |
| P4 | attach notes | STATE of `referrals` | REUSES `ReferralAttachment` kind `note` + `REFERRAL_ATTACHMENT_KIND_LABELS` |
| P5 | attach lab results | STATE of `referrals` | REUSES `ReferralAttachment` kind `lab` |
| P6 | attach rx history | STATE of `referrals` | REUSES `ReferralAttachment` kind `prescription` |
| P7 | referral sent | STATE of `referrals` | REUSES `ReferralStatus === 'sent'` + `REFERRAL_STATUS_LABELS` |
| P8 | referral accepted | STATE of `referrals` | REUSES `ReferralStatus === 'accepted'` |
| P9 | referral rejected | STATE of `referrals` | REUSES `ReferralStatus === 'rejected'` |
| P10 | incoming referral | full screen `referrals/incoming` | `useIncomingReferrals` (`IncomingReferral[]`) + `INCOMING_REFERRAL_STATUS_LABELS` |
| P11 | referral case detail | full screen `referrals/incoming/[id]` | `useIncomingReferral` + `useAcceptReferral` / `useRejectReferral` (+ `REFERRAL_REJECTION_REASONS`) |
| P12 | specialist opinion request | SHEET on `referrals/incoming` | `useRequestOpinion` (kind `specialist`) + `OPINION_TYPE_OPTIONS` |
| P13 | second opinion request | SHEET on `referrals/incoming` | `useRequestOpinion` (kind `second`) |
| P14 | care team chat | full screen `referrals/[id]/care-team` | `useCareTeamThread` + `useSendCareTeamMessage` (`CareTeamThread`, `CareTeamMessage`) |
| P15 | shared case summary | STATE of `referrals/[id]/care-team` | `useSharedCaseSummary` (`SharedCaseSummary`) |
| P16 | referral history | STATE of `referrals` | REUSES Phase 2 `useReferrals`, `SpecialistReferral[]`; opinion history via `useOpinionRequests` (`OpinionRequest[]`) + `OPINION_STATUS_LABELS` |

---

## SECTION Q — Follow-Up Care (15)

REUSE: base follow-up CRUD via Phase 2 `useFollowUps` / `useCreateFollowUp` /
`useReviewFollowUpRequest` on `follow-ups/*`. NEW: eligibility, long-term care
plans, chronic monitoring, adherence checks, reminders, complete/missed. Hooks:
`useFollowUpEligibility`, `useLongTermCarePlans`, `useLongTermCarePlan`,
`useChronicMonitoring`, `useAdherenceChecks`, `useSetFollowUpReminder`,
`useCompleteFollowUp`, `useRecordAdherenceCheck`, `useSaveCarePlan`.

| # | Spec entry | Ownership | Data / hook |
|---|-----------|-----------|-------------|
| Q1 | create plan | full screen `follow-ups` (REUSE) | REUSES Phase 2 `useCreateFollowUp` |
| Q2 | date selection | STATE of `follow-ups` | REUSES `FollowUpPlan` date + `FOLLOW_UP_KIND_OPTIONS` |
| Q3 | reason | STATE of `follow-ups` | REUSES `FollowUpPlan.reason` |
| Q4 | free follow-up eligibility | STATE (banner) of `follow-ups` | `useFollowUpEligibility` (`FollowUpEligibility.freeEligible`) + `FREE_FOLLOW_UP_WINDOW_OPTIONS` |
| Q5 | paid follow-up requirement | STATE (banner) of `follow-ups` | `FollowUpEligibility` (paid; `feeKobo` in kobo) |
| Q6 | patient follow-up request | STATE of `follow-ups` | REUSES Phase 2 `useFollowUps` (request items) |
| Q7 | approve | STATE of `follow-ups` | REUSES Phase 2 `useReviewFollowUpRequest` (decision approve) |
| Q8 | reject | STATE of `follow-ups` | REUSES Phase 2 `useReviewFollowUpRequest` (decision reject) |
| Q9 | reminder | SHEET on `follow-ups` | `useSetFollowUpReminder` (`remindAt`) |
| Q10 | follow-up notes | STATE of `follow-ups` | `useCompleteFollowUp` (`outcomeNote`) |
| Q11 | completed | STATE of `follow-ups` | `useCompleteFollowUp` → `'completed'` + `FOLLOW_UP_STATUS_LABELS` |
| Q12 | missed | STATE of `follow-ups` | `useCompleteFollowUp` (`missed: true`) → `'missed'` |
| Q13 | long-term care plan | full screen `care-plans/index` + `care-plans/new` | `useLongTermCarePlans`, `useLongTermCarePlan`, `useSaveCarePlan` (`LongTermCarePlan`, `CarePlanMilestone`) + `CARE_PLAN_REVIEW_OPTIONS` / `CHRONIC_CONDITION_OPTIONS` |
| Q14 | chronic monitoring | SECTION of `care-plans/index` | `useChronicMonitoring` (`ChronicMonitoringEntry`) + `CHRONIC_TREND_LABELS` |
| Q15 | medication adherence check | SHEET on `care-plans/index` | `useAdherenceChecks` + `useRecordAdherenceCheck` (`MedicationAdherenceCheck`) + `ADHERENCE_OPTIONS` |

---

## SECTION R — Emergency & Escalation (10) — DEMO, non-actionable

All Section R data and actions are **DEMO**: no real dialing, no dispatch, no
notification is sent. Every emergency screen MUST surface `EMERGENCY_DISCLAIMER`.
Hooks: `useEmergencyFacilities`, `useRedFlagAlerts`, `useEmergencyEscalations`,
`useEmergencyCaseRecords`, `useEmergencyCaseRecord`, `useEscalateToHospital`,
`useEscalateToAmbulance`, `useNotifyEmergencyContact`, `useDocumentEmergencyCase`,
`useScheduleEmergencyFollowUp`.

| # | Spec entry | Ownership | Data / hook |
|---|-----------|-----------|-------------|
| R1 | emergency warning | STATE (banner) of `emergency/index` | `EMERGENCY_DISCLAIMER` (mandatory on every screen) |
| R2 | red-flag alert | STATE of `emergency/index` | `useRedFlagAlerts` (`RedFlagAlert` extends `RedFlagWarning`) + `RED_FLAG_OPTIONS` |
| R3 | recommend facility | SHEET on `emergency/index` | `useEmergencyFacilities` (`EmergencyFacility`) + `EMERGENCY_FACILITY_KIND_LABELS` |
| R4 | emergency referral note | STATE of `emergency/[caseId]` | `EmergencyCaseRecord` + `useDocumentEmergencyCase` (`actionsTaken`) |
| R5 | escalate to hospital | SHEET on `emergency/index` | `useEscalateToHospital` (`EscalateInput`) + `ESCALATION_KIND_LABELS` (DEMO) |
| R6 | escalate to ambulance | SHEET on `emergency/index` | `useEscalateToAmbulance` (`EscalateInput`) (DEMO) |
| R7 | notify emergency contact | SHEET on `emergency/index` | `useNotifyEmergencyContact` (DEMO — no message sent) |
| R8 | emergency disclaimer | STATE (banner) of all `emergency/*` | `EMERGENCY_DISCLAIMER` |
| R9 | emergency case documentation | full screen `emergency/[caseId]` | `useEmergencyCaseRecords`, `useEmergencyCaseRecord`, `useDocumentEmergencyCase` (`EmergencyCaseRecord`) |
| R10 | emergency follow-up | STATE of `emergency/[caseId]` | `useScheduleEmergencyFollowUp` → REUSES Phase 2 follow-up (`FollowUpStatus`) |

> Escalation status (`initiated` / `notified` / `acknowledged` / `cancelled`,
> `ESCALATION_STATUS_LABELS`) is rendered on `EmergencyEscalation` rows via
> `useEmergencyEscalations`. None of the R mutations perform a real-world action.

---

## Frontend notes — likely component fits

Reuse existing `src/features/doctor/components/**`; no new primitives needed for
most entries:
- **`StateView`** — loading / error / empty states for every list and detail.
- **`SectionCard`** — plan coverage benefit groups, shared case summary blocks,
  care-plan sections, emergency case record sections.
- **`InfoRow`** — labelled fields (benefit lines, co-pay, limits, facility
  contact, eligibility rows).
- **`StatusBadge`** — pre-auth / covered / claim / incoming-referral / opinion /
  care-plan-milestone / escalation status (drive tone from the `*_LABELS` maps).
- **`AlertCard`** — co-pay notice, coverage-limit exceeded, HMO fraud warning,
  paid follow-up requirement, red-flag alert, and the mandatory
  `EMERGENCY_DISCLAIMER` banner.
- **`SeverityFinding`** — `RedFlagAlert` / `HmoFraudWarning` severity rendering.
- **`StatusTimeline`** — pre-auth progression, escalation progression,
  care-plan milestones, claim events.
- **`ChatComposer` / `MessageBubble`** — HMO support chat, care-team chat
  (`HmoSupportMessage`, `CareTeamMessage`; author maps incl. `'hmo'`).
- **`EditableListCard`** — care-plan milestone editor (`SaveCarePlanInput.milestones`),
  red-flag selection in the emergency documentation flow.
