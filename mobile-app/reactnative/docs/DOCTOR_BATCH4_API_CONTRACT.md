# Doctor API Contract — Batch 4 (sections O · P · Q · R)

Reference for the Frontend role. ADDITIVE to the Phase 1 / Phase 2 / Section B /
Phase 3 / Batch 1 / Batch 2 / Batch 3 contracts. All data is **demo data**
resolved with simulated latency (`wait()`); Phase C swaps bodies for live
endpoints + the `Idempotency-Key` header (each mutation carries a
`// TODO: Idempotency-Key` for the live wire-up). Money is always an integer in
**kobo**. Path alias is `@/` → `src/`. Use `import type` for type-only imports.

- Types:     `@/types/doctor.batch4`   (re-exports the primitives it reuses)
- API:       `@/api/doctor.batch4.api` (Frontend should NOT call these directly — use hooks)
- Hooks:     `@/features/doctor/hooks`  (same barrel as earlier phases)
- Constants: `@/features/doctor/constants` (same barrel; Batch 4 lists re-exported from `batch4`)

**Consolidation:** granular variants (every status, pending/approved/rejected,
sent/accepted/rejected, completed/missed, each escalation kind) are modelled as
states/data on top of a small set of entities. **Sections O, P and Q are mostly
reuse** of Phase 2 (claims / referrals / follow-ups). **Section R (emergency) is
DEMO and non-actionable** — no real dialing or dispatch; screens MUST surface
`EMERGENCY_DISCLAIMER`. See the Ownership Map for which spec entries are full
screens vs states vs reuse-existing.

---

## 1. Exported types (`@/types/doctor.batch4`)

**Re-exported from Phase 1 (`@/types/doctor`):** `PatientSummary`, `ChatAuthor`,
`HmoEligibility`, `EligibilityStatus`.
**From Phase 2 (`@/types/doctor.phase2`):** `HmoClaim`, `ClaimStatus`,
`ClaimLineItem`, `ClaimEvent`, `Specialist`, `SpecialistReferral`,
`ReferralStatus`, `ReferralAttachment`, `ReferralAttachmentKind`, `FollowUpPlan`,
`FollowUpKind`, `FollowUpStatus`, `SoapNote`, `DoctorPrescription`, `LabResult`.
**From Batch 2 (`@/types/doctor.batch2`):** `RedFlagWarning`, `RedFlagSeverity`.

### Section O — HMO / Insurance
`HmoBenefitLine`, `HmoPlanCoverage`, `PreAuthStatus`, `PreAuthRequest`,
`CoveredServiceKind`, `CoveredServiceStatus`, `CoveredService`,
`HmoSupportAuthor`, `HmoSupportMessage`, `HmoSupportThread`,
`FraudWarningSeverity`, `HmoFraudWarning`.

### Section P — Referral & Specialist Collaboration
`IncomingReferralStatus`, `IncomingReferral`, `OpinionKind`, `OpinionStatus`,
`OpinionRequest`, `CareTeamMessage`, `CareTeamThread`, `SharedCaseSummary`.

### Section Q — Follow-Up Care
`FollowUpEligibility`, `CarePlanMilestoneStatus`, `CarePlanMilestone`,
`LongTermCarePlan`, `ChronicTrend`, `ChronicMonitoringEntry`, `AdherenceLevel`,
`MedicationAdherenceCheck`.

### Section R — Emergency & Escalation (DEMO)
`EmergencyFacilityKind`, `EmergencyFacility`, `RedFlagAlert` (extends
`RedFlagWarning`), `EscalationKind`, `EscalationStatus`, `EmergencyEscalation`,
`EmergencyCaseRecord`.

### Mutation inputs / results
O: `RequestPreAuthInput/Result`, `SendHmoSupportMessageInput/Result`,
`AcknowledgeFraudWarningInput/Result`.
P: `AcceptReferralInput/Result`, `RejectReferralInput/Result`,
`RequestOpinionInput/Result`, `SendCareTeamMessageInput/Result`.
Q: `SetFollowUpReminderInput/Result`, `CompleteFollowUpInput/Result`,
`RecordAdherenceCheckInput/Result`, `SaveCarePlanInput/Result`.
R: `EscalateInput/Result` (shared by hospital + ambulance),
`NotifyEmergencyContactInput/Result`, `DocumentEmergencyCaseInput/Result`,
`ScheduleEmergencyFollowUpInput/Result`.

> Every `*Input` includes an `idempotencyKey: string`; hooks generate it, so
> Frontend passes `Omit<Input, 'idempotencyKey'>`. `CompleteFollowUpResult.status`
> is `'completed' | 'missed'` (the base `FollowUpStatus` has no `'missed'`).

---

## 2. API functions (`@/api/doctor.batch4.api`)

### Reads (resolve `DEMO_*`)
```ts
// Section O
getHmoPlanCoverage(patientId: string): Promise<HmoPlanCoverage>
getPreAuthRequests(status?: PreAuthStatus): Promise<PreAuthRequest[]>
getPreAuthRequest(id: string): Promise<PreAuthRequest | undefined>
getCoveredServices(patientId?: string): Promise<CoveredService[]>
getHmoSupportThread(threadId: string): Promise<HmoSupportThread>
getHmoFraudWarnings(): Promise<HmoFraudWarning[]>

// Section P
getIncomingReferrals(status?: IncomingReferralStatus): Promise<IncomingReferral[]>
getIncomingReferral(id: string): Promise<IncomingReferral | undefined>
getOpinionRequests(status?: OpinionStatus): Promise<OpinionRequest[]>
getOpinionRequest(id: string): Promise<OpinionRequest | undefined>
getCareTeamThread(threadId: string): Promise<CareTeamThread>
getSharedCaseSummary(caseRef: string): Promise<SharedCaseSummary>

// Section Q
getFollowUpEligibility(patientId: string, appointmentId?: string): Promise<FollowUpEligibility>
getLongTermCarePlans(patientId?: string): Promise<LongTermCarePlan[]>
getLongTermCarePlan(id: string): Promise<LongTermCarePlan | undefined>
getChronicMonitoring(patientId?: string): Promise<ChronicMonitoringEntry[]>
getAdherenceChecks(patientId?: string): Promise<MedicationAdherenceCheck[]>

// Section R (DEMO)
getEmergencyFacilities(kind?: EmergencyFacility['kind']): Promise<EmergencyFacility[]>
getRedFlagAlerts(patientId?: string): Promise<RedFlagAlert[]>
getEmergencyEscalations(patientId?: string): Promise<EmergencyEscalation[]>
getEmergencyCaseRecords(patientId?: string): Promise<EmergencyCaseRecord[]>
getEmergencyCaseRecord(id: string): Promise<EmergencyCaseRecord | undefined>
```

### Reads → return-type table
| Read fn | Returns |
|---------|---------|
| `getHmoPlanCoverage` | `HmoPlanCoverage` |
| `getPreAuthRequests` | `PreAuthRequest[]` |
| `getPreAuthRequest` | `PreAuthRequest \| undefined` |
| `getCoveredServices` | `CoveredService[]` |
| `getHmoSupportThread` | `HmoSupportThread` |
| `getHmoFraudWarnings` | `HmoFraudWarning[]` |
| `getIncomingReferrals` | `IncomingReferral[]` |
| `getIncomingReferral` | `IncomingReferral \| undefined` |
| `getOpinionRequests` | `OpinionRequest[]` |
| `getOpinionRequest` | `OpinionRequest \| undefined` |
| `getCareTeamThread` | `CareTeamThread` |
| `getSharedCaseSummary` | `SharedCaseSummary` |
| `getFollowUpEligibility` | `FollowUpEligibility` |
| `getLongTermCarePlans` | `LongTermCarePlan[]` |
| `getLongTermCarePlan` | `LongTermCarePlan \| undefined` |
| `getChronicMonitoring` | `ChronicMonitoringEntry[]` |
| `getAdherenceChecks` | `MedicationAdherenceCheck[]` |
| `getEmergencyFacilities` | `EmergencyFacility[]` |
| `getRedFlagAlerts` | `RedFlagAlert[]` |
| `getEmergencyEscalations` | `EmergencyEscalation[]` |
| `getEmergencyCaseRecords` | `EmergencyCaseRecord[]` |
| `getEmergencyCaseRecord` | `EmergencyCaseRecord \| undefined` |

### Mutations → return-type table (each carries an `Idempotency-Key` TODO)
| Mutation fn | Input | Returns |
|-------------|-------|---------|
| `requestPreAuth` | `RequestPreAuthInput` | `RequestPreAuthResult` |
| `sendHmoSupportMessage` | `SendHmoSupportMessageInput` | `SendHmoSupportMessageResult` |
| `acknowledgeFraudWarning` | `AcknowledgeFraudWarningInput` | `AcknowledgeFraudWarningResult` |
| `acceptReferral` | `AcceptReferralInput` | `AcceptReferralResult` |
| `rejectReferral` | `RejectReferralInput` | `RejectReferralResult` |
| `requestOpinion` | `RequestOpinionInput` | `RequestOpinionResult` |
| `sendCareTeamMessage` | `SendCareTeamMessageInput` | `SendCareTeamMessageResult` |
| `setFollowUpReminder` | `SetFollowUpReminderInput` | `SetFollowUpReminderResult` |
| `completeFollowUp` | `CompleteFollowUpInput` | `CompleteFollowUpResult` (`status: 'completed' \| 'missed'`) |
| `recordAdherenceCheck` | `RecordAdherenceCheckInput` | `RecordAdherenceCheckResult` |
| `saveCarePlan` | `SaveCarePlanInput` | `SaveCarePlanResult` |
| `escalateToHospital` | `EscalateInput` | `EscalateResult` (DEMO) |
| `escalateToAmbulance` | `EscalateInput` | `EscalateResult` (DEMO) |
| `notifyEmergencyContact` | `NotifyEmergencyContactInput` | `NotifyEmergencyContactResult` (DEMO) |
| `documentEmergencyCase` | `DocumentEmergencyCaseInput` | `DocumentEmergencyCaseResult` (DEMO) |
| `scheduleEmergencyFollowUp` | `ScheduleEmergencyFollowUpInput` | `ScheduleEmergencyFollowUpResult` (DEMO) |

> All Section R mutations are **non-actionable**: they resolve a demo result
> without placing a call, dispatching an ambulance, or sending a notification.

### REUSED API fns (Phase 1 / Phase 2 — call via their existing hooks, not here)
HMO claims: `submitClaim`, `disputeClaim`, claim reads (Phase 2).
Referrals: `createReferral`, `getReferrals`, `getReferral`, `getSpecialists`
(Phase 2). Follow-ups: `createFollowUp`, `getFollowUps`,
`reviewFollowUpRequest` (Phase 2). HMO eligibility reads (Phase 1).

### DEMO_* exports (used as `placeholderData`)
`DEMO_HMO_PLAN_COVERAGE`, `DEMO_PRE_AUTH_REQUESTS`, `DEMO_COVERED_SERVICES`,
`DEMO_HMO_SUPPORT_THREAD`, `DEMO_HMO_FRAUD_WARNINGS`, `DEMO_INCOMING_REFERRALS`,
`DEMO_OPINION_REQUESTS`, `DEMO_CARE_TEAM_THREAD`, `DEMO_SHARED_CASE_SUMMARY`,
`DEMO_FOLLOW_UP_ELIGIBILITY`, `DEMO_LONG_TERM_CARE_PLANS`,
`DEMO_CHRONIC_MONITORING`, `DEMO_ADHERENCE_CHECKS`, `DEMO_EMERGENCY_FACILITIES`,
`DEMO_RED_FLAG_ALERTS`, `DEMO_EMERGENCY_ESCALATIONS`,
`DEMO_EMERGENCY_CASE_RECORDS`.

---

## 3. Hooks (`@/features/doctor/hooks`)

Frontend calls these — not the API fns. Mutations take
`Omit<Input, 'idempotencyKey'>`; the key is auto-generated via
`generateIdempotencyKey()`. Queries wire `DEMO_*` as `placeholderData`.

### Section O — `useHmo.ts`
```ts
// queries
useHmoPlanCoverage(patientId: string)        // → HmoPlanCoverage   (enabled: !!patientId)
usePreAuthRequests(status?: PreAuthStatus)    // → PreAuthRequest[]
usePreAuthRequest(id: string)                 // → PreAuthRequest | undefined (enabled: !!id)
useCoveredServices(patientId?: string)        // → CoveredService[]
useHmoSupportThread(threadId: string)         // → HmoSupportThread  (enabled: !!threadId)
useHmoFraudWarnings()                         // → HmoFraudWarning[]
// mutations (Omit<Input,'idempotencyKey'>)
useRequestPreAuth()                           // mutate(RequestPreAuthInput w/o key)
useSendHmoSupportMessage()                    // mutate(SendHmoSupportMessageInput w/o key)
useAcknowledgeFraudWarning()                  // mutate(AcknowledgeFraudWarningInput w/o key)
```
> REUSES Phase 2 claim hooks `useHmoClaims`, `useSubmitClaim`, `useDisputeClaim`
> (claim list / submit preview / dispute), and Phase 1 HMO eligibility hooks.

### Section P — `useCollaboration.ts`
```ts
// queries
useIncomingReferrals(status?: IncomingReferralStatus)  // → IncomingReferral[]
useIncomingReferral(id: string)                        // → IncomingReferral | undefined (enabled: !!id)
useOpinionRequests(status?: OpinionStatus)             // → OpinionRequest[]
useOpinionRequest(id: string)                          // → OpinionRequest | undefined (enabled: !!id)
useCareTeamThread(threadId: string)                    // → CareTeamThread (enabled: !!threadId)
useSharedCaseSummary(caseRef: string)                  // → SharedCaseSummary (enabled: !!caseRef)
// mutations (Omit<Input,'idempotencyKey'>)
useAcceptReferral()                                    // mutate(AcceptReferralInput w/o key)
useRejectReferral()                                    // mutate(RejectReferralInput w/o key)
useRequestOpinion()                                    // mutate(RequestOpinionInput w/o key)
useSendCareTeamMessage()                               // mutate(SendCareTeamMessageInput w/o key)
```
> REUSES Phase 2 `useReferrals`, `useReferral`, `useCreateReferral`,
> `useSpecialists` (outgoing referral + specialist select/attach/sent flows).

### Section Q — `useFollowUpCare.ts`
```ts
// queries
useFollowUpEligibility(patientId: string, appointmentId?: string)  // → FollowUpEligibility (enabled: !!patientId)
useLongTermCarePlans(patientId?: string)                           // → LongTermCarePlan[]
useLongTermCarePlan(id: string)                                    // → LongTermCarePlan | undefined (enabled: !!id)
useChronicMonitoring(patientId?: string)                           // → ChronicMonitoringEntry[]
useAdherenceChecks(patientId?: string)                             // → MedicationAdherenceCheck[]
// mutations (Omit<Input,'idempotencyKey'>)
useSetFollowUpReminder()                                           // mutate(SetFollowUpReminderInput w/o key)
useCompleteFollowUp()                                              // mutate(CompleteFollowUpInput w/o key) → 'completed' | 'missed'
useRecordAdherenceCheck()                                          // mutate(RecordAdherenceCheckInput w/o key)
useSaveCarePlan()                                                  // mutate(SaveCarePlanInput w/o key)
```
> REUSES Phase 2 `useFollowUps`, `useCreateFollowUp`, `useReviewFollowUpRequest`
> (create / patient request / approve / reject base flows).

### Section R — `useEmergency.ts` (DEMO — non-actionable)
```ts
// queries
useEmergencyFacilities(kind?: EmergencyFacility['kind'])  // → EmergencyFacility[]
useRedFlagAlerts(patientId?: string)                      // → RedFlagAlert[]
useEmergencyEscalations(patientId?: string)               // → EmergencyEscalation[]
useEmergencyCaseRecords(patientId?: string)               // → EmergencyCaseRecord[]
useEmergencyCaseRecord(id: string)                        // → EmergencyCaseRecord | undefined (enabled: !!id)
// mutations (Omit<Input,'idempotencyKey'>) — DEMO, perform NO real action
useEscalateToHospital()                                   // mutate(EscalateInput w/o key)
useEscalateToAmbulance()                                  // mutate(EscalateInput w/o key)
useNotifyEmergencyContact()                               // mutate(NotifyEmergencyContactInput w/o key)
useDocumentEmergencyCase()                                // mutate(DocumentEmergencyCaseInput w/o key)
useScheduleEmergencyFollowUp()                            // mutate(ScheduleEmergencyFollowUpInput w/o key)
```
> Every emergency screen MUST render `EMERGENCY_DISCLAIMER`. No call is placed
> and no ambulance/hospital is dispatched. `useScheduleEmergencyFollowUp`
> invalidates the Phase 2 follow-up list.

---

## 4. Constants (`@/features/doctor/constants`, from `batch4`)

Section O: `PREAUTH_STATUS_LABELS`, `COVERED_STATUS_LABELS`,
`COVERED_SERVICE_KIND_LABELS`, `FRAUD_WARNING_SEVERITY_LABELS`,
`PREAUTH_SERVICE_OPTIONS`.
Section P: `INCOMING_REFERRAL_STATUS_LABELS`, `OPINION_TYPE_OPTIONS`,
`OPINION_STATUS_LABELS`, `REFERRAL_REJECTION_REASONS`.
Section Q: `ADHERENCE_OPTIONS`, `CHRONIC_TREND_LABELS`,
`CARE_PLAN_MILESTONE_STATUS_LABELS`, `CARE_PLAN_REVIEW_OPTIONS`,
`CHRONIC_CONDITION_OPTIONS`, `FOLLOWUP_WINDOW_OPTIONS`.
Section R: `ESCALATION_KIND_LABELS`, `ESCALATION_STATUS_LABELS`,
`EMERGENCY_FACILITY_KIND_LABELS`, **`EMERGENCY_DISCLAIMER`** (mandatory banner
copy for every emergency screen).

> Label maps are `{ label, tone }` where `tone` is a UI palette key
> (`success` / `warning` / `danger` / `info` / `muted`).
> REUSES (re-exported from `batch4` for a single import site, source of truth
> unchanged): `FOLLOW_UP_STATUS_LABELS`, `FOLLOW_UP_KIND_OPTIONS`,
> `REFERRAL_STATUS_LABELS`, `REFERRAL_URGENCY_OPTIONS`,
> `REFERRAL_ATTACHMENT_KIND_LABELS`, `REFERRAL_SPECIALTY_OPTIONS`,
> `CLAIM_STATUS_LABELS`, `HMO_PROVIDER_OPTIONS` (from `phase2`);
> `RED_FLAG_OPTIONS` (from `batch2`); `FREE_FOLLOW_UP_WINDOW_OPTIONS` (from
> `profile`). `FOLLOWUP_WINDOW_OPTIONS` is a documenting alias of the latter.

---

## 5. Loading / error / empty conventions

Same as earlier batches:
- **Loading:** queries return `isLoading`; `DEMO_*` are wired as `placeholderData`
  so screens render immediately with demo content.
- **Error:** queries expose `isError` / `error`; mutations expose
  `isError` / `error` / `isPending`.
- **Empty:** array fields are `[]` (never `null`); optional single objects are
  `undefined` (the `get…(id)` detail reads resolve `undefined` when not found:
  `getPreAuthRequest`, `getIncomingReferral`, `getOpinionRequest`,
  `getLongTermCarePlan`, `getEmergencyCaseRecord`).
- **Money:** integers in kobo; format with `formatKobo` (e.g.
  `HmoPlanCoverage.coPayKobo` / limit fields, `CoveredService.coPayKobo`,
  `PreAuthRequest.estimatedKobo`, `FollowUpEligibility.feeKobo`).
- **Emergency (Section R):** DEMO + non-actionable; screens MUST surface
  `EMERGENCY_DISCLAIMER` and must not imply a real call/dispatch occurred.
```
