# Doctor Section A — API Contract (Splash, Onboarding & Authentication)

Section A = the 20-entry pre-account funnel. **Additive** to every earlier
contract. Same runtime mock↔live switch as the rest of the doctor module: every
api fn branches on `DOCTOR_USE_MOCK` (default mock) and, when live, calls the
backend under `/api/v1/doctor` via the shared `doctorGet` / `doctorPost` helpers
in `src/api/doctor.client.ts`. Mutations send `Idempotency-Key:
<input.idempotencyKey>`. Response envelope: `res.data.data ?? res.data`. Money is
always kobo (Section A has none).

Files: `src/types/doctor.onboarding.ts`, `src/api/doctor.onboarding.api.ts`,
`src/features/doctor/hooks/useOnboarding.ts`,
`src/features/doctor/constants/onboarding.ts`.

---

## Exported types (`src/types/doctor.onboarding.ts`)

**Entry 2 — carousel**
- `OnboardingSlide` — `{ id, title, body, icon, accent? }`

**Entries 3 & 4 — merchant upgrade + provider type**
- `ProviderType` = `'doctor' | 'specialist' | 'veterinarian'`
- `ProviderBuilderTarget` = `'doctor_profile_builder' | 'vet_profile_builder'`
- `ProviderTypeOption` — `{ type, label, description, icon, routesTo }`
- `MerchantUpgradeState` = `'not_started' | 'type_selected' | 'in_progress' | 'submitted' | 'completed'`
- `MerchantUpgradeStatus` — `{ state, selectedType?, startedAt?, updatedAt }`

**Entries 8–12 — legal consents (versioned)**
- `LegalDocKind` = `'terms_of_service' | 'medical_privacy' | 'hipaa_data_protection' | 'professional_conduct' | 'telemedicine_policy'`
- `LegalDocumentSection` — `{ heading, body }`
- `LegalDocument` — `{ kind, version, title, summary, bodyMarkdown, sections, effectiveDate, requiresReacceptance? }`
- `LegalConsentRecord` — `{ kind, version, acceptedAt }` *(named to avoid collision with `ConsentRecord` in `@/types/doctor.phase2`)*
- `ConsentAcceptance` = alias of `LegalConsentRecord`
- `ConsentStatus` — `{ accepted, outstanding, allAccepted, updatedAt }`

**Entries 13–16 — OS permissions**
- `AppPermissionKind` = `'notification' | 'camera' | 'microphone' | 'location'`
- `PermissionState` = `'granted' | 'denied' | 'undetermined'`
- `AppPermissionStatus` — `{ kind, state, required, decidedAt? }`
- `PermissionStates` — `{ permissions, updatedAt }`

**Mutation inputs/results**
- `RequestMerchantUpgradeInput` / `RequestMerchantUpgradeResult`
- `SelectProviderTypeInput` / `SelectProviderTypeResult`
- `AcceptConsentInput` / `AcceptConsentResult`
- `RecordPermissionDecisionInput` / `RecordPermissionDecisionResult`

**Re-exported (REUSE — not re-declared)**
- `AccountStatus`, `AccountState`, `AccountReviewNotice`, `AccountReviewReason` from `@/types/doctor.batch7` (entries 17–20).

---

## API fn signatures + live paths (`src/api/doctor.onboarding.api.ts`)

All paths are relative to the prefix `/api/v1/doctor`.

| Function | Method | Live path | Response | Idempotent |
|---|---|---|---|---|
| `getOnboardingSlides()` | GET | `/onboarding/slides` | `OnboardingSlide[]` | no |
| `getMerchantUpgradeStatus()` | GET | `/onboarding/merchant-upgrade` | `MerchantUpgradeStatus` | no |
| `getLegalDocument(kind)` | GET | `/onboarding/legal?kind=` | `LegalDocument` | no |
| `getConsentStatus()` | GET | `/onboarding/consents` | `ConsentStatus` | no |
| `getPermissionStates()` | GET | `/onboarding/permissions` | `PermissionStates` | no |
| `requestMerchantUpgrade(input)` | POST | `/onboarding/merchant-upgrade` | `RequestMerchantUpgradeResult` | yes |
| `selectProviderType(input)` | POST | `/onboarding/provider-type` | `SelectProviderTypeResult` | yes |
| `acceptConsent(input)` | POST | `/onboarding/consents` | `AcceptConsentResult` | yes |
| `recordPermissionDecision(input)` | POST | `/onboarding/permissions` | `RecordPermissionDecisionResult` | yes |

Demo exports (double as `placeholderData`): `DEMO_ONBOARDING_SLIDES`,
`DEMO_MERCHANT_UPGRADE_STATUS`, `DEMO_LEGAL_DOCUMENTS`, `DEMO_CONSENT_STATUS`,
`DEMO_PERMISSION_STATES`. Re-exports: `formatKobo` (from `doctor.api`),
`getAccountStatus` + `DEMO_ACCOUNT_STATUS` (from `doctor.batch7.api`, REUSE for
entries 17–20).

> These nine endpoints must be appended to `docs/DOCTOR_ENDPOINT_INVENTORY.md`
> under a new **"Section A (doctor.onboarding.api.ts)"** table — see block below.

### Block to paste into DOCTOR_ENDPOINT_INVENTORY.md

```
## Section A — Onboarding & Auth (doctor.onboarding.api.ts)

| Function | Method | Path | Response | Idempotent |
|---|---|---|---|---|
| `getOnboardingSlides` | GET | `/onboarding/slides` | `OnboardingSlide[]` | no |
| `getMerchantUpgradeStatus` | GET | `/onboarding/merchant-upgrade` | `MerchantUpgradeStatus` | no |
| `getLegalDocument` | GET | `/onboarding/legal` | `LegalDocument` (query: `kind`) | no |
| `getConsentStatus` | GET | `/onboarding/consents` | `ConsentStatus` | no |
| `getPermissionStates` | GET | `/onboarding/permissions` | `PermissionStates` | no |
| `requestMerchantUpgrade` | POST | `/onboarding/merchant-upgrade` | `RequestMerchantUpgradeResult` | yes |
| `selectProviderType` | POST | `/onboarding/provider-type` | `SelectProviderTypeResult` | yes |
| `acceptConsent` | POST | `/onboarding/consents` | `AcceptConsentResult` | yes |
| `recordPermissionDecision` | POST | `/onboarding/permissions` | `RecordPermissionDecisionResult` | yes |
```

> Account-status reads/writes for entries 17–20 are NOT new — they REUSE the
> existing Batch 7 `getAccountStatus` (`GET /account/status`) already in the
> inventory.

---

## Hooks (`src/features/doctor/hooks/useOnboarding.ts`)

Reads use `DEMO_*` as `placeholderData`. Mutations auto-generate the
`idempotencyKey`; callers pass `Omit<Input, 'idempotencyKey'>`.

| Hook | Kind | Signature |
|---|---|---|
| `useOnboardingSlides()` | read | → `UseQueryResult<OnboardingSlide[]>` |
| `useMerchantUpgradeStatus()` | read | → `UseQueryResult<MerchantUpgradeStatus>` |
| `useLegalDocument(kind: LegalDocKind)` | read | → `UseQueryResult<LegalDocument>` |
| `useConsentStatus()` | read | → `UseQueryResult<ConsentStatus>` |
| `usePermissionStates()` | read | → `UseQueryResult<PermissionStates>` |
| `useOnboardingAccountStatus()` | read | REUSE alias of `useAccountStatus()` → `UseQueryResult<AccountStatus>` |
| `useRequestMerchantUpgrade()` | mutation | `mutate(input?: Omit<RequestMerchantUpgradeInput,'idempotencyKey'>)` |
| `useSelectProviderType()` | mutation | `mutate(input: Omit<SelectProviderTypeInput,'idempotencyKey'>)` |
| `useAcceptConsent()` | mutation | `mutate(input: Omit<AcceptConsentInput,'idempotencyKey'>)` |
| `useRecordPermissionDecision()` | mutation | `mutate(input: Omit<RecordPermissionDecisionInput,'idempotencyKey'>)` |

Query keys: `['doctor','onboarding','slides' | 'merchant-upgrade' | 'consents' |
'permissions']` and `['doctor','onboarding','legal', kind]`. Account-status reuses
the Batch 7 key `['doctor','account-status']`.

---

## Constants (`src/features/doctor/constants/onboarding.ts`)
- `ONBOARDING_SLIDES` (re-export of `DEMO_ONBOARDING_SLIDES`)
- `PROVIDER_TYPE_OPTIONS: ProviderTypeOption[]`
- `LEGAL_DOC_LABELS: Record<LegalDocKind, string>`, `LEGAL_DOC_ORDER: LegalDocKind[]`
- `PERMISSION_LABELS: Record<AppPermissionKind, { label, rationale, icon, required }>`, `PERMISSION_ORDER: AppPermissionKind[]`

---

## Loading / error / empty conventions
- **Loading:** each read returns its `DEMO_*` as `placeholderData`, so screens
  render instantly with demo data, then refresh. Gate real spinners on
  `isLoading && !data`.
- **Error:** reads surface `isError` / `error`; screens should show the shared
  edge-state (`getEdgeState('server_error')` / `'no_internet'`). Mutations expose
  `isPending` / `isError` for inline button state.
- **Empty:** `useConsentStatus().outstanding.length === 0` (or `allAccepted`)
  means the consent gate is satisfied — render the "all done" state, not an empty
  list. `usePermissionStates().permissions` is always fully populated (four
  kinds); an "empty" permission is one with `state: 'undetermined'`.
- **Idempotency:** every mutation is safe to retry — the hook regenerates the key
  per call; the backend must dedupe on `Idempotency-Key`.

---

## Reuse summary
- Entries 5/6 → Section B builder (`useProfileBuilder` / `doctor.profile`).
- Entry 7 → Section C / Batch 1 vet builder (`useVetProfile` / `doctor.batch1`).
- Entries 17–20 → Batch 7 `AccountStatus` / `AccountState` / `useAccountStatus`
  (re-exported, never re-declared).
- `formatKobo` re-exported from `doctor.api` for parity (no money in Section A).
