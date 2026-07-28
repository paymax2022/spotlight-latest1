// ── Contestant Registration — Mobile types ───────────────────────────────────
// Mirror of the backend contract:
//   frontend-web/src/features/registration/types.ts (canonical)
//   frontend-web/src/server/registration/store.ts    (draft / step shapes)
//
// The registration flow is SCHEMA-DRIVEN: the server returns an ordered list of
// `steps`, each with `fields[]` of `RegistrationField`. The mobile wizard renders
// purely from this schema — it must never hardcode the step list or field set.

export type ContestCategory =
  | 'music'
  | 'acting'
  | 'comedy_content'
  | 'dance'
  | 'film_production'
  | 'stem_innovation'
  | 'sme_pitch'
  | 'school_campus'
  | 'open_mic'
  | 'general_reality_show'
  | 'other';

export type ContestType =
  | 'online_contest'
  | 'physical_audition'
  | 'hybrid_contest'
  | 'public_voting_contest'
  | 'bootcamp_reality_show'
  | 'housemate_reality_show'
  | 'pitch_competition'
  | 'school_vs_school_contest'
  | 'regional_contest'
  | 'national_contest'
  | 'international_entry';

export type ApplicationStatus =
  | 'draft'
  | 'submitted'
  | 'awaiting_payment'
  | 'payment_failed'
  | 'under_review'
  | 'more_information_requested'
  | 'shortlisted'
  | 'callback_invited'
  | 'approved'
  | 'rejected'
  | 'waitlisted'
  | 'disqualified'
  | 'audition_scheduled'
  | 'selected_for_bootcamp'
  | 'selected_for_public_voting'
  | 'eliminated'
  | 'winner'
  | 'withdrawn';

export type ContestantRole =
  | 'public_user'
  | 'contestant'
  | 'parent_guardian'
  | 'school_representative'
  | 'admin'
  | 'super_admin';

export type RegistrationStepKey =
  | 'account_gate'
  | 'contest_selection'
  | 'personal_information'
  | 'guardian_consent'
  | 'identity_verification'
  | 'talent_profile'
  | 'category_specific'
  | 'media_uploads'
  | 'social_fanbase'
  | 'bootcamp_housemate_readiness'
  | 'medical_welfare_safety'
  | 'emergency_contact'
  | 'character_compliance'
  | 'payment'
  | 'audition_scheduling'
  | 'public_profile_setup'
  | 'legal_consents'
  | 'review_submit';

// Field types the renderer maps to mobile inputs. `password` is reserved for the
// account_gate step (handled by the app's auth, not entered in the wizard).
export type FieldType =
  | 'text'
  | 'email'
  | 'tel'
  | 'password'
  | 'date'
  | 'number'
  | 'textarea'
  | 'select'
  | 'checkbox'
  | 'multi_select'
  | 'file'
  | 'url';

export interface RegistrationField {
  key: string;
  label: string;
  type: FieldType;
  required?: boolean;
  readOnly?: boolean;
  placeholder?: string;
  helpText?: string;
  options?: string[];
  accept?: string;
  maxSizeMb?: number;
  multiple?: boolean;
}

// The server sends `steps` without the `conditional` predicate (it is applied
// server-side in buildRegistrationSteps), so the mobile RegistrationStep is the
// serialisable subset.
export interface RegistrationStep {
  key: RegistrationStepKey;
  title: string;
  description: string;
  fields: RegistrationField[];
}

export interface ContestRegistrationDefinition {
  slug: string;
  title: string;
  contestCategory: ContestCategory;
  contestType: ContestType;
  seasonOrEdition: string;
  regionScope: 'state' | 'regional' | 'national' | 'international';
  isPaid: boolean;
  registrationFeeNgn?: number;
  requiresGuardianConsentForMinors: boolean;
  legalAdultAge: number;
  requiresMedical: boolean;
  requiresBootcampReadiness: boolean;
  supportsVoting: boolean;
  supportsAuditionScheduling: boolean;
  supportsSchoolEntry: boolean;
  supportsGroupEntry: boolean;
  auditionStates?: string[];
  applicantCategories?: string[];
  categoryQuestionSet: ContestCategory;
}

export interface RegistrationDraft {
  id: string;
  reference: string;
  contestSlug: string;
  status: ApplicationStatus;
  role: ContestantRole;
  userId?: string;
  createdAt: string;
  updatedAt: string;
  submittedAt?: string;
  formData: Record<string, unknown>;
  completionPercent: number;
  currentStep?: RegistrationStepKey;
  fraudFlags: string[];
}

export interface RegistrationStatusEvent {
  id: string;
  applicationId: string;
  oldStatus?: ApplicationStatus;
  newStatus: ApplicationStatus;
  note?: string;
  createdAt: string;
  actorRole: ContestantRole;
}

// ── API response envelopes (Next.js successResponse wraps payloads bare) ──────

export interface ContestsResponse {
  success: boolean;
  contests: ContestRegistrationDefinition[];
}

export interface ApplicationsListResponse {
  success: boolean;
  applications: RegistrationDraft[];
}

export interface DraftResponse {
  success: boolean;
  draft: RegistrationDraft;
  steps?: RegistrationStep[];
}

// PATCH save-step returns the draft + the recomputed schema + validation.
export interface SaveStepResponse {
  success: boolean;
  draft: RegistrationDraft;
  steps: RegistrationStep[];
  validation: { isValid: boolean; errors: Record<string, string> };
}

export interface SubmitResponse {
  success: boolean;
  draft: RegistrationDraft;
  message?: string;
}

export interface StatusResponse {
  success: boolean;
  draft: RegistrationDraft;
  timeline: RegistrationStatusEvent[];
}

export interface UploadResponse {
  success: boolean;
  upload: {
    fileName: string;
    fileSize: number;
    mimeType: string;
    storageKey: string;
    storagePath: string;
    previewUrl: string;
  };
}

// ── Registration payment ──────────────────────────────────────────────────────

export type RegistrationPaymentMethod = 'WALLET' | 'PAYSTACK';

export interface InitiateRegistrationPaymentResponse {
  success: boolean;
  transactionId: string;
  reference: string;
  /** Paystack hosted checkout URL — absent for wallet payments (instant). */
  authorizationUrl?: string;
  /** `completed` = wallet settled immediately; `initiated` = awaiting Paystack. */
  status: 'completed' | 'initiated';
}

export interface VerifyRegistrationPaymentResponse {
  success: boolean;
  status: 'PENDING' | 'SUCCESSFUL' | 'FAILED';
  reference: string;
}

// ── File uploads ─────────────────────────────────────────────────────────────

// A locally-picked file ready for multipart upload.
export interface PickedUpload {
  uri: string;
  name: string;
  mimeType: string;
}

// Stored value of a `file` field once uploaded — the previewUrl is what the
// backend persists in formData; we keep fileName for display.
export interface UploadedFileValue {
  previewUrl: string;
  fileName: string;
  storageKey?: string;
}
