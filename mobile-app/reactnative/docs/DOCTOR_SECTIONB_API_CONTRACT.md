# Doctor API Contract — Section B (Profile & Verification)

Reference for the Frontend role. ADDITIVE to the Phase 1 (`DOCTOR_API_CONTRACT.md`)
and Phase 2 (`DOCTOR_PHASE2_API_CONTRACT.md`) contracts. All data is **demo data**
resolved with simulated latency (`wait()`); Phase C swaps bodies for live endpoints
+ the `Idempotency-Key` header (and presigned R2 uploads for files). Money is always
an integer in **kobo**. Path alias is `@/` → `src/`. Use `import type` for type-only
imports.

- Types:     `@/types/doctor.profile`   (re-exports the Phase 1/2 primitives it reuses)
- API:       `@/api/doctor.profile.api` (Frontend should NOT call directly — use hooks)
- Hooks:     `@/features/doctor/hooks`  (same barrel as Phase 1/2)
- Constants: `@/features/doctor/constants` (same barrel; Section B lists re-exported)
- Money fmt: `formatKobo(kobo)` — re-exported from `@/api/doctor.profile.api`

---

## 1. Exported types (`@/types/doctor.profile`)

**Re-exported from Phase 1** (`@/types/doctor`): `DoctorProfile`,
`VerificationStatus`, `VerificationDocType`, `VerificationDocument`,
`VerificationSubmission`, `SubmitVerificationResult`.
**Re-exported from Phase 2** (`@/types/doctor.phase2`): `LicenceStatus`.

**Unions:** `ProfileDocType` (`VerificationDocType` + `'certificate'` +
`'association_membership'`), `GenderOption`, `ProfileBuilderStep`,
`VerificationDecisionOutcome`.

**Entities:** `UploadedFile`, `ProfileDocumentSlot`, `PersonalInfo`,
`ProfileLicenceInfo`, `LicenceExpiryWarning`, `LicenceRenewal`, `EducationEntry`,
`WorkExperienceEntry`, `ClinicAffiliation`, `ConsultationPricing`,
`FreeFollowUpPolicy`, `BankAccount`, `TaxInfo`, `DoctorProfileDraft`,
`VerificationRejectionReason`, `VerificationDecision`.

**Mutation inputs/results:** `SaveProfileDraftInput`/`SaveProfileDraftResult`,
`UploadProfilePhotoInput`/`UploadResult`, `UploadDocumentInput`/`UploadResult`,
`SaveBankAccountInput`/`SaveBankAccountResult`,
`SaveTaxInfoInput`/`SaveTaxInfoResult`,
`SubmitProfileVerificationInput`/`SubmitProfileVerificationResult`,
`RenewLicenceInput`/`RenewLicenceResult`,
`PublishProfileInput`/`PublishProfileResult`.

> NOTE on collisions: Phase 2 already exports `LicenceInfo` (compliance view).
> Section B's editable licence metadata is `ProfileLicenceInfo` (distinct name).
> `LicenceStatus` is reused from Phase 2, not re-declared.

> Every state-changing input type carries `idempotencyKey: string`. Hooks
> generate it via `generateIdempotencyKey()`, so Frontend passes the input
> **without** `idempotencyKey` (`Omit<…, 'idempotencyKey'>`).

---

## 2. API functions (`@/api/doctor.profile.api`)

### Reads
| Function | Returns |
|----------|---------|
| `getProfileDraft(draftId?)` | `DoctorProfileDraft` |
| `getDocumentSlots()` | `ProfileDocumentSlot[]` |
| `getLicenceExpiryWarning()` | `LicenceExpiryWarning \| undefined` |
| `getVerificationDecision(submissionId?)` | `VerificationDecision` |

### Mutations (Idempotency-Key required in Phase C)
| Function | Input | Returns |
|----------|-------|---------|
| `saveProfileDraft(input)` | `SaveProfileDraftInput` | `SaveProfileDraftResult` |
| `uploadProfilePhoto(input)` | `UploadProfilePhotoInput` | `UploadResult` |
| `uploadDocument(input)` | `UploadDocumentInput` | `UploadResult` |
| `saveBankAccount(input)` | `SaveBankAccountInput` | `SaveBankAccountResult` |
| `saveTaxInfo(input)` | `SaveTaxInfoInput` | `SaveTaxInfoResult` |
| `submitProfileVerification(input)` | `SubmitProfileVerificationInput` | `SubmitProfileVerificationResult` |
| `renewLicence(input)` | `RenewLicenceInput` | `RenewLicenceResult` |
| `publishProfile(input)` | `PublishProfileInput` | `PublishProfileResult` |

`DEMO_*` exports (placeholderData): `DEMO_PROFILE_DRAFT`, `DEMO_DOCUMENT_SLOTS`,
`DEMO_LICENCE_EXPIRY_WARNING`, `DEMO_VERIFICATION_DECISION`,
`DEMO_REJECTION_REASONS`.

---

## 3. Hooks (`@/features/doctor/hooks`)

### Reads (all ship `placeholderData`)
| Hook | Query key | Returns (`data`) |
|------|-----------|------------------|
| `useProfileDraft(draftId?)` | `['doctor','profile','draft',draftId]` | `DoctorProfileDraft` |
| `useDocumentSlots()` | `['doctor','profile','documents']` | `ProfileDocumentSlot[]` |
| `useLicenceExpiryWarning()` | `['doctor','profile','licence-expiry']` | `LicenceExpiryWarning \| undefined` |
| `useVerificationDecision(submissionId?)` | `['doctor','profile','verification-decision',submissionId]` | `VerificationDecision` |

### Mutations (pass input **without** `idempotencyKey`)
| Hook | Input (`mutate` arg) | Invalidates |
|------|----------------------|-------------|
| `useSaveProfileDraft()` | `Omit<SaveProfileDraftInput,'idempotencyKey'>` | draft |
| `useUploadProfilePhoto()` | `Omit<UploadProfilePhotoInput,'idempotencyKey'>` | draft |
| `useUploadDocument()` | `Omit<UploadDocumentInput,'idempotencyKey'>` | documents, draft |
| `useSaveBankAccount()` | `Omit<SaveBankAccountInput,'idempotencyKey'>` | draft |
| `useSaveTaxInfo()` | `Omit<SaveTaxInfoInput,'idempotencyKey'>` | draft |
| `useSubmitProfileVerification()` | `Omit<SubmitProfileVerificationInput,'idempotencyKey'>` | verification, draft, verification-decision |
| `useRenewLicence()` | `Omit<RenewLicenceInput,'idempotencyKey'>` | licence-expiry, verification, compliance |
| `usePublishProfile()` | `Omit<PublishProfileInput,'idempotencyKey'>` | profile (all) |

### Reused existing hooks (Section B does NOT redefine these)
- `useAvailability()` / `useUpdateAvailability()` — screen 19 (availability).
- `useVerification()` — screens 24, 25, 26 (submission status).
- `useSubmitVerification()` — Phase 1 simple submit; Section B adds the
  full-draft `useSubmitProfileVerification` for screen 23.

---

## 4. Constants (`@/features/doctor/constants`)

Section B (`constants/profile.ts`): `LANGUAGE_OPTIONS`, `EXPERIENCE_OPTIONS`,
`MAX_YEARS_EXPERIENCE`, `clampYearsExperience()`, `TITLE_OPTIONS`,
`GENDER_OPTIONS`, `DEGREE_OPTIONS`, `ID_TYPE_OPTIONS`, `ASSOCIATION_OPTIONS`,
`PROFILE_BUILDER_STEPS`, `PROFILE_DOC_TYPE_LABELS`, `REJECTION_REASONS`,
`BANK_LIST`, `NIGERIAN_STATES`, `FREE_FOLLOW_UP_WINDOW_OPTIONS`,
`CONSULT_FEE_PRESETS_KOBO`.

Reused (do NOT duplicate): `SPECIALTY_OPTIONS`, `SUB_SPECIALTY_OPTIONS`,
`VERIFICATION_DOC_TYPES`, `WEEKDAYS`, `CONSULT_DURATION_OPTIONS`, `BUFFER_OPTIONS`.

---

## 5. Loading / error / empty conventions
- Read hooks ship `placeholderData` (a `DEMO_*`) → content on first paint.
- Spinner while `isLoading && !data`; otherwise render `data`.
- Empty state when an array read returns `[]` (e.g. no certificates yet) or an
  optional read returns `undefined` (e.g. no licence-expiry warning).
- Mutations: gate the submit button on `isPending`; surface `error` on `isError`;
  navigate / invalidate on success (handled by the hook's `onSuccess`).
- All money fields are kobo integers; render with `formatKobo`.
