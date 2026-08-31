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

export type ContestantRole = 'public_user' | 'contestant' | 'parent_guardian' | 'school_representative' | 'admin' | 'super_admin';

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

export interface RegistrationStep {
  key: RegistrationStepKey;
  title: string;
  description: string;
  fields: RegistrationField[];
  conditional?: (draft: RegistrationDraft) => boolean;
}

// Steps whose fields an admin may configure per-contest. Account login, contest
// selection, and the legal/consent + submit steps are fixed by the platform and
// are NOT part of the configurable schema.
export type ConfigurableStepKey = 'personal_information' | 'category_specific';

// A single custom (admin-authored) question added on top of the catalog.
export interface ContestCustomField {
  key: string;            // always namespaced 'custom.<slug>'
  label: string;
  type: FieldType;
  step: ConfigurableStepKey;
  required?: boolean;
  options?: string[];     // for select / multi_select
  accept?: string;        // for file
  helpText?: string;
}

// Admin-defined mapping of which inputs a contest collects. When a contest has a
// schema, the contestant sees EXACTLY the catalog fields in `includedFields`
// (plus any custom fields and the fixed platform steps) — nothing else.
export interface ContestFormSchema {
  version: 1;
  includedFields: string[];                    // allow-list of catalog field keys
  requiredOverrides?: Record<string, boolean>; // catalog key -> required?
  customFields?: ContestCustomField[];
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
  // Contest-specific voting rules/policies text shown on the mobile contest
  // details screen, above the platform's default rules sections.
  rulesText?: string;
  /** Banner image shown on the mobile contest list and detail screens. */
  bannerImageUrl?: string;
  // Optional admin-defined form mapping. When present the contestant form is
  // built from this schema; when absent the contest falls back to its tailored
  // code template (forms/<slug>.ts) or the capability-driven default.
  formSchema?: ContestFormSchema;
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

export interface RegistrationReviewInput {
  status: ApplicationStatus;
  note?: string;
  score?: number;
  fraudFlags?: string[];
  requestedFields?: string[];
}

export interface RegistrationListFilter {
  contestSlug?: string;
  status?: ApplicationStatus;
  contestCategory?: ContestCategory;
  minAge?: number;
  maxAge?: number;
  paymentStatus?: 'pending' | 'paid' | 'failed' | 'waived';
  query?: string;
}
