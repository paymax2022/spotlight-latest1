// ── Merchant Onboarding & Role-Upgrade — type contract ───────────────────────
// Source of truth for the "one identity, many capabilities" subsystem
// (Spotlight-Paymax-Onboarding-PRD.md §5, §7, §10).
//
// This file is the interface the mobile screens code against. The Backend role
// owns it; the Frontend role consumes it and never reaches past it.
//
// IRON RULE: every monetary amount is an integer in minor units (kobo).

// ─── Modules & merchant types (PRD §4, §8.2) ─────────────────────────────────

export type ModuleOnboardingStatus = 'open' | 'closed';

export interface MerchantModule {
  id:          string;
  slug:        string;
  name:        string;
  description: string;
  icon:        string;   // lucide icon name (resolved by ModuleCard/StateView pattern)
  iconColor:   string;
  bgColor:     string;
  status:      ModuleOnboardingStatus;
  typeCount:   number;   // merchant types open within this module
}

export interface MerchantType {
  id:                  string;
  moduleId:            string;
  moduleName:          string;
  slug:                string;
  name:                string;
  description:         string;
  icon:                string;
  requirementsSummary: string[];          // bullet copy for the type picker (FR-6)
  expectedReviewLabel: string;            // e.g. "24–48 hours" (FR-6)
  requiredKycTier:     0 | 1 | 2 | 3;     // FR-18
  roleToGrant:         string;            // e.g. "health_provider" (FR-16)
  currentFormSchemaId: string;
  status:              'open' | 'retired';
}

// ─── Form-schema engine (PRD §8.3, FR-8 … FR-13) ─────────────────────────────

export type FormFieldType =
  | 'text'
  | 'textarea'
  | 'number'
  | 'email'
  | 'phone'
  | 'select'
  | 'multiselect'
  | 'date'
  | 'address'
  | 'currency'      // value stored as kobo (integer)
  | 'document'      // file upload slot
  | 'boolean';

export interface FormFieldOption {
  label: string;
  value: string;
}

/** Show this field only when another field equals `equals` (FR-10). */
export interface FieldVisibility {
  field:  string;
  equals: string | boolean;
}

export interface FormField {
  key:          string;
  type:         FormFieldType;
  label:        string;
  placeholder?: string;
  helpText?:    string;
  required:     boolean;
  options?:     FormFieldOption[];   // select / multiselect
  min?:         number;              // number / currency / multiselect count
  max?:         number;
  maxSelections?: number;            // multiselect cap
  hasExpiry?:   boolean;             // document fields (FR-13)
  visibleWhen?: FieldVisibility;
}

export interface FormStep {
  key:          string;
  title:        string;
  description?: string;
  fields:       FormField[];
}

export interface FormSchema {
  id:               string;
  merchantTypeId:   string;
  version:          number;          // applications validate against their version (FR-12)
  status:           'published' | 'draft' | 'archived';
  steps:            FormStep[];
}

// ─── Submitted values ────────────────────────────────────────────────────────
// A flat map keyed by FormField.key. Document fields store a DocumentValue.

export interface DocumentValue {
  fileName:    string;
  uploadedAt:  string;          // ISO
  expiryDate?: string | null;   // ISO, when field.hasExpiry
  status:      'pending' | 'verified' | 'rejected';
}

export type FieldValue = string | number | boolean | string[] | DocumentValue | null;

export type ApplicationData = Record<string, FieldValue>;

// ─── Onboarding application (PRD §7.2, §10) ──────────────────────────────────

export type ApplicationStatus =
  | 'DRAFT'
  | 'SUBMITTED'
  | 'UNDER_REVIEW'
  | 'NEEDS_MORE_INFO'
  | 'APPROVED'
  | 'REJECTED';

export interface ApplicationCheck {
  key:    string;          // e.g. "bvn", "mdcn_register"
  label:  string;
  status: 'pending' | 'passed' | 'failed';
  detail?: string;
}

export interface OnboardingApplication {
  id:                string;
  userId:            string;
  merchantTypeId:    string;
  merchantTypeName:  string;
  moduleId:          string;
  moduleName:        string;
  formSchemaId:      string;
  formSchemaVersion: number;
  status:            ApplicationStatus;
  data:              ApplicationData;
  checks:            ApplicationCheck[];
  decisionReason?:   string | null;     // reject reason / needs-info checklist
  infoChecklist?:    string[];          // NEEDS_MORE_INFO items (FR-21)
  createdAt:         string;
  updatedAt:         string;
  submittedAt?:      string | null;
  decidedAt?:        string | null;
}

// ─── Merchant profile & capabilities (PRD §7.3, §8.7) ────────────────────────

export type MerchantProfileStatus =
  | 'PROVISIONING'
  | 'ACTIVE'
  | 'UNDER_REVERIFICATION'
  | 'SUSPENDED'
  | 'OFFBOARDED';

export interface MerchantProfile {
  id:               string;
  userId:           string;
  moduleId:         string;
  moduleName:       string;
  merchantTypeId:   string;
  merchantTypeName: string;
  icon:             string;
  roleGranted:      string;
  status:           MerchantProfileStatus;
  activatedAt?:     string | null;
  workspaceRoute:   string;             // capability switcher target (FR-26)
}

export type CapabilityKind = 'customer' | 'merchant';

/** A unified switcher row: the base Customer context + each merchant profile. */
export interface Capability {
  id:        string;
  kind:      CapabilityKind;
  label:     string;            // "Customer" | merchant type name
  sublabel:  string;            // module name / "Personal account"
  icon:      string;
  status:    'active' | MerchantProfileStatus;
  route:     string;
}

export interface MyCapabilities {
  userId:           string;
  displayName:      string;
  kycTier:          0 | 1 | 2 | 3;
  customer:         Capability;          // always present (PRD rule §11.1)
  merchants:        MerchantProfile[];
  activeApplications: OnboardingApplication[];  // in-flight (DRAFT … UNDER_REVIEW)
}

// ─── Mutation inputs (FR-11, FR-12, idempotent — §9) ─────────────────────────

export interface CreateApplicationInput {
  merchantTypeId: string;
}

export interface SaveDraftInput {
  applicationId: string;
  data:          ApplicationData;
}

export interface SubmitApplicationInput {
  applicationId:  string;
  data:           ApplicationData;
  idempotencyKey: string;
}

export interface ResubmitApplicationInput {
  applicationId:  string;
  data:           ApplicationData;
  idempotencyKey: string;
}

// ─── Validation (client mirrors server, FR-12) ───────────────────────────────

export type FieldErrors = Record<string, string>;

export interface StepValidationResult {
  ok:     boolean;
  errors: FieldErrors;
}
