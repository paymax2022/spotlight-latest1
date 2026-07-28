# Doctor Batch 3 — File Ownership Map

Batch 3 = spec **sections K, L, M, N**. This is **additive** to Phase 1,
Phase 2, Section B, Phase 3, Batch 1 and Batch 2: nothing in earlier contracts
is edited (only the hooks/constants barrels gain new export lines). Money is
always integers in **kobo**.

**Consolidation principle:** granular variants (each warning kind, each
lifecycle step, each status, alternatives, edit/cancel/expired, audit) are
modelled as **states/data** on top of the existing entities, not as separate
entities. The tables below mark each entry as a **full screen**, a **STATE of**
an existing/sibling screen, a **SHEET on** a screen, or a **REUSES existing**
route/hook. Sections L, M and N are **mostly reuse** of Phase 1 / Phase 2.

## Ownership boundaries (do not cross)

### BACKEND (data/type contract) — owns
- `src/types/doctor.batch3.ts`                          *(new)*
- `src/api/doctor.batch3.api.ts`                         *(new)*
- `src/features/doctor/hooks/useEprescription.ts`        *(new — Section K)*
- `src/features/doctor/hooks/usePharmacyFulfil.ts`       *(new — Section L)*
- `src/features/doctor/hooks/useLabOrdering.ts`          *(new — Section M)*
- `src/features/doctor/hooks/useLabResults.ts`           *(new — Section N)*
- `src/features/doctor/constants/batch3.ts`              *(new)*
- `src/features/doctor/hooks/index.ts`                   *(edited — additive export lines only)*
- `src/features/doctor/constants/index.ts`              *(edited — additive export line only)*

> Backend continues to own the Phase 1 / 2 / Section B / Phase 3 / Batch 1 / 2 files unchanged.

### FRONTEND (screens/UI) — owns
- `app/(doctor)/**` (all route files), in particular the screens Batch 3 extends:
  - `app/(doctor)/consult/[id]/prescription.tsx`   (Section K — builder)
  - `app/(doctor)/prescriptions/index.tsx`         (Section K — list/lifecycle)
  - `app/(doctor)/consult/[id]/lab-order.tsx`      (Section M — builder)
  - `app/(doctor)/pharmacy/index.tsx`              (Section L — fulfilments)
  - `app/(doctor)/pharmacy/[id].tsx`               (Section L — detail/messages)
  - `app/(doctor)/pharmacy/[id]/delivery.tsx`      (Section L — delivery/alerts)
  - `app/(doctor)/refills/index.tsx`               (Section K/L — refills)
  - `app/(doctor)/lab/[orderId].tsx`               (Section N — result review)
- `src/features/doctor/components/**`

### QA — owns
- `docs/QA_DOCTOR_BATCH3_REPORT.md`

> Frontend consumes Backend's hooks/types only — never imports from
> `doctor.batch3.api.ts` directly (use the hooks; pure helpers
> `checkPrescriptionWarnings`, `searchDrugCatalogue`, `getDrugAlternatives`,
> `checkLabCoverage` and `formatKobo` re-exported via the hooks/api are the
> exception). All money is kobo; format with `formatKobo`.

---

## Reused existing work (do NOT recreate)

| Area | Existing asset | Reused hook / type |
|------|----------------|--------------------|
| Prescription builder (base) | Phase 1 | `useCreatePrescription`, `usePrescriptions`, `usePrescription`, `PrescriptionDrugItem`, `PrescriptionDraft`, `CreatePrescriptionInput`, `DoctorPrescription` (embedded as `IssuedPrescription.base` / `RxDrugLine.base`) |
| Drug / route / frequency / duration lists | barrel | `DRUG_CATALOGUE`, `ROUTE_OPTIONS`, `FREQUENCY_OPTIONS`, `DURATION_OPTIONS`, `EMPTY_DRUG_ITEM` |
| Refill request/approve/reject | Phase 2 | `RefillRequest`, `RefillStatus`, `reviewRefill`, `useReviewRefill`, `useRefillRequests`, `useRefillRequest` |
| Pharmacy fulfilment / substitute / delivery | Phase 2 | `PharmacyFulfilment`, `PharmacyFulfilmentStatus`, `SubstituteDrug`, `DrugDelivery`, `DeliveryStage`, `DeliveryEvent`, `reviewSubstitute`, `useReviewSubstitute`, `usePharmacyFulfilments`, `usePharmacyFulfilment`, `useDrugDeliveries`, `useDrugDelivery` |
| Lab ordering (base) | Phase 1 | `LabTest`, `LabOrder`, `LabOrderStatus`, `CreateLabOrderInput`, `useCreateLabOrder`, `useLabOrders` (embedded as `LabCatalogueEntry.base` / `LabOrderRich.base`) |
| Lab test catalogue | barrel | `LAB_TEST_CATALOGUE` (composed into `DEMO_LAB_CATALOGUE`) |
| Lab results (base) | Phase 1 | `LabResult`, `LabResultValue`, `useLabResult`, `useMarkLabResultReviewed` (embedded as `LabResultRich.base` / `LabResultValueRich.base`) |
| HMO coverage | Phase 1 | `HmoCoverage` concept (informs `LabCoverageCheck`) |

REUSED constants (from the barrel — not duplicated): `DRUG_CATALOGUE`,
`ROUTE_OPTIONS`, `FREQUENCY_OPTIONS`, `DURATION_OPTIONS`, `EMPTY_DRUG_ITEM`,
`LAB_TEST_CATALOGUE`.

---

## SECTION K — E-Prescription (45)

Extends `consult/[id]/prescription.tsx` (builder) and `prescriptions/index.tsx`
(list/lifecycle). The plain create path REUSES Phase 1 `useCreatePrescription`;
everything else layers on `RxDrugLine` + `IssuedPrescription`. Refills REUSE the
Phase 2 `RefillRequest` / `useReviewRefill`. Hooks: `useIssuedPrescription`,
`useIssuePrescription`, `useCancelPrescription`, `useSharePrescription`,
`useSendToPharmacy`, `useRequestRefillConsultation`; pure helpers
`checkPrescriptionWarnings`, `searchDrugCatalogue`, `getDrugAlternatives`.

| # | Spec entry | Ownership | Data / hook |
|---|-----------|-----------|-------------|
| K1 | start prescription | full screen `consult/[id]/prescription` | `useCreatePrescription` (Phase 1) |
| K2 | add drug | STATE of prescription | `RxDrugLine` + `EMPTY_DRUG_ITEM` |
| K3 | drug search | SHEET on prescription | `searchDrugCatalogue()` over `DRUG_CATALOGUE_RICH` |
| K4 | drug catalogue | SHEET on prescription | `DrugCatalogueEntry` (`DRUG_CATALOGUE_RICH`) |
| K5 | strength select | STATE of prescription | `RxDrugLine.strength` + `STRENGTH_OPTIONS` |
| K6 | dosage form select | STATE of prescription | `RxDrugLine.dosageForm` + `DOSAGE_FORM_OPTIONS` |
| K7 | route select | STATE of prescription | `RxDrugLine.route` + `ROUTE_OPTIONS` (reuse) |
| K8 | frequency select | STATE of prescription | `RxDrugLine.base.frequency` + `FREQUENCY_OPTIONS` (reuse) |
| K9 | duration select | STATE of prescription | `RxDrugLine.base.duration` + `DURATION_OPTIONS` (reuse) |
| K10 | before/after food | STATE of prescription | `RxDrugLine.beforeAfterFood` + `FOOD_TIMING_OPTIONS` |
| K11 | special instruction | STATE of prescription | `RxDrugLine.specialInstruction` |
| K12 | quantity | STATE of prescription | `RxDrugLine.quantity` |
| K13 | generic alternatives | SHEET on prescription | `getDrugAlternatives()` (kind `generic`) |
| K14 | brand alternatives | SHEET on prescription | `getDrugAlternatives()` (kind `brand`) |
| K15 | interaction warning | STATE (banner) of prescription | `RxWarning` kind `interaction` (`checkPrescriptionWarnings`) |
| K16 | duplicate-drug warning | STATE (banner) of prescription | `RxWarning` kind `duplicate` |
| K17 | contraindication warning | STATE (banner) of prescription | `RxWarning` kind `contraindication` |
| K18 | controlled-substance warning | STATE (banner) of prescription | `RxWarning` kind `controlled` |
| K19 | pregnancy/breastfeeding warning | STATE (banner) of prescription | `RxWarning` kind `pregnancy_breastfeeding` |
| K20 | paediatric-dose warning | STATE (banner) of prescription | `RxWarning` kind `paediatric_dose` |
| K21 | elderly-dose warning | STATE (banner) of prescription | `RxWarning` kind `elderly_dose` |
| K22 | warning severity tone | STATE of prescription | `RxWarning.severity` + `RX_WARNING_TONES` |
| K23 | safety check summary | STATE of prescription | `checkPrescriptionWarnings()` → `RxWarning[]` |
| K24 | draft | STATE of prescription | `RxLifecycleStatus === 'draft'` |
| K25 | preview | SHEET on prescription | `RxLifecycleStatus === 'preview'` (`IssuedPrescription`) |
| K26 | digital signature | SHEET on prescription | `RxDigitalSignature` via `useIssuePrescription` |
| K27 | sign prescription | STATE of prescription | `RxLifecycleStatus === 'signed'` |
| K28 | issue prescription | STATE of prescription | `useIssuePrescription` → `'issued'` |
| K29 | QR / verification code | STATE of prescription | `IssuedPrescription.qrPayload` / `verificationCode` |
| K30 | issued prescription detail | full screen `prescriptions/index` (detail) | `useIssuedPrescription` |
| K31 | prescription expired | STATE of prescription | `RxLifecycleStatus === 'expired'` / `validUntil` |
| K32 | cancel prescription | STATE of prescription | `useCancelPrescription` + `RX_CANCEL_REASONS` |
| K33 | edit prescription (pre-issue) | STATE of prescription | `RxLifecycleStatus === 'draft'` (editable) |
| K34 | share prescription | SHEET on prescription | `useSharePrescription` |
| K35 | send to pharmacy | SHEET on prescription | `useSendToPharmacy` + `RX_FULFILMENT_OPTION_LABELS` |
| K36 | choose fulfilment option | STATE of prescription | `RxFulfilmentOption` + `RX_FULFILMENT_OPTION_LABELS` |
| K37 | prescription list | full screen `prescriptions/index` | REUSES `usePrescriptions` (Phase 1) |
| K38 | prescription audit trail | SHEET on prescription | `IssuedPrescription.audit[]` + `AUDIT_ACTION_LABELS` |
| K39 | refill request | REUSES Phase 2 | `RefillRequest`, `useRefillRequests` |
| K40 | approve refill | STATE of refills | `useReviewRefill` (decision `approve`) |
| K41 | reject refill | STATE of refills | `useReviewRefill` (decision `reject`) |
| K42 | refill consultation required | SHEET on refills | `useRequestRefillConsultation` |
| K43 | prescription status badge | STATE of prescription | `RxLifecycleStatus` + `RX_LIFECYCLE_LABELS` |
| K44 | validity window | STATE of prescription | `IssuedPrescription.validUntil` + `RX_VALIDITY_DAYS` |
| K45 | prescription drug line summary | SECTION of prescription | `RxDrugLine[]` (`IssuedPrescription.lines`) |

---

## SECTION L — Pharmacy & Drug Fulfilment (21)

Mostly **REUSES Phase 2** (`usePharmacyFulfilments`, `useDrugDeliveries`,
`useReviewSubstitute`). Extends `pharmacy/index.tsx`, `pharmacy/[id].tsx`,
`pharmacy/[id]/delivery.tsx`. New hooks: `usePharmacies`, `usePreferredPharmacy`,
`useDrugStock`, `usePharmacyMessages`, `useDeliveryAlerts`, `useSelectPharmacy`,
`useSendPharmacyMessage`, `useConfirmPatientReceived`, `useReportPharmacy`.

| # | Spec entry | Ownership | Data / hook |
|---|-----------|-----------|-------------|
| L1 | pharmacy fulfilments list | REUSES Phase 2 | `usePharmacyFulfilments`, `PharmacyFulfilment` |
| L2 | fulfilment detail | REUSES Phase 2 | `usePharmacyFulfilment` |
| L3 | nearby pharmacy lookup | SHEET on pharmacy | `usePharmacies` (`Pharmacy[]`, sorted by `distanceKm`) |
| L4 | preferred pharmacy | STATE of pharmacy | `usePreferredPharmacy` / `Pharmacy.isPreferred` |
| L5 | verified-pharmacy badge | STATE of pharmacy | `Pharmacy.verified` |
| L6 | select pharmacy | STATE of pharmacy | `useSelectPharmacy` |
| L7 | drug stock availability | STATE of pharmacy | `useDrugStock` (`DrugStock`) + `STOCK_LEVEL_LABELS` |
| L8 | drug-unavailable alert | STATE (banner) of pharmacy | `DrugStock.level === 'out_of_stock'` |
| L9 | substitute request | REUSES Phase 2 | `PharmacyFulfilment.substitute` (`SubstituteDrug`) |
| L10 | approve substitute | STATE of fulfilment | `useReviewSubstitute` (decision `approve`) |
| L11 | reject substitute | STATE of fulfilment | `useReviewSubstitute` (decision `reject`) |
| L12 | pharmacy clarification chat | SHEET on fulfilment | `usePharmacyMessages` + `useSendPharmacyMessage` (`PharmacyMessage`) |
| L13 | fulfilment status (partial/full) | STATE of fulfilment | `FulfilmentStatusExt` (`partial`) + `FULFILMENT_STATUS_LABELS` |
| L14 | awaiting payment | STATE of fulfilment | `FulfilmentStatusExt === 'awaiting_payment'` |
| L15 | awaiting HMO | STATE of fulfilment | `FulfilmentStatusExt === 'awaiting_hmo'` |
| L16 | awaiting delivery | STATE of fulfilment | `FulfilmentStatusExt === 'awaiting_delivery'` |
| L17 | delivery tracking | REUSES Phase 2 | `useDrugDeliveries`, `useDrugDelivery`, `DrugDelivery` |
| L18 | delivery delayed/failed alert | STATE (banner) of delivery | `useDeliveryAlerts` (`DeliveryAlert`) |
| L19 | patient-received confirmation | STATE of fulfilment | `useConfirmPatientReceived` → `'received_by_patient'` |
| L20 | pharmacy complaint/report | SHEET on pharmacy | `useReportPharmacy` + `PHARMACY_REPORT_REASONS` |
| L21 | pharmacy message thread | SHEET on fulfilment | `usePharmacyMessages` (`PharmacyMessage[]`) |

---

## SECTION M — Lab Test Ordering (26)

Extends `consult/[id]/lab-order.tsx`. The plain order-create path REUSES Phase 1
`useCreateLabOrder` / `useLabOrders`; everything layers on `LabCatalogueEntry`,
`LabPackage`, `LabProvider`, `LabCoverageCheck`, `LabOrderRich`. Hooks:
`useLabCatalogue`, `useLabPackages`, `useLabProviders`, `useLabOrderRich`,
`useShareLabOrder`, `useCancelLabOrder`; pure helper `checkLabCoverage`.

| # | Spec entry | Ownership | Data / hook |
|---|-----------|-----------|-------------|
| M1 | start lab order | full screen `consult/[id]/lab-order` | `useCreateLabOrder` (Phase 1) |
| M2 | lab catalogue | SHEET on lab-order | `useLabCatalogue` (`LabCatalogueEntry`) |
| M3 | test search/select | STATE of lab-order | `LabCatalogueEntry.base` (reuse `LabTest`) |
| M4 | lab packages | SHEET on lab-order | `useLabPackages` (`LabPackage`) + `LAB_PACKAGES` |
| M5 | reason / diagnosis link | STATE of lab-order | `LabOrderRich.reason` / `linkedDiagnosis` |
| M6 | sample type | STATE of lab-order | `LabCatalogueEntry.sampleType` + `SAMPLE_TYPE_OPTIONS` |
| M7 | sample-type instruction | STATE of lab-order | `LabCatalogueEntry.sampleInstruction` |
| M8 | fasting requirement | STATE of lab-order | `LabCatalogueEntry.fastingRequired` + `FASTING_INSTRUCTION` |
| M9 | fasting hours | STATE of lab-order | `LabCatalogueEntry.fastingHours` |
| M10 | urgency | STATE of lab-order | `LabOrderRich.urgency` + `URGENCY_OPTIONS` |
| M11 | home collection | STATE of lab-order | `CollectionMode === 'home_collection'` + `COLLECTION_OPTIONS` |
| M12 | lab visit | STATE of lab-order | `CollectionMode === 'lab_visit'` |
| M13 | lab provider lookup | SHEET on lab-order | `useLabProviders` (`LabProvider`) |
| M14 | verified-lab badge | STATE of lab-order | `LabProvider.verified` |
| M15 | recommended provider | STATE of lab-order | `LabProvider.recommended` |
| M16 | select provider | STATE of lab-order | `LabOrderRich.provider` |
| M17 | HMO-covered check | STATE of lab-order | `checkLabCoverage()` (`LabCoverageCheck`) |
| M18 | patient-payment notice | STATE (banner) of lab-order | `LabCoverageCheck.patientPayKobo` (kobo) |
| M19 | order price | STATE of lab-order | `LabCatalogueEntry.priceKobo` (kobo, `formatKobo`) |
| M20 | turnaround | STATE of lab-order | `LabCatalogueEntry.turnaroundHours` |
| M21 | preview | SHEET on lab-order | `LabOrderRich` (read view) |
| M22 | submit / success | STATE of lab-order | `useCreateLabOrder` → `CreateLabOrderResult` |
| M23 | share lab order | SHEET on lab-order | `useShareLabOrder` |
| M24 | lab order history | REUSES Phase 1 | `useLabOrders`, `LabOrder[]` |
| M25 | cancel lab order | STATE of lab-order | `useCancelLabOrder` |
| M26 | lab order expired | STATE of lab-order | `LabOrderRich.validUntil` |

---

## SECTION N — Lab Result Review (20)

Extends `lab/[orderId].tsx` (result review). The base result + mark-reviewed
REUSE Phase 1 `useLabResult` / `useMarkLabResultReviewed`; everything layers on
`LabResultRich`, `LabResultInbox`, `LabResultValueRich`, `LabValueComparison`,
`LabInterpretation`. Hooks: `useResultInbox`, `useLabResultRich`,
`useLabValueComparisons`, `useAddInterpretation`, `useRequestRepeatTest`,
`useShareResultExplanation`, `useReportSuspiciousResult`.

| # | Spec entry | Ownership | Data / hook |
|---|-----------|-----------|-------------|
| N1 | results inbox | full screen (inbox) | `useResultInbox` (`LabResultInbox[]`) |
| N2 | result status (pending/ready/delayed) | STATE of inbox | `LabResultStatus` + `RESULT_STATUS_LABELS` |
| N3 | new-result flag | STATE of inbox | `LabResultInbox.isNew` |
| N4 | critical-result alert | STATE (banner) of inbox/detail | `LabResultInbox.hasCritical` / `LabResultRich.hasCritical` |
| N5 | result detail | full screen `lab/[orderId]` | `useLabResultRich` |
| N6 | base result | REUSES Phase 1 | `useLabResult`, `LabResult` (`LabResultRich.base`) |
| N7 | PDF report | SHEET on result | `LabResultRich.pdfReportUrl` |
| N8 | structured values | SECTION of result | `LabResultValueRich[]` (reuse `LabResultValue` as `base`) |
| N9 | abnormal-value flag | STATE of result | `LabResultValueRich.abnormal` + `RESULT_FLAG_LABELS` |
| N10 | critical-value flag | STATE of result | `LabResultValueRich.critical` |
| N11 | reference ranges | STATE of result | `LabResultValueRich.refLow` / `refHigh` / `base.refRange` |
| N12 | compare with previous | SHEET on result | `useLabValueComparisons` (`LabValueComparison` timeseries) |
| N13 | doctor interpretation | SECTION of result | `useAddInterpretation` (`LabInterpretation`) |
| N14 | recommendation | STATE of result | `LabInterpretation.recommendation` |
| N15 | mark reviewed | REUSES Phase 1 | `useMarkLabResultReviewed` |
| N16 | request repeat / additional test | SHEET on result | `useRequestRepeatTest` |
| N17 | share explanation with patient | SHEET on result | `useShareResultExplanation` |
| N18 | schedule follow-up from result | STATE of result | REUSES Phase 2 `useCreateFollowUp` (follow-up flow) |
| N19 | refer to specialist from result | STATE of result | REUSES Phase 2 `useCreateReferral` (referral flow) |
| N20 | download / audit / suspicious report | SHEET on result | `LabResultRich.pdfReportUrl`, `LabResultRich.audit[]` + `RESULT_AUDIT_ACTION_LABELS`, `useReportSuspiciousResult` |

> N18 / N19 deliberately REUSE the Phase 2 follow-up and referral flows
> (`useCreateFollowUp`, `useCreateReferral`) launched from the result screen —
> no new entities are created for them.

---

## Loading / error / empty conventions

Same as earlier batches:
- **Loading:** queries return `isLoading`; `DEMO_*` are wired as `placeholderData`
  so screens render immediately with demo content.
- **Error:** queries expose `isError` / `error`; mutations expose
  `isError` / `error` / `isPending`.
- **Empty:** array fields are `[]` (never `null`); optional single objects are
  `undefined` (`signature?`, `interpretation?`, `coverage?`, `provider?`,
  `preferred pharmacy` may be `undefined`).
- **Money:** integers in kobo; format with `formatKobo`.
