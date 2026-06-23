# Doctor API Contract — Batch 3 (sections K · L · M · N)

Reference for the Frontend role. ADDITIVE to the Phase 1 / Phase 2 / Section B /
Phase 3 / Batch 1 / Batch 2 contracts. All data is **demo data** resolved with
simulated latency (`wait()`); Phase C swaps bodies for live endpoints + the
`Idempotency-Key` header. Money is always an integer in **kobo**. Path alias is
`@/` → `src/`. Use `import type` for type-only imports.

- Types:     `@/types/doctor.batch3`   (re-exports the primitives it reuses)
- API:       `@/api/doctor.batch3.api` (Frontend should NOT call these directly — use hooks; pure helpers `checkPrescriptionWarnings`, `searchDrugCatalogue`, `getDrugAlternatives`, `checkLabCoverage`, `formatKobo` are the exception)
- Hooks:     `@/features/doctor/hooks`  (same barrel as earlier phases)
- Constants: `@/features/doctor/constants` (same barrel; Batch 3 lists re-exported from `batch3`)
- Money fmt: `formatKobo(kobo)` — re-exported from `@/api/doctor.batch3.api` (and `@/api/doctor.api`)

**Consolidation:** granular variants (each warning kind, lifecycle step, status,
alternatives, edit/cancel/expired, audit) are modelled as states/data on top of
the existing entities. **Sections L, M, N are mostly reuse** of Phase 1 / Phase 2.
See the Ownership Map for which spec entries are full screens vs states vs
reuse-existing.

---

## 1. Exported types (`@/types/doctor.batch3`)

**Re-exported from Phase 1 (`@/types/doctor`):** `PatientSummary`,
`PrescriptionDrugItem`, `DoctorPrescription`, `PrescriptionDraft`, `LabTest`,
`LabOrder`, `LabOrderStatus`, `LabResult`, `LabResultValue`.
**From Phase 2 (`@/types/doctor.phase2`):** `PharmacyFulfilment`,
`PharmacyFulfilmentStatus`, `SubstituteDrug`, `DrugDelivery`, `DeliveryStage`,
`DeliveryEvent`, `RefillRequest`, `RefillStatus`.

### Section K — e-prescription
`DosageForm`, `FoodTiming`, `DrugCatalogueEntry`, `DrugAlternative`,
`RxWarningKind`, `RxWarningSeverity`, `RxWarning`, `RxDrugLine`,
`RxLifecycleStatus`, `RxDigitalSignature`, `RxAuditAction`, `RxAuditEntry`,
`IssuedPrescription`, `RxFulfilmentOption`.

### Section L — pharmacy & drug fulfilment
`Pharmacy`, `StockLevel`, `DrugStock`, `FulfilmentStatusExt`,
`PharmacyMessageAuthor`, `PharmacyMessage`, `DeliveryAlertKind`, `DeliveryAlert`.

### Section M — lab test ordering
`SampleType`, `CollectionMode`, `LabUrgency`, `LabCatalogueEntry`, `LabPackage`,
`LabProvider`, `LabCoverageCheck`, `LabOrderRich`.

### Section N — lab result review
`LabResultStatus`, `LabResultInbox`, `LabResultValueRich`, `LabValueTrendPoint`,
`LabValueComparison`, `LabInterpretation`, `LabResultAuditAction`,
`LabResultAuditEntry`, `LabResultRich`.

### Mutation inputs / results
K: `IssuePrescriptionInput/Result`, `CancelPrescriptionInput/Result`,
`SharePrescriptionInput/Result`, `SendToPharmacyInput/Result`,
`RequestRefillConsultationInput/Result`.
L: `SelectPharmacyInput/Result`, `SendPharmacyMessageInput/Result`,
`ConfirmPatientReceivedInput/Result`, `ReportPharmacyInput/Result`.
M: `ShareLabOrderInput/Result`, `CancelLabOrderInput/Result`.
N: `AddInterpretationInput/Result`, `RequestRepeatTestInput/Result`,
`ShareResultExplanationInput/Result`, `ReportSuspiciousResultInput/Result`.

Helper context type: `PrescriptionWarningContext` (input to
`checkPrescriptionWarnings`).

> Composition note: `IssuedPrescription`, `RxDrugLine`, `LabCatalogueEntry`,
> `LabOrderRich`, `LabResultRich` and `LabResultValueRich` each **compose** the
> Phase 1 / Phase 2 entity under a `base` field rather than redeclaring it — the
> base shapes are reused verbatim.

---

## 2. API functions (`@/api/doctor.batch3.api`)

### Reads (resolve `DEMO_*`)
```ts
// Section K
getIssuedPrescription(id: string): Promise<IssuedPrescription>

// Section L
getPharmacies(patientId?: string): Promise<Pharmacy[]>
getPreferredPharmacy(patientId?: string): Promise<Pharmacy | undefined>
getDrugStock(pharmacyId: string): Promise<DrugStock[]>
getPharmacyMessages(fulfilmentId: string): Promise<PharmacyMessage[]>
getDeliveryAlerts(): Promise<DeliveryAlert[]>

// Section M
getLabCatalogue(): Promise<LabCatalogueEntry[]>
getLabPackages(): Promise<LabPackage[]>
getLabProviders(): Promise<LabProvider[]>
getLabOrderRich(orderId: string): Promise<LabOrderRich>

// Section N
getResultInbox(): Promise<LabResultInbox[]>
getLabResultRich(resultId: string): Promise<LabResultRich>
getLabValueComparisons(resultId: string): Promise<LabValueComparison[]>
```

### Pure helpers (safe to call directly)
```ts
checkPrescriptionWarnings(lines: RxDrugLine[], context?: PrescriptionWarningContext): RxWarning[]
searchDrugCatalogue(query: string): DrugCatalogueEntry[]   // filters DRUG_CATALOGUE_RICH
getDrugAlternatives(drugName: string): DrugAlternative[]   // filters DRUG_ALTERNATIVES
checkLabCoverage(testIds: string[], opts?): LabCoverageCheck
formatKobo(kobo: number): string                          // re-exported
```

### Mutations (each appends `Idempotency-Key`; hooks generate it)
```ts
// Section K
issuePrescription(input): Promise<IssuePrescriptionResult>          // digital signature → 'issued'
cancelPrescription(input): Promise<CancelPrescriptionResult>        // → 'cancelled'
sharePrescription(input): Promise<SharePrescriptionResult>
sendToPharmacy(input): Promise<SendToPharmacyResult>
requestRefillConsultation(input): Promise<RequestRefillConsultationResult>

// Section L
selectPharmacy(input): Promise<SelectPharmacyResult>
sendPharmacyMessage(input): Promise<SendPharmacyMessageResult>
confirmPatientReceived(input): Promise<ConfirmPatientReceivedResult> // → 'received_by_patient'
reportPharmacy(input): Promise<ReportPharmacyResult>

// Section M
shareLabOrder(input): Promise<ShareLabOrderResult>
cancelLabOrder(input): Promise<CancelLabOrderResult>

// Section N
addInterpretation(input): Promise<AddInterpretationResult>
requestRepeatTest(input): Promise<RequestRepeatTestResult>          // → new order 'ordered'
shareResultExplanation(input): Promise<ShareResultExplanationResult>
reportSuspiciousResult(input): Promise<ReportSuspiciousResultResult>
```

### REUSED API fns (Phase 1 / Phase 2 — call via their existing hooks, not here)
`createPrescription`, `getPrescriptions`, `getPrescription` (Phase 1);
`reviewRefill`, `getRefillRequests` (Phase 2);
`reviewSubstitute`, `getPharmacyFulfilments`, `getDrugDeliveries` (Phase 2);
`createLabOrder`, `getLabOrders` (Phase 1);
`getLabResult`, `markLabResultReviewed` (Phase 1).

### DEMO_* exports (used as `placeholderData`)
`DEMO_ISSUED_PRESCRIPTION`, `DEMO_PHARMACIES`, `DEMO_DRUG_STOCK`,
`DEMO_PHARMACY_MESSAGES`, `DEMO_DELIVERY_ALERTS`, `DEMO_LAB_CATALOGUE`,
`DEMO_LAB_PROVIDERS`, `DEMO_LAB_ORDER_RICH`, `DEMO_RESULT_INBOX`,
`DEMO_LAB_RESULT_RICH`.

---

## 3. Hooks (`@/features/doctor/hooks`)

Frontend calls these — not the API fns. Mutations take
`Omit<Input, 'idempotencyKey'>`; the key is auto-generated.

### Section K — `useEprescription.ts`
```ts
useIssuedPrescription(id: string)          // → IssuedPrescription (placeholderData wired)
useIssuePrescription()                     // mutate(IssuePrescriptionInput w/o key) — digital signature → 'issued'
useCancelPrescription()                    // mutate(CancelPrescriptionInput w/o key)
useSharePrescription()                     // mutate(SharePrescriptionInput w/o key)
useSendToPharmacy()                        // mutate(SendToPharmacyInput w/o key)
useRequestRefillConsultation()            // mutate(RequestRefillConsultationInput w/o key)
checkPrescriptionWarnings(lines, ctx?)     // pure helper, re-exported from the hook module
searchDrugCatalogue(query)                 // pure helper, re-exported
getDrugAlternatives(drugName)              // pure helper, re-exported
```
> REUSES Phase 1 `useCreatePrescription`, `usePrescriptions`, `usePrescription`
> and Phase 2 `useReviewRefill`, `useRefillRequests` (refill approve/reject).

### Section L — `usePharmacyFulfil.ts`
```ts
usePharmacies(patientId?: string)          // → Pharmacy[]
usePreferredPharmacy(patientId?: string)   // → Pharmacy | undefined
useDrugStock(pharmacyId: string)           // → DrugStock[]
usePharmacyMessages(fulfilmentId: string)  // → PharmacyMessage[]
useDeliveryAlerts()                        // → DeliveryAlert[]
useSelectPharmacy()                        // mutate(SelectPharmacyInput w/o key)
useSendPharmacyMessage()                   // mutate(SendPharmacyMessageInput w/o key)
useConfirmPatientReceived()                // mutate(ConfirmPatientReceivedInput w/o key) → 'received_by_patient'
useReportPharmacy()                        // mutate(ReportPharmacyInput w/o key)
```
> REUSES Phase 2 `usePharmacyFulfilments`, `usePharmacyFulfilment`,
> `useDrugDeliveries`, `useDrugDelivery`, `useReviewSubstitute` (substitute
> approve/reject).

### Section M — `useLabOrdering.ts`
```ts
useLabCatalogue()                          // → LabCatalogueEntry[]
useLabPackages()                           // → LabPackage[]
useLabProviders()                          // → LabProvider[]
useLabOrderRich(orderId: string)           // → LabOrderRich
useShareLabOrder()                         // mutate(ShareLabOrderInput w/o key)
useCancelLabOrder()                        // mutate(CancelLabOrderInput w/o key)
checkLabCoverage(testIds, opts?)           // pure helper, re-exported from the hook module
```
> REUSES Phase 1 `useCreateLabOrder`, `useLabOrders` for the base order create/list.

### Section N — `useLabResults.ts`
```ts
useResultInbox()                           // → LabResultInbox[]
useLabResultRich(resultId: string)         // → LabResultRich
useLabValueComparisons(resultId: string)   // → LabValueComparison[]
useAddInterpretation()                     // mutate(AddInterpretationInput w/o key)
useRequestRepeatTest()                     // mutate(RequestRepeatTestInput w/o key) → new order
useShareResultExplanation()                // mutate(ShareResultExplanationInput w/o key)
useReportSuspiciousResult()                // mutate(ReportSuspiciousResultInput w/o key)
```
> REUSES Phase 1 `useLabResult`, `useMarkLabResultReviewed` for the base result +
> mark-reviewed. N18/N19 (follow-up / specialist referral from a result) REUSE
> the Phase 2 `useCreateFollowUp` / `useCreateReferral` flows.

---

## 4. Constants (`@/features/doctor/constants`, from `batch3`)

Section K: `DOSAGE_FORM_OPTIONS`, `STRENGTH_OPTIONS`, `FOOD_TIMING_OPTIONS`,
`RX_WARNING_LABELS`, `RX_WARNING_TONES`, `RX_LIFECYCLE_LABELS`,
`AUDIT_ACTION_LABELS`, `DRUG_CATALOGUE_RICH`, `DRUG_ALTERNATIVES`,
`RX_FULFILMENT_OPTION_LABELS`, `RX_VALIDITY_DAYS`, `RX_CANCEL_REASONS`.
Section L: `STOCK_LEVEL_LABELS`, `FULFILMENT_STATUS_LABELS`,
`PHARMACY_REPORT_REASONS`.
Section M: `SAMPLE_TYPE_OPTIONS`, `URGENCY_OPTIONS`, `COLLECTION_OPTIONS`,
`FASTING_INSTRUCTION`, `LAB_PACKAGES`.
Section N: `RESULT_STATUS_LABELS`, `RESULT_FLAG_LABELS`,
`RESULT_AUDIT_ACTION_LABELS`, `SUSPICIOUS_RESULT_REASONS`.

> REUSES barrel `DRUG_CATALOGUE`, `ROUTE_OPTIONS`, `FREQUENCY_OPTIONS`,
> `DURATION_OPTIONS`, `EMPTY_DRUG_ITEM`, `LAB_TEST_CATALOGUE` (the richer
> `DRUG_CATALOGUE_RICH` / `DEMO_LAB_CATALOGUE` compose these, not replace them).

---

## 5. Loading / error / empty conventions

- **Loading:** `isLoading` on queries; `DEMO_*` wired as `placeholderData`.
- **Error:** `isError` / `error` on queries; `isPending` / `isError` / `error`
  on mutations.
- **Empty:** array fields are `[]` (never `null`); optional singles are
  `undefined` (`signature?`, `qrPayload?`, `interpretation?`, `coverage?`,
  `provider?`, `getPreferredPharmacy` may resolve `undefined`).
- **Money:** integers in kobo; format with `formatKobo` (e.g.
  `LabCatalogueEntry.priceKobo`, `LabCoverageCheck.patientPayKobo`,
  `DrugAlternative.priceKobo`, `DrugStock.unitPriceKobo`, `LabPackage.priceKobo`).
```
