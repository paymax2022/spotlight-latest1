import { env } from '@/config/env';
import type {
  StemContest,
  StemEmergingInnovator,
  StemEmergingProject,
  StemEmergingTeam,
  StemEligibilityResult,
  StemJudgingScore,
  StemJudgingRubric,
  StemJudgingCriterion,
  StemJudgeAssignment,
  StemVotingRule,
  StemVotePackage,
  StemVoteTransaction,
  StemBootcampCohort,
  StemBootcampTask,
  StemBootcampScore,
  StemSponsor,
  StemCertificate,
  StemBadge,
  StemBadgeAward,
  StemReportSummary,
  StemReportBucket,
  StemLeaderboardEntry,
  StemLeaderboardSlice,
  StemOverview,
  StemSchool,
  StemSchoolDashboard,
  StemSchoolProfile,
  StemSchoolTeam,
  StemSubmission,
} from '@/types/stem';

function adminHeaders() {
  const headers: Record<string, string> = {};
  const adminKey = process.env.NEXT_PUBLIC_ADMIN_API_KEY || '';
  if (adminKey) headers['x-admin-api-key'] = adminKey;
  headers['x-stem-role'] = process.env.NEXT_PUBLIC_STEM_ROLE || 'ADMIN';
  return headers;
}

export async function getStemOverview(): Promise<StemOverview | null> {
  const res = await fetch(`${env.apiBaseUrl}/admin/stem/overview`, {
    cache: 'no-store',
    credentials: 'include',
    headers: adminHeaders(),
  });
  const payload = await res.json().catch(() => ({}));
  if (!res.ok || !payload?.success || !payload?.overview) return null;
  return payload.overview as StemOverview;
}

export async function listStemSchools(limit = 100): Promise<StemSchool[]> {
  const url = new URL(`${env.apiBaseUrl}/admin/schools`);
  url.searchParams.set('limit', String(limit));
  const res = await fetch(url.toString(), {
    cache: 'no-store',
    credentials: 'include',
    headers: adminHeaders(),
  });
  const payload = await res.json().catch(() => ({}));
  if (!res.ok || !payload?.success || !Array.isArray(payload?.schools)) return [];
  return payload.schools as StemSchool[];
}

export async function createStemSchool(input: {
  schoolName: string;
  schoolType?: string;
  ownershipType?: string;
  educationLevel?: string;
  country?: string;
  state?: string;
  lgaCity?: string;
  address?: string;
  officialEmail?: string;
  officialPhone?: string;
  website?: string;
  principalName?: string;
  schoolAdminName?: string;
  schoolAdminEmail?: string;
  schoolAdminPhone?: string;
  numberOfStudents?: number;
  hasStemClub?: boolean;
  hasStemTeacher?: boolean;
  schoolLogoUrl?: string;
  registrationDocumentUrl?: string;
  accreditationDocumentUrl?: string;
  socialLinks?: Record<string, unknown>;
  preferredContestCategory?: string;
  submittedBy?: string;
}): Promise<StemSchool | null> {
  const res = await fetch(`${env.apiBaseUrl}/schools`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(input),
  });
  const payload = await res.json().catch(() => ({}));
  if (!res.ok || !payload?.success || !payload?.school) return null;
  return payload.school as StemSchool;
}

export async function updateStemSchoolVerification(
  schoolId: string,
  status: string,
  reason = ''
): Promise<boolean> {
  const res = await fetch(`${env.apiBaseUrl}/admin/schools/${encodeURIComponent(schoolId)}/verification`, {
    method: 'PATCH',
    credentials: 'include',
    headers: { 'Content-Type': 'application/json', ...adminHeaders() },
    body: JSON.stringify({ status, reason }),
  });
  const payload = await res.json().catch(() => ({}));
  return Boolean(res.ok && payload?.success);
}

export async function getStemSchoolDashboard(schoolId: string): Promise<StemSchoolDashboard | null> {
  const res = await fetch(`${env.apiBaseUrl}/admin/schools/${encodeURIComponent(schoolId)}/dashboard`, {
    cache: 'no-store',
    credentials: 'include',
    headers: adminHeaders(),
  });
  const payload = await res.json().catch(() => ({}));
  if (!res.ok || !payload?.success || !payload?.dashboard) return null;
  return payload.dashboard as StemSchoolDashboard;
}

export async function listStemSchoolTeams(limit = 100): Promise<StemSchoolTeam[]> {
  const url = new URL(`${env.apiBaseUrl}/admin/school-teams`);
  url.searchParams.set('limit', String(limit));
  const res = await fetch(url.toString(), {
    cache: 'no-store',
    credentials: 'include',
    headers: adminHeaders(),
  });
  const payload = await res.json().catch(() => ({}));
  if (!res.ok || !payload?.success || !Array.isArray(payload?.teams)) return [];
  return payload.teams as StemSchoolTeam[];
}

export async function listStemSchoolProfiles(limit = 100): Promise<StemSchoolProfile[]> {
  const url = new URL(`${env.apiBaseUrl}/admin/school-profiles`);
  url.searchParams.set('limit', String(limit));
  const res = await fetch(url.toString(), {
    cache: 'no-store',
    credentials: 'include',
    headers: adminHeaders(),
  });
  const payload = await res.json().catch(() => ({}));
  if (!res.ok || !payload?.success || !Array.isArray(payload?.profiles)) return [];
  return payload.profiles as StemSchoolProfile[];
}

export async function createStemSchoolProfile(input: {
  schoolId: string;
  userId?: string;
  roleType: string;
  fullName: string;
  email?: string;
  phone?: string;
  gradeLevel?: string;
  specialization?: string;
}): Promise<StemSchoolProfile | null> {
  const res = await fetch(`${env.apiBaseUrl}/school-profiles`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(input),
  });
  const payload = await res.json().catch(() => ({}));
  if (!res.ok || !payload?.success || !payload?.profile) return null;
  return payload.profile as StemSchoolProfile;
}

export async function createStemSchoolTeam(input: {
  schoolId: string;
  teamName: string;
  contestCategory?: string;
  coachName?: string;
  projectTitle?: string;
  teamSize?: number;
}): Promise<StemSchoolTeam | null> {
  const res = await fetch(`${env.apiBaseUrl}/school-teams`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(input),
  });
  const payload = await res.json().catch(() => ({}));
  if (!res.ok || !payload?.success || !payload?.team) return null;
  return payload.team as StemSchoolTeam;
}

export async function listStemEmergingInnovators(limit = 100): Promise<StemEmergingInnovator[]> {
  const url = new URL(`${env.apiBaseUrl}/admin/emerging-innovators`);
  url.searchParams.set('limit', String(limit));
  const res = await fetch(url.toString(), {
    cache: 'no-store',
    credentials: 'include',
    headers: adminHeaders(),
  });
  const payload = await res.json().catch(() => ({}));
  if (!res.ok || !payload?.success || !Array.isArray(payload?.emergingInnovators)) return [];
  return payload.emergingInnovators as StemEmergingInnovator[];
}

export async function createStemEmergingInnovator(input: {
  fullName: string;
  email: string;
  phone?: string;
  country?: string;
  state?: string;
  lgaCity?: string;
  educationBackground?: string;
  currentStatus?: string;
  stemSkillArea?: string;
  innovationTrack?: string;
  portfolioUrl?: string;
  linkedInUrl?: string;
  gitHubUrl?: string;
  socialLinks?: Record<string, unknown>;
  businessName?: string;
  teamName?: string;
  prototypeAvailable?: boolean;
  pitchDeckUrl?: string;
  videoDemoUrl?: string;
  photoUrl?: string;
  idVerificationUrl?: string;
  submittedBy?: string;
}): Promise<StemEmergingInnovator | null> {
  const res = await fetch(`${env.apiBaseUrl}/emerging-innovators`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(input),
  });
  const payload = await res.json().catch(() => ({}));
  if (!res.ok || !payload?.success || !payload?.emergingInnovator) return null;
  return payload.emergingInnovator as StemEmergingInnovator;
}

export async function listStemEmergingTeams(limit = 100): Promise<StemEmergingTeam[]> {
  const url = new URL(`${env.apiBaseUrl}/admin/emerging-teams`);
  url.searchParams.set('limit', String(limit));
  const res = await fetch(url.toString(), {
    cache: 'no-store',
    credentials: 'include',
    headers: adminHeaders(),
  });
  const payload = await res.json().catch(() => ({}));
  if (!res.ok || !payload?.success || !Array.isArray(payload?.teams)) return [];
  return payload.teams as StemEmergingTeam[];
}

export async function listStemEmergingProjects(limit = 100): Promise<StemEmergingProject[]> {
  const url = new URL(`${env.apiBaseUrl}/admin/emerging-projects`);
  url.searchParams.set('limit', String(limit));
  const res = await fetch(url.toString(), {
    cache: 'no-store',
    credentials: 'include',
    headers: adminHeaders(),
  });
  const payload = await res.json().catch(() => ({}));
  if (!res.ok || !payload?.success || !Array.isArray(payload?.projects)) return [];
  return payload.projects as StemEmergingProject[];
}

export async function listStemContests(limit = 100): Promise<StemContest[]> {
  const url = new URL(`${env.apiBaseUrl}/admin/stem-contests`);
  url.searchParams.set('limit', String(limit));
  const res = await fetch(url.toString(), {
    cache: 'no-store',
    credentials: 'include',
    headers: adminHeaders(),
  });
  const payload = await res.json().catch(() => ({}));
  if (!res.ok || !payload?.success || !Array.isArray(payload?.contests)) return [];
  return payload.contests as StemContest[];
}

export async function createStemContest(input: {
  name: string;
  slug: string;
  contestType?: string;
  contestMode?: string;
  eligibleParticipantTypes?: string[];
  eligibleSchoolLevels?: string[];
  eligibleStates?: string[];
  allowMixedChannels?: boolean;
  rankingFormula?: string;
  stageLifecycle?: string[];
  stageTransitions?: Record<string, string[]>;
  status?: string;
}): Promise<StemContest | null> {
  const res = await fetch(`${env.apiBaseUrl}/admin/stem-contests`, {
    method: 'POST',
    credentials: 'include',
    headers: { 'Content-Type': 'application/json', ...adminHeaders() },
    body: JSON.stringify(input),
  });
  const payload = await res.json().catch(() => ({}));
  if (!res.ok || !payload?.success || !payload?.contest) return null;
  return payload.contest as StemContest;
}

export async function checkStemEligibility(input: {
  contestId: string;
  participantType: string;
  state?: string;
  schoolLevel?: string;
  schoolVerified?: boolean;
}): Promise<StemEligibilityResult | null> {
  const res = await fetch(`${env.apiBaseUrl}/admin/stem-eligibility/check`, {
    method: 'POST',
    credentials: 'include',
    headers: { 'Content-Type': 'application/json', ...adminHeaders() },
    body: JSON.stringify(input),
  });
  const payload = await res.json().catch(() => ({}));
  if (!res.ok || !payload?.success || !payload?.result) return null;
  return payload.result as StemEligibilityResult;
}

export async function listStemLeaderboard(contestId: string, limit = 100): Promise<StemLeaderboardEntry[]> {
  const url = new URL(`${env.apiBaseUrl}/admin/stem-leaderboard`);
  url.searchParams.set('contestId', contestId);
  url.searchParams.set('limit', String(limit));
  const res = await fetch(url.toString(), {
    cache: 'no-store',
    credentials: 'include',
    headers: adminHeaders(),
  });
  const payload = await res.json().catch(() => ({}));
  if (!res.ok || !payload?.success || !Array.isArray(payload?.leaderboard)) return [];
  return payload.leaderboard as StemLeaderboardEntry[];
}

export async function listStemLeaderboardSlices(
  contestId: string,
  by: 'participant_type' | 'state' = 'participant_type',
  limit = 100
): Promise<StemLeaderboardSlice[]> {
  const url = new URL(`${env.apiBaseUrl}/admin/stem-leaderboard/slices`);
  url.searchParams.set('contestId', contestId);
  url.searchParams.set('by', by);
  url.searchParams.set('limit', String(limit));
  const res = await fetch(url.toString(), {
    cache: 'no-store',
    credentials: 'include',
    headers: adminHeaders(),
  });
  const payload = await res.json().catch(() => ({}));
  if (!res.ok || !payload?.success || !Array.isArray(payload?.slices)) return [];
  return payload.slices as StemLeaderboardSlice[];
}

export async function listStemSubmissions(limit = 100, status = ''): Promise<StemSubmission[]> {
  const url = new URL(`${env.apiBaseUrl}/admin/stem-submissions`);
  url.searchParams.set('limit', String(limit));
  if (status) url.searchParams.set('status', status);
  const res = await fetch(url.toString(), {
    cache: 'no-store',
    credentials: 'include',
    headers: adminHeaders(),
  });
  const payload = await res.json().catch(() => ({}));
  if (!res.ok || !payload?.success || !Array.isArray(payload?.submissions)) return [];
  return payload.submissions as StemSubmission[];
}

export async function updateStemSubmissionStatus(
  submissionId: string,
  status: string,
  reviewStage = ''
): Promise<boolean> {
  const res = await fetch(`${env.apiBaseUrl}/admin/stem-submissions/${encodeURIComponent(submissionId)}/status`, {
    method: 'PATCH',
    credentials: 'include',
    headers: { 'Content-Type': 'application/json', ...adminHeaders() },
    body: JSON.stringify({ status, reviewStage }),
  });
  const payload = await res.json().catch(() => ({}));
  return Boolean(res.ok && payload?.success);
}

export async function listStemJudgingScores(applicationId: string, limit = 100): Promise<StemJudgingScore[]> {
  const url = new URL(`${env.apiBaseUrl}/admin/stem-judging/scores`);
  url.searchParams.set('applicationId', applicationId);
  url.searchParams.set('limit', String(limit));
  const res = await fetch(url.toString(), {
    cache: 'no-store',
    credentials: 'include',
    headers: adminHeaders(),
  });
  const payload = await res.json().catch(() => ({}));
  if (!res.ok || !payload?.success || !Array.isArray(payload?.scores)) return [];
  return payload.scores as StemJudgingScore[];
}

export async function createStemJudgingScore(input: StemJudgingScore): Promise<StemJudgingScore | null> {
  const res = await fetch(`${env.apiBaseUrl}/admin/stem-judging/scores`, {
    method: 'POST',
    credentials: 'include',
    headers: { 'Content-Type': 'application/json', ...adminHeaders() },
    body: JSON.stringify(input),
  });
  const payload = await res.json().catch(() => ({}));
  if (!res.ok || !payload?.success || !payload?.score) return null;
  return payload.score as StemJudgingScore;
}

export async function updateStemJudgingScoreReviewState(
  scoreId: string,
  input: { reviewStatus: string; isLocked: boolean; lockReason?: string; lockedBy?: string }
): Promise<boolean> {
  const res = await fetch(`${env.apiBaseUrl}/admin/stem-judging/scores/${encodeURIComponent(scoreId)}/review-state`, {
    method: 'PATCH',
    credentials: 'include',
    headers: { 'Content-Type': 'application/json', ...adminHeaders() },
    body: JSON.stringify(input),
  });
  const payload = await res.json().catch(() => ({}));
  return Boolean(res.ok && payload?.success);
}

export async function listStemJudgingRubrics(contestId = '', limit = 100): Promise<StemJudgingRubric[]> {
  const url = new URL(`${env.apiBaseUrl}/admin/stem-judging/rubrics`);
  if (contestId) url.searchParams.set('contestId', contestId);
  url.searchParams.set('limit', String(limit));
  const res = await fetch(url.toString(), {
    cache: 'no-store',
    credentials: 'include',
    headers: adminHeaders(),
  });
  const payload = await res.json().catch(() => ({}));
  if (!res.ok || !payload?.success || !Array.isArray(payload?.rubrics)) return [];
  return payload.rubrics as StemJudgingRubric[];
}

export async function listStemJudgingCriteria(rubricId: string, limit = 100): Promise<StemJudgingCriterion[]> {
  const url = new URL(`${env.apiBaseUrl}/admin/stem-judging/criteria`);
  url.searchParams.set('rubricId', rubricId);
  url.searchParams.set('limit', String(limit));
  const res = await fetch(url.toString(), {
    cache: 'no-store',
    credentials: 'include',
    headers: adminHeaders(),
  });
  const payload = await res.json().catch(() => ({}));
  if (!res.ok || !payload?.success || !Array.isArray(payload?.criteria)) return [];
  return payload.criteria as StemJudgingCriterion[];
}

export async function createStemJudgingRubric(input: {
  contestId: string;
  name: string;
  description?: string;
  status?: string;
  criteria?: Array<{ key: string; label: string; weightPct: number; maxScore: number; description?: string }>;
}): Promise<{ rubric: StemJudgingRubric; criteria: StemJudgingCriterion[] } | null> {
  const res = await fetch(`${env.apiBaseUrl}/admin/stem-judging/rubrics`, {
    method: 'POST',
    credentials: 'include',
    headers: { 'Content-Type': 'application/json', ...adminHeaders() },
    body: JSON.stringify(input),
  });
  const payload = await res.json().catch(() => ({}));
  if (!res.ok || !payload?.success || !payload?.rubric) return null;
  return {
    rubric: payload.rubric as StemJudgingRubric,
    criteria: (payload.criteria || []) as StemJudgingCriterion[],
  };
}

export async function listStemJudgeAssignments(
  filters: { contestId?: string; applicationId?: string; judgeUserId?: string },
  limit = 100
): Promise<StemJudgeAssignment[]> {
  const url = new URL(`${env.apiBaseUrl}/admin/stem-judging/assignments`);
  if (filters.contestId) url.searchParams.set('contestId', filters.contestId);
  if (filters.applicationId) url.searchParams.set('applicationId', filters.applicationId);
  if (filters.judgeUserId) url.searchParams.set('judgeUserId', filters.judgeUserId);
  url.searchParams.set('limit', String(limit));
  const res = await fetch(url.toString(), {
    cache: 'no-store',
    credentials: 'include',
    headers: adminHeaders(),
  });
  const payload = await res.json().catch(() => ({}));
  if (!res.ok || !payload?.success || !Array.isArray(payload?.assignments)) return [];
  return payload.assignments as StemJudgeAssignment[];
}

export async function createStemJudgeAssignment(input: StemJudgeAssignment): Promise<StemJudgeAssignment | null> {
  const res = await fetch(`${env.apiBaseUrl}/admin/stem-judging/assignments`, {
    method: 'POST',
    credentials: 'include',
    headers: { 'Content-Type': 'application/json', ...adminHeaders() },
    body: JSON.stringify(input),
  });
  const payload = await res.json().catch(() => ({}));
  if (!res.ok || !payload?.success || !payload?.assignment) return null;
  return payload.assignment as StemJudgeAssignment;
}

export async function updateStemJudgeAssignmentConflict(
  assignmentId: string,
  input: { hasConflict: boolean; conflictReason?: string; status?: string }
): Promise<boolean> {
  const res = await fetch(`${env.apiBaseUrl}/admin/stem-judging/assignments/${encodeURIComponent(assignmentId)}/conflict`, {
    method: 'PATCH',
    credentials: 'include',
    headers: { 'Content-Type': 'application/json', ...adminHeaders() },
    body: JSON.stringify(input),
  });
  const payload = await res.json().catch(() => ({}));
  return Boolean(res.ok && payload?.success);
}

export async function listStemVotingRules(contestId = '', limit = 100): Promise<StemVotingRule[]> {
  const url = new URL(`${env.apiBaseUrl}/admin/stem-voting/rules`);
  if (contestId) url.searchParams.set('contestId', contestId);
  url.searchParams.set('limit', String(limit));
  const res = await fetch(url.toString(), { cache: 'no-store', credentials: 'include', headers: adminHeaders() });
  const payload = await res.json().catch(() => ({}));
  if (!res.ok || !payload?.success || !Array.isArray(payload?.rules)) return [];
  return payload.rules as StemVotingRule[];
}

export async function upsertStemVotingRule(input: StemVotingRule): Promise<StemVotingRule | null> {
  const res = await fetch(`${env.apiBaseUrl}/admin/stem-voting/rules`, {
    method: 'POST', credentials: 'include', headers: { 'Content-Type': 'application/json', ...adminHeaders() }, body: JSON.stringify(input),
  });
  const payload = await res.json().catch(() => ({}));
  if (!res.ok || !payload?.success || !payload?.rule) return null;
  return payload.rule as StemVotingRule;
}

export async function listStemVotePackages(contestId = '', limit = 100): Promise<StemVotePackage[]> {
  const url = new URL(`${env.apiBaseUrl}/admin/stem-voting/packages`);
  if (contestId) url.searchParams.set('contestId', contestId);
  url.searchParams.set('limit', String(limit));
  const res = await fetch(url.toString(), { cache: 'no-store', credentials: 'include', headers: adminHeaders() });
  const payload = await res.json().catch(() => ({}));
  if (!res.ok || !payload?.success || !Array.isArray(payload?.packages)) return [];
  return payload.packages as StemVotePackage[];
}

export async function createStemVotePackage(input: StemVotePackage): Promise<StemVotePackage | null> {
  const res = await fetch(`${env.apiBaseUrl}/admin/stem-voting/packages`, {
    method: 'POST', credentials: 'include', headers: { 'Content-Type': 'application/json', ...adminHeaders() }, body: JSON.stringify(input),
  });
  const payload = await res.json().catch(() => ({}));
  if (!res.ok || !payload?.success || !payload?.package) return null;
  return payload.package as StemVotePackage;
}

export async function listStemVoteTransactions(contestId = '', limit = 100): Promise<StemVoteTransaction[]> {
  const url = new URL(`${env.apiBaseUrl}/admin/stem-voting/transactions`);
  if (contestId) url.searchParams.set('contestId', contestId);
  url.searchParams.set('limit', String(limit));
  const res = await fetch(url.toString(), { cache: 'no-store', credentials: 'include', headers: adminHeaders() });
  const payload = await res.json().catch(() => ({}));
  if (!res.ok || !payload?.success || !Array.isArray(payload?.transactions)) return [];
  return payload.transactions as StemVoteTransaction[];
}

export async function createStemVoteTransaction(input: StemVoteTransaction): Promise<StemVoteTransaction | null> {
  const res = await fetch(`${env.apiBaseUrl}/admin/stem-voting/transactions`, {
    method: 'POST',
    credentials: 'include',
    headers: { 'Content-Type': 'application/json', ...adminHeaders() },
    body: JSON.stringify(input),
  });
  const payload = await res.json().catch(() => ({}));
  if (!res.ok || !payload?.success || !payload?.transaction) return null;
  return payload.transaction as StemVoteTransaction;
}

export async function listStemBootcampCohorts(contestId = '', limit = 100): Promise<StemBootcampCohort[]> {
  const url = new URL(`${env.apiBaseUrl}/admin/stem-bootcamp/cohorts`);
  if (contestId) url.searchParams.set('contestId', contestId);
  url.searchParams.set('limit', String(limit));
  const res = await fetch(url.toString(), { cache: 'no-store', credentials: 'include', headers: adminHeaders() });
  const payload = await res.json().catch(() => ({}));
  if (!res.ok || !payload?.success || !Array.isArray(payload?.cohorts)) return [];
  return payload.cohorts as StemBootcampCohort[];
}

export async function createStemBootcampCohort(input: StemBootcampCohort): Promise<StemBootcampCohort | null> {
  const res = await fetch(`${env.apiBaseUrl}/admin/stem-bootcamp/cohorts`, {
    method: 'POST', credentials: 'include', headers: { 'Content-Type': 'application/json', ...adminHeaders() }, body: JSON.stringify(input),
  });
  const payload = await res.json().catch(() => ({}));
  if (!res.ok || !payload?.success || !payload?.cohort) return null;
  return payload.cohort as StemBootcampCohort;
}

export async function listStemBootcampTasks(cohortId = '', limit = 100): Promise<StemBootcampTask[]> {
  const url = new URL(`${env.apiBaseUrl}/admin/stem-bootcamp/tasks`);
  if (cohortId) url.searchParams.set('cohortId', cohortId);
  url.searchParams.set('limit', String(limit));
  const res = await fetch(url.toString(), {
    cache: 'no-store',
    credentials: 'include',
    headers: adminHeaders(),
  });
  const payload = await res.json().catch(() => ({}));
  if (!res.ok || !payload?.success || !Array.isArray(payload?.tasks)) return [];
  return payload.tasks as StemBootcampTask[];
}

export async function createStemBootcampTask(input: StemBootcampTask): Promise<StemBootcampTask | null> {
  const res = await fetch(`${env.apiBaseUrl}/admin/stem-bootcamp/tasks`, {
    method: 'POST',
    credentials: 'include',
    headers: { 'Content-Type': 'application/json', ...adminHeaders() },
    body: JSON.stringify(input),
  });
  const payload = await res.json().catch(() => ({}));
  if (!res.ok || !payload?.success || !payload?.task) return null;
  return payload.task as StemBootcampTask;
}

export async function listStemBootcampScores(cohortId = '', applicationId = '', limit = 100): Promise<StemBootcampScore[]> {
  const url = new URL(`${env.apiBaseUrl}/admin/stem-bootcamp/scores`);
  if (cohortId) url.searchParams.set('cohortId', cohortId);
  if (applicationId) url.searchParams.set('applicationId', applicationId);
  url.searchParams.set('limit', String(limit));
  const res = await fetch(url.toString(), {
    cache: 'no-store',
    credentials: 'include',
    headers: adminHeaders(),
  });
  const payload = await res.json().catch(() => ({}));
  if (!res.ok || !payload?.success || !Array.isArray(payload?.scores)) return [];
  return payload.scores as StemBootcampScore[];
}

export async function upsertStemBootcampScore(input: StemBootcampScore): Promise<StemBootcampScore | null> {
  const res = await fetch(`${env.apiBaseUrl}/admin/stem-bootcamp/scores`, {
    method: 'POST',
    credentials: 'include',
    headers: { 'Content-Type': 'application/json', ...adminHeaders() },
    body: JSON.stringify(input),
  });
  const payload = await res.json().catch(() => ({}));
  if (!res.ok || !payload?.success || !payload?.score) return null;
  return payload.score as StemBootcampScore;
}

export async function listStemSponsors(limit = 100): Promise<StemSponsor[]> {
  const url = new URL(`${env.apiBaseUrl}/admin/stem-sponsors`);
  url.searchParams.set('limit', String(limit));
  const res = await fetch(url.toString(), { cache: 'no-store', credentials: 'include', headers: adminHeaders() });
  const payload = await res.json().catch(() => ({}));
  if (!res.ok || !payload?.success || !Array.isArray(payload?.sponsors)) return [];
  return payload.sponsors as StemSponsor[];
}

export async function createStemSponsor(input: StemSponsor): Promise<StemSponsor | null> {
  const res = await fetch(`${env.apiBaseUrl}/admin/stem-sponsors`, {
    method: 'POST', credentials: 'include', headers: { 'Content-Type': 'application/json', ...adminHeaders() }, body: JSON.stringify(input),
  });
  const payload = await res.json().catch(() => ({}));
  if (!res.ok || !payload?.success || !payload?.sponsor) return null;
  return payload.sponsor as StemSponsor;
}

export async function listStemCertificates(limit = 100): Promise<StemCertificate[]> {
  const url = new URL(`${env.apiBaseUrl}/admin/stem-awards/certificates`);
  url.searchParams.set('limit', String(limit));
  const res = await fetch(url.toString(), { cache: 'no-store', credentials: 'include', headers: adminHeaders() });
  const payload = await res.json().catch(() => ({}));
  if (!res.ok || !payload?.success || !Array.isArray(payload?.certificates)) return [];
  return payload.certificates as StemCertificate[];
}

export async function createStemCertificate(input: StemCertificate): Promise<StemCertificate | null> {
  const res = await fetch(`${env.apiBaseUrl}/admin/stem-awards/certificates`, {
    method: 'POST', credentials: 'include', headers: { 'Content-Type': 'application/json', ...adminHeaders() }, body: JSON.stringify(input),
  });
  const payload = await res.json().catch(() => ({}));
  if (!res.ok || !payload?.success || !payload?.certificate) return null;
  return payload.certificate as StemCertificate;
}

export async function listStemBadges(limit = 100): Promise<StemBadge[]> {
  const url = new URL(`${env.apiBaseUrl}/admin/stem-awards/badges`);
  url.searchParams.set('limit', String(limit));
  const res = await fetch(url.toString(), { cache: 'no-store', credentials: 'include', headers: adminHeaders() });
  const payload = await res.json().catch(() => ({}));
  if (!res.ok || !payload?.success || !Array.isArray(payload?.badges)) return [];
  return payload.badges as StemBadge[];
}

export async function createStemBadge(input: StemBadge): Promise<StemBadge | null> {
  const res = await fetch(`${env.apiBaseUrl}/admin/stem-awards/badges`, {
    method: 'POST', credentials: 'include', headers: { 'Content-Type': 'application/json', ...adminHeaders() }, body: JSON.stringify(input),
  });
  const payload = await res.json().catch(() => ({}));
  if (!res.ok || !payload?.success || !payload?.badge) return null;
  return payload.badge as StemBadge;
}

export async function listStemBadgeAwards(applicationId = '', limit = 100): Promise<StemBadgeAward[]> {
  const url = new URL(`${env.apiBaseUrl}/admin/stem-awards/badge-awards`);
  if (applicationId) url.searchParams.set('applicationId', applicationId);
  url.searchParams.set('limit', String(limit));
  const res = await fetch(url.toString(), { cache: 'no-store', credentials: 'include', headers: adminHeaders() });
  const payload = await res.json().catch(() => ({}));
  if (!res.ok || !payload?.success || !Array.isArray(payload?.awards)) return [];
  return payload.awards as StemBadgeAward[];
}

export async function awardStemBadge(input: StemBadgeAward): Promise<StemBadgeAward | null> {
  const res = await fetch(`${env.apiBaseUrl}/admin/stem-awards/badge-awards`, {
    method: 'POST', credentials: 'include', headers: { 'Content-Type': 'application/json', ...adminHeaders() }, body: JSON.stringify(input),
  });
  const payload = await res.json().catch(() => ({}));
  if (!res.ok || !payload?.success || !payload?.award) return null;
  return payload.award as StemBadgeAward;
}

export async function getStemReportSummary(): Promise<StemReportSummary | null> {
  const res = await fetch(`${env.apiBaseUrl}/admin/stem-reports/summary`, { cache: 'no-store', credentials: 'include', headers: adminHeaders() });
  const payload = await res.json().catch(() => ({}));
  if (!res.ok || !payload?.success || !payload?.summary) return null;
  return payload.summary as StemReportSummary;
}

export async function getStemReportBuckets(kind: string, contestId = '', limit = 100): Promise<StemReportBucket[]> {
  const url = new URL(`${env.apiBaseUrl}/admin/stem-reports/buckets`);
  url.searchParams.set('kind', kind);
  if (contestId) url.searchParams.set('contestId', contestId);
  url.searchParams.set('limit', String(limit));
  const res = await fetch(url.toString(), { cache: 'no-store', credentials: 'include', headers: adminHeaders() });
  const payload = await res.json().catch(() => ({}));
  if (!res.ok || !payload?.success || !Array.isArray(payload?.buckets)) return [];
  return payload.buckets as StemReportBucket[];
}
