// Paymax Connect — Jobs types (PRD §6.1 JB-*).
//
// Self-contained jobs slice under the networking feature. Reuses USE_MOCK /
// CONNECT_API_BASE from ../../constants/connect.constants and money helpers.
//
// INVARIANTS:
//  • Money is ALWAYS integers in minor units (kobo) — salaries + referral bounty.
//  • Application state mirrors the backend FSM (see ApplicationState below); the
//    server is the source of truth for transitions.
//  • JB-07 "Open to Work" is a profile-level signal visible to Recruiters only.

// A single job posting surfaced in the jobs feed (JB-01) / detail (JB-02).
export interface JobPosting {
  id: string;
  title: string;
  company: string;
  companyLogo?: string;          // remote URI
  location: string;              // city, e.g. "Lagos"
  isRemote: boolean;
  employmentType: EmploymentType;
  seniority: string;             // "Entry", "Mid-level", "Senior", …
  salaryMinKobo: number;         // kobo; 0 => undisclosed
  salaryMaxKobo: number;         // kobo; 0 => undisclosed
  salaryPeriod: SalaryPeriod;
  description: string;
  responsibilities: string[];
  requirements: string[];
  skills: string[];
  postedAt: string;              // ISO
  applicantCount: number;
  bountyKobo: number;            // referral bounty (JB-08); 0 => none. ALWAYS kobo
  easyApply: boolean;
  recruiterName: string;
  // viewer-relative flags
  saved: boolean;
  applied: boolean;
}

export type EmploymentType =
  | 'full_time'
  | 'part_time'
  | 'contract'
  | 'internship'
  | 'temporary';

export type SalaryPeriod = 'month' | 'year';

export interface JobFilters {
  query: string;
  location: string;              // '' => any
  remoteOnly: boolean;
  employmentTypes: EmploymentType[];
  skills: string[];
}

// ── Application FSM (JB-04) ───────────────────────────────────────────────────
// Backend-owned lifecycle. `draft` is a locally-saved-but-unsent application;
// `withdrawn` is a terminal state the applicant can trigger.
export type ApplicationState =
  | 'draft'
  | 'submitted'
  | 'under_review'
  | 'needs_info'
  | 'shortlisted'
  | 'interview'
  | 'offered'
  | 'hired'
  | 'rejected'
  | 'withdrawn';

export interface JobApplication {
  id: string;
  jobId: string;
  jobTitle: string;
  company: string;
  companyLogo?: string;
  state: ApplicationState;
  appliedAt: string;             // ISO
  updatedAt: string;             // ISO
  resumeRef?: string;            // stored resume identifier / filename
  portfolioUrl?: string;
  coverNote?: string;
  lastUpdateNote?: string;       // e.g. "Recruiter requested your portfolio"
}

// Input for JB-03 apply flow. resumeRef points at a stored resume (see MOCK_RESUMES).
export interface ApplyInput {
  jobId: string;
  resumeRef: string;
  portfolioUrl?: string;
  coverNote?: string;
}

// Result of POST /networking/jobs/:id/apply. Transitions to 'submitted'.
export interface ApplyResult {
  ok: boolean;
  applicationId: string;
  state: ApplicationState;       // -> 'submitted'
}

// A resume/CV the user has on file, offered in the apply picker (JB-03).
export interface ResumeRef {
  id: string;
  label: string;                 // "Product_Manager_CV_2026.pdf"
  updatedAt: string;             // ISO
}

// JB-07 — Open to Work signal. Visible to Recruiters only.
export interface OpenToWork {
  enabled: boolean;
  roles: string[];               // desired role titles
  locations: string[];          // preferred locations / "Remote"
  visibleToRecruitersOnly: boolean;
}
