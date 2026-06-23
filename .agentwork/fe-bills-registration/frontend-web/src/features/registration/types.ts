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
