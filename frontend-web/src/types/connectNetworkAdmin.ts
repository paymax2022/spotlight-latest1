// ── Types — Paymax Connect Phase 6 (Professional Network) admin console ───────
// Backend contract: /api/connect/admin/networking/*  (camelCase JSON, {data:...}).
// PN-1 SAFETY: raw trust/strength numbers are NEVER surfaced. Where a trust signal
// is relevant we carry only a coarse, non-numeric band (see TrustBand).

/** Shared review verb for every moderation/approval action in this module. */
export type ReviewAction = 'approve' | 'reject' | 'flag';

/** Coarse, non-numeric trust band — PN-1: never a raw score. */
export type TrustBand = 'new' | 'emerging' | 'established' | 'trusted';

export interface ReviewResult {
  id: string;
  status: string;
  reviewedAt: string;
}

// ── ADM-JB-01 · Job posting moderation ───────────────────────────────────────
export type JobModerationStatus = 'pending' | 'approved' | 'rejected' | 'flagged';

export interface JobPosting {
  id: string;
  title: string;
  companyName: string;
  companyPageId: string;
  location: string;
  employmentType: 'full_time' | 'part_time' | 'contract' | 'internship' | 'remote';
  status: JobModerationStatus;
  aiReasonCodes: string[];
  posterTrustBand: TrustBand; // PN-1: band only
  submittedAt: string;
}

// ── ADM-JB-02 · Referral bounty payout queue ─────────────────────────────────
export type BountyState = 'bounty_payable' | 'approved' | 'released' | 'held' | 'rejected';

export interface BountyPayout {
  id: string;
  reference: string;
  referrerId: string;
  referredId: string;
  jobId: string;
  jobTitle: string;
  amountKobo: number; // integer minor units
  state: BountyState;
  riskFlags: string[];
  createdAt: string;
}

// ── ADM-CN-01 · Content moderation queue (reported posts/comments) ────────────
export type ContentReportStatus = 'open' | 'reviewing' | 'actioned' | 'dismissed';

export interface ContentReport {
  id: string;
  contentType: 'post' | 'comment';
  contentId: string;
  postId: string; // POST /networking/posts/:postId/moderation
  reason: string;
  aiReasonCodes: string[];
  reporterId: string | null;
  authorId: string;
  status: ContentReportStatus;
  createdAt: string;
}

// ── ADM-CP-01 · Company page claim review ────────────────────────────────────
export type ClaimStatus = 'claim_submitted' | 'under_review' | 'approved' | 'rejected';

export interface CompanyPageClaim {
  id: string;
  companyName: string;
  companyPageId: string;
  claimantId: string;
  claimantHandle: string;
  evidenceRef: string; // vault pointer, raw docs never rendered
  domainVerified: boolean;
  status: ClaimStatus;
  submittedAt: string;
}

// ── ADM-SA-01 · Question bank / assessment management ────────────────────────
export interface SkillAssessment {
  id: string;
  domain: string;
  title: string;
  version: string;
  questionCount: number;
  passThreshold: number; // percentage 0-100 (assessment config, not a trust score)
  status: 'draft' | 'published' | 'archived';
  updatedAt: string;
}

export interface SkillAssessmentDetail extends SkillAssessment {
  reviewer: string | null;
  changelog: { at: string; actor: string; action: string; note: string | null }[];
}

// ── ADM-MN-01 · Mentorship safety reports ────────────────────────────────────
export type MentorshipReportStatus = 'open' | 'escalated' | 'resolved' | 'dismissed';

export interface MentorshipReport {
  id: string;
  threadId: string;
  mentorId: string;
  menteeId: string;
  reason: string;
  aiReasonCodes: string[];
  reporterRole: 'mentor' | 'mentee';
  severity: 'low' | 'normal' | 'high' | 'critical';
  status: MentorshipReportStatus;
  createdAt: string;
}

// ── ADM-GM-01 · Loyalty (Paymax Black) event audit ───────────────────────────
export interface LoyaltyAuditEntry {
  id: string;
  module: string; // always 'connect' for Phase-6 grants
  subjectId: string;
  eventType: string; // e.g. connect.event.attended, connect.referral.bounty
  points: number; // non-cash Paymax Black points, not money
  sourceRef: string; // trace pointer back to originating Phase-6 action
  grantedAt: string;
}
