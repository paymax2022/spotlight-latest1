// ── Association — Admin-lite type contract (Q/R/S/T) ──────────────────────────
// IRON RULE: monetary amounts are integers in minor units (kobo).

// ─── Dashboard KPIs (Q1) ──────────────────────────────────────────────────────

export interface AdminKpis {
  totalMembers:     number;
  activeMembers:    number;
  pendingApprovals: number;
  unpaidMembers:    number;
  duesCollectedKobo: number;
  duesOutstandingKobo: number;
}

// ─── Approvals (Q2–Q6) ────────────────────────────────────────────────────────

export type ApplicationJurisdiction = 'CHAPTER' | 'NATIONAL';
export type ApplicationReviewStatus = 'PENDING' | 'INFO_REQUESTED';
export type ApprovalDecision = 'APPROVE' | 'REJECT' | 'REQUEST_INFO';

export interface ApplicationDoc { id: string; name: string; verified: boolean }

export interface AdminApplicationSummary {
  id:           string;
  applicantName: string;
  category:     string;
  chapter:      string;
  submittedAt:  string;        // ISO
  status:       ApplicationReviewStatus;
  jurisdiction: ApplicationJurisdiction;
  paid:         boolean;
}

export interface AdminApplication extends AdminApplicationSummary {
  email:     string;
  phone:     string;
  profession: string;
  sponsor:   string | null;
  documents: ApplicationDoc[];
  registrationFeeKobo: number;
  slaHoursLeft: number;        // negative when breached
}

// ─── Finance / treasurer (S) ──────────────────────────────────────────────────

export interface RevenueLine { label: string; amountKobo: number }

export interface FinanceSummary {
  collectedKobo:   number;
  outstandingKobo: number;
  paidMembers:     number;
  unpaidMembers:   number;
  byChapter:       RevenueLine[];
  byCategory:      RevenueLine[];
  offlinePending:  number;
}

export type OfflineStatus = 'PENDING' | 'APPROVED' | 'REJECTED';

export interface OfflinePayment {
  id:          string;
  memberName:  string;
  memberId:    string;
  amountKobo:  number;
  method:      string;          // "Bank transfer" | "Cash"
  reference:   string;
  forItem:     string;          // "2026 Annual dues"
  submittedAt: string;          // ISO
  status:      OfflineStatus;
}

// ─── Bulk import (R) ──────────────────────────────────────────────────────────

export type ImportIssue = null | 'duplicate' | 'invalid_phone' | 'invalid_email' | 'missing_field';

export interface ImportRow {
  rowNum: number;
  name:   string;
  phone:  string;
  email:  string;
  chapter: string;
  issue:  ImportIssue;
}

export interface ImportPreview {
  fileName:   string;
  total:      number;
  valid:      number;
  duplicates: number;
  invalid:    number;
  rows:       ImportRow[];
}

export interface ImportResult {
  imported:  number;
  skipped:   number;
  invited:   number;
  batchId:   string;
}

// ─── Audit log (Q20) ──────────────────────────────────────────────────────────

export type AuditAction =
  | 'APPROVAL_DECISION'
  | 'MEMBER_SUSPEND'
  | 'MEMBER_RESTORE'
  | 'MEMBER_TRANSFER'
  | 'ROLE_ASSIGN'
  | 'OFFLINE_PAYMENT'
  | 'DUES_PAY'
  | 'IMPORT'
  | 'ANNOUNCEMENT'
  | 'MINUTES_PUBLISH';

export interface AuditEntry {
  id:          string;
  action:      AuditAction;
  actorName:   string;
  summary:     string;       // human-readable line
  subject:     string | null;
  at:          string;       // ISO
}
