// ── Doctor (Telemedicine, provider-side) — Section A Domain Types ─────────────
// Section A = Splash, Onboarding & Authentication (20 entries). This is the
// pre-account funnel: splash/welcome, the intro carousel, the user→merchant
// (provider) upgrade + provider-type choice, the legal-consent gate, the OS
// permission record, and the post-submission account-status screens.
//
// CONSOLIDATED + heavy REUSE — ADDITIVE to every earlier contract; nothing in
// `@/types/doctor`, `@/types/doctor.batch7`, `@/types/doctor.profile` etc. is
// edited. Money amounts (none in Section A) are integers in minor units (kobo).
// Use `import type` for type-only imports.
//
// Entry → coverage map (full detail in docs/DOCTOR_SECTIONA_OWNERSHIP_MAP.md):
//   1  Splash + Welcome ............ static screen, no data (Frontend-only)
//   2  App intro carousel .......... OnboardingSlide + getOnboardingSlides (NEW)
//   3  Upgrade to Merchant ......... MerchantUpgradeStatus + requestMerchantUpgrade (NEW)
//   4  Choose provider type ........ ProviderType + ProviderTypeOption + selectProviderType (NEW)
//   5  Doctor profile update ....... REUSE Section B (doctor.profile / useProfileBuilder)
//   6  Specialist doctor .......... REUSE Section B (provider-type variant of doctor)
//   7  Veterinary doctor .......... REUSE Section C / Batch 1 (doctor.batch1 / useVetProfile)
//   8–12 Legal consents .......... LegalDocKind + LegalDocument + LegalConsentRecord +
//                                   ConsentStatus + getLegalDocument/getConsentStatus/acceptConsent (NEW)
//   13–16 OS permissions ......... AppPermissionKind + PermissionState +
//                                   getPermissionStates / recordPermissionDecision (NEW)
//   17–20 Account states ......... REUSE Batch 7 AccountStatus / AccountState / useAccountStatus

// Re-export the Batch 7 account-status vocabulary so a Section A account-state
// screen can pull everything from one import site — these are REUSED verbatim,
// never re-declared.
export type { AccountStatus, AccountState } from '@/types/doctor.batch7';
export type { AccountReviewNotice, AccountReviewReason } from '@/types/doctor.batch7';

// ═══════════════════════════════════════════════════════════════════════════
// ENTRY 2 — APP INTRO CAROUSEL
// ═══════════════════════════════════════════════════════════════════════════
// A single slide of the post-splash intro carousel. `icon` is an Ionicons name
// (the Frontend renders the artwork); `accent` is an optional theme key the UI
// can map to a colour. Pure presentational content — no money, no PII.

export interface OnboardingSlide {
  id:       string;
  title:    string;
  body:     string;
  icon:     string;          // Ionicons name, e.g. 'medkit-outline'
  accent?:  string;          // optional theme accent key
}

// ═══════════════════════════════════════════════════════════════════════════
// ENTRIES 3 & 4 — UPGRADE TO MERCHANT (PROVIDER) + CHOOSE PROVIDER TYPE
// ═══════════════════════════════════════════════════════════════════════════
// The provider type drives which profile builder the Frontend routes into:
//   - 'doctor'       → Section B builder (useProfileBuilder)
//   - 'specialist'   → Section B builder (a doctor variant; same builder, the
//                      specialty step is mandatory) — entry 6
//   - 'veterinarian' → Section C / Batch 1 builder (useVetProfile) — entry 7
// NOTE: name-spaced `Provider*` here to avoid collision with `MerchantType` /
// `MerchantProfile` in `@/types/merchant` (the generic merchant onboarding).

export type ProviderType = 'doctor' | 'specialist' | 'veterinarian';

// `routesTo` tells the Frontend which existing builder a choice opens — it does
// NOT couple the data layer to navigation; it is documentation the UI may use.
export type ProviderBuilderTarget = 'doctor_profile_builder' | 'vet_profile_builder';

export interface ProviderTypeOption {
  type:        ProviderType;
  label:       string;
  description: string;
  icon:        string;                 // Ionicons name
  routesTo:    ProviderBuilderTarget;  // which existing builder this opens
}

// The lifecycle of the user→provider (merchant) upgrade request itself, distinct
// from the later verification/account status. `selectedType` is set once the
// provider type is chosen (entry 4).
export type MerchantUpgradeState =
  | 'not_started'   // user has not begun the upgrade
  | 'type_selected' // provider type chosen, builder not yet submitted
  | 'in_progress'   // profile builder in progress
  | 'submitted'     // builder submitted, verification pending
  | 'completed';    // provider account active

export interface MerchantUpgradeStatus {
  state:         MerchantUpgradeState;
  selectedType?: ProviderType;   // present once entry 4 has run
  startedAt?:    string;         // ISO datetime
  updatedAt:     string;         // ISO datetime
}

// ═══════════════════════════════════════════════════════════════════════════
// ENTRIES 8–12 — LEGAL CONSENTS (versioned)
// ═══════════════════════════════════════════════════════════════════════════
// Five documents the provider must accept during onboarding. Each acceptance is
// versioned — re-accepting is required when a document's `version` changes.
// NOTE: `ConsentRecord` already exists in `@/types/doctor.phase2` (compliance
// consents); ours is named `LegalConsentRecord` to avoid the collision.

export type LegalDocKind =
  | 'terms_of_service'        // entry 8
  | 'medical_privacy'         // entry 9
  | 'hipaa_data_protection'   // entry 10
  | 'professional_conduct'    // entry 11
  | 'telemedicine_policy';    // entry 12

// A renderable section of a legal document (so the Frontend can show structured
// headings without parsing markdown if it prefers).
export interface LegalDocumentSection {
  heading: string;
  body:    string;
}

export interface LegalDocument {
  kind:          LegalDocKind;
  version:       string;        // semantic-ish version, e.g. '2026.1'
  title:         string;
  summary:       string;        // one-line gist for the consent checkbox row
  bodyMarkdown:  string;        // full document body (markdown)
  sections:      LegalDocumentSection[]; // structured alternative to bodyMarkdown
  effectiveDate: string;        // ISO date (yyyy-mm-dd)
  requiresReacceptance?: boolean; // true when a new version supersedes an accepted one
}

// A single recorded acceptance — what version of which document was accepted and
// when. This is the Section-A consent record (distinct from phase2 ConsentRecord).
export interface LegalConsentRecord {
  kind:       LegalDocKind;
  version:    string;        // the version that was accepted
  acceptedAt: string;        // ISO datetime
}

// Backwards-friendly alias for callers that think in terms of "an acceptance".
export type ConsentAcceptance = LegalConsentRecord;

// Aggregate view: which consents are accepted vs still outstanding, and whether
// the whole gate is satisfied (all required docs accepted at their current
// version).
export interface ConsentStatus {
  accepted:     LegalConsentRecord[];  // accepted at current version
  outstanding:  LegalDocKind[];        // not yet accepted, or version superseded
  allAccepted:  boolean;               // true when `outstanding` is empty
  updatedAt:    string;                // ISO datetime
}

// ═══════════════════════════════════════════════════════════════════════════
// ENTRIES 13–16 — OS PERMISSIONS (the app's record of the OS outcome)
// ═══════════════════════════════════════════════════════════════════════════
// The actual OS prompt is the Frontend's job (expo-notifications / expo-camera /
// expo-av / expo-location). This data layer only stores the doctor-app's record
// of the outcome so the backend / other screens know what was granted.

export type AppPermissionKind =
  | 'notification'   // entry 13
  | 'camera'         // entry 14
  | 'microphone'     // entry 15
  | 'location';      // entry 16

export type PermissionState = 'granted' | 'denied' | 'undetermined';

export interface AppPermissionStatus {
  kind:       AppPermissionKind;
  state:      PermissionState;
  // `required` flags the permissions a doctor must grant to take video consults
  // (camera + microphone); notification/location are recommended only.
  required:   boolean;
  decidedAt?: string;        // ISO datetime of the recorded decision
}

// Aggregate map of every tracked permission's current recorded state.
export interface PermissionStates {
  permissions: AppPermissionStatus[];
  updatedAt:   string;       // ISO datetime
}

// ═══════════════════════════════════════════════════════════════════════════
// MUTATION INPUTS / RESULTS
// ═══════════════════════════════════════════════════════════════════════════
// `idempotencyKey` is required on every state-changing mutation. Hooks generate
// it; callers pass `Omit<Input, 'idempotencyKey'>`.

// ─── Entry 3 — request the user→merchant (provider) upgrade ──────────────────
export interface RequestMerchantUpgradeInput {
  idempotencyKey: string;
}

export interface RequestMerchantUpgradeResult {
  status: MerchantUpgradeStatus;
}

// ─── Entry 4 — choose the provider type ──────────────────────────────────────
export interface SelectProviderTypeInput {
  type:           ProviderType;
  idempotencyKey: string;
}

export interface SelectProviderTypeResult {
  status: MerchantUpgradeStatus;   // state becomes 'type_selected', selectedType set
}

// ─── Entries 8–12 — accept a legal document (versioned) ──────────────────────
export interface AcceptConsentInput {
  kind:           LegalDocKind;
  version:        string;          // the version the user is accepting
  idempotencyKey: string;
}

export interface AcceptConsentResult {
  record: LegalConsentRecord;
  status: ConsentStatus;           // refreshed aggregate after this acceptance
}

// ─── Entries 13–16 — record an OS permission decision ────────────────────────
export interface RecordPermissionDecisionInput {
  kind:           AppPermissionKind;
  state:          PermissionState;
  idempotencyKey: string;
}

export interface RecordPermissionDecisionResult {
  permission: AppPermissionStatus;
}
