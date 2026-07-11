// Paymax Connect — Jobs API (PRD §6.1 JB-*).
// Mock-first (USE_MOCK). Live path hits `${CONNECT_API_BASE}/networking/...`.
// Money is ALWAYS kobo. Every apply carries an Idempotency-Key.

import { api } from '@/api/client';
import { USE_MOCK, CONNECT_API_BASE } from '../../constants/connect.constants';
import type {
  JobPosting,
  JobFilters,
  JobApplication,
  ApplyInput,
  ApplyResult,
  ResumeRef,
  OpenToWork,
  EmploymentType,
} from './types';

const delay = (ms = 280) => new Promise((r) => setTimeout(r, ms));

function unwrap<T>(res: { data?: { data?: T } & T }): T {
  return (res.data?.data ?? res.data) as T;
}

// Cheap RFC4122-ish key for the Idempotency-Key header on money/state mutations.
function idempotencyKey(): string {
  return `job-apply-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

const LOGO = (seed: string) => `https://images.unsplash.com/${seed}?auto=format&fit=crop&w=200&q=60`;

// ── Mock postings (realistic Nigerian-market jobs) ───────────────────────────
const MOCK_JOBS: JobPosting[] = [
  {
    id: 'j1',
    title: 'Senior Backend Engineer (Go)',
    company: 'Paystack',
    companyLogo: LOGO('photo-1614680376593-902f74cf0d41'),
    location: 'Lagos',
    isRemote: true,
    employmentType: 'full_time',
    seniority: 'Senior',
    salaryMinKobo: 65_000_000,   // ₦650k
    salaryMaxKobo: 95_000_000,   // ₦950k
    salaryPeriod: 'month',
    description:
      'Own and scale the core payments ledger that moves billions of naira monthly. You will design idempotent, double-entry money flows and mentor a growing platform team.',
    responsibilities: [
      'Design and ship money-path services in Go',
      'Guard ledger integrity and idempotency guarantees',
      'Review PRs and mentor mid-level engineers',
    ],
    requirements: [
      '5+ years backend experience, 2+ in Go',
      'Deep understanding of Postgres and transactions',
      'Experience with payments, fintech or high-integrity systems',
    ],
    skills: ['Go', 'PostgreSQL', 'Payments', 'Distributed Systems'],
    postedAt: new Date(Date.now() - 2 * 86400000).toISOString(),
    applicantCount: 47,
    bountyKobo: 15_000_000,      // ₦150k referral bounty
    easyApply: true,
    recruiterName: 'Ifeoma Okoro',
    saved: false,
    applied: false,
  },
  {
    id: 'j2',
    title: 'Product Manager, Growth',
    company: 'Flutterwave',
    companyLogo: LOGO('photo-1560179707-f14e90ef3623'),
    location: 'Lagos',
    isRemote: false,
    employmentType: 'full_time',
    seniority: 'Mid-level',
    salaryMinKobo: 50_000_000,
    salaryMaxKobo: 75_000_000,
    salaryPeriod: 'month',
    description:
      'Drive activation and retention across our merchant products. Partner with data, design and engineering to run a fast experimentation loop.',
    responsibilities: [
      'Own the growth roadmap end-to-end',
      'Run A/B experiments and analyse results',
      'Align stakeholders around a single north-star metric',
    ],
    requirements: [
      '3+ years in product, ideally growth or fintech',
      'Comfortable with SQL and analytics tooling',
      'Strong written communication',
    ],
    skills: ['Product Strategy', 'Growth', 'SQL', 'Experimentation'],
    postedAt: new Date(Date.now() - 5 * 86400000).toISOString(),
    applicantCount: 112,
    bountyKobo: 0,
    easyApply: true,
    recruiterName: 'Aisha Bello',
    saved: true,
    applied: false,
  },
  {
    id: 'j3',
    title: 'Frontend Engineer (React Native)',
    company: 'Kuda',
    companyLogo: LOGO('photo-1611162617213-7d7a39e9b1d7'),
    location: 'Abuja',
    isRemote: true,
    employmentType: 'contract',
    seniority: 'Mid-level',
    salaryMinKobo: 45_000_000,
    salaryMaxKobo: 60_000_000,
    salaryPeriod: 'month',
    description:
      'Build delightful mobile banking experiences used by millions. You will ship features across our React Native app with a strong eye for polish and accessibility.',
    responsibilities: [
      'Ship user-facing features in React Native / Expo',
      'Collaborate closely with design on pixel-perfect UI',
      'Improve app performance and accessibility',
    ],
    requirements: [
      '3+ years frontend, 1+ in React Native',
      'Solid TypeScript fundamentals',
      'Care about accessibility and testing',
    ],
    skills: ['React Native', 'TypeScript', 'Expo', 'Accessibility'],
    postedAt: new Date(Date.now() - 1 * 86400000).toISOString(),
    applicantCount: 29,
    bountyKobo: 8_000_000,
    easyApply: true,
    recruiterName: 'Chidi Eze',
    saved: false,
    applied: true,
  },
  {
    id: 'j4',
    title: 'Data Analyst (Risk)',
    company: 'Moniepoint',
    companyLogo: LOGO('photo-1551288049-bebda4e38f71'),
    location: 'Lagos',
    isRemote: false,
    employmentType: 'full_time',
    seniority: 'Entry',
    salaryMinKobo: 30_000_000,
    salaryMaxKobo: 42_000_000,
    salaryPeriod: 'month',
    description:
      'Turn transaction data into fraud and credit-risk insight. A great first role for a sharp analyst who loves SQL and clear storytelling.',
    responsibilities: [
      'Build dashboards and monitor risk metrics',
      'Investigate anomalies in transaction data',
      'Partner with the risk team on model inputs',
    ],
    requirements: [
      '1+ years in analytics or a strong portfolio',
      'Fluent in SQL; Python a plus',
      'Clear communicator',
    ],
    skills: ['SQL', 'Python', 'Risk', 'Data Viz'],
    postedAt: new Date(Date.now() - 8 * 86400000).toISOString(),
    applicantCount: 203,
    bountyKobo: 0,
    easyApply: false,
    recruiterName: 'Tobi Adeyemi',
    saved: false,
    applied: false,
  },
  {
    id: 'j5',
    title: 'Product Design Intern',
    company: 'PiggyVest',
    companyLogo: LOGO('photo-1600880292203-757bb62b4baf'),
    location: 'Lagos',
    isRemote: true,
    employmentType: 'internship',
    seniority: 'Entry',
    salaryMinKobo: 15_000_000,
    salaryMaxKobo: 20_000_000,
    salaryPeriod: 'month',
    description:
      'A 6-month paid internship for a designer who wants to learn fintech product design in a fast, supportive team.',
    responsibilities: [
      'Support the design team on live features',
      'Prototype and test ideas with users',
      'Contribute to the design system',
    ],
    requirements: [
      'A portfolio showing product thinking',
      'Familiarity with Figma',
      'Eager to learn and take feedback',
    ],
    skills: ['Figma', 'UI Design', 'Prototyping'],
    postedAt: new Date(Date.now() - 3 * 86400000).toISOString(),
    applicantCount: 88,
    bountyKobo: 0,
    easyApply: true,
    recruiterName: 'Amaka Nwosu',
    saved: false,
    applied: false,
  },
];

// Resumes the user has on file (JB-03 apply picker).
const MOCK_RESUMES: ResumeRef[] = [
  { id: 'r1', label: 'General_CV_2026.pdf', updatedAt: new Date(Date.now() - 6 * 86400000).toISOString() },
  { id: 'r2', label: 'Engineering_Resume.pdf', updatedAt: new Date(Date.now() - 20 * 86400000).toISOString() },
];

// Applications the user has already made (JB-04). Covers a spread of FSM states.
const MOCK_APPLICATIONS: JobApplication[] = [
  {
    id: 'a1',
    jobId: 'j3',
    jobTitle: 'Frontend Engineer (React Native)',
    company: 'Kuda',
    companyLogo: LOGO('photo-1611162617213-7d7a39e9b1d7'),
    state: 'interview',
    appliedAt: new Date(Date.now() - 9 * 86400000).toISOString(),
    updatedAt: new Date(Date.now() - 1 * 86400000).toISOString(),
    resumeRef: 'Engineering_Resume.pdf',
    coverNote: 'Big fan of the app — would love to help polish the mobile experience.',
    lastUpdateNote: 'Interview scheduled for Thursday, 2pm (virtual).',
  },
  {
    id: 'a2',
    jobId: 'j2',
    jobTitle: 'Product Manager, Growth',
    company: 'Flutterwave',
    companyLogo: LOGO('photo-1560179707-f14e90ef3623'),
    state: 'under_review',
    appliedAt: new Date(Date.now() - 4 * 86400000).toISOString(),
    updatedAt: new Date(Date.now() - 2 * 86400000).toISOString(),
    resumeRef: 'General_CV_2026.pdf',
  },
  {
    id: 'a3',
    jobId: 'j4',
    jobTitle: 'Data Analyst (Risk)',
    company: 'Moniepoint',
    companyLogo: LOGO('photo-1551288049-bebda4e38f71'),
    state: 'needs_info',
    appliedAt: new Date(Date.now() - 7 * 86400000).toISOString(),
    updatedAt: new Date(Date.now() - 6 * 3600000).toISOString(),
    resumeRef: 'General_CV_2026.pdf',
    lastUpdateNote: 'Recruiter asked for a link to your portfolio.',
  },
  {
    id: 'a4',
    jobId: 'j1',
    jobTitle: 'Senior Backend Engineer (Go)',
    company: 'Paystack',
    companyLogo: LOGO('photo-1614680376593-902f74cf0d41'),
    state: 'shortlisted',
    appliedAt: new Date(Date.now() - 6 * 86400000).toISOString(),
    updatedAt: new Date(Date.now() - 12 * 3600000).toISOString(),
    resumeRef: 'Engineering_Resume.pdf',
  },
  {
    id: 'a5',
    jobId: 'j5',
    jobTitle: 'Growth Marketer',
    company: 'Cowrywise',
    state: 'rejected',
    appliedAt: new Date(Date.now() - 21 * 86400000).toISOString(),
    updatedAt: new Date(Date.now() - 14 * 86400000).toISOString(),
    resumeRef: 'General_CV_2026.pdf',
    lastUpdateNote: 'Thanks for applying — we moved forward with other candidates.',
  },
];

// In-memory Open to Work signal (JB-07). Mock only; server owns this live.
let MOCK_OPEN_TO_WORK: OpenToWork = {
  enabled: false,
  roles: ['Product Manager', 'Senior Frontend Engineer'],
  locations: ['Lagos', 'Remote'],
  visibleToRecruitersOnly: true,
};

export const JOB_EMPLOYMENT_TYPES: { value: EmploymentType; label: string }[] = [
  { value: 'full_time', label: 'Full-time' },
  { value: 'part_time', label: 'Part-time' },
  { value: 'contract', label: 'Contract' },
  { value: 'internship', label: 'Internship' },
  { value: 'temporary', label: 'Temporary' },
];

export { MOCK_RESUMES };

// ── Feed (JB-01) ─────────────────────────────────────────────────────────────
export async function getJobs(filters: JobFilters): Promise<JobPosting[]> {
  if (USE_MOCK) {
    await delay();
    const q = filters.query.trim().toLowerCase();
    const loc = filters.location.trim().toLowerCase();
    return MOCK_JOBS.filter((j) => {
      if (filters.remoteOnly && !j.isRemote) return false;
      if (filters.employmentTypes.length && !filters.employmentTypes.includes(j.employmentType)) return false;
      if (filters.skills.length && !filters.skills.some((s) => j.skills.includes(s))) return false;
      if (loc && !(`${j.location}`.toLowerCase().includes(loc) || (j.isRemote && 'remote'.includes(loc)))) return false;
      if (q && !(`${j.title} ${j.company} ${j.skills.join(' ')}`.toLowerCase().includes(q))) return false;
      return true;
    }).map((j) => ({ ...j }));
  }
  const res = await api.get(`${CONNECT_API_BASE}/networking/jobs`, { params: filters });
  return unwrap<JobPosting[]>(res);
}

// ── Detail (JB-02) ───────────────────────────────────────────────────────────
export async function getJob(id: string): Promise<JobPosting> {
  if (USE_MOCK) {
    await delay(180);
    return { ...(MOCK_JOBS.find((j) => j.id === id) ?? MOCK_JOBS[0]) };
  }
  const res = await api.get(`${CONNECT_API_BASE}/networking/jobs/${id}`);
  return unwrap<JobPosting>(res);
}

// ── Apply (JB-03) — carries an Idempotency-Key ───────────────────────────────
export async function applyToJob(input: ApplyInput): Promise<ApplyResult> {
  if (USE_MOCK) {
    await delay(420);
    return { ok: true, applicationId: `app_${input.jobId}_${Date.now()}`, state: 'submitted' };
  }
  const res = await api.post(
    `${CONNECT_API_BASE}/networking/jobs/${input.jobId}/apply`,
    { resumeRef: input.resumeRef, portfolioUrl: input.portfolioUrl, coverNote: input.coverNote },
    { headers: { 'Idempotency-Key': idempotencyKey() } },
  );
  return unwrap<ApplyResult>(res);
}

// ── My applications (JB-04) ──────────────────────────────────────────────────
export async function getMyApplications(): Promise<JobApplication[]> {
  if (USE_MOCK) {
    await delay();
    return MOCK_APPLICATIONS.map((a) => ({ ...a }));
  }
  const res = await api.get(`${CONNECT_API_BASE}/networking/applications/mine`);
  return unwrap<JobApplication[]>(res);
}

// Stored resumes for the apply picker (JB-03).
export async function getMyResumes(): Promise<ResumeRef[]> {
  if (USE_MOCK) {
    await delay(160);
    return MOCK_RESUMES.map((r) => ({ ...r }));
  }
  const res = await api.get(`${CONNECT_API_BASE}/networking/resumes`);
  return unwrap<ResumeRef[]>(res);
}

// ── Open to Work (JB-07) ─────────────────────────────────────────────────────
export async function getOpenToWork(): Promise<OpenToWork> {
  if (USE_MOCK) {
    await delay(160);
    return { ...MOCK_OPEN_TO_WORK };
  }
  const res = await api.get(`${CONNECT_API_BASE}/networking/open-to-work`);
  return unwrap<OpenToWork>(res);
}

export async function setOpenToWork(input: OpenToWork): Promise<OpenToWork> {
  if (USE_MOCK) {
    await delay(280);
    MOCK_OPEN_TO_WORK = { ...input };
    return { ...MOCK_OPEN_TO_WORK };
  }
  const res = await api.put(`${CONNECT_API_BASE}/networking/open-to-work`, input);
  return unwrap<OpenToWork>(res);
}
