# Doctor Section B — File Ownership Map

Section B is the full **Doctor Profile & Verification** flow — 31 screens forming
a multi-step profile builder plus the verification lifecycle. This is **additive**
to Phase 1 and Phase 2: nothing in earlier contracts is edited (only barrels gain
new export lines). Money is always integers in **kobo**.

## Ownership boundaries (do not cross)

### BACKEND (data/type contract) — owns
- `src/types/doctor.profile.ts`                       *(new)*
- `src/api/doctor.profile.api.ts`                     *(new)*
- `src/features/doctor/hooks/useProfileBuilder.ts`    *(new)*
- `src/features/doctor/constants/profile.ts`          *(new)*
- `src/features/doctor/hooks/index.ts`                *(edited — additive export line only)*
- `src/features/doctor/constants/index.ts`            *(edited — additive export line only)*

> Backend continues to own the Phase 1 / Phase 2 files unchanged
> (`doctor.ts`, `doctor.phase2.ts`, `doctor.api.ts`, `doctor.phase2.api.ts`, the
> other hook/constant files).

### FRONTEND (screens/UI) — owns
- `app/(doctor)/**` (all route files)
- `src/features/doctor/components/**`

### QA — owns
- `docs/QA_DOCTOR_SECTIONB_REPORT.md`

> Frontend consumes Backend's hooks/types only — never imports from
> `doctor.profile.api.ts` directly (use the hooks). All money is kobo; format with
> `formatKobo` (re-exported from `@/api/doctor.profile.api`, `@/api/doctor.api`).

---

## Reused existing work (do NOT recreate)

| Screen | Existing route / asset | Reused hook / type |
|--------|------------------------|--------------------|
| 19 Availability setup | `app/(doctor)/availability.tsx` | `useAvailability`, `useUpdateAvailability`, `AvailabilitySchedule` |
| 25 Verification pending | `app/(doctor)/signup/pending.tsx` | `useVerification`, `VerificationSubmission` |
| 23 Submit for verification | submit action in `signup/index.tsx` (`useSubmitVerification`) | extended by `useSubmitProfileVerification` (full-draft submit) |

Section B also REUSES these existing constants (from the barrel — not duplicated):
`SPECIALTY_OPTIONS`, `SUB_SPECIALTY_OPTIONS`, `VERIFICATION_DOC_TYPES`,
`WEEKDAYS`, `CONSULT_DURATION_OPTIONS`, `BUFFER_OPTIONS`.

---

## Proposed routes for the 31 screens

A wizard under `app/(doctor)/profile/setup/<step>` drives screens 1–22, with the
verification lifecycle as sibling stack screens under `app/(doctor)/profile/`.
The Phase 1 bottom-tab layout is unchanged; the hub (screen 1) is reachable from
the dashboard / settings.

| #  | Screen | Proposed route (under `app/(doctor)/`) | Hook(s) consumed | Key types |
|----|--------|----------------------------------------|------------------|-----------|
| 1  | Create doctor profile (hub) | `profile/setup/index` | `useProfileDraft` | `DoctorProfileDraft`, `ProfileBuilderStep` |
| 2  | Personal information | `profile/setup/personal` | `useProfileDraft`, `useSaveProfileDraft` | `PersonalInfo`, `GenderOption` |
| 3  | Upload profile photo | `profile/setup/photo` | `useUploadProfilePhoto`, `useProfileDraft` | `UploadedFile`, `UploadProfilePhotoInput` |
| 4  | Professional bio | `profile/setup/bio` | `useProfileDraft`, `useSaveProfileDraft` | `DoctorProfileDraft` |
| 5  | Medical specialty selection | `profile/setup/specialty` | `useProfileDraft`, `useSaveProfileDraft` | `DoctorProfileDraft` (+ `SPECIALTY_OPTIONS`) |
| 6  | Sub-specialty selection | `profile/setup/sub-specialty` | `useProfileDraft`, `useSaveProfileDraft` | `DoctorProfileDraft` (+ `SUB_SPECIALTY_OPTIONS`) |
| 7  | Years of experience | `profile/setup/experience` | `useProfileDraft`, `useSaveProfileDraft` | `DoctorProfileDraft` (+ `EXPERIENCE_OPTIONS`) |
| 8  | Languages spoken | `profile/setup/languages` | `useProfileDraft`, `useSaveProfileDraft` | `DoctorProfileDraft` (+ `LANGUAGE_OPTIONS`) |
| 9  | Medical licence number entry | `profile/setup/licence-number` | `useProfileDraft`, `useSaveProfileDraft` | `ProfileLicenceInfo` |
| 10 | Upload medical licence | `profile/setup/licence-upload` | `useUploadDocument`, `useDocumentSlots` | `UploadDocumentInput`, `ProfileDocumentSlot`, `ProfileDocType` |
| 11 | Upload government ID | `profile/setup/government-id` | `useUploadDocument`, `useDocumentSlots` | `UploadDocumentInput`, `ProfileDocumentSlot` (+ `ID_TYPE_OPTIONS`) |
| 12 | Upload certificates | `profile/setup/certificates` | `useUploadDocument`, `useProfileDraft` | `UploadedFile`, `UploadDocumentInput` |
| 13 | Upload association membership | `profile/setup/association` | `useUploadDocument`, `useProfileDraft` | `UploadedFile` (+ `ASSOCIATION_OPTIONS`) |
| 14 | Hospital/clinic affiliation | `profile/setup/affiliations` | `useProfileDraft`, `useSaveProfileDraft` | `ClinicAffiliation` (+ `NIGERIAN_STATES`) |
| 15 | Education history | `profile/setup/education` | `useProfileDraft`, `useSaveProfileDraft` | `EducationEntry` (+ `DEGREE_OPTIONS`) |
| 16 | Work experience | `profile/setup/work-experience` | `useProfileDraft`, `useSaveProfileDraft` | `WorkExperienceEntry` |
| 17 | Consultation pricing setup | `profile/setup/pricing` | `useProfileDraft`, `useSaveProfileDraft` | `ConsultationPricing` (+ `CONSULT_FEE_PRESETS_KOBO`) |
| 18 | Free follow-up policy setup | `profile/setup/free-follow-up` | `useProfileDraft`, `useSaveProfileDraft` | `FreeFollowUpPolicy` (+ `FREE_FOLLOW_UP_WINDOW_OPTIONS`) |
| 19 | Availability setup **(EXISTS — reuse)** | `availability` | `useAvailability`, `useUpdateAvailability` | `AvailabilitySchedule` |
| 20 | Bank account setup | `profile/setup/bank-account` | `useSaveBankAccount`, `useProfileDraft` | `BankAccount`, `SaveBankAccountInput` (+ `BANK_LIST`) |
| 21 | Tax/VAT information | `profile/setup/tax-info` | `useSaveTaxInfo`, `useProfileDraft` | `TaxInfo`, `SaveTaxInfoInput` |
| 22 | Profile preview | `profile/setup/preview` | `useProfileDraft` | `DoctorProfileDraft` |
| 23 | Submit for verification **(extends existing submit)** | `profile/setup/submit` | `useSubmitProfileVerification` | `SubmitProfileVerificationInput/Result` |
| 24 | Verification submitted | `profile/verification/submitted` | `useVerification` | `VerificationSubmission` |
| 25 | Verification pending **(EXISTS — reuse)** | `signup/pending` | `useVerification` | `VerificationSubmission` |
| 26 | Verification approved | `profile/verification/approved` | `useVerificationDecision`, `useVerification` | `VerificationDecision` |
| 27 | Verification failed | `profile/verification/failed` | `useVerificationDecision` | `VerificationDecision`, `VerificationRejectionReason` (+ `REJECTION_REASONS`) |
| 28 | Resubmit verification documents | `profile/verification/resubmit` | `useUploadDocument`, `useSubmitProfileVerification`, `useDocumentSlots` | `ProfileDocumentSlot`, `UploadDocumentInput` |
| 29 | Licence expiry warning | `profile/licence/expiry` | `useLicenceExpiryWarning` | `LicenceExpiryWarning`, `LicenceStatus` |
| 30 | Licence renewal upload | `profile/licence/renew` | `useRenewLicence`, `useLicenceExpiryWarning` | `RenewLicenceInput`, `LicenceRenewal` |
| 31 | Doctor profile published | `profile/published` | `usePublishProfile`, `useProfileDraft` | `PublishProfileInput/Result` |

> Routes 1–22 form the wizard; the order is driven by `PROFILE_BUILDER_STEPS`.
> Each builder step reads the current draft and patches it via `useSaveProfileDraft`
> (or the dedicated upload/bank/tax mutation). Screen 19 deep-links to the
> existing `availability` route rather than re-implementing it.

---

## Loading / error / empty conventions (mirror Phase 1 & 2)
- Every read hook ships `placeholderData` (a `DEMO_*`) so first paint has content.
- Show a spinner while `isLoading && !data`; show data otherwise.
- Mutations expose `mutate` / `mutateAsync`, `isPending`, `isError`, `error`.
- Frontend passes inputs **without** `idempotencyKey` (`Omit<…, 'idempotencyKey'>`);
  hooks generate it via `generateIdempotencyKey()`.
