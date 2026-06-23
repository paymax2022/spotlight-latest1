# Doctor API Contract — Batch 5 (sections S · T · U · V — Veterinary)

Reference for the Frontend role. ADDITIVE to the Phase 1 / Phase 2 / Section B /
Phase 3 / Batch 1 / Batch 2 / Batch 3 / Batch 4 contracts. All data is **demo
data** resolved with simulated latency (`wait()`); Phase C swaps bodies for live
endpoints + the `Idempotency-Key` header (each mutation carries a `// TODO(Phase
C)` for the live wire-up). Money is always an integer in **kobo**. Path alias is
`@/` → `src/`. Use `import type` for type-only imports.

- Types:     `@/types/doctor.batch5`   (re-exports the primitives it reuses)
- API:       `@/api/doctor.batch5.api` (Frontend should NOT call these directly — use hooks; exceptions: `formatKobo`, `computePetDosage`, `checkPetRxWarnings`)
- Hooks:     `@/features/doctor/hooks` (same barrel as earlier phases)
- Constants: `@/features/doctor/constants` (same barrel; Batch 5 lists re-exported from `batch5`)

**Consolidation + reuse:** Batch 5 is the veterinary contract and is built almost
entirely on **reuse**. Phase 3 already shipped the vet dashboard, pet profile,
pet prescription, pet lab and pet store; Batch 5 adds only the *missing* vet
pieces and richer variants. Vet chat / audio / video / SOAP **reuse the Batch 2
rich human-side types** (`ChatMessageRich`, `ChatThreadState`, `CallSessionRich`,
`ClinicalNote`) via thin pet-context wrappers. Pet emergency warning **reuses
`RedFlagWarning`**. Follow-up **reuses the Phase 2 `FollowUpPlan`**. Granular
variants (statuses, warning kinds, fulfilment steps, urgencies) are **states/data**,
not separate entities. See the Ownership Map for which spec entries are full
screens vs states vs reuse-existing.

---

## 1. Exported types (`@/types/doctor.batch5`)

**Re-exported from Phase 3 (`@/types/doctor.phase3`):** `PetSpecies`,
`PetProfile`, `PetOwner`, `PetConsultSummary`, `PetVaccination`, `PetDrug`,
`PetDrugCategory`, `PetDosageCalculation`, `PetPrescription`,
`PetPrescriptionItem`, `PetPrescriptionWarning`, `PetWarningSeverity`,
`PetLabTest`, `PetLabCategory`, `PetLabOrder`, `PetLabResult`,
`PetLabResultValue`, `PetStoreProduct`, `PetProductCategory`,
`PetProductRecommendation`.
**From Batch 2 (`@/types/doctor.batch2`):** `ChatMessageRich`, `ChatThreadState`,
`CallSessionRich`, `ClinicalNote`, `RedFlagWarning`.
**From Phase 2 (`@/types/doctor.phase2`):** `FollowUpPlan`, `SpecialistReferral`.
**From Phase 1 (`@/types/doctor`):** `LabOrderStatus`.

### Section S — Veterinary Consultation
`VetConsultType`, `VetAppointmentStatus`, `VetAppointment`,
`PetOwnerRequestStatus`, `PetOwnerRequest`, `VetChatThread` (composes
`ChatThreadState` + `ChatMessageRich[]`), `VetCallSession` (composes
`CallSessionRich`), `VetClinicalNote` (composes `ClinicalNote`),
`PetEmergencyWarning` (extends `RedFlagWarning`), `VetReferralStatus`,
`VetSpecialist`, `VetReferral`, `VetConsultSummary`, `VetConsultHistoryItem`.

### Section T — Pet E-Prescription
`PetRxWarningKind`, `PetRxWarning`, `ComputePetDosageInput`,
`CheckPetRxWarningsInput`, `PetPharmacy`, `PetRxSendStatus`, `PetRxAuditAction`,
`PetRxAuditEntry`, `IssuedPetPrescription` (composes `PetPrescription`),
`PetRefillStatus`, `PetRefillRequest`.

### Section U — Vet Lab & Pet Health
`PetLabCatalogueEntry` (composes `PetLabTest`), `PetLabResultInboxItem`
(composes `PetLabResult`), `PetLabInterpretation`, `PetVaccinationUrgency`,
`PetVaccinationRecommendation`, `PetVaccinationReminder`, `PetHealthRecord`,
`PetGrowthPoint`, `PetGrowthHistory`, `PetChronicTrend`,
`PetChronicMonitoringEntry`, `PetLabOrderStatus` (alias of `LabOrderStatus`).

### Section V — Pet Store / Vet-Recommended Products
`PetProductDetail` (composes `PetStoreProduct`), `PetFulfilmentStatus`,
`PetFulfilmentEvent`, `PetProductDelivery`, `PetProductFulfilment`.

### Mutation inputs / results
S: `RespondToPetRequestInput/Result`, `SaveVetSoapNoteInput/Result`,
`CreateVetReferralInput/Result`.
T: `IssuePetPrescriptionInput/Result`, `SendPetRxToPharmacyInput/Result`,
`RequestPetRefillInput/Result`, `ReviewPetRefillInput/Result`.
U: `AddPetLabInterpretationInput/Result`, `SetPetVaccinationReminderInput/Result`,
`RecordPetGrowthInput/Result`, `SavePetChronicMonitoringInput/Result`.
V: `ShareProductWithOwnerInput/Result`.

Every mutation input carries `idempotencyKey: string`; the hooks auto-generate it,
so callers pass `Omit<Input, 'idempotencyKey'>`.

---

## 2. API functions (`@/api/doctor.batch5.api`)

> Frontend uses the **hooks**, not these directly. Re-exported helpers
> (`formatKobo`, `computePetDosage`, `checkPetRxWarnings`) are the exception.

### Pure helpers (no I/O)
```ts
computePetDosage(drug: PetDrug, weightKg: number): PetDosageCalculation
//   → dose-by-weight: dosePerKgMg{Low,High} * weightKg, suggested = rounded midpoint.
checkPetRxWarnings(drug: PetDrug, species: PetSpecies, allergies: string[]): PetRxWarning[]
//   → species_contraindication (danger) + allergy (danger) + medicine (caution) variants.
```

### Reads
```ts
// Section S
getVetAppointments(): Promise<VetAppointment[]>
getPetOwnerRequests(): Promise<PetOwnerRequest[]>
getVetChatThread(petId: string): Promise<VetChatThread>
getVetCallSession(petId: string): Promise<VetCallSession>
getVetSoapNote(petId: string): Promise<VetClinicalNote>
getPetEmergencyWarnings(petId: string): Promise<PetEmergencyWarning[]>
getVetSpecialists(): Promise<VetSpecialist[]>
getVetReferrals(petId: string): Promise<VetReferral[]>
getVetConsultSummary(consultId: string): Promise<VetConsultSummary>
getVetConsultHistory(): Promise<VetConsultHistoryItem[]>
// Section T
getPetPharmacies(): Promise<PetPharmacy[]>
getIssuedPetPrescription(prescriptionId: string): Promise<IssuedPetPrescription>
getPetRefillRequests(): Promise<PetRefillRequest[]>
// Section U
getPetLabCatalogue(species?: PetSpecies): Promise<PetLabCatalogueEntry[]>
getPetLabInbox(): Promise<PetLabResultInboxItem[]>
getPetVaccinationRecommendations(petId: string): Promise<PetVaccinationRecommendation[]>
getPetVaccinationReminders(petId: string): Promise<PetVaccinationReminder[]>
getPetHealthRecord(petId: string): Promise<PetHealthRecord>
getPetGrowthHistory(petId: string): Promise<PetGrowthHistory>
getPetChronicMonitoring(petId: string): Promise<PetChronicMonitoringEntry[]>
// Section V
getPetProductDetail(productId: string): Promise<PetProductDetail>
getPetProductFulfilments(): Promise<PetProductFulfilment[]>
getPetProductFulfilment(id: string): Promise<PetProductFulfilment | undefined>
```

### Mutations (each takes its full `*Input` incl. `idempotencyKey`)
```ts
// Section S
respondToPetRequest(input): Promise<RespondToPetRequestResult>
saveVetSoapNote(input): Promise<SaveVetSoapNoteResult>
createVetReferral(input): Promise<CreateVetReferralResult>
// Section T
issuePetPrescription(input): Promise<IssuePetPrescriptionResult>
sendPetRxToPharmacy(input): Promise<SendPetRxToPharmacyResult>
requestPetRefill(input): Promise<RequestPetRefillResult>
reviewPetRefill(input): Promise<ReviewPetRefillResult>
// Section U
addPetLabInterpretation(input): Promise<AddPetLabInterpretationResult>
setPetVaccinationReminder(input): Promise<SetPetVaccinationReminderResult>
recordPetGrowth(input): Promise<RecordPetGrowthResult>
savePetChronicMonitoring(input): Promise<SavePetChronicMonitoringResult>
// Section V
shareProductWithOwner(input): Promise<ShareProductWithOwnerResult>
```

### DEMO_* exports (double as `placeholderData`)
`DEMO_VET_APPOINTMENTS`, `DEMO_PET_OWNER_REQUESTS`, `DEMO_VET_CHAT_THREAD`,
`DEMO_VET_CALL_SESSION`, `DEMO_VET_CLINICAL_NOTE`, `DEMO_PET_EMERGENCY_WARNINGS`,
`DEMO_VET_SPECIALISTS`, `DEMO_VET_REFERRALS`, `DEMO_VET_CONSULT_SUMMARY`,
`DEMO_VET_CONSULT_HISTORY`, `DEMO_PET_PHARMACIES`,
`DEMO_ISSUED_PET_PRESCRIPTION`, `DEMO_PET_REFILL_REQUESTS`,
`DEMO_PET_LAB_CATALOGUE`, `DEMO_PET_LAB_INBOX`,
`DEMO_PET_VACCINATION_RECOMMENDATIONS`, `DEMO_PET_VACCINATION_REMINDERS`,
`DEMO_PET_HEALTH_RECORD`, `DEMO_PET_GROWTH_HISTORY`,
`DEMO_PET_CHRONIC_MONITORING`, `DEMO_PET_PRODUCT_DETAIL`,
`DEMO_PET_PRODUCT_FULFILMENTS`.

---

## 3. Hooks (`@/features/doctor/hooks`)

Query keys are all under `['doctor', 'vet', …]`. Reads use the matching `DEMO_*`
as `placeholderData`. Mutations auto-generate `idempotencyKey` (callers pass
`Omit<Input, 'idempotencyKey'>`) and invalidate the relevant query keys.

### `useVetConsult.ts` (Section S)
`useVetAppointments()`, `usePetOwnerRequests()`, `useVetChatThread(petId)`,
`useVetCallSession(petId)`, `useVetSoapNote(petId)`,
`usePetEmergencyWarnings(petId)`, `useVetSpecialists()`, `useVetReferrals(petId)`,
`useVetConsultSummary(consultId)`, `useVetConsultHistory()`;
mutations `useRespondToPetRequest()`, `useSaveVetSoapNote()`,
`useCreateVetReferral()`.

### `usePetRx.ts` (Section T)
`usePetPharmacies()`, `useIssuedPetPrescription(prescriptionId)`,
`usePetRefillRequests()`; mutations `useIssuePetPrescription()`,
`useSendPetRxToPharmacy()`, `useRequestPetRefill()`, `useReviewPetRefill()`.
**Re-exports the pure helpers** `computePetDosage`, `checkPetRxWarnings` for UI.
> REUSE: create-draft uses the Phase 3 `useCreatePetPrescription`.

### `usePetHealth.ts` (Section U)
`usePetLabCatalogue(species?)`, `usePetLabInbox()`,
`usePetVaccinationRecommendations(petId)`, `usePetVaccinationReminders(petId)`,
`usePetHealthRecord(petId)`, `usePetGrowthHistory(petId)`,
`usePetChronicMonitoring(petId)`; mutations `useAddPetLabInterpretation()`,
`useSetPetVaccinationReminder()`, `useRecordPetGrowth()`,
`useSavePetChronicMonitoring()`.
> REUSE: create lab order / mark reviewed use the Phase 3 `useCreatePetLabOrder`
> / `useMarkPetLabResultReviewed` and `usePetLabResult`.

### `usePetStore.ts` (Section V)
`usePetProductDetail(productId)`, `usePetProductFulfilments()`,
`usePetProductFulfilment(id)`; mutation `useShareProductWithOwner()`.
> REUSE: product search / recommend use the Phase 3 `usePetProducts` /
> `usePetRecommendations` / `useRecommendProducts`.

---

## 4. Constants (`@/features/doctor/constants`, from `batch5`)

**REUSE (re-exported from Phase 3 `phase3.ts` for a single import site):**
`PET_SPECIES_OPTIONS`, `PET_SPECIES_LABELS`, `PET_BREED_OPTIONS`,
`PET_DRUG_CATALOGUE`, `PET_DRUG_CATEGORY_LABELS`, `PET_LAB_TESTS`,
`PET_LAB_CATEGORY_LABELS`, `PET_PRODUCT_CATEGORIES`,
`PET_WARNING_SEVERITY_LABELS`, `PET_WARNING_SEVERITY_TONES`.

**ADDED:** `VET_CONSULT_TYPE_OPTIONS`, `VET_CONSULT_TYPE_LABELS`,
`VET_APPOINTMENT_STATUS_LABELS`, `PET_OWNER_REQUEST_STATUS_LABELS`,
`VET_REFERRAL_STATUS_LABELS`, `VET_REFERRAL_URGENCY_OPTIONS`,
`PET_RX_WARNING_LABELS`, `PET_RX_WARNING_KIND_SEVERITY`,
`PET_RX_SEND_STATUS_LABELS`, `PET_REFILL_STATUS_LABELS`, `DOSAGE_UNIT_OPTIONS`,
`PET_VACCINATION_URGENCY_LABELS`, `PET_VACCINATION_URGENCY_TONES`,
`PET_VACCINE_OPTIONS`, `VACCINATION_REMINDER_CHANNEL_OPTIONS`,
`PET_LAB_PACKAGES`, `PET_CHRONIC_TREND_LABELS`, `PET_CHRONIC_TREND_TONES`,
`PET_FULFILMENT_STATUS_LABELS`, `PET_FULFILMENT_STATUS_RANK`.

---

## 5. Loading / error / empty conventions (same as prior batches)

- **Loading:** reads expose `isLoading` / `isPending`; `placeholderData` (the
  `DEMO_*`) renders immediately so screens never flash blank. Show skeletons only
  where the screen has no placeholder (e.g. `useVetCallSession` mid-call).
- **Error:** reads expose `isError` / `error`; render an inline retry. Mutations
  expose `isPending` / `isError`; disable the submit control while pending and
  surface a toast on error.
- **Empty:** list reads (`useVetAppointments`, `usePetOwnerRequests`,
  `usePetRefillRequests`, `usePetLabInbox`, `usePetProductFulfilments`,
  `useVetConsultHistory`) can resolve to `[]` — render an empty state with the
  primary CTA.
- **Money:** all `*Kobo` fields are integers in kobo — format with `formatKobo`.
- **Idempotency:** never construct keys in the UI — the hooks generate them.
