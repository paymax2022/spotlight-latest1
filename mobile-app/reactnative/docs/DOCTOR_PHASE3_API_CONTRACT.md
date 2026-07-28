# Doctor API Contract — Phase 3

Reference for the Frontend role. ADDITIVE to the Phase 1 / Phase 2 / Section B
contracts. All data is **demo data** resolved with simulated latency (`wait()`);
Phase C swaps bodies for live endpoints + the `Idempotency-Key` header. Money is
always an integer in **kobo**. Path alias is `@/` → `src/`. Use `import type` for
type-only imports.

- Types:     `@/types/doctor.phase3`   (re-exports the primitives it reuses)
- API:       `@/api/doctor.phase3.api` (Frontend should NOT call these directly — use hooks)
- Hooks:     `@/features/doctor/hooks`  (same barrel as earlier phases)
- Constants: `@/features/doctor/constants` (same barrel; Phase 3 lists re-exported)
- Money fmt: `formatKobo(kobo)` — re-exported from `@/api/doctor.phase3.api` (and `@/api/doctor.api`)

---

## 1. Exported types (`@/types/doctor.phase3`)

Re-exported from Phase 1 (`@/types/doctor`): `PatientSummary`,
`PrescriptionDrugItem`, `LabTest`, `LabOrderStatus`, `SoapNote`,
`DoctorPrescription`, `LabResult`, `LabResultValue`.
Re-exported from Section B (`@/types/doctor.profile`): `ClinicAffiliation`.

**Vet enums/unions:** `PetSpecies`, `PetDrugCategory`, `PetWarningSeverity`,
`PetLabCategory`, `PetProductCategory`.

**Vet entities:** `VetProfileSummary`, `PetConsultSummary`, `VetDashboard`,
`PetOwner`, `PetVaccination`, `PetHistoryItem`, `PetImage`, `PetProfile`,
`PetDrug`, `PetDosageCalculation`, `PetPrescriptionWarning`,
`PetPrescriptionItem`, `PetPrescription`, `PetLabTest`, `PetLabOrder`,
`PetLabResultValue`, `PetLabResult`, `PetStoreProduct`,
`PetProductRecommendation`.

**AI envelope & outputs:** `AiStatus`, `AiEnvelope<T>`, `AiNoteSummaryOutput`,
`AiNoteSummary`, `AiSeverity`, `AiFindingKind`, `AiSafetyFinding`,
`AiSafetyOutput`, `AiSafetyReport`, `AiLabFlagExplanation`,
`AiLabExplanationOutput`, `AiLabExplanation`.

**Practice entities:** `AnalyticsPeriod`, `AnalyticsPoint`, `AnalyticsMetric`,
`QualityAnalytics`, `ClinicRole`, `ClinicSchedule`, `ClinicMembership`,
`ClinicPortfolio`.

**Mutation inputs/results:** `ToggleVetModeInput`/`ToggleVetModeResult`,
`CreatePetPrescriptionInput`/`CreatePetPrescriptionResult`,
`CreatePetLabOrderInput`/`CreatePetLabOrderResult`,
`MarkPetLabResultReviewedInput`,
`RecommendProductsInput`/`RecommendProductsResult`,
`GenerateAiNoteSummaryInput`,
`AcceptAiNoteSummaryInput`/`AcceptAiNoteSummaryResult`,
`CheckPrescriptionSafetyInput`, `ExplainLabResultInput`,
`SetActiveClinicInput`/`SetActiveClinicResult`,
`UpdateClinicScheduleInput`/`UpdateClinicScheduleResult`.

> Every state-changing input type carries `idempotencyKey: string`. Hooks
> generate it via `generateIdempotencyKey()`, so Frontend passes the input
> **without** `idempotencyKey` (`Omit<…, 'idempotencyKey'>`).

### The AI envelope contract

All three AI screens consume `AiEnvelope<T>`:

```ts
interface AiEnvelope<T> {
  status: 'idle' | 'generating' | 'ready' | 'error';
  model: string;            // display label
  generatedAt?: string;     // ISO, present once ready
  confidence?: number;      // 0–100, present once ready
  disclaimer: string;       // not-medical-advice copy (always render this)
  output?: T;               // structured result, present once ready
  accepted: boolean;        // doctor accepted the draft as-is
  edited: boolean;          // doctor edited before accepting
  errorMessage?: string;    // present when status === 'error'
}
```

State mapping in the UI:
- **idle** — nothing generated yet; show a "Generate" CTA.
- **generating** — driven by the generate mutation's `isPending`; show a spinner /
  skeleton. (The read hooks return the ready demo envelope directly.)
- **ready** — render `output`; always show `disclaimer`, `model`, `confidence`.
  Offer Accept / Edit / Regenerate.
- **error** — driven by the mutation's `isError`; show `errorMessage` + retry.

`output` shapes: `AiNoteSummaryOutput` (SOAP draft + keyPoints),
`AiSafetyOutput` (findings[], `overallSeverity`, `safeToIssue`),
`AiLabExplanationOutput` (headline, plainSummary, flags[], followUps[]).

---

## 2. API functions (`@/api/doctor.phase3.api`)

### Reads
| Function | Returns |
|----------|---------|
| `getVetDashboard()` | `VetDashboard` |
| `getPetProfile(petId)` | `PetProfile` |
| `getPetPrescription(petId)` | `PetPrescription` |
| `getPetLabOrders()` | `PetLabOrder[]` |
| `getPetLabResult(orderId)` | `PetLabResult \| undefined` |
| `getPetProducts(category?)` | `PetStoreProduct[]` |
| `getPetRecommendations(petId)` | `PetProductRecommendation[]` |
| `getQualityAnalytics(period?)` | `QualityAnalytics` |
| `getClinicPortfolio()` | `ClinicPortfolio` |
| `getAiNoteSummary(appointmentId)` | `AiNoteSummary` |
| `getAiSafetyReport(id)` | `AiSafetyReport` |
| `getAiLabExplanation(resultId)` | `AiLabExplanation` |

### Mutations (all require `Idempotency-Key` in Phase C)
| Function | Returns |
|----------|---------|
| `toggleVetMode(input)` | `ToggleVetModeResult` |
| `createPetPrescription(input)` | `CreatePetPrescriptionResult` |
| `createPetLabOrder(input)` | `CreatePetLabOrderResult` |
| `markPetLabResultReviewed(input)` | `{ resultId; reviewed }` |
| `recommendProducts(input)` | `RecommendProductsResult` |
| `generateAiNoteSummary(input)` | `AiNoteSummary` (ready envelope) |
| `acceptAiNoteSummary(input)` | `AcceptAiNoteSummaryResult` |
| `checkPrescriptionSafety(input)` | `AiSafetyReport` (ready envelope) |
| `explainLabResult(input)` | `AiLabExplanation` (ready envelope) |
| `setActiveClinic(input)` | `SetActiveClinicResult` |
| `updateClinicSchedule(input)` | `UpdateClinicScheduleResult` |

**Exported DEMO_* (also used as `placeholderData`):** `DEMO_VET_DASHBOARD`,
`DEMO_PET_PROFILE`, `DEMO_PET_PRESCRIPTION`, `DEMO_PET_LAB_ORDERS`,
`DEMO_PET_LAB_RESULTS`, `DEMO_PET_PRODUCTS`, `DEMO_PET_RECOMMENDATIONS`,
`DEMO_AI_NOTE_SUMMARY`, `DEMO_AI_SAFETY_REPORT`, `DEMO_AI_LAB_EXPLANATION`,
`DEMO_QUALITY_ANALYTICS`, `DEMO_CLINIC_PORTFOLIO`.

---

## 3. Hooks (`@/features/doctor/hooks`)

### Vet (`useVet.ts`)
| Hook | Kind | Signature |
|------|------|-----------|
| `useVetDashboard()` | query | → `VetDashboard` |
| `useToggleVetMode()` | mutation | `Omit<ToggleVetModeInput,'idempotencyKey'>` |
| `usePetProfile(petId)` | query | → `PetProfile` |
| `usePetPrescription(petId)` | query | → `PetPrescription` |
| `useCreatePetPrescription()` | mutation | `Omit<CreatePetPrescriptionInput,'idempotencyKey'>` |
| `usePetLabOrders()` | query | → `PetLabOrder[]` |
| `usePetLabResult(orderId)` | query | → `PetLabResult \| undefined` |
| `useCreatePetLabOrder()` | mutation | `Omit<CreatePetLabOrderInput,'idempotencyKey'>` |
| `useMarkPetLabResultReviewed()` | mutation | `Omit<MarkPetLabResultReviewedInput,'idempotencyKey'>` |
| `usePetProducts(category?)` | query | → `PetStoreProduct[]` |
| `usePetRecommendations(petId)` | query | → `PetProductRecommendation[]` |
| `useRecommendProducts()` | mutation | `Omit<RecommendProductsInput,'idempotencyKey'>` |

### AI assist (`useAiAssist.ts`)
| Hook | Kind | Signature |
|------|------|-----------|
| `useAiNoteSummary(appointmentId)` | query | → `AiNoteSummary` |
| `useGenerateAiNoteSummary()` | mutation | `Omit<GenerateAiNoteSummaryInput,'idempotencyKey'>` → `AiNoteSummary` |
| `useAcceptAiNoteSummary()` | mutation | `Omit<AcceptAiNoteSummaryInput,'idempotencyKey'>` |
| `useCheckPrescriptionSafety()` | mutation | `Omit<CheckPrescriptionSafetyInput,'idempotencyKey'>` → `AiSafetyReport` |
| `useAiSafetyReport(id)` | query | → `AiSafetyReport` |
| `useAiLabExplanation(resultId)` | query | → `AiLabExplanation` |
| `useExplainLabResult()` | mutation | `Omit<ExplainLabResultInput,'idempotencyKey'>` → `AiLabExplanation` |

> For AI, the **`generating`** state is the generate mutation's `isPending`, the
> resolved value is the **`ready`** envelope (also written into the query cache
> via `setQueryData`), and **`error`** is the mutation's `isError` /
> `error.message`.

### Practice (`usePractice.ts`)
| Hook | Kind | Signature |
|------|------|-----------|
| `useQualityAnalytics(period?)` | query | → `QualityAnalytics` |
| `useClinicPortfolio()` | query | → `ClinicPortfolio` |
| `useSetActiveClinic()` | mutation | `Omit<SetActiveClinicInput,'idempotencyKey'>` |
| `useUpdateClinicSchedule()` | mutation | `Omit<UpdateClinicScheduleInput,'idempotencyKey'>` |

---

## 4. Constants (`@/features/doctor/constants`)

`PET_SPECIES_OPTIONS`, `PET_SPECIES_LABELS`, `PET_BREED_OPTIONS`,
`PET_DRUG_CATEGORY_LABELS`, `PET_DRUG_CATALOGUE`, `PET_LAB_CATEGORY_LABELS`,
`PET_LAB_TESTS`, `PET_PRODUCT_CATEGORIES`, `PET_WARNING_SEVERITY_LABELS`,
`PET_WARNING_SEVERITY_TONES`, `AI_STATUS_LABELS`, `AI_SEVERITY_LABELS`,
`AI_SEVERITY_TONES`, `AI_SEVERITY_RANK`, `AI_FINDING_KIND_LABELS`,
`ANALYTICS_PERIOD_OPTIONS`, `CLINIC_ROLE_OPTIONS`, `CLINIC_ROLE_LABELS`.

The `PET_DRUG_CATALOGUE` entries carry `dosePerKgMgLow`/`dosePerKgMgHigh` to
drive the dosage-by-weight calculator (screen 3), and
`contraindicatedSpecies` + `warnings` for species/allergy safety flags.

---

## 5. Loading / error / empty conventions

Identical to earlier phases:
- **Loading:** `isPending` (queries with `placeholderData` show demo data
  immediately; gate skeletons on `isPlaceholderData` where a true spinner is
  wanted). AI generate flows: gate on the mutation's `isPending` (= `generating`).
- **Error:** `isError` + `error`; render a retry affordance. AI errors map to the
  envelope's `error` state (`errorMessage` / mutation `error.message`).
- **Empty:** arrays may be `[]` (e.g. no pet lab orders) — render an empty state.
  `getPetLabResult` / detail reads may resolve `undefined` — render not-found.
- **Money:** integers in kobo; format with `formatKobo`. Never do float math.
