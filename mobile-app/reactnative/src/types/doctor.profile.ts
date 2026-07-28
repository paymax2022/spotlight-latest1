// ── Doctor (Telemedicine, provider-side) — Section B Domain Types ─────────────
// Section B: the full Doctor Profile & Verification flow (31 screens) — a
// multi-step profile builder that produces a draft (`DoctorProfileDraft`) which
// maps onto the published `DoctorProfile` plus a richer verification submission.
//
// ADDITIVE to `@/types/doctor` and `@/types/doctor.phase2` — those shapes are
// imported/reused, never duplicated. Money amounts are integers in minor units
// (kobo). Use `import type` for type-only imports.

import type {
  DoctorProfile,
  VerificationStatus,
  VerificationDocType,
  VerificationDocument,
  VerificationSubmission,
  SubmitVerificationResult,
} from '@/types/doctor';
import type { LicenceStatus } from '@/types/doctor.phase2';

// Re-export the Phase 1 / Phase 2 primitives Section B leans on, so a screen can
// pull everything it needs from one import site.
export type {
  DoctorProfile,
  VerificationStatus,
  VerificationDocType,
  VerificationDocument,
  VerificationSubmission,
  SubmitVerificationResult,
} from '@/types/doctor';
export type { LicenceStatus } from '@/types/doctor.phase2';

// ─── Extended verification document types ────────────────────────────────────
// Phase 1 `VerificationDocType` already covers MDCN cert, medical license,
// degree cert, government ID, passport photo and CV. Section B adds a few more
// document categories collected during the profile builder. These extend the
// concept without re-declaring the Phase 1 union.

export type ProfileDocType =
  | VerificationDocType        // reuse all Phase 1 doc types
  | 'certificate'             // additional professional certificate
  | 'association_membership'; // professional association proof

// ─── Uploaded files (photos, licences, certificates, etc.) ───────────────────
// A lightweight client-side handle for a picked / uploaded file. `uri` is the
// local file URI (Expo ImagePicker / DocumentPicker); Phase C swaps it for the
// uploaded R2/object-storage URL after upload.

export interface UploadedFile {
  id:          string;
  uri:         string;          // local URI now; remote URL after Phase C upload
  fileName:    string;
  mimeType?:   string;          // "application/pdf", "image/jpeg"
  sizeBytes?:  number;
  uploadedAt:  string;          // ISO datetime
}

// A document slot in the builder, keyed by ProfileDocType, optionally filled.
export interface ProfileDocumentSlot {
  type:      ProfileDocType;
  label:     string;
  required:  boolean;
  file?:     UploadedFile;      // present once the doctor uploads it
}

// ─── Personal information (screen 2) ─────────────────────────────────────────

export type GenderOption = 'male' | 'female' | 'other' | 'prefer_not_to_say';

export interface PersonalInfo {
  firstName:    string;
  lastName:     string;
  title:        string;          // honorific, e.g. "Dr."
  gender?:      GenderOption;
  dateOfBirth?: string;          // ISO date
  email:        string;
  phone:        string;
  state?:       string;          // Nigerian state of practice
  city?:        string;
  address?:     string;
}

// ─── Licence info (screens 9, 29, 30) ────────────────────────────────────────
// NOTE: Phase 2 already exports a `LicenceInfo` (compliance view, derived from
// the register). Section B's editable licence metadata is a distinct shape, so
// it is namespaced as `ProfileLicenceInfo` to avoid a name collision.

export interface ProfileLicenceInfo {
  licenceNumber: string;         // MDCN registration number
  issuingBody:   string;         // "MDCN"
  issuedAt?:     string;         // ISO date
  expiresAt?:    string;         // ISO date
  status?:       LicenceStatus;  // reuse Phase 2 LicenceStatus union
  licenceFile?:  UploadedFile;   // uploaded licence document
}

// Licence expiry warning + renewal (screens 29, 30).
export interface LicenceExpiryWarning {
  licenceNumber: string;
  expiresAt:     string;         // ISO date
  daysToExpiry:  number;         // negative when already expired
  status:        LicenceStatus;  // 'expiring_soon' | 'expired' | ...
  message:       string;         // human-readable warning copy
}

export interface LicenceRenewal {
  id:            string;
  licenceNumber: string;
  newExpiresAt:  string;         // ISO date
  renewalFile:   UploadedFile;   // uploaded renewed licence
  submittedAt:   string;         // ISO datetime
  status:        VerificationStatus; // renewal goes through verification again
}

// ─── Education & work history (screens 15, 16) ───────────────────────────────

export interface EducationEntry {
  id:           string;
  institution:  string;          // "University of Lagos"
  degree:       string;          // "MBBS", "MSc Public Health"
  field?:       string;          // "Medicine & Surgery"
  startYear:    number;          // 2008
  endYear?:     number;          // 2014 (undefined if ongoing)
  isCurrent:    boolean;
}

export interface WorkExperienceEntry {
  id:           string;
  organisation: string;          // "Lagoon Medical Centre"
  role:         string;          // "Consultant Family Physician"
  location?:    string;          // "Lagos, NG"
  startYear:    number;
  endYear?:     number;          // undefined if current
  isCurrent:    boolean;
  description?: string;
}

// ─── Clinic / hospital affiliation (screen 14) ───────────────────────────────

export interface ClinicAffiliation {
  id:        string;
  name:      string;             // "Lagoon Medical Centre"
  role?:     string;             // "Consultant"
  state?:    string;
  city?:     string;
  isPrimary: boolean;            // the doctor's main place of practice
}

// ─── Consultation pricing & free follow-up policy (screens 17, 18) ───────────

export interface ConsultationPricing {
  videoFeeKobo:    number;       // per-consult fee in kobo
  audioFeeKobo:    number;
  chatFeeKobo:     number;
  currency:        string;       // "NGN"
  acceptsInstant:  boolean;      // accept on-demand consults
}

export interface FreeFollowUpPolicy {
  enabled:       boolean;        // offer free follow-ups at all
  windowDays:    number;         // days after a consult a free follow-up is valid
  maxFreeVisits: number;         // number of free follow-ups per consult
  note?:         string;         // policy note shown to patients
}

// ─── Bank account & tax info (screens 20, 21) ────────────────────────────────

export interface BankAccount {
  bankName:        string;       // "GTBank"
  bankCode?:       string;       // NIP/CBN bank code
  accountNumber:   string;       // 10-digit NUBAN (validated client-side)
  accountName:     string;       // resolved account holder name
  isVerified:      boolean;      // name-enquiry resolved
}

export interface TaxInfo {
  hasTin:      boolean;          // doctor has a Tax Identification Number
  tin?:        string;           // TIN when hasTin
  vatRegistered: boolean;        // registered for VAT
  vatNumber?:  string;
  businessName?: string;         // registered business / practice name
}

// ─── Profile builder draft (screens 1–22) ────────────────────────────────────
// All editable fields collected across the wizard. A partial draft is saved as
// the doctor progresses; `step`/`completedSteps` drive the hub (screen 1).

export type ProfileBuilderStep =
  | 'personal_info'        // 2
  | 'profile_photo'        // 3
  | 'bio'                  // 4
  | 'specialty'            // 5
  | 'sub_specialty'        // 6
  | 'experience'           // 7
  | 'languages'            // 8
  | 'licence_number'       // 9
  | 'licence_upload'       // 10
  | 'government_id'        // 11
  | 'certificates'         // 12
  | 'association'          // 13
  | 'affiliations'         // 14
  | 'education'            // 15
  | 'work_experience'      // 16
  | 'pricing'              // 17
  | 'free_follow_up'       // 18
  | 'availability'         // 19 (handled by existing useAvailability)
  | 'bank_account'         // 20
  | 'tax_info';            // 21

export interface DoctorProfileDraft {
  id:               string;             // draft id
  doctorId?:        string;             // linked account, when known
  personalInfo:     PersonalInfo;
  photo?:           UploadedFile;       // profile photo (screen 3)
  bio:              string;             // professional bio (screen 4)
  specialtyId:      string;             // primary specialty (screen 5)
  subSpecialtyIds:  string[];           // sub-specialties (screen 6) — label ids
  yearsExperience:  number;             // screen 7
  languages:        string[];           // screen 8
  licence:          ProfileLicenceInfo; // screens 9, 10
  documents:        ProfileDocumentSlot[]; // govt ID (11), certs (12), assoc (13), etc.
  certificates:     UploadedFile[];     // additional certificates (screen 12)
  associationMembership?: UploadedFile; // professional association proof (screen 13)
  affiliations:     ClinicAffiliation[];   // screen 14
  education:        EducationEntry[];      // screen 15
  workExperience:   WorkExperienceEntry[]; // screen 16
  pricing:          ConsultationPricing;   // screen 17
  freeFollowUp:     FreeFollowUpPolicy;    // screen 18
  bankAccount?:     BankAccount;           // screen 20
  taxInfo?:         TaxInfo;               // screen 21
  completedSteps:   ProfileBuilderStep[];  // drives the hub checklist (screen 1)
  status:           VerificationStatus;    // mirrors the submission lifecycle
  updatedAt:        string;                // ISO datetime
  isPublished:      boolean;               // screen 31 — live & discoverable
}

// ─── Verification lifecycle (screens 22–31) ──────────────────────────────────
// Reuses Phase 1 `VerificationStatus` ('unsubmitted'|'pending'|'approved'|
// 'rejected'). The four lifecycle states map as:
//   submitted/pending → 'pending', approved → 'approved',
//   failed → 'rejected', resubmit → back to 'unsubmitted'/'pending'.

export type VerificationDecisionOutcome = 'approved' | 'rejected';

// A rejection reason attached to a failed verification (screen 27, 28).
export interface VerificationRejectionReason {
  code:    string;               // "doc_unclear", "licence_mismatch", ...
  label:   string;               // human-readable
  docType?: ProfileDocType;      // the offending document, when applicable
}

export interface VerificationDecision {
  submissionId: string;
  outcome:      VerificationDecisionOutcome;
  decidedAt:    string;          // ISO datetime
  reviewer?:    string;          // reviewer name / queue
  reasons?:     VerificationRejectionReason[]; // present when rejected
  notes?:       string;
}

// ─── Mutation inputs / results ───────────────────────────────────────────────
// `idempotencyKey` is required on every state-changing mutation. Hooks generate
// it; callers pass `Omit<Input, 'idempotencyKey'>`.

export interface SaveProfileDraftInput {
  draft:          Partial<DoctorProfileDraft>; // patch — merged into the draft
  idempotencyKey: string;
}

export interface SaveProfileDraftResult {
  draftId:   string;
  status:    VerificationStatus;
  updatedAt: string;
}

export interface UploadProfilePhotoInput {
  uri:            string;        // local file URI
  fileName:       string;
  mimeType?:      string;
  idempotencyKey: string;
}

export interface UploadDocumentInput {
  type:           ProfileDocType;
  uri:            string;        // local file URI
  fileName:       string;
  mimeType?:      string;
  idempotencyKey: string;
}

export interface UploadResult {
  file: UploadedFile;
}

export interface SaveBankAccountInput {
  bankName:       string;
  bankCode?:      string;
  accountNumber:  string;
  idempotencyKey: string;
}

export interface SaveBankAccountResult {
  account: BankAccount;          // includes resolved name + isVerified
}

export interface SaveTaxInfoInput {
  taxInfo:        TaxInfo;
  idempotencyKey: string;
}

export interface SaveTaxInfoResult {
  taxInfo: TaxInfo;
}

// Section B's submit reuses Phase 1's result shape but accepts the richer draft
// instead of just an MDCN number + doc-type list.
export interface SubmitProfileVerificationInput {
  draftId:        string;
  idempotencyKey: string;
}

export type SubmitProfileVerificationResult = SubmitVerificationResult;

export interface RenewLicenceInput {
  licenceNumber:  string;
  newExpiresAt:   string;        // ISO date
  uri:            string;        // local file URI of renewed licence
  fileName:       string;
  mimeType?:      string;
  idempotencyKey: string;
}

export interface RenewLicenceResult {
  renewalId: string;
  status:    VerificationStatus;
}

export interface PublishProfileInput {
  draftId:        string;
  idempotencyKey: string;
}

export interface PublishProfileResult {
  doctorId:    string;
  isPublished: boolean;
  publishedAt: string;           // ISO datetime
}
