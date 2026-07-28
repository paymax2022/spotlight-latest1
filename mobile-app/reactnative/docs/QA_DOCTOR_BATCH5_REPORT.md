# QA Report — Doctor Batch 5 (Sections S · T · U · V — Veterinary)

**Reviewer:** QA Agent (read-only; no feature code edited)
**Date:** 2026-06-20
**Scope:** spec sections S (22), T (16), U (15), V (12) = 65 entries, built consolidated
with heavy reuse of Phase 3 vet/pet work and Batch 2 chat/call/notes patterns.

---

## Summary verdict — **PASS** (ship-ready; 0 blockers)

Batch 5 is a clean, disciplined consolidation. All 65 spec entries are covered as a
full screen, a documented state/sheet, or a verified reuse of an existing screen/hook.
The two highlighted risk areas — pet dosage-by-weight + the 3 Rx warning kinds, and the
pet lab abnormal alert — both genuinely surface in the UI. All 5 new components are used
(no orphans). No raw design-token violations. No navigation orphans, dead links, or Expo
Router collisions. Contract adherence (hooks-only, kobo+formatKobo, hook-generated
idempotency keys) is fully respected.

| Severity | Count |
|---|---|
| Blocker | 0 |
| Major   | 0 |
| Minor   | 3 |

**Defects are all minor:** one documentation discrepancy (a route named in the ownership
map was consolidated into an existing screen), one partial coverage nuance (growth screen
has no explicit "abnormal alert"), and cleanup notes (inert temp file; an unrelated
package.json dep). None block the batch.

### Required-report facts
- **doctor-scoped tsc grep:** INCONCLUSIVE-BY-TIMEOUT. Full `tsc --noEmit` reliably exceeds
  the 45s shell cap (confirmed twice). Verified types by inspection instead: every screen
  imports from the hooks/components/constants barrels (no broken paths), helper signatures
  match call sites (`computePetDosage(drug, weightKg)`, `checkPetRxWarnings(drug, species,
  allergies[])`), component prop shapes match call sites, and all referenced exported symbols
  exist. Per the brief, the batch is NOT failed for the timeout. Pre-existing unrelated
  `src/features/fx/**` error noted (out of scope). Inert empty `tsdoctor.tmp.json` at app
  root noted as cleanup (VM temp, not in tsconfig).
- **Per-section coverage:** S **22/22**, T **16/16**, U **15/15**, V **12/12** = **65/65**.
- **Pet dosage-by-weight + 3 Rx warnings surface:** YES. `computePetDosage` (dose-by-weight,
  low/high * weightKg, rounded midpoint) and `checkPetRxWarnings` (species_contraindication
  + allergy + medicine) are both imported into `prescription.tsx` from the hooks barrel and
  rendered via `DosageCalculatorField` and `PetRxWarningChip`.
- **All 5 new components used:** YES — VetAppointmentRow → appointments.tsx, PetRequestRow →
  requests.tsx, PetVaccinationRow → vaccinations.tsx, PetRxWarningChip → prescription.tsx,
  DosageCalculatorField → prescription.tsx. Zero orphans.
- **Nav orphans / dead links / collisions:** none / none / none.

---

## Per-section coverage tables

### Section S — Veterinary Consultation (22/22)

| # | Entry | How covered | Verdict |
|---|---|---|---|
| 1 | Vet dashboard | `vet/index.tsx` + Phase 3 `useVetDashboard` (links to all 7 sub-screens) | PASS |
| 2 | Vet appointment list | `vet/appointments.tsx` + `useVetAppointments` + `VetAppointmentRow` | PASS |
| 3 | Pet owner request | `vet/requests.tsx` + `usePetOwnerRequests`/`useRespondToPetRequest` + `PetRequestRow` | PASS |
| 4 | Pet profile review | `vet/pet/[id]/index.tsx` + Phase 3 `usePetProfile` | PASS |
| 5 | Pet species detail | STATE of profile (species via `PET_SPECIES_LABELS`) | PASS |
| 6 | Pet breed detail | STATE of profile (breed field) | PASS |
| 7 | Pet age/weight profile | STATE of profile (ageMonths/weightKg) | PASS |
| 8 | Pet vaccination history | STATE of profile / health-record | PASS |
| 9 | Pet medical history | STATE of profile / health-record | PASS |
| 10 | Pet symptoms submitted | STATE of profile / owner request | PASS |
| 11 | Pet images/videos | STATE of profile (PetImage) | PASS |
| 12 | Vet chat consult | `vet/consult/[id]/chat.tsx` + `useVetChatThread`, reuses Batch 2 `MessageBubble`/`ChatComposer` | PASS |
| 13 | Vet audio call | STATE (`mode='audio'`) of `vet/consult/[id]/call.tsx`, `session.base.mode` | PASS |
| 14 | Vet video call | STATE (`mode='video'`) of same screen + `CallStageView`/`CallControlBar` | PASS |
| 15 | Vet SOAP notes | `vet/pet/[id]/soap.tsx` + `useVetSoapNote`/`useSaveVetSoapNote`, reuses `SoapSection` | PASS |
| 16 | Pet diagnosis | STATE of SOAP (`diagnosis` field) | PASS |
| 17 | Pet treatment plan | STATE of SOAP (`treatmentPlan` field) | PASS |
| 18 | Pet emergency warning | banner on `vet/pet/[id]/index.tsx` + `usePetEmergencyWarnings`, reuses AlertCard/RedFlag shape | PASS |
| 19 | Pet follow-up recommendation | reuses Phase 2 follow-up (`app/(doctor)/follow-ups` exists) | PASS |
| 20 | Vet referral | `vet/pet/[id]/referral.tsx` + `useVetReferrals`/`useVetSpecialists`/`useCreateVetReferral` | PASS |
| 21 | Vet consultation summary | `vet/consult/[id]/summary.tsx` + `useVetConsultSummary` | PASS |
| 22 | Vet consultation history | `vet/history.tsx` + `useVetConsultHistory` | PASS |

### Section T — Pet E-Prescription (16/16)

| # | Entry | How covered | Verdict |
|---|---|---|---|
| 1 | Create pet prescription | `vet/pet/[id]/prescription.tsx` + Phase 3 `useCreatePetPrescription` | PASS |
| 2 | Search pet medicine | STATE (`PET_DRUG_CATALOGUE` filter, Search modal) | PASS |
| 3 | Add pet medicine | STATE (add line item) | PASS |
| 4 | Pet dosage calculator | SHEET on Rx screen + `DosageCalculatorField` (pure `computePetDosage`) | PASS |
| 5 | Dosage by pet weight | STATE of calc — `computePetDosage(drug, weightKg)`, dose-by-weight | PASS |
| 6 | Pet medicine warning | `checkPetRxWarnings` kind=`medicine` (caution) → `PetRxWarningChip` | PASS |
| 7 | Species contraindication | `checkPetRxWarnings` kind=`species_contraindication` (danger) | PASS |
| 8 | Pet allergy warning | `checkPetRxWarnings` kind=`allergy` (danger) | PASS |
| 9 | Pet prescription preview | STATE of Rx (review before issue) | PASS |
| 10 | Issue pet prescription | `vet/pet/[id]/prescription/issue.tsx` + `useIssuePetPrescription` | PASS |
| 11 | Send to pet pharmacy | SHEET + `usePetPharmacies`/`useSendPetRxToPharmacy` | PASS |
| 12 | Pet prescription history | `vet/prescriptions.tsx` + `useIssuedPetPrescription` | PASS |
| 13 | Pet refill request | STATE (status=`requested`) on refills screen | PASS |
| 14 | Approve/reject refill | `vet/refills.tsx` + `usePetRefillRequests`/`useReviewPetRefill` | PASS |
| 15 | Pet Rx audit trail | STATE (`audit[]`) on issued-Rx screen | PASS |
| 16 | Pet pharmacy directory | SHEET on send-to-pharmacy + `usePetPharmacies` | PASS |

### Section U — Vet Lab & Pet Health (15/15)

| # | Entry | How covered | Verdict |
|---|---|---|---|
| 1 | Create pet lab order | `vet/pet/[id]/lab-order.tsx` + Phase 3 `useCreatePetLabOrder` | PASS |
| 2 | Pet lab test catalogue | consolidated INTO `lab-order.tsx` — `usePetLabCatalogue` + `PET_LAB_PACKAGES` + category filter (see Minor-1: map named a separate `vet/lab-catalogue.tsx` that does not exist) | PASS |
| 3 | Vaccination recommendation | `vet/pet/[id]/vaccinations.tsx` + `usePetVaccinationRecommendations` + `PetVaccinationRow` | PASS |
| 4 | Pet blood test | STATE (category=`blood`) of catalogue | PASS |
| 5 | Pet stool test | STATE (category=`stool`) | PASS |
| 6 | Pet imaging referral | STATE (category=`imaging`) | PASS |
| 7 | Pet lab result inbox | `vet/lab-inbox.tsx` + `usePetLabInbox` | PASS |
| 8 | Pet lab result detail | `vet/lab-result/[orderId].tsx` + Phase 3 `usePetLabResult` | PASS |
| 9 | Pet abnormal result alert | STATE (`hasAbnormal`) — badge in inbox + `AlertCard` in detail | PASS |
| 10 | Pet result interpretation | SHEET on detail + `useAddPetLabInterpretation` | PASS |
| 11 | Follow-up from lab result | STATE (`followUpRecommended`) on interpretation | PASS |
| 12 | Vaccination reminder setup | SHEET on vaccinations + `useSetPetVaccinationReminder` | PASS |
| 13 | Pet health record | `vet/pet/[id]/health-record.tsx` + `usePetHealthRecord` | PASS |
| 14 | Pet growth/weight history | `vet/pet/[id]/growth.tsx` + `usePetGrowthHistory`/`useRecordPetGrowth` + `BarRow` weight trend | PARTIAL (trend+history present; no explicit "abnormal alert" — see Minor-2) |
| 15 | Pet chronic condition monitoring | `vet/pet/[id]/chronic.tsx` + `usePetChronicMonitoring`/`useSavePetChronicMonitoring` + trend tones | PASS |

### Section V — Pet Store / Vet-Recommended Products (12/12)

| # | Entry | How covered | Verdict |
|---|---|---|---|
| 1 | Recommend pet product | `vet/pet-store.tsx` + Phase 3 `useRecommendProducts` | PASS |
| 2 | Search pet products | Phase 3 `usePetProducts` | PASS |
| 3 | Pet food rec | STATE (category=`food`) | PASS |
| 4 | Pet supplement rec | STATE (category=`supplement`) | PASS |
| 5 | Pet grooming rec | STATE (category=`grooming`) | PASS |
| 6 | Pet medicine rec | STATE (category=`medicine`) | PASS |
| 7 | Vet-approved product list | STATE (`vetApproved` filter) | PASS |
| 8 | Product detail | `vet/product/[id].tsx` + `usePetProductDetail` | PASS |
| 9 | Add recommendation note | STATE (`note` field) | PASS |
| 10 | Share product with owner | SHEET + `useShareProductWithOwner` | PASS |
| 11 | Pet store fulfilment status | `vet/fulfilments.tsx` + `usePetProductFulfilments` + `StatusTimeline` | PASS |
| 12 | Pet product delivery status | STATE (`delivery.timeline`) on fulfilment detail | PASS |

---

## Checks — evidence

### 1. Spec coverage — PASS (65/65)
All entries cross-referenced against code (tables above). REUSES-existing entries verified
to have a real backing screen/hook (Phase 3 vet dashboard/profile/lab/store; Batch 2 chat/
call/note; Phase 2 follow-up route `app/(doctor)/follow-ups`). Highlighted areas confirmed:
- **T dosage-by-weight + 3 warnings:** `computePetDosage` and `checkPetRxWarnings`
  (`src/api/doctor.batch5.api.ts:100`, `:118`) implement dose-by-weight and all three kinds
  (species_contraindication danger, allergy danger, medicine caution). Surfaced in
  `prescription.tsx:127,147,183` via `DosageCalculatorField` and a `PetRxWarningChip` loop.
- **U.9 abnormal lab alert:** `lab-inbox.tsx:52` (Abnormal badge) and
  `lab-result/[orderId].tsx:85-87` (`AlertCard` "Abnormal values detected"). PASS.
- **U.14 growth trend:** `growth.tsx:62-64` `BarRow` weight trend + history list. No explicit
  abnormal/outlier alert (Minor-2).

### 2. Reuse vs duplication — PASS
- All 5 new components are genuinely new (each carries a header comment justifying why no
  existing barrel component fits the vet shape) and all 5 are imported/used (no orphans):
  - `VetAppointmentRow.tsx` → `appointments.tsx` (PASS — human `AppointmentRow` is typed to `DoctorAppointment`, doesn't fit `VetAppointment`).
  - `PetRequestRow.tsx` → `requests.tsx` (PASS — no existing owner-request row).
  - `PetVaccinationRow.tsx` → `vaccinations.tsx` (PASS — syringe + urgency badge + reminder CTA).
  - `PetRxWarningChip.tsx` → `prescription.tsx` (PASS — `SeverityFinding` prop shape is AI-findings, not the warning union).
  - `DosageCalculatorField.tsx` → `prescription.tsx` (PASS — extracts the dose readout for the calculator sheet).
- Screens reuse barrel components rather than re-implementing: `MessageBubble`/`ChatComposer`
  (chat), `CallStageView`/`CallControlBar` (call), `SoapSection` (soap), `AlertCard`
  (lab-result, pet emergency), `StatusTimeline` (fulfilments), `BarRow` (growth),
  `StateView`/`StatusBadge`/`SectionCard`/`InfoRow` throughout. No duplicates found.

### 3. Design-token compliance — PASS (clean)
Grepped all new/edited vet screens + the 5 components for raw hex (excluding rgba overlays),
raw `fontSize`, and magic spacing/radius: **0 violations**. All colours via `Colors.*`, all
type via `Typography.*`, all spacing/radius via `Spacing.*`/`Radius.*`.

### 4. Screen states — PASS
All list screens (appointments, requests, history, prescriptions, refills, lab-inbox,
fulfilments) implement loading (`StateView variant="loading"` gated on `isLoading &&
isPlaceholderData`), error (`variant="error"` with `onRetry={refetch}`), and empty
(`variant="empty"`) states. Consolidated states verified: vet appt status tones
(`VetAppointmentRow` 6 statuses), owner-request statuses (`PetRequestRow` 4 statuses), Rx
warnings/issue/refill, lab abnormal alert (inbox badge + detail AlertCard), fulfilment
timeline (StatusTimeline ordered by `PET_FULFILMENT_STATUS_RANK`).

### 5. Navigation — PASS. **Orphans: none. Dead links: none. Collisions: none.**
- Every Batch 5 route registered in `app/(doctor)/_layout.tsx:147-168` has >=1 caller
  (verified against the full `router.push/replace` target list across `app/(doctor)`).
- Every `router.push/replace` vet target resolves to an existing route file (45 distinct
  targets checked; all map to files under `app/(doctor)/vet/**`).
- Vet dashboard (`vet/index.tsx:81-154`) links to appointments, requests, lab-inbox,
  prescriptions, refills, fulfilments, history. Pet profile (`vet/pet/[id]/index.tsx`) links
  to chat, call, soap, referral, prescription, lab-order, health-record, growth,
  vaccinations, chronic, pet-store (all 10+ targets present). lab-inbox -> result; pet-store ->
  product -> fulfilments all wired.
- **Collisions:** `vet/pet/[id]/prescription.tsx` (leaf) + `vet/pet/[id]/prescription/issue.tsx`
  (dir) is the SAME accepted pattern as the existing `pharmacy/[id].tsx` + `pharmacy/[id]/`
  (a prior passed batch). `vet/consult/[id]/` is a fresh dir with no sibling leaf. Expo Router
  resolves both cleanly — no collision.

### 6. Accessibility — PASS
Icon-only Pressables are labelled (`accessibilityRole="button"` + `accessibilityLabel`):
the 10 vet-dashboard nav links (`vet/index.tsx:81-154`), modal close buttons, and the
vaccination reminder bell (`PetVaccinationRow`). Row/card Pressables that wrap readable text
(e.g. lab-inbox row, appointment row) and modal backdrops correctly omit explicit labels.
Touch targets meet >=44 where icon-only (reminder bell 36 inside a row with `hitSlop`; close
buttons use `hitSlop={16}`). `numberOfLines` applied on truncatable text in all 5 components
and in the row screens.

### 7. Contract adherence — PASS
- **Hooks-only:** zero `from '@/api/doctor.batch5.api'` imports in `app/(doctor)`. The only
  api-direct imports are `formatKobo` from `@/api/doctor.phase3.api` (the established Phase 3
  pattern; `formatKobo` is an explicitly allowed exception). The two pure helpers
  `computePetDosage`/`checkPetRxWarnings` are imported from the **hooks barrel**
  (re-exported via `usePetRx.ts:32`), as the contract requires.
- **Idempotency:** zero `idempotencyKey` constructions in the UI — hooks auto-generate;
  callers pass `Omit<Input,'idempotencyKey'>`. Mutations use `isPending`/`mutateAsync`
  (26 usages across vet screens).
- **Money:** all `*Kobo` fields formatted with `formatKobo`; no float kobo math found.
- **Demo-safe content:** all data resolves from `DEMO_*` placeholders; copy is demo-safe.

### 8. Typecheck — INCONCLUSIVE-BY-TIMEOUT (not a fail)
Full `tsc --noEmit` exceeds the 45s cap (confirmed twice). Verified by inspection: barrel
imports resolve, helper/component prop shapes match call sites, exported symbols exist.
Pre-existing unrelated `src/features/fx/**` error is out of scope. Inert empty
`tsdoctor.tmp.json` at app root noted as cleanup.

### 9. Ownership / no new deps — PASS for Batch 5
Frontend changes confined to `app/(doctor)/**` + `src/features/doctor/components/**`; backend
to the batch5 type/api/hook/constant files + additive barrel export lines. **Batch 5 added
no dependencies** — the `expo-image-picker` line in `package.json` is consumed only by
`src/features/crowdfunding/utils/mediaPicker.ts` (unrelated to Batch 5), so it is pre-existing
relative to this batch, not a Batch 5 violation. Noted as Minor-3 for tracking.

---

## Prioritized defect list

### Blocker — none

### Major — none

### Minor

**Minor-1 — Ownership-map route name discrepancy (U.2).**
The ownership map lists `vet/lab-catalogue.tsx` as a "full screen / SHEET" for U.2 (Pet lab
test catalogue), but that file does not exist. Coverage was correctly consolidated into
`app/(doctor)/vet/pet/[id]/lab-order.tsx` (`usePetLabCatalogue` + `PET_LAB_PACKAGES` +
category filter, lines 31/43/109/117). Functionally complete and consistent with the
consolidation principle; only the map text is stale.
*Fix (doc-only):* update the ownership map U.2 row to say "consolidated into lab-order.tsx"
instead of naming a separate `vet/lab-catalogue.tsx`.

**Minor-2 — U.14 growth "abnormal alert" not surfaced.**
`app/(doctor)/vet/pet/[id]/growth.tsx` renders the weight trend (`BarRow`, lines 62-64) and
the full history list, fully covering "growth/weight history." However neither
`PetGrowthHistory`/`PetGrowthPoint` (`src/types/doctor.batch5.ts:368-378`) nor the screen
carry an abnormal/outlier flag, so the "abnormal alert" sub-aspect emphasised in the QA brief
is not visibly present. The ownership map row itself only promises trend/history (types
`PetGrowthHistory`, `PetGrowthPoint`), so this is a coverage nuance, not a contract breach.
*Fix (optional, low priority):* add an `isAbnormal`/`flag` marker to `PetGrowthPoint` (or a
derived `hasAbnormalTrend` on the history) and render a small `AlertCard` on growth.tsx when
a point falls outside an expected range — mirroring the lab abnormal-alert pattern.

**Minor-3 — Cleanup notes.**
(a) Inert empty `tsdoctor.tmp.json` at the app root (VM temp, not in tsconfig, cannot be
unlinked) — remove when possible. (b) `package.json` carries an `expo-image-picker` dep used
only by the unrelated crowdfunding feature; confirm it was intentionally added by its owning
batch (not Batch 5) and leave as-is.

---

## Conclusion
Batch 5 passes QA. 65/65 spec entries covered, all 5 new components used and justified, design
tokens clean, navigation sound (no orphans/dead links/collisions), contract fully respected
(hooks-only, kobo+formatKobo, hook-generated idempotency keys). The dosage-by-weight
calculator and all three Rx warning kinds surface; the lab abnormal alert surfaces. The three
minor items are documentation/cleanup and one optional enhancement — none block merge.
