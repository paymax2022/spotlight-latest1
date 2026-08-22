// ── Types for the EdTech School-Fees admin console (SC-29 … SC-40) ────────────
// Brownfield extension of the Academy admin. Monetary amounts are integers in
// minor units (kobo). Times are ISO-8601. Invariants: SF-1 (FeeSchedule
// immutable once issued), SF-3 (two-approval promotion), SF-9 (human hardship
// review), SF-11 (opt-in, immutably-logged government export).

// ── SC-29 Setup wizard: school → session → class → fee schedule ───────────────
export type VerificationTier = 'basic' | 'verified' | 'accredited';
export type SchoolStatus = 'onboarding' | 'active' | 'suspended';

export type FeesSchool = {
  id: string;
  name: string;
  state: string;
  verification_tier: VerificationTier;
  status: SchoolStatus;
  owner_email?: string;
  bank_account?: string;
  created_at: string;
};
export type FeesSchoolInput = { name: string; state: string; owner_email: string; bank_account?: string };

export type SessionStatus = 'upcoming' | 'active' | 'closed';
export type FeesSession = {
  id: string;
  school_id: string;
  name: string;
  starts_on: string;
  ends_on: string;
  status: SessionStatus;
};
export type FeesSessionInput = { school_id: string; name: string; starts_on: string; ends_on: string };

export type FeesClass = {
  id: string;
  school_id: string;
  session_id: string;
  name: string;
  curriculum_class: string;
  students: number;
};
export type FeesClassInput = { school_id: string; session_id: string; name: string; curriculum_class: string };

export type FeeItem = { id: string; name: string; amount_kobo: number; mandatory: boolean };
export type FeeItemInput = { name: string; amount_kobo: number; mandatory: boolean };
export type InstallmentPolicy = { enabled: boolean; count: number; cadence_days: number; first_due_date: string };

export type FeeScheduleStatus = 'draft' | 'issued'; // SF-1: 'issued' is terminal & immutable
export type FeeSchedule = {
  id: string;
  school_id: string;
  session_id: string;
  class_id: string;
  term: string;
  status: FeeScheduleStatus;
  due_date: string;
  fee_items: FeeItem[];
  installment_policy: InstallmentPolicy;
  issued_at: string | null;
};
export type FeeScheduleInput = {
  school_id: string;
  session_id: string;
  class_id: string;
  term: string;
  due_date: string;
  fee_items: FeeItemInput[];
  installment_policy: InstallmentPolicy;
};
export type FeeScheduleIssueResult = { id: string; status: 'issued'; issued_at: string; immutable: true };

// ── SC-32 Bulk onboarding ─────────────────────────────────────────────────────
export type OnboardingRowStatus = 'valid' | 'error';
export type OnboardingRow = {
  line: number;
  student_name: string;
  guardian_email: string;
  class_name: string;
  admission_no: string;
  status: OnboardingRowStatus;
  message: string | null;
};
export type OnboardingBatchStatus = 'pending_review' | 'approved' | 'rejected';
export type OnboardingBatch = {
  id: string;
  school_id: string;
  filename: string;
  uploaded_by: string;
  status: OnboardingBatchStatus;
  total: number;
  valid: number;
  errors: number;
  uploaded_at: string;
  rows: OnboardingRow[];
};
export type OnboardingApproveInput = { batch_id: string; decision: 'approve' | 'reject'; note?: string };

// ── SC-33 Collections dashboard ───────────────────────────────────────────────
export type CollectionsOverview = {
  invoices_issued: number;
  invoices_paid: number;
  invoices_partial: number;
  invoices_overdue: number;
  billed_kobo: number;
  collected_kobo: number;
  outstanding_kobo: number;
};
export type InvoiceStatus = 'issued' | 'partial' | 'paid' | 'overdue' | 'frozen';
export type InvoiceRow = {
  id: string;
  student_name: string;
  class_name: string;
  guardian_email: string;
  billed_kobo: number;
  paid_kobo: number;
  status: InvoiceStatus;
  due_date: string;
  issued_at: string;
};

// ── SC-34 Defaulters & hardship (SF-9) ────────────────────────────────────────
export type HardshipStatus = 'pending' | 'approved' | 'denied';
export type HardshipRequest = {
  id: string;
  invoice_id: string;
  student_name: string;
  class_name: string;
  guardian_email: string;
  outstanding_kobo: number;
  reason: string;
  requested_at: string;
  status: HardshipStatus;
  reviewer_note?: string | null;
  reviewed_at?: string;
};
export type HardshipDecisionInput = { request_id: string; decision: 'approve' | 'deny'; note?: string };

// ── SC-35/36 Promotion + rollover (SF-3) ──────────────────────────────────────
export type PromotionStatus =
  | 'results_finalized' | 'promotion_computed' | 'promotion_reviewed' | 'promotion_approved' | 'applied';
export type PromotionBatch = {
  id: string;
  school_id: string;
  session_id: string;
  from_class: string;
  to_class: string;
  students_total: number;
  students_promoted: number;
  students_retained: number;
  status: PromotionStatus;
  teacher_approved_by: string | null;
  teacher_approved_at: string | null;
  head_approved_by: string | null;
  head_approved_at: string | null;
  computed_at: string;
};
export type PromotionApproveInput = { batch_id: string; role: 'class_teacher' | 'head_teacher'; approver?: string };

// ── SC-37 Competition registration ────────────────────────────────────────────
export type CompetitionScope = 'class' | 'school' | 'city' | 'state' | 'national';
export type CompetitionStatus =
  | 'draft' | 'open_registration' | 'registration_closed' | 'in_progress'
  | 'results_pending' | 'completed' | 'archived';
export type Competition = {
  id: string;
  name: string;
  subject: string;
  scope: CompetitionScope;
  status: CompetitionStatus;
  starts_on: string;
  registration_closes: string;
  registered_schools: number;
  registered_students: number;
};
export type CompetitionRegistration = {
  id: string;
  competition_id: string;
  school_id: string;
  team_name: string;
  students: number;
  status: 'pending' | 'confirmed';
  registered_at: string;
};
export type CompetitionRegisterInput = { competition_id: string; school_id: string; team_name: string; students: number };

// ── SC-38 Government export center (SF-11) ─────────────────────────────────────
export type DataCategory = 'roster' | 'attendance' | 'fees' | 'results' | 'welfare';
export type GovExportOptIn = { school_id: string; category: DataCategory; opted_in: boolean; updated_at: string };
export type GovExportOptInInput = { school_id: string; category: DataCategory; opted_in: boolean };
export type ComplianceExport = {
  id: string;
  school_id: string;
  report_type: string;
  recipient: string;
  data_categories: DataCategory[];
  period: string;
  generated_by: string;
  generated_at: string;
};
export type ComplianceExportInput = {
  school_id: string;
  report_type: string;
  recipient: string;
  data_categories: DataCategory[];
  period: string;
};

// ── SC-40 Staff & bursar role management ──────────────────────────────────────
export type SchoolRole = 'school-owner' | 'bursar' | 'class-teacher' | 'head-teacher';
export type SchoolRoleGrant = {
  id: string;
  school_id: string;
  user_email: string;
  role: SchoolRole;
  granted_by: string;
  granted_at: string;
  status: 'active' | 'revoked';
};
export type RoleAssignInput = { school_id: string; user_email: string; role: SchoolRole };
export type RoleRevokeInput = { grant_id: string };
