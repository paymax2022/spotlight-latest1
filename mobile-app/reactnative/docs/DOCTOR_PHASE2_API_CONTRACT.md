# Doctor API Contract — Phase 2

Reference for the Frontend role. ADDITIVE to the Phase 1 contract
(`docs/DOCTOR_API_CONTRACT.md`). All data is **demo data** resolved with
simulated latency (`wait()`); Phase C swaps bodies for live endpoints + the
`Idempotency-Key` header. Money is always an integer in **kobo**. Path alias is
`@/` → `src/`. Use `import type` for type-only imports.

- Types:     `@/types/doctor.phase2`   (re-exports the Phase 1 primitives it reuses)
- API:       `@/api/doctor.phase2.api` (Frontend should NOT call these directly — use hooks)
- Hooks:     `@/features/doctor/hooks`  (same barrel as Phase 1)
- Constants: `@/features/doctor/constants` (same barrel; Phase 2 lists re-exported)
- Money fmt: `formatKobo(kobo)` — re-exported from `@/api/doctor.phase2.api` (and `@/api/doctor.api`)

---

## 1. Exported types (`@/types/doctor.phase2`)

Re-exported from Phase 1 (`@/types/doctor`): `PatientSummary`,
`DoctorPrescription`, `PrescriptionDrugItem`, `LabOrder`, `LabResult`,
`SoapNote`, `DoctorAppointment`, `PayoutItem`.

**Enums / unions:** `PharmacyFulfilmentStatus`, `DeliveryStage`, `RefillStatus`,
`ReferralStatus`, `ReferralAttachmentKind`, `RecordDocumentKind`,
`RecordAccessAction`, `ClaimStatus`, `FollowUpKind`, `FollowUpStatus`,
`LicenceStatus`, `ComplianceAuditAction`, `ComplianceAlertSeverity`.

**Entities:** `SubstituteDrug`, `PharmacyFulfilment`, `DeliveryEvent`,
`DrugDelivery`, `RefillRequest`, `Specialist`, `ReferralAttachment`,
`SpecialistReferral`, `RecordDiagnosisEntry`, `RecordDocument`,
`RecordAccessEntry`, `PatientRecordHub`, `ClaimLineItem`, `ClaimEvent`,
`HmoClaim`, `FollowUpPlan`, `RatingBreakdown`, `DoctorReview`,
`ReputationMetrics`, `ReputationSummary`, `PayoutPeriodBreakdown`,
`PayoutReport`, `LicenceInfo`, `ConsentRecord`, `ComplianceAuditEntry`,
`ComplianceAlert`, `PolicyAcknowledgement`, `ComplianceDashboard`.

**Mutation inputs/results:** `ReviewSubstituteInput`/`ReviewSubstituteResult`,
`ReviewRefillInput`/`ReviewRefillResult`,
`CreateReferralInput`/`CreateReferralResult`,
`SubmitClaimInput`/`SubmitClaimResult`, `DisputeClaimInput`/`DisputeClaimResult`,
`CreateFollowUpInput`/`CreateFollowUpResult`,
`ReviewFollowUpRequestInput`/`ReviewFollowUpRequestResult`,
`ReportReviewInput`/`ReportReviewResult`,
`AcknowledgePolicyInput`/`AcknowledgePolicyResult`.

> Every state-changing / money input type carries `idempotencyKey: string`.
> Hooks generate it via `generateIdempotencyKey()`, so Frontend passes the input
> **without** `idempotencyKey` (`Omit<…, 'idempotencyKey'>`).

---

## 2. API functions (`@/api/doctor.phase2.api`)

### Reads
| Function | Returns |
|----------|---------|
| `getPharmacyFulfilments()` | `PharmacyFulfilment[]` |
| `getPharmacyFulfilment(id)` | `PharmacyFulfilment \| undefined` |
| `getDrugDeliveries()` | `DrugDelivery[]` |
| `getDrugDelivery(fulfilmentId)` | `DrugDelivery \| undefined` |
| `getRefillRequests(status?)` | `RefillRequest[]` |
| `getRefillRequest(id)` | `RefillRequest \| undefined` |
| `getSpecialists(specialty?)` | `Specialist[]` |
| `getReferrals(status?)` | `SpecialistReferral[]` |
| `getReferral(id)` | `SpecialistReferral \| undefined` |
| `getPatientRecordHub(patientId)` | `PatientRecordHub` |
| `getHmoClaims(status?)` | `HmoClaim[]` |
| `getHmoClaim(id)` | `HmoClaim \| undefined` |
| `getFollowUps(status?)` | `FollowUpPlan[]` |
| `getFollowUp(id)` | `FollowUpPlan \| undefined` |
| `getReputation()` | `ReputationSummary` |
| `getPayoutReport(rangeLabel?)` | `PayoutReport` |
| `getComplianceDashboard()` | `ComplianceDashboard` |

### Mutations (all require `Idempotency-Key` in Phase C)
| Function | Returns |
|----------|---------|
| `reviewSubstitute(input: ReviewSubstituteInput)` | `ReviewSubstituteResult` |
| `reviewRefill(input: ReviewRefillInput)` | `ReviewRefillResult` |
| `createReferral(input: CreateReferralInput)` | `CreateReferralResult` |
| `submitClaim(input: SubmitClaimInput)` | `SubmitClaimResult` |
| `disputeClaim(input: DisputeClaimInput)` | `DisputeClaimResult` |
| `createFollowUp(input: CreateFollowUpInput)` | `CreateFollowUpResult` |
| `reviewFollowUpRequest(input: ReviewFollowUpRequestInput)` | `ReviewFollowUpRequestResult` |
| `reportReview(input: ReportReviewInput)` | `ReportReviewResult` |
| `acknowledgePolicy(input: AcknowledgePolicyInput)` | `AcknowledgePolicyResult` |

**Exported DEMO_* (also used as `placeholderData`):** `DEMO_PHARMACY_FULFILMENTS`,
`DEMO_DRUG_DELIVERIES`, `DEMO_REFILL_REQUESTS`, `DEMO_SPECIALISTS`,
`DEMO_REFERRALS`, `DEMO_PATIENT_RECORD_HUB`, `DEMO_HMO_CLAIMS`,
`DEMO_FOLLOW_UPS`, `DEMO_REPUTATION`, `DEMO_PAYOUT_REPORT`, `DEMO_COMPLIANCE`.

---

## 3. Hooks (`@/features/doctor/hooks`)

Query hooks return a TanStack Query `UseQueryResult`; mutation hooks return a
`UseMutationResult`. Query keys are namespaced under `['doctor', …]`.

### Queries
| Hook | Signature | `data` type |
|------|-----------|-------------|
| `usePharmacyFulfilments()` | — | `PharmacyFulfilment[]` |
| `usePharmacyFulfilment(id)` | `string` | `PharmacyFulfilment \| undefined` |
| `useDrugDeliveries()` | — | `DrugDelivery[]` |
| `useDrugDelivery(fulfilmentId)` | `string` | `DrugDelivery \| undefined` |
| `useRefillRequests(status?)` | `RefillStatus?` | `RefillRequest[]` |
| `useRefillRequest(id)` | `string` | `RefillRequest \| undefined` |
| `useSpecialists(specialty?)` | `string?` | `Specialist[]` |
| `useReferrals(status?)` | `ReferralStatus?` | `SpecialistReferral[]` |
| `useReferral(id)` | `string` | `SpecialistReferral \| undefined` |
| `usePatientRecordHub(patientId)` | `string` | `PatientRecordHub` |
| `useHmoClaims(status?)` | `ClaimStatus?` | `HmoClaim[]` |
| `useHmoClaim(id)` | `string` | `HmoClaim \| undefined` |
| `useFollowUps(status?)` | `FollowUpStatus?` | `FollowUpPlan[]` |
| `useFollowUp(id)` | `string` | `FollowUpPlan \| undefined` |
| `useReputation()` | — | `ReputationSummary` |
| `usePayoutReport(rangeLabel?)` | `string?` | `PayoutReport` |
| `useComplianceDashboard()` | — | `ComplianceDashboard` |

### Mutations (call `.mutate(input)` with `Omit<Input, 'idempotencyKey'>`)
| Hook | Input (no idempotencyKey) | Invalidates |
|------|---------------------------|-------------|
| `useReviewSubstitute()` | `{ fulfilmentId, decision, note? }` | `pharmacy-fulfilments`, `pharmacy-fulfilment/:id` |
| `useReviewRefill()` | `{ refillId, decision, rejectionReason? }` | `refill-requests`, `refill-request/:id` |
| `useCreateReferral()` | `{ patientId, specialistId, reason, urgency, attachments }` | `referrals` |
| `useSubmitClaim()` | `{ appointmentId, provider, authCode?, lineItems }` | `hmo-claims` |
| `useDisputeClaim()` | `{ claimId, reason }` | `hmo-claims`, `hmo-claim/:id` |
| `useCreateFollowUp()` | `{ patientId, appointmentId?, reason, dueDate, kind, feeKobo }` | `follow-ups` |
| `useReviewFollowUpRequest()` | `{ followUpId, decision, rejectionReason? }` | `follow-ups`, `follow-up/:id` |
| `useReportReview()` | `{ reviewId, reason }` | `reputation` |
| `useAcknowledgePolicy()` | `{ policyKey, version }` | `compliance` |

`decision` is `'approve' | 'reject'` on substitute/refill/follow-up reviews.

---

## 4. Constants (`@/features/doctor/constants` → `phase2`)

`PHARMACY_STATUS_LABELS`, `DELIVERY_STAGE_LABELS`, `DELIVERY_STAGE_ORDER`,
`COURIER_OPTIONS`, `REFILL_STATUS_LABELS`, `REFERRAL_STATUS_LABELS`,
`REFERRAL_URGENCY_OPTIONS`, `REFERRAL_ATTACHMENT_KIND_LABELS`,
`REFERRAL_SPECIALTY_OPTIONS`, `CLAIM_STATUS_LABELS`, `HMO_PROVIDER_OPTIONS`,
`FOLLOW_UP_STATUS_LABELS`, `FOLLOW_UP_KIND_OPTIONS`, `REVIEW_REPORT_REASONS`,
`LICENCE_STATUS_LABELS`, `ALERT_SEVERITY_LABELS`.

The `*_LABELS` exports are `Record<Status, string>` maps for badge text.

---

## 5. Loading / error / empty-state contract

Identical to Phase 1:

- **Loading:** `isLoading === true` → skeleton/`ActivityIndicator`. Hooks with
  `placeholderData` (all list/summary reads) expose demo `data` immediately, so a
  spinner is only briefly needed.
- **Error:** `isError === true` → render error/retry; call `refetch()`. In Phase A
  errors never fire (demo data) but wire the branch now.
- **Empty:** arrays come back as `[]` (never null). Single-item reads
  (`get*Fulfilment`, `getRefillRequest`, `getReferral`, `getHmoClaim`,
  `getFollowUp`, `getDrugDelivery`) resolve to `undefined` when missing — render an
  explicit empty/not-found state.
- **Default the array:** `const { data: claims = [] } = useHmoClaims();`
- **Money:** never float-math on kobo. Display with `formatKobo(value)`. Note
  `SubstituteDrug.priceDeltaKobo` and `PayoutPeriodBreakdown` fields can be
  negative / zero — still kobo integers.
- **Mutations:** drive button state from `isPending`; use `mutateAsync` to await
  before navigating. Inputs omit `idempotencyKey` (auto-generated by the hook).
