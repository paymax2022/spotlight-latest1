# Doctor Section A — File Ownership Map

Section A is **Splash, Onboarding & Authentication** — the 20-entry pre-account
funnel that runs *before* a provider account exists (splash → intro carousel →
user→merchant upgrade → provider-type choice → profile builders → legal consents
→ OS permissions → account-status gates). This is **additive** to every earlier
contract: nothing in Phase 1 / Phase 2 / Section B / Section C / Batch 1–7 is
edited (only the two doctor barrels gain one new export line each). Money is
always integers in **kobo** (Section A has no money fields).

CONSOLIDATED + heavy REUSE: 8 of 20 entries are fully covered by existing work
(profile builders + Batch 7 account status); only the carousel, the merchant
upgrade / provider-type choice, the legal-consent gate, and the permission record
are new data.

## Ownership boundaries (do not cross)

### BACKEND (data/type contract) — owns
- `src/types/doctor.onboarding.ts`                    *(new)*
- `src/api/doctor.onboarding.api.ts`                  *(new)*
- `src/features/doctor/hooks/useOnboarding.ts`        *(new)*
- `src/features/doctor/constants/onboarding.ts`       *(new)*
- `src/features/doctor/hooks/index.ts`                *(edited — additive export line only)*
- `src/features/doctor/constants/index.ts`            *(edited — additive export line only)*

> Backend continues to own all earlier files unchanged. NOTHING in
> `doctor.ts`, `doctor.batch7.ts`, `doctor.profile.ts`, `doctor.batch1.ts`,
> their api/hook/constant siblings, the patient-app `app/(auth)/**`,
> `app/index.tsx` or `app/_layout.tsx` is modified.

### FRONTEND (screens/UI) — owns
- The onboarding route group (Frontend decides: `app/(doctor)/onboarding/**` or a
  new onboarding group). Backend does NOT create or edit screen files.
- `src/features/doctor/components/**`

### QA — owns
- `docs/QA_DOCTOR_SECTIONA_REPORT.md` *(QA to create)*

> Frontend consumes Backend's hooks/types only — never imports from
> `doctor.onboarding.api.ts` directly (use the hooks). For the doctor/specialist
> profile builder reuse it uses the Section B hooks; for vet it uses the Section C
> / Batch 1 hooks; for account-status gates it uses `useAccountStatus`.

---

## Reused existing work (do NOT recreate)

| Entry | Existing asset | Reused hook / type |
|-------|----------------|--------------------|
| 5 Doctor (additional profile update) | Section B `doctor.profile.ts` / `useProfileBuilder.ts` | `useProfileDraft`, `useSaveProfileDraft`, `useSubmitProfileVerification`, `DoctorProfileDraft` |
| 6 Specialist doctor | Section B (same builder, specialty step mandatory) | `useProfileDraft` + Section B specialty step |
| 7 Veterinary doctor | Section C / Batch 1 `doctor.batch1.ts` / `useVetProfile.ts` | `useVetProfileDraft`, `useSubmitVetVerification`, `usePublishVetProfile` |
| 17 Account pending verification | Batch 7 `doctor.batch7.ts` / `useAppStatus.ts` | `useAccountStatus` (`state: 'pending'`), `AccountStatus` |
| 18 Account rejected | Batch 7 | `useAccountStatus` (`state: 'rejected'`), `AccountStatus` |
| 19 Account suspended | Batch 7 | `useAccountStatus` (`state: 'suspended'`), `AccountStatus` |
| 20 Account under compliance review | Batch 7 | `useAccountStatus` (`state: 'under_review'`, `reviewNotice`), `AccountStatus`, `AccountReviewNotice` |

> Section A also re-exports `useAccountStatus` as `useOnboardingAccountStatus`
> (thin alias) and `getAccountStatus`/`DEMO_ACCOUNT_STATUS` from the Section A api,
> so an onboarding account-state screen can import everything from a single
> Section A import site without re-declaring anything.

---

## All 20 entries — route / state / reuse + per-screen hooks & types

| # | Entry | Route OR state | Hooks | Types |
|---|-------|----------------|-------|-------|
| 1 | Splash + Welcome | STATE of splash screen — static, no data | — | — |
| 2 | App intro carousel | `<onboarding>/intro` | `useOnboardingSlides` | `OnboardingSlide` |
| 3 | User profile upgrade to Merchant | `<onboarding>/upgrade` | `useMerchantUpgradeStatus`, `useRequestMerchantUpgrade` | `MerchantUpgradeStatus`, `MerchantUpgradeState` |
| 4 | Choose provider type | `<onboarding>/provider-type` | `useSelectProviderType`, `useMerchantUpgradeStatus` | `ProviderType`, `ProviderTypeOption`, `ProviderBuilderTarget` |
| 5 | Doctor (additional profile update) | REUSES Section B builder route | `useProfileDraft`, `useSaveProfileDraft`, `useSubmitProfileVerification` (Section B) | `DoctorProfileDraft` (Section B) |
| 6 | Specialist doctor | REUSES Section B builder (specialty mandatory) | Section B profile-builder hooks | Section B types |
| 7 | Veterinary doctor | REUSES Section C / Batch 1 vet builder route | `useVetProfileDraft`, `useSubmitVetVerification` (Batch 1) | Batch 1 vet types |
| 8 | Terms of service consent | `<onboarding>/consent/terms_of_service` | `useLegalDocument('terms_of_service')`, `useAcceptConsent`, `useConsentStatus` | `LegalDocument`, `LegalConsentRecord`, `ConsentStatus`, `LegalDocKind` |
| 9 | Medical privacy consent | `<onboarding>/consent/medical_privacy` | same as 8 | same as 8 |
| 10 | HIPAA / data-protection ack | `<onboarding>/consent/hipaa_data_protection` | same as 8 | same as 8 |
| 11 | Professional conduct agreement | `<onboarding>/consent/professional_conduct` | same as 8 | same as 8 |
| 12 | Telemedicine policy agreement | `<onboarding>/consent/telemedicine_policy` | same as 8 | same as 8 |
| 13 | Notification permission | STATE of `<onboarding>/permissions` (notification) | `usePermissionStates`, `useRecordPermissionDecision` | `AppPermissionKind`, `PermissionState`, `AppPermissionStatus`, `PermissionStates` |
| 14 | Camera permission | STATE of `<onboarding>/permissions` (camera) | same as 13 | same as 13 |
| 15 | Microphone permission | STATE of `<onboarding>/permissions` (microphone) | same as 13 | same as 13 |
| 16 | Location permission | STATE of `<onboarding>/permissions` (location) | same as 13 | same as 13 |
| 17 | Account pending verification | STATE of account-status gate (`state: 'pending'`) | `useOnboardingAccountStatus` / `useAccountStatus` (Batch 7 REUSE) | `AccountStatus`, `AccountState` (Batch 7) |
| 18 | Account rejected | STATE of account-status gate (`state: 'rejected'`) | same (Batch 7 REUSE) | `AccountStatus`, `AccountState` |
| 19 | Account suspended | STATE of account-status gate (`state: 'suspended'`) | same (Batch 7 REUSE) | `AccountStatus`, `AccountState` |
| 20 | Account under compliance review | STATE of account-status gate (`state: 'under_review'`) | same (Batch 7 REUSE) | `AccountStatus`, `AccountState`, `AccountReviewNotice` |

> Entries 8–12 are five **states of one consent flow** sharing the same hooks and
> types, keyed by `LegalDocKind`. Entries 13–16 are four **states of one
> permission step** sharing the same hooks/types, keyed by `AppPermissionKind`.
> Entries 17–20 are four **states of one account-status gate** driven entirely by
> the Batch 7 `AccountState` union — no new account-status types were added.

## Frontend component-reuse notes
- Carousel (2): a swipeable pager over `OnboardingSlide[]`.
- Provider-type (4): a selectable card list over `PROVIDER_TYPE_OPTIONS`; use
  `option.routesTo` to navigate into the Section B or Batch 1 builder.
- Consents (8–12): one reusable consent screen parameterised by `LegalDocKind`;
  render `LegalDocument.sections` (or `bodyMarkdown`) + an accept checkbox bound to
  `useAcceptConsent`; the consent index reads `useConsentStatus().outstanding`.
- Permissions (13–16): one reusable rationale screen parameterised by
  `AppPermissionKind` using `PERMISSION_LABELS[kind]`; the OS prompt is Frontend's
  job (expo-notifications / expo-camera / expo-av / expo-location); record the
  outcome via `useRecordPermissionDecision`.
- Account states (17–20): reuse the existing Batch 7 account-status screen /
  StateView; switch on `AccountStatus.state`.
