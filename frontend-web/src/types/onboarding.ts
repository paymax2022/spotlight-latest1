// Merchant Onboarding admin types.
// Application JSON is camelCase, matching the backend admin endpoints.

export type OnboardingStatus =
  | 'DRAFT'
  | 'SUBMITTED'
  | 'UNDER_REVIEW'
  | 'NEEDS_MORE_INFO'
  | 'APPROVED'
  | 'REJECTED';

export type DocumentVerificationStatus =
  | 'pending'
  | 'verified'
  | 'rejected'
  | 'expired';

export type CheckStatus = 'pass' | 'fail' | 'pending' | 'manual';

export interface OnboardingDocument {
  type: string;
  label: string;
  fileName: string;
  expiryDate: string | null;
  verificationStatus: DocumentVerificationStatus;
}

export interface OnboardingCheck {
  key: string; // e.g. bvn, nin, credential
  label: string;
  status: CheckStatus;
  detail: string;
}

export interface OnboardingApplication {
  id: string;
  userId: string;
  applicantName: string;
  merchantTypeId: string;
  merchantTypeName: string;
  moduleId: string;
  moduleName: string;
  formSchemaId: string;
  formSchemaVersion: string;
  status: OnboardingStatus;
  data: Record<string, unknown>;
  documents: OnboardingDocument[];
  checks: OnboardingCheck[];
  decisionReason: string | null;
  infoChecklist: string[];
  submittedAt: string | null;
  decidedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

// Lighter row shape returned by the review queue list endpoint.
// Backend may return full applications; the queue page only relies on these fields.
export interface OnboardingQueueRow {
  id: string;
  applicantName: string;
  moduleId: string;
  moduleName: string;
  merchantTypeId: string;
  merchantTypeName: string;
  status: OnboardingStatus;
  riskLevel: 'low' | 'medium' | 'high' | null;
  submittedAt: string | null;
  createdAt: string;
}

export interface OnboardingQueueFilters {
  module?: string;
  type?: string;
  status?: string;
  age?: string; // e.g. '1d', '3d', '7d' age buckets
}
