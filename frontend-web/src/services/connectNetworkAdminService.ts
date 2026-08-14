// ── Admin — Paymax Connect Phase 6 (Professional Network) control-plane ───────
// Mock by default (mirrors connectAdminService). Flip with
// NEXT_PUBLIC_CONNECT_ADMIN_USE_MOCK=false to hit the live Go backend at
// /api/connect/admin/networking/*. Kept in its OWN file so the money/trust admin
// service (connectAdminService.ts) stays lean.
//
// All money is integer minor units (kobo). PN-1: raw trust/strength numbers are
// never emitted — only coarse TrustBand labels.

import { env } from '@/config/env';
import type {
  JobPosting,
  BountyPayout,
  ContentReport,
  CompanyPageClaim,
  SkillAssessment,
  SkillAssessmentDetail,
  MentorshipReport,
  LoyaltyAuditEntry,
  ReviewAction,
  ReviewResult,
} from '@/types/connectNetworkAdmin';

const USE_MOCK = (process.env.NEXT_PUBLIC_CONNECT_ADMIN_USE_MOCK ?? 'true').toLowerCase() !== 'false';

function adminBase(): string {
  return env.apiBaseUrl.replace(/\/api\/v1\/?$/, '/api/connect/admin');
}
function authHeaders(): Record<string, string> {
  if (typeof window === 'undefined') return {};
  const token = localStorage.getItem('spotlight_admin_access_token') || '';
  return token
    ? { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }
    : { 'Content-Type': 'application/json' };
}
const delay = (ms = 260) => new Promise((r) => setTimeout(r, ms));
async function getJson<T>(path: string): Promise<T> {
  const res = await fetch(`${adminBase()}${path}`, { headers: authHeaders() });
  if (!res.ok) throw new Error(`Request failed (${res.status})`);
  const j = await res.json();
  return (j?.data ?? j) as T;
}
async function postJson<T>(path: string, body: unknown): Promise<T> {
  const res = await fetch(`${adminBase()}${path}`, { method: 'POST', headers: authHeaders(), body: JSON.stringify(body) });
  if (!res.ok) throw new Error(`Request failed (${res.status})`);
  const j = await res.json();
  return (j?.data ?? j) as T;
}
const iso = (hAgo: number) => new Date(Date.now() - hAgo * 3_600_000).toISOString();
const reviewOk = (id: string, action: ReviewAction): ReviewResult => ({
  id,
  status: action === 'approve' ? 'approved' : action === 'reject' ? 'rejected' : 'flagged',
  reviewedAt: new Date().toISOString(),
});

// ════════════════════════════════════════════════════════════════════════════
// ADM-JB-01 — Job posting moderation
// ════════════════════════════════════════════════════════════════════════════
const JOBS: JobPosting[] = [
  { id: 'job_1', title: 'Senior Backend Engineer', companyName: 'Paystack', companyPageId: 'cp_1', location: 'Lagos (Hybrid)', employmentType: 'full_time', status: 'pending', aiReasonCodes: [], posterTrustBand: 'trusted', submittedAt: iso(2) },
  { id: 'job_2', title: 'Remote Growth Marketer — $$$ fast cash', companyName: 'QuickCash Ltd', companyPageId: 'cp_2', location: 'Remote', employmentType: 'contract', status: 'flagged', aiReasonCodes: ['UPFRONT_FEE', 'SCAM_PATTERN'], posterTrustBand: 'new', submittedAt: iso(4) },
  { id: 'job_3', title: 'Product Designer', companyName: 'Flutterwave', companyPageId: 'cp_3', location: 'Abuja', employmentType: 'full_time', status: 'approved', aiReasonCodes: [], posterTrustBand: 'established', submittedAt: iso(28) },
  { id: 'job_4', title: 'Data Entry (work from home)', companyName: 'Unverified Co', companyPageId: 'cp_4', location: 'Remote', employmentType: 'part_time', status: 'rejected', aiReasonCodes: ['MLM_PATTERN', 'OFF_PLATFORM_PRESSURE'], posterTrustBand: 'new', submittedAt: iso(50) },
];
export async function listJobModeration(status?: string): Promise<JobPosting[]> {
  if (USE_MOCK) { await delay(); return status ? JOBS.filter((j) => j.status === status) : [...JOBS]; }
  return getJson<JobPosting[]>(`/networking/jobs${status ? `?status=${encodeURIComponent(status)}` : ''}`);
}
export async function reviewJob(id: string, action: ReviewAction, reason?: string): Promise<ReviewResult> {
  if (USE_MOCK) { await delay(); return reviewOk(id, action); }
  return postJson<ReviewResult>(`/networking/jobs/${encodeURIComponent(id)}/review`, { action, reason });
}

// ════════════════════════════════════════════════════════════════════════════
// ADM-JB-02 — Referral bounty payout queue (review before ledger release)
// ════════════════════════════════════════════════════════════════════════════
const BOUNTIES: BountyPayout[] = [
  { id: 'bty_1', reference: 'RB-9001', referrerId: 'usr_a', referredId: 'usr_h', jobId: 'job_3', jobTitle: 'Product Designer', amountKobo: 50_000_00, state: 'bounty_payable', riskFlags: [], createdAt: iso(3) },
  { id: 'bty_2', reference: 'RB-9002', referrerId: 'usr_d', referredId: 'usr_i', jobId: 'job_1', jobTitle: 'Senior Backend Engineer', amountKobo: 75_000_00, state: 'bounty_payable', riskFlags: ['SAME_DEVICE', 'RAPID_HIRE'], createdAt: iso(6) },
  { id: 'bty_3', reference: 'RB-9003', referrerId: 'usr_c', referredId: 'usr_j', jobId: 'job_3', jobTitle: 'Product Designer', amountKobo: 50_000_00, state: 'released', riskFlags: [], createdAt: iso(70) },
  { id: 'bty_4', reference: 'RB-9004', referrerId: 'usr_b', referredId: 'usr_k', jobId: 'job_4', jobTitle: 'Data Entry', amountKobo: 20_000_00, state: 'held', riskFlags: ['CIRCULAR_REFERRAL'], createdAt: iso(30) },
];
export async function listBountyPayouts(state?: string): Promise<BountyPayout[]> {
  if (USE_MOCK) { await delay(); return state ? BOUNTIES.filter((b) => b.state === state) : [...BOUNTIES]; }
  return getJson<BountyPayout[]>(`/networking/bounties${state ? `?state=${encodeURIComponent(state)}` : ''}`);
}
export async function reviewBounty(id: string, action: ReviewAction, reason?: string): Promise<ReviewResult> {
  if (USE_MOCK) { await delay(); return reviewOk(id, action); }
  return postJson<ReviewResult>(`/networking/bounties/${encodeURIComponent(id)}/review`, { action, reason });
}

// ════════════════════════════════════════════════════════════════════════════
// ADM-CN-01 — Content moderation queue (reported posts/comments)
// ════════════════════════════════════════════════════════════════════════════
const CONTENT: ContentReport[] = [
  { id: 'rep_1', contentType: 'post', contentId: 'post_a', postId: 'post_a', reason: 'Spam / repeated self-promotion', aiReasonCodes: ['SPAM', 'LINK_FARMING'], reporterId: 'usr_c', authorId: 'usr_d', status: 'open', createdAt: iso(1) },
  { id: 'rep_2', contentType: 'comment', contentId: 'cmt_b', postId: 'post_e', reason: 'Harassment in comment thread', aiReasonCodes: ['HARASSMENT'], reporterId: 'usr_a', authorId: 'usr_b', status: 'reviewing', createdAt: iso(5) },
  { id: 'rep_3', contentType: 'post', contentId: 'post_c', postId: 'post_c', reason: 'Misinformation flagged by AI', aiReasonCodes: ['MISINFORMATION'], reporterId: null, authorId: 'usr_z', status: 'open', createdAt: iso(8) },
  { id: 'rep_4', contentType: 'post', contentId: 'post_d', postId: 'post_d', reason: 'Off-topic', aiReasonCodes: [], reporterId: 'usr_c', authorId: 'usr_w', status: 'dismissed', createdAt: iso(40) },
];
export async function listContentReports(status?: string): Promise<ContentReport[]> {
  if (USE_MOCK) { await delay(); return status ? CONTENT.filter((c) => c.status === status) : [...CONTENT]; }
  return getJson<ContentReport[]>(`/networking/content-reports${status ? `?status=${encodeURIComponent(status)}` : ''}`);
}
/** Moderate a reported post/comment. POST /networking/posts/:id/moderation (connect.moderation.manage). */
export async function moderatePost(postId: string, action: ReviewAction, reason?: string): Promise<ReviewResult> {
  if (USE_MOCK) { await delay(); return reviewOk(postId, action); }
  return postJson<ReviewResult>(`/networking/posts/${encodeURIComponent(postId)}/moderation`, { action, reason });
}

// ════════════════════════════════════════════════════════════════════════════
// ADM-CP-01 — Company page claim review
// ════════════════════════════════════════════════════════════════════════════
const CLAIMS: CompanyPageClaim[] = [
  { id: 'clm_1', companyName: 'Paystack', companyPageId: 'cp_1', claimantId: 'usr_a', claimantHandle: '@ada_hr', evidenceRef: 'vault://claims/clm_1', domainVerified: true, status: 'claim_submitted', submittedAt: iso(2) },
  { id: 'clm_2', companyName: 'QuickCash Ltd', companyPageId: 'cp_2', claimantId: 'usr_d', claimantHandle: '@chidi_ng', evidenceRef: 'vault://claims/clm_2', domainVerified: false, status: 'under_review', submittedAt: iso(9) },
  { id: 'clm_3', companyName: 'Flutterwave', companyPageId: 'cp_3', claimantId: 'usr_c', claimantHandle: '@zara_talent', evidenceRef: 'vault://claims/clm_3', domainVerified: true, status: 'approved', submittedAt: iso(60) },
  { id: 'clm_4', companyName: 'Unverified Co', companyPageId: 'cp_4', claimantId: 'usr_e', claimantHandle: '@fave_99', evidenceRef: 'vault://claims/clm_4', domainVerified: false, status: 'rejected', submittedAt: iso(80) },
];
export async function listCompanyClaims(status?: string): Promise<CompanyPageClaim[]> {
  if (USE_MOCK) { await delay(); return status ? CLAIMS.filter((c) => c.status === status) : [...CLAIMS]; }
  return getJson<CompanyPageClaim[]>(`/networking/company-pages${status ? `?status=${encodeURIComponent(status)}` : ''}`);
}
export async function reviewCompanyClaim(id: string, action: ReviewAction, reason?: string): Promise<ReviewResult> {
  if (USE_MOCK) { await delay(); return reviewOk(id, action); }
  return postJson<ReviewResult>(`/networking/company-pages/${encodeURIComponent(id)}/review`, { action, reason });
}

// ════════════════════════════════════════════════════════════════════════════
// ADM-SA-01 — Question bank / assessment management (AssessmentReviewer)
// ════════════════════════════════════════════════════════════════════════════
const ASSESSMENTS: SkillAssessment[] = [
  { id: 'asm_1', domain: 'Software Engineering', title: 'Backend Fundamentals', version: 'v3', questionCount: 40, passThreshold: 70, status: 'published', updatedAt: iso(48) },
  { id: 'asm_2', domain: 'Product Design', title: 'UX Foundations', version: 'v2', questionCount: 35, passThreshold: 65, status: 'published', updatedAt: iso(120) },
  { id: 'asm_3', domain: 'Data Science', title: 'Applied Statistics', version: 'v1', questionCount: 50, passThreshold: 75, status: 'draft', updatedAt: iso(6) },
  { id: 'asm_4', domain: 'Marketing', title: 'Growth Analytics', version: 'v4', questionCount: 30, passThreshold: 60, status: 'archived', updatedAt: iso(400) },
];
export async function listAssessments(domain?: string): Promise<SkillAssessment[]> {
  if (USE_MOCK) { await delay(); return domain ? ASSESSMENTS.filter((a) => a.domain === domain) : [...ASSESSMENTS]; }
  return getJson<SkillAssessment[]>(`/networking/assessments${domain ? `?domain=${encodeURIComponent(domain)}` : ''}`);
}
export async function getAssessment(id: string): Promise<SkillAssessmentDetail> {
  if (USE_MOCK) {
    await delay();
    const base = ASSESSMENTS.find((a) => a.id === id) ?? ASSESSMENTS[0];
    return {
      ...base,
      reviewer: base.status === 'published' ? 'reviewer_1' : null,
      changelog: [
        { at: base.updatedAt, actor: 'reviewer_1', action: 'version_published', note: `${base.version} · ${base.questionCount} questions` },
        { at: iso(500), actor: 'reviewer_2', action: 'question_bank_edited', note: 'Retired 4 stale questions' },
      ],
    };
  }
  return getJson<SkillAssessmentDetail>(`/networking/assessments/${encodeURIComponent(id)}`);
}

// ════════════════════════════════════════════════════════════════════════════
// ADM-MN-01 — Mentorship safety reports (connect.moderation.manage)
// ════════════════════════════════════════════════════════════════════════════
const MENTORSHIP: MentorshipReport[] = [
  { id: 'mnr_1', threadId: 'thr_1', mentorId: 'usr_d', menteeId: 'usr_h', reason: 'Requested off-platform payment', aiReasonCodes: ['FINANCIAL_SOLICITATION', 'OFF_PLATFORM_PRESSURE'], reporterRole: 'mentee', severity: 'critical', status: 'escalated', createdAt: iso(2) },
  { id: 'mnr_2', threadId: 'thr_2', mentorId: 'usr_a', menteeId: 'usr_i', reason: 'Inappropriate messages', aiReasonCodes: ['HARASSMENT'], reporterRole: 'mentee', severity: 'high', status: 'open', createdAt: iso(7) },
  { id: 'mnr_3', threadId: 'thr_3', mentorId: 'usr_c', menteeId: 'usr_j', reason: 'Spam / promotion', aiReasonCodes: ['SPAM'], reporterRole: 'mentor', severity: 'normal', status: 'resolved', createdAt: iso(50) },
];
export async function listMentorshipReports(status?: string): Promise<MentorshipReport[]> {
  if (USE_MOCK) { await delay(); return status ? MENTORSHIP.filter((m) => m.status === status) : [...MENTORSHIP]; }
  return getJson<MentorshipReport[]>(`/networking/mentorship/reports${status ? `?status=${encodeURIComponent(status)}` : ''}`);
}
export async function reviewMentorshipReport(id: string, action: ReviewAction, reason?: string): Promise<ReviewResult> {
  if (USE_MOCK) { await delay(); return reviewOk(id, action); }
  return postJson<ReviewResult>(`/networking/mentorship/reports/${encodeURIComponent(id)}/review`, { action, reason });
}

// ════════════════════════════════════════════════════════════════════════════
// ADM-GM-01 — Loyalty event audit (trace Paymax Black grants → Phase-6 source)
// ════════════════════════════════════════════════════════════════════════════
const LOYALTY_AUDIT: LoyaltyAuditEntry[] = [
  { id: 'la_1', module: 'connect', subjectId: 'usr_a', eventType: 'connect.event.attended', points: 50, sourceRef: 'networking_event:evt_18', grantedAt: iso(1) },
  { id: 'la_2', module: 'connect', subjectId: 'usr_c', eventType: 'connect.referral.bounty', points: 120, sourceRef: 'bounty:bty_3', grantedAt: iso(4) },
  { id: 'la_3', module: 'connect', subjectId: 'usr_h', eventType: 'connect.assessment.passed', points: 30, sourceRef: 'assessment:asm_1', grantedAt: iso(12) },
  { id: 'la_4', module: 'connect', subjectId: 'usr_i', eventType: 'connect.mentorship.milestone', points: 40, sourceRef: 'mentorship_thread:thr_2', grantedAt: iso(30) },
];
export async function listLoyaltyAudit(module = 'connect'): Promise<LoyaltyAuditEntry[]> {
  if (USE_MOCK) { await delay(); return LOYALTY_AUDIT.filter((l) => l.module === module); }
  return getJson<LoyaltyAuditEntry[]>(`/networking/mentorship/loyalty-audit?module=${encodeURIComponent(module)}`);
}

/** Format kobo (minor units) → "₦1,234.56". Money always renders via this helper. */
export function formatNaira(kobo: number): string {
  const naira = kobo / 100;
  return `₦${naira.toLocaleString('en-NG', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}
