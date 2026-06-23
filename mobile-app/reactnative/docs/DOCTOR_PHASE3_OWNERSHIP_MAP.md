# Doctor Phase 3 — File Ownership Map

Phase 3 extends the doctor-side (provider) telemedicine experience with 10 new
screens across three domains: **veterinary mode**, **AI assistance**, and
**practice management**. This is **additive** to Phases 1/2 and Section B:
nothing in the earlier contracts is edited (only the hooks/constants barrels gain
new export lines). Money is always integers in **kobo**.

## Ownership boundaries (do not cross)

### BACKEND (data/type contract) — owns
- `src/types/doctor.phase3.ts`                       *(new)*
- `src/api/doctor.phase3.api.ts`                     *(new)*
- `src/features/doctor/hooks/useVet.ts`              *(new)*
- `src/features/doctor/hooks/useAiAssist.ts`         *(new)*
- `src/features/doctor/hooks/usePractice.ts`         *(new)*
- `src/features/doctor/constants/phase3.ts`          *(new)*
- `src/features/doctor/hooks/index.ts`               *(edited — additive export lines only)*
- `src/features/doctor/constants/index.ts`           *(edited — additive export line only)*

> Backend continues to own the Phase 1 / Phase 2 / Section B files unchanged.

### FRONTEND (screens/UI) — owns
- `app/(doctor)/**` (all route files)
- `src/features/doctor/components/**`

### QA — owns
- `docs/QA_DOCTOR_PHASE3_REPORT.md`

> Frontend consumes Backend's hooks/types only — never imports from
> `doctor.phase3.api.ts` directly (use the hooks). All money is kobo; format with
> `formatKobo` (re-exported from `@/api/doctor.api` / `@/api/doctor.phase3.api`).

---

## Proposed routes for the 10 Phase 3 screens

Phase 3 screens are **stack screens**. Vet screens hang off a vet-mode entry
(reached from settings/dashboard once vet mode is toggled on); AI screens are
pushes from the relevant consult artefact (notes / prescription draft / lab
result); analytics and clinics are pushes from the dashboard / settings. The
Phase 1 bottom-tab layout is unchanged.

| #  | Screen | Route (under `app/(doctor)/`) | Reached from | Hooks consumed | Key types |
|----|--------|-------------------------------|--------------|----------------|-----------|
| 1  | Veterinary doctor mode | `vet/index` | Settings / Dashboard (vet-mode entry) | `useVetDashboard`, `useToggleVetMode` | `VetDashboard`, `VetProfileSummary`, `PetConsultSummary`, `ToggleVetModeInput` |
| 2  | Pet profile review | `vet/pet/[id]` | Vet dashboard → today's consult | `usePetProfile` | `PetProfile`, `PetOwner`, `PetVaccination`, `PetHistoryItem`, `PetImage` |
| 3  | Pet prescription | `vet/pet/[id]/prescription` | Pet profile | `usePetPrescription`, `useCreatePetPrescription`, (`useCheckPrescriptionSafety`) | `PetPrescription`, `PetPrescriptionItem`, `PetDosageCalculation`, `PetPrescriptionWarning`, `CreatePetPrescriptionInput` |
| 4  | Pet lab orders | `vet/pet/[id]/lab-order` (create) + `vet/lab-result/[orderId]` (result) | Pet profile / vet dashboard | `usePetLabOrders`, `usePetLabResult`, `useCreatePetLabOrder`, `useMarkPetLabResultReviewed` | `PetLabOrder`, `PetLabTest`, `PetLabResult`, `PetLabResultValue`, `CreatePetLabOrderInput` |
| 5  | Pet store recommendation | `vet/pet-store` (+ `?petId=`) | Pet profile | `usePetProducts`, `usePetRecommendations`, `useRecommendProducts` | `PetStoreProduct`, `PetProductRecommendation`, `RecommendProductsInput` |
| 6  | AI consultation note summary | `ai/note-summary` (+ `?appointmentId=`) | Consult notes screen | `useAiNoteSummary`, `useGenerateAiNoteSummary`, `useAcceptAiNoteSummary` | `AiNoteSummary` (`AiEnvelope<AiNoteSummaryOutput>`), `AcceptAiNoteSummaryInput` |
| 7  | AI prescription safety checker | `ai/rx-safety` | Prescription draft (human or pet) | `useCheckPrescriptionSafety`, `useAiSafetyReport` | `AiSafetyReport` (`AiEnvelope<AiSafetyOutput>`), `AiSafetyFinding`, `AiSeverity`, `CheckPrescriptionSafetyInput` |
| 8  | AI lab result explanation | `ai/lab-explanation` (+ `?resultId=`) | Lab result detail | `useAiLabExplanation`, `useExplainLabResult` | `AiLabExplanation` (`AiEnvelope<AiLabExplanationOutput>`), `AiLabFlagExplanation`, `ExplainLabResultInput` |
| 9  | Doctor quality analytics | `analytics/index` | Dashboard / Settings | `useQualityAnalytics` | `QualityAnalytics`, `AnalyticsMetric`, `AnalyticsPoint`, `AnalyticsPeriod` |
| 10 | Multi-clinic / provider management | `clinics/index` | Settings / Dashboard | `useClinicPortfolio`, `useSetActiveClinic`, `useUpdateClinicSchedule` | `ClinicPortfolio`, `ClinicMembership`, `ClinicRole`, `ClinicSchedule`, `SetActiveClinicInput`, `UpdateClinicScheduleInput` |

Notes for Frontend:
- **Vet mode (1)** is the entry point: toggling it on (via `useToggleVetMode`)
  reveals the vet stack. Pet profile (2) → prescription (3) / lab-order (4) /
  pet-store (5) all chain off `vet/pet/[id]`.
- **AI screens (6–8)** are contextual: note summary is launched from the SOAP
  notes screen, the safety checker from a prescription draft (human *or* pet),
  the lab explanation from a lab-result detail. They share the `AiEnvelope`
  generating → ready → error contract (see the API contract doc).
- **Analytics (9)** and **Clinics (10)** are pushes from the Dashboard /
  Settings; the active-clinic switch in (10) affects which clinic context future
  consults are attributed to.
