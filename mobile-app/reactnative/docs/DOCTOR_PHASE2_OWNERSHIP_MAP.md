# Doctor Phase 2 — File Ownership Map

Phase 2 extends the doctor-side (provider) telemedicine experience with 10 new
screens. This is **additive** to Phase 1: nothing in the Phase 1 contract is
edited (only barrels gain new export lines). Money is always integers in **kobo**.

## Ownership boundaries (do not cross)

### BACKEND (data/type contract) — owns
- `src/types/doctor.phase2.ts`            *(new)*
- `src/api/doctor.phase2.api.ts`          *(new)*
- `src/features/doctor/hooks/usePharmacy.ts`    *(new)*
- `src/features/doctor/hooks/useReferrals.ts`   *(new)*
- `src/features/doctor/hooks/useRecords.ts`     *(new)*
- `src/features/doctor/hooks/useReputation.ts`  *(new)*
- `src/features/doctor/hooks/useCompliance.ts`  *(new)*
- `src/features/doctor/constants/phase2.ts`     *(new)*
- `src/features/doctor/hooks/index.ts`          *(edited — additive export lines only)*
- `src/features/doctor/constants/index.ts`      *(edited — additive export line only)*

> Backend continues to own the Phase 1 files unchanged
> (`src/types/doctor.ts`, `src/api/doctor.api.ts`, the other hook files).

### FRONTEND (screens/UI) — owns
- `app/(doctor)/**` (all route files)
- `src/features/doctor/components/**`

### QA — owns
- `docs/QA_DOCTOR_MVP_REPORT.md`

> Frontend consumes Backend's hooks/types only — never imports from
> `doctor.phase2.api.ts` directly (use the hooks). All money is kobo; format with
> `formatKobo` (re-exported from `@/api/doctor.api` and `@/api/doctor.phase2.api`).

---

## Proposed routes for the 10 Phase 2 screens

Most Phase 2 screens are **stack screens** reached from the Records tab hub, the
dashboard, or settings. The Phase 1 bottom-tab layout is unchanged.

| #  | Screen | Route (under `app/(doctor)/`) | Reached from | Hooks consumed | Key types |
|----|--------|-------------------------------|--------------|----------------|-----------|
| 1  | Pharmacy substitution approval | `pharmacy/index` (list) + `pharmacy/[id]` (review) | Records hub | `usePharmacyFulfilments`, `usePharmacyFulfilment`, `useReviewSubstitute` | `PharmacyFulfilment`, `SubstituteDrug`, `ReviewSubstituteInput` |
| 2  | Drug delivery tracking | `pharmacy/[id]/delivery` | Pharmacy detail / Records hub | `useDrugDelivery`, `useDrugDeliveries` | `DrugDelivery`, `DeliveryEvent`, `DeliveryStage` |
| 3  | Refill approval | `refills/index` (list + inline approve/reject) | Records hub | `useRefillRequests`, `useRefillRequest`, `useReviewRefill` | `RefillRequest`, `ReviewRefillInput`, `RefillStatus` |
| 4  | Specialist referral | `referrals/index` (list) + `referrals/new` (create) + `referrals/[id]` (detail) | Records hub / patient record | `useReferrals`, `useReferral`, `useSpecialists`, `useCreateReferral` | `SpecialistReferral`, `Specialist`, `ReferralAttachment`, `CreateReferralInput` |
| 5  | Advanced medical records | `records/[patientId]` | Records tab → patient | `usePatientRecordHub` | `PatientRecordHub`, `RecordDiagnosisEntry`, `RecordDocument`, `RecordAccessEntry` |
| 6  | HMO claim tracking | `claims/index` (list) + `claims/[id]` (detail; submit/dispute) | Records hub / earnings | `useHmoClaims`, `useHmoClaim`, `useSubmitClaim`, `useDisputeClaim` | `HmoClaim`, `ClaimLineItem`, `ClaimEvent`, `SubmitClaimInput`, `DisputeClaimInput` |
| 7  | Patient follow-up plans | `follow-ups/index` (list + approve/reject requests) + `follow-ups/new` (create) | Dashboard / patient record | `useFollowUps`, `useFollowUp`, `useCreateFollowUp`, `useReviewFollowUpRequest` | `FollowUpPlan`, `FollowUpKind`, `CreateFollowUpInput`, `ReviewFollowUpRequestInput` |
| 8  | Doctor ratings / reviews | `reviews/index` | Dashboard / settings | `useReputation`, `useReportReview` | `ReputationSummary`, `DoctorReview`, `ReputationMetrics`, `ReportReviewInput` |
| 9  | Payout reports | `earnings/report` | Earnings tab | `usePayoutReport` | `PayoutReport`, `PayoutPeriodBreakdown`, `PayoutItem` |
| 10 | Compliance dashboard | `compliance/index` | Settings | `useComplianceDashboard`, `useAcknowledgePolicy` | `ComplianceDashboard`, `LicenceInfo`, `ConsentRecord`, `ComplianceAuditEntry`, `ComplianceAlert`, `PolicyAcknowledgement`, `AcknowledgePolicyInput` |

Notes for Frontend:
- The **Records** tab (`(tabs)/records`) becomes the hub linking to Pharmacy (1),
  Delivery (2), Refills (3), Referrals (4), Advanced records (5) and Claims (6).
- Payout report (9) is a push from the **Earnings** tab; Reviews (8) and
  Compliance (10) are pushes from the **Dashboard** / **Settings**.
- Follow-ups (7) are reachable from both the dashboard (pending patient requests)
  and a patient's record.
