# Doctor Batch 5 — File Ownership Map

Batch 5 = spec **sections S · T · U · V** (the VETERINARY sections). This is
**additive** to Phase 1, Phase 2, Section B, Phase 3 and Batch 1–4: nothing in
earlier contracts is edited (only the hooks/constants barrels gain new export
lines). Money is always integers in **kobo**.

**Consolidation + reuse principle:** granular variants (every status, warning
kind, fulfilment step, urgency) are modelled as **states/data** on top of a
small set of entities, not as separate entities. Batch 5 leans **heavily on the
Phase 3 vet/pet work** (pet profile, pet prescription, pet lab, pet store) and
on the **Batch 2 human-side rich types** for the vet chat / audio / video / SOAP
analogues, plus **Phase 2 follow-up / referral** concepts. The tables below mark
each spec entry as a **full screen**, a **STATE of** an existing/sibling screen,
a **SHEET on** a screen, or a **REUSES existing** route/hook.

## Ownership boundaries (do not cross)

### BACKEND (data/type contract) — owns
- `src/types/doctor.batch5.ts`                          *(new)*
- `src/api/doctor.batch5.api.ts`                         *(new — incl. pure helpers `computePetDosage`, `checkPetRxWarnings`)*
- `src/features/doctor/hooks/useVetConsult.ts`           *(new — Section S)*
- `src/features/doctor/hooks/usePetRx.ts`                *(new — Section T)*
- `src/features/doctor/hooks/usePetHealth.ts`            *(new — Section U)*
- `src/features/doctor/hooks/usePetStore.ts`             *(new — Section V)*
- `src/features/doctor/constants/batch5.ts`              *(new)*
- `src/features/doctor/hooks/index.ts`                   *(edited — additive export lines only)*
- `src/features/doctor/constants/index.ts`              *(edited — additive export line only)*

> Backend continues to own the Phase 1 / 2 / Section B / Phase 3 / Batch 1–4
> files unchanged.

### FRONTEND (screens/UI) — owns
- `app/(doctor)/**` (all route files), in particular the vet screens Batch 5
  extends or adds:
  - `app/(doctor)/vet/index.tsx`                 (S — vet dashboard / appointments, REUSE Phase 3)
  - `app/(doctor)/vet/pet/[id]/index.tsx`        (S/U — pet profile / health record, REUSE Phase 3)
  - `app/(doctor)/vet/pet/[id]/prescription.tsx` (T — pet Rx, REUSE Phase 3 base)
  - `app/(doctor)/vet/pet/[id]/lab-order.tsx`    (U — pet lab order, REUSE Phase 3 base)
  - `app/(doctor)/vet/lab-result/[orderId].tsx`  (U — pet lab result, REUSE Phase 3 base)
  - `app/(doctor)/vet/pet-store.tsx`             (V — pet store, REUSE Phase 3 base)
- `src/features/doctor/components/**`

### QA — owns
- `docs/QA_DOCTOR_BATCH5_REPORT.md`

> Frontend consumes Backend's hooks/types only — never imports from
> `doctor.batch5.api.ts` directly (use the hooks; `formatKobo` and the two pure
> helpers re-exported via the api/hook are the exception). All money is kobo;
> format with `formatKobo`.

---

## Section S — Veterinary Consultation (22)

| # | Spec entry | Ownership | Hook(s) | Type(s) |
|---|---|---|---|---|
| 1 | Vet dashboard | REUSES `vet/index.tsx` + Phase 3 `useVetDashboard` | `useVetDashboard` (Phase 3) | `VetDashboard` (Phase 3) |
| 2 | Vet appointment list | full screen `vet/index.tsx` (queue tab) | `useVetAppointments` | `VetAppointment` |
| 3 | Pet owner request | full screen `vet/requests.tsx` | `usePetOwnerRequests`, `useRespondToPetRequest` | `PetOwnerRequest`, `PetOwnerRequestStatus` |
| 4 | Pet profile review | REUSES `vet/pet/[id]/index.tsx` + Phase 3 `usePetProfile` | `usePetProfile` (Phase 3) | `PetProfile` (Phase 3) |
| 5 | Pet species detail | STATE of pet profile (species field) | `usePetProfile` (Phase 3) | `PetSpecies` (Phase 3) |
| 6 | Pet breed detail | STATE of pet profile (breed field) | `usePetProfile` (Phase 3) | `PetProfile.breed` |
| 7 | Pet age/weight profile | STATE of pet profile (ageMonths/weightKg) | `usePetProfile` (Phase 3) | `PetProfile` (Phase 3) |
| 8 | Pet vaccination history | STATE of pet profile / health record | `usePetProfile`, `usePetHealthRecord` | `PetVaccination` (Phase 3) |
| 9 | Pet medical history | STATE of pet profile / health record | `usePetProfile`, `usePetHealthRecord` | `PetHistoryItem` (Phase 3) |
| 10 | Pet symptoms submitted | STATE of pet profile / owner request | `usePetProfile`, `usePetOwnerRequests` | `PetProfile.symptoms`, `PetOwnerRequest.symptoms` |
| 11 | Pet images/videos uploaded | STATE of pet profile | `usePetProfile` (Phase 3) | `PetImage` (Phase 3) |
| 12 | Vet chat consultation | full screen `vet/pet/[id]/chat.tsx` (REUSE Batch 2 chat) | `useVetChatThread` | `VetChatThread` (composes `ChatThreadState`+`ChatMessageRich`) |
| 13 | Vet audio call | STATE of vet call screen (mode='audio') | `useVetCallSession` | `VetCallSession` (composes `CallSessionRich`) |
| 14 | Vet video call | STATE of vet call screen (mode='video') | `useVetCallSession` | `VetCallSession` (composes `CallSessionRich`) |
| 15 | Vet SOAP notes | full screen `vet/pet/[id]/soap.tsx` (REUSE Batch 2 ClinicalNote) | `useVetSoapNote`, `useSaveVetSoapNote` | `VetClinicalNote` (composes `ClinicalNote`) |
| 16 | Pet diagnosis | STATE of vet SOAP (`diagnosis` field) | `useVetSoapNote` | `VetClinicalNote.diagnosis` |
| 17 | Pet treatment plan | STATE of vet SOAP (`treatmentPlan` field) | `useVetSoapNote` | `VetClinicalNote.treatmentPlan` |
| 18 | Pet emergency warning | SHEET on consult (REUSE `RedFlagWarning`) | `usePetEmergencyWarnings` | `PetEmergencyWarning` (extends `RedFlagWarning`) |
| 19 | Pet follow-up recommendation | REUSES Phase 2 follow-up hooks/screens | Phase 2 follow-up hooks | `FollowUpPlan` (Phase 2, re-exported) |
| 20 | Vet referral | full screen `vet/pet/[id]/referral.tsx` | `useVetReferrals`, `useVetSpecialists`, `useCreateVetReferral` | `VetReferral`, `VetSpecialist`, `VetReferralStatus` |
| 21 | Vet consultation summary | full screen `vet/consult/[id]/summary.tsx` | `useVetConsultSummary` | `VetConsultSummary` |
| 22 | Vet consultation history | full screen `vet/history.tsx` | `useVetConsultHistory` | `VetConsultHistoryItem` |

## Section T — Pet E-Prescription (16)

| # | Spec entry | Ownership | Hook(s) | Type(s) |
|---|---|---|---|---|
| 1 | Create pet prescription | REUSES `vet/pet/[id]/prescription.tsx` + Phase 3 `useCreatePetPrescription` | `useCreatePetPrescription` (Phase 3) | `PetPrescription`, `PetPrescriptionItem` (Phase 3) |
| 2 | Search pet medicine | STATE of Rx screen (`PET_DRUG_CATALOGUE` filter) | — (constant) | `PetDrug` (Phase 3) |
| 3 | Add pet medicine | STATE of Rx screen (add line item) | `useCreatePetPrescription` (Phase 3) | `PetPrescriptionItem` (Phase 3) |
| 4 | Pet dosage calculator | SHEET on Rx screen | pure `computePetDosage` (re-exported from `usePetRx`) | `PetDosageCalculation` (Phase 3), `ComputePetDosageInput` |
| 5 | Dosage by pet weight | STATE of dosage calculator | pure `computePetDosage` | `ComputePetDosageInput` |
| 6 | Pet medicine warning | STATE of Rx preview (`medicine` kind) | pure `checkPetRxWarnings` | `PetRxWarning` (kind=`medicine`) |
| 7 | Species contraindication warning | STATE of Rx preview (`species_contraindication`) | pure `checkPetRxWarnings` | `PetRxWarning` (kind=`species_contraindication`) |
| 8 | Pet allergy warning | STATE of Rx preview (`allergy` kind) | pure `checkPetRxWarnings` | `PetRxWarning` (kind=`allergy`) |
| 9 | Pet prescription preview | STATE of Rx screen (review before issue) | `useCreatePetPrescription` (Phase 3) | `PetPrescription` (Phase 3) |
| 10 | Issue pet prescription | full screen / SHEET `vet/pet/[id]/prescription/issue.tsx` | `useIssuePetPrescription` | `IssuePetPrescription{Input,Result}` |
| 11 | Send to pet pharmacy | SHEET on issued Rx | `usePetPharmacies`, `useSendPetRxToPharmacy` | `PetPharmacy`, `PetRxSendStatus` |
| 12 | Pet prescription history | full screen `vet/prescriptions.tsx` | `useIssuedPetPrescription` | `IssuedPetPrescription` |
| 13 | Pet refill request | STATE of refills screen (status=`requested`) | `useRequestPetRefill` | `PetRefillRequest` |
| 14 | Approve/reject pet refill | full screen `vet/refills.tsx` | `usePetRefillRequests`, `useReviewPetRefill` | `PetRefillRequest`, `PetRefillStatus` |
| 15 | Pet prescription audit trail | STATE of issued-Rx screen (`audit[]`) | `useIssuedPetPrescription` | `PetRxAuditEntry`, `PetRxAuditAction` |
| 16 | (Pet pharmacy directory) | SHEET on send-to-pharmacy | `usePetPharmacies` | `PetPharmacy` |

## Section U — Vet Lab & Pet Health (15)

| # | Spec entry | Ownership | Hook(s) | Type(s) |
|---|---|---|---|---|
| 1 | Create pet lab order | REUSES `vet/pet/[id]/lab-order.tsx` + Phase 3 `useCreatePetLabOrder` | `useCreatePetLabOrder` (Phase 3) | `PetLabOrder` (Phase 3) |
| 2 | Pet lab test catalogue | full screen / SHEET `vet/lab-catalogue.tsx` | `usePetLabCatalogue` | `PetLabCatalogueEntry` |
| 3 | Pet vaccination recommendation | full screen `vet/pet/[id]/vaccinations.tsx` | `usePetVaccinationRecommendations` | `PetVaccinationRecommendation`, `PetVaccinationUrgency` |
| 4 | Pet blood test | STATE of lab order/catalogue (category=`blood`) | `usePetLabCatalogue` | `PetLabCatalogueEntry` |
| 5 | Pet stool test | STATE of lab order/catalogue (category=`stool`) | `usePetLabCatalogue` | `PetLabCatalogueEntry` |
| 6 | Pet imaging referral | STATE of lab order/catalogue (category=`imaging`) | `usePetLabCatalogue` | `PetLabCatalogueEntry` |
| 7 | Pet lab result inbox | full screen `vet/lab-inbox.tsx` | `usePetLabInbox` | `PetLabResultInboxItem` |
| 8 | Pet lab result detail | REUSES `vet/lab-result/[orderId].tsx` + Phase 3 `usePetLabResult` | `usePetLabResult` (Phase 3) | `PetLabResult` (Phase 3) |
| 9 | Pet abnormal result alert | STATE of inbox/detail (`hasAbnormal`) | `usePetLabInbox` | `PetLabResultInboxItem.hasAbnormal` |
| 10 | Pet result interpretation | SHEET on result detail | `useAddPetLabInterpretation` | `PetLabInterpretation`, `AddPetLabInterpretation{Input,Result}` |
| 11 | Pet follow-up from lab result | STATE of interpretation (`followUpRecommended`) | `useAddPetLabInterpretation` | `PetLabInterpretation` |
| 12 | Pet vaccination reminder setup | SHEET on vaccinations screen | `usePetVaccinationReminders`, `useSetPetVaccinationReminder` | `PetVaccinationReminder` |
| 13 | Pet health record | full screen `vet/pet/[id]/health-record.tsx` | `usePetHealthRecord` | `PetHealthRecord` |
| 14 | Pet growth/weight history | STATE of health record / chart screen | `usePetGrowthHistory`, `useRecordPetGrowth` | `PetGrowthHistory`, `PetGrowthPoint` |
| 15 | Pet chronic condition monitoring | full screen `vet/pet/[id]/chronic.tsx` | `usePetChronicMonitoring`, `useSavePetChronicMonitoring` | `PetChronicMonitoringEntry`, `PetChronicTrend` |

## Section V — Pet Store / Vet-Recommended Products (12)

| # | Spec entry | Ownership | Hook(s) | Type(s) |
|---|---|---|---|---|
| 1 | Recommend pet product | REUSES `vet/pet-store.tsx` + Phase 3 `useRecommendProducts` | `useRecommendProducts` (Phase 3) | `PetProductRecommendation` (Phase 3) |
| 2 | Search pet products | REUSES Phase 3 `usePetProducts` | `usePetProducts` (Phase 3) | `PetStoreProduct` (Phase 3) |
| 3 | Pet food rec | STATE of store (category=`food`) | `usePetProducts` (Phase 3) | `PetStoreProduct` (Phase 3) |
| 4 | Pet supplement rec | STATE of store (category=`supplement`) | `usePetProducts` (Phase 3) | `PetStoreProduct` (Phase 3) |
| 5 | Pet grooming rec | STATE of store (category=`grooming`) | `usePetProducts` (Phase 3) | `PetStoreProduct` (Phase 3) |
| 6 | Pet medicine rec | STATE of store (category=`medicine`) | `usePetProducts` (Phase 3) | `PetStoreProduct` (Phase 3) |
| 7 | Vet-approved product list | STATE of store (`vetApproved` filter) | `usePetProducts` (Phase 3) | `PetStoreProduct.vetApproved` |
| 8 | Product detail | full screen / SHEET `vet/product/[id].tsx` | `usePetProductDetail` | `PetProductDetail` |
| 9 | Add recommendation note | STATE of recommend flow (`note` field) | `useRecommendProducts` (Phase 3) | `RecommendProductsInput` (Phase 3) |
| 10 | Share product with pet owner | SHEET on recommendation | `useShareProductWithOwner` | `ShareProductWithOwner{Input,Result}` |
| 11 | Pet store fulfilment status | full screen `vet/fulfilments.tsx` | `usePetProductFulfilments` | `PetProductFulfilment`, `PetFulfilmentStatus` |
| 12 | Pet product delivery status | STATE of fulfilment detail (`delivery.timeline`) | `usePetProductFulfilment` | `PetProductDelivery`, `PetFulfilmentEvent` |

---

## Frontend notes — component reuse

- **Vet chat / audio / video (S.12–14):** reuse the **Batch 2** chat & call
  components verbatim — `VetChatThread.thread`/`.messages` are the exact Batch 2
  `ChatThreadState` / `ChatMessageRich`, and `VetCallSession.session` is the
  Batch 2 `CallSessionRich`. Render pet/owner context from the wrapper's
  `petName` / `ownerName` fields. Audio vs video is `session.base.mode`; all
  reconnect/dropped/poor-network states are already modelled on `CallSessionRich`.
- **Vet SOAP (S.15–17):** reuse the **Batch 2** clinical-note editor —
  `VetClinicalNote.note` is the Batch 2 `ClinicalNote`. Diagnosis / treatment
  plan are the `diagnosis` / `treatmentPlan` fields on the wrapper (mirror
  `note.base.diagnosis`). Draft/finalized/locked are `note.status`.
- **Pet emergency warning (S.18):** reuse the **Batch 2 / Batch 4** red-flag
  banner — `PetEmergencyWarning extends RedFlagWarning` so the same chip/severity
  rendering applies.
- **Pet Rx warnings (T.6–8):** one chip component over `PetRxWarning`; colour by
  `severity` via the reused `PET_WARNING_SEVERITY_TONES`, label the kind via
  `PET_RX_WARNING_LABELS`.
- **Dosage calculator (T.4–5):** call the pure `computePetDosage(drug, weightKg)`
  (re-exported from `usePetRx`) — no network. Result is the Phase 3
  `PetDosageCalculation` shape, so any existing dosage display reuses directly.
- **Fulfilment timeline (V.11–12):** render `delivery.timeline` as a stepper,
  ordering by `PET_FULFILMENT_STATUS_RANK`, labels via
  `PET_FULFILMENT_STATUS_LABELS`.
- **Lab catalogue / packages (U.2):** reuse the Phase 3 lab-test list UI; bundle
  presets come from `PET_LAB_PACKAGES`.
- All money fields (`feeKobo`, `priceKobo`, `totalKobo`) are kobo — format with
  `formatKobo`.
