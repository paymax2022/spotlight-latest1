export type StemOverview = {
  totalApplications: number;
  submittedApplications: number;
  underReviewApplications: number;
  shortlistedApplications: number;
  schoolChannelApplicants: number;
  emergingApplicants: number;
};

export type StemSchool = {
  id?: string;
  name: string;
  state: string;
  applications: number;
  submittedCount: number;
  underReviewCount: number;
  shortlistedCount: number;
  verificationStatus: string;
};

export type StemSchoolDashboard = {
  schoolId: string;
  schoolName: string;
  verificationStatus: string;
  totalStudents: number;
  totalTeams: number;
  totalProjects: number;
  totalSubmissions: number;
  activeContests: number;
  pendingVerifications: number;
};

export type StemSchoolTeam = {
  id?: string;
  schoolId: string;
  teamName: string;
  contestCategory: string;
  coachName: string;
  projectTitle: string;
  teamSize: number;
};

export type StemSchoolProfile = {
  id?: string;
  schoolId: string;
  userId: string;
  roleType: string;
  fullName: string;
  email: string;
  phone: string;
  gradeLevel: string;
  specialization: string;
  status: string;
};

export type StemEmergingInnovator = {
  id?: string;
  fullName: string;
  email: string;
  phone: string;
  state: string;
  currentStatus: string;
  innovationTrack: string;
  teamName: string;
  prototypeAvailable: boolean;
  verificationStatus: string;
};

export type StemEmergingTeam = {
  id?: string;
  innovatorId: string;
  teamName: string;
  innovationTrack: string;
  teamSize: number;
};

export type StemEmergingProject = {
  id?: string;
  teamId: string;
  projectTitle: string;
  category: string;
  status: string;
};

export type StemContest = {
  id?: string;
  name: string;
  slug: string;
  contestType: string;
  contestMode: string;
  eligibleParticipantTypes: string[];
  eligibleSchoolLevels: string[];
  eligibleStates: string[];
  allowMixedChannels: boolean;
  rankingFormula: string;
  stageLifecycle: string[];
  stageTransitions: Record<string, string[]>;
  status: string;
};

export type StemEligibilityResult = {
  eligible: boolean;
  reasons: string[];
};

export type StemLeaderboardEntry = {
  id?: string;
  contestId: string;
  participantId: string;
  participantType: string;
  displayName: string;
  judgeScore: number;
  voteScore: number;
  stageScore: number;
  finalScore: number;
  rankPosition: number;
};

export type StemLeaderboardSlice = {
  groupKey: string;
  count: number;
  avgScore: number;
};

export type StemSubmission = {
  id: string;
  status: string;
  reviewStage: string;
  entryRoute: string;
  challengeType: string;
  categoryTrack: string;
  completionPercent: number;
};

export type StemJudgingScore = {
  id?: string;
  applicationId: string;
  reviewerId: string;
  innovationScore: number;
  technicalDepthScore: number;
  impactScore: number;
  overallScore: number;
  notes: string;
  reviewStatus?: string;
  isLocked?: boolean;
  lockReason?: string;
  lockedAt?: string;
  lockedBy?: string;
  hasConflict?: boolean;
  conflictReason?: string;
};

export type StemJudgingRubric = {
  id?: string;
  contestId: string;
  name: string;
  description: string;
  status: string;
};

export type StemJudgingCriterion = {
  id?: string;
  rubricId: string;
  key: string;
  label: string;
  weightPct: number;
  maxScore: number;
  description: string;
};

export type StemJudgeAssignment = {
  id?: string;
  contestId: string;
  applicationId: string;
  judgeUserId: string;
  status: string;
  hasConflict?: boolean;
  conflictReason?: string;
};

export type StemVotingRule = {
  id?: string;
  contestId: string;
  votingStatus: string;
  votingMode: string;
  dailyVoteLimit: number;
  oneUserOneVote: boolean;
  allowPaidVotes: boolean;
};

export type StemVotePackage = {
  id?: string;
  contestId: string;
  name: string;
  votes: number;
  amountNgn: number;
  isActive: boolean;
};

export type StemVoteTransaction = {
  id?: string;
  contestId: string;
  applicationId: string;
  packageId: string;
  voterRef: string;
  paymentReference: string;
  amountNgn: number;
  votesAllocated: number;
  status: string;
};

export type StemBootcampCohort = {
  id?: string;
  contestId: string;
  name: string;
  status: string;
  startDate: string;
  endDate: string;
};

export type StemBootcampTask = {
  id?: string;
  cohortId: string;
  title: string;
  description: string;
  dayNumber: number;
  maxScore: number;
};

export type StemBootcampScore = {
  id?: string;
  cohortId: string;
  taskId: string;
  applicationId: string;
  score: number;
  note: string;
};

export type StemSponsor = {
  id?: string;
  name: string;
  sponsorType: string;
  logoUrl: string;
  websiteUrl: string;
  campaignMessage: string;
  ctaUrl: string;
  isActive: boolean;
};

export type StemCertificate = {
  id?: string;
  applicationId: string;
  certificateType: string;
  certificateNumber: string;
  issuedAt: string;
  fileUrl: string;
};

export type StemBadge = {
  id?: string;
  name: string;
  description: string;
  iconUrl: string;
};

export type StemBadgeAward = {
  id?: string;
  badgeId: string;
  applicationId: string;
  awardedAt: string;
  note: string;
};

export type StemReportSummary = {
  totalApplications: number;
  totalSchools: number;
  totalEmerging: number;
  totalVotes: number;
  totalSponsors: number;
  totalCertificates: number;
  totalBadgeAwards: number;
  totalBootcampCohorts: number;
};

export type StemReportBucket = {
  key: string;
  count: number;
};
