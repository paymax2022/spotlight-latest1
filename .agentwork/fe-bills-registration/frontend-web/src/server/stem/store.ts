import { randomUUID } from 'crypto';
import {
  stemDefaultProjectFields,
  stemDefaultScoringCriteria,
  stemDefaultTrackRules,
  stemDefaultUploads,
} from '@/src/features/stem/constants';
import {
  computeCompletionPercent,
  detectStemFraudFlags,
  validateApplicationDraft,
  validateStartApplicationInput,
  validateStemContestConfig,
} from '@/src/features/stem/validation';
import type {
  StemAdminApplicationReviewInput,
  StemApplicantType,
  StemApplication,
  StemApplicationFilter,
  StemApplicationStatus,
  StemContest,
  StemContestCategory,
  StemPriceCategory,
  StemPrizeCategory,
  StemSchool,
  StemSchoolJoinRequest,
  StemStartApplicationInput,
  StemStatusEvent,
} from '@/src/features/stem/types';

type StemStore = {
  contests: Map<string, StemContest>;
  contestsBySlug: Map<string, string>;
  schools: Map<string, StemSchool>;
  schoolJoinRequests: Map<string, StemSchoolJoinRequest>;
  applications: Map<string, StemApplication>;
  statusEvents: Map<string, StemStatusEvent[]>;
};

function nowIso() {
  return new Date().toISOString();
}

function makeReference(prefix: string) {
  const cleanPrefix = prefix.replace(/[^a-z0-9]/gi, '').slice(0, 6).toUpperCase() || 'STEM';
  const stamp = Date.now().toString().slice(-6);
  const suffix = Math.random().toString(36).slice(2, 6).toUpperCase();
  return `${cleanPrefix}-${stamp}-${suffix}`;
}

function getStore(): StemStore {
  const globalKey = '__spotlightStemContestStore';
  const globalObj = globalThis as unknown as Record<string, StemStore | undefined>;
  if (!globalObj[globalKey]) {
    const seeded = seedDefaultStore();
    globalObj[globalKey] = seeded;
  }
  return globalObj[globalKey] as StemStore;
}

function pushStatusEvent(
  applicationId: string,
  oldStatus: StemApplicationStatus | undefined,
  newStatus: StemApplicationStatus,
  actorRole: StemStatusEvent['actorRole'],
  note?: string
) {
  const store = getStore();
  const event: StemStatusEvent = {
    id: randomUUID(),
    applicationId,
    oldStatus,
    newStatus,
    actorRole,
    note,
    createdAt: nowIso(),
  };
  const existing = store.statusEvents.get(applicationId) || [];
  existing.push(event);
  store.statusEvents.set(applicationId, existing);
}

function makeDefaultContest(): StemContest {
  const timestamp = nowIso();
  return {
    id: randomUUID(),
    slug: 'stem-contest',
    title: 'Spotlight STEM Challenge',
    season: '2026 National Edition',
    subtitle: 'School + Innovator National Innovation League',
    description:
      'A national innovation challenge connecting schools and independent innovators across Nigeria through category-based project submissions, judging, demo days, and optional public voting.',
    objective:
      'Discover high-potential innovations, strengthen STEM capacity, and connect projects with mentorship, incubation, and sponsor support.',
    status: 'open_for_registration',
    visibility: 'public',
    tracksAllowed: ['school_student', 'independent_innovator', 'mixed'],
    trackRules: {
      ...stemDefaultTrackRules,
      publicVotingEnabled: true,
      publicVotesDetermineFinalistsOnly: true,
    },
    applicantAgeMin: 12,
    applicantAgeMax: 45,
    schoolTypeEligibility: ['secondary_school', 'university', 'polytechnic', 'technical_college'],
    innovatorEligibility: ['graduate', 'artisan', 'freelancer', 'startup_founder', 'engineer', 'maker'],
    stateEligibility: [],
    requiredDocuments: ['id_verification', 'consent_records'],
    requiredMediaUploads: [...stemDefaultUploads],
    requiredProjectFields: [...stemDefaultProjectFields],
    teamSizeMin: 1,
    teamSizeMax: 8,
    judgingCriteriaDefault: [...stemDefaultScoringCriteria],
    votingEnabled: true,
    votingFeePerVote: 50,
    votingStartDate: undefined,
    votingEndDate: undefined,
    registrationOpenDate: undefined,
    registrationCloseDate: undefined,
    demoDayEnabled: true,
    demoLocations: ['Lagos', 'Abuja', 'Port Harcourt', 'Kano'],
    sponsorBackedCategories: ['Artificial Intelligence', 'Renewable Energy'],
    freeEntryEnabled: true,
    paidEntryEnabled: true,
    couponEnabled: true,
    waiverEnabled: true,
    schoolBulkRegistrationEnabled: true,
    publicProfileEnabled: true,
    finalistSelectionProcess: 'Judge shortlist + weighted public voting',
    winnerSelectionRules: 'Weighted judge score, compliance checks, and tie-break rubric.',
    reportingRequirements: 'State distribution, school type distribution, category spread, sponsor-alignment, and finalist outcomes.',
    categories: [],
    priceCategories: [],
    prizeCategories: [],
    createdAt: timestamp,
    updatedAt: timestamp,
  };
}

function seedDefaultStore(): StemStore {
  const contests = new Map<string, StemContest>();
  const contestsBySlug = new Map<string, string>();
  const schools = new Map<string, StemSchool>();
  const schoolJoinRequests = new Map<string, StemSchoolJoinRequest>();
  const applications = new Map<string, StemApplication>();
  const statusEvents = new Map<string, StemStatusEvent[]>();

  const contest = makeDefaultContest();
  const category: StemContestCategory = {
    id: randomUUID(),
    contestId: contest.id,
    name: 'Artificial Intelligence',
    description: 'AI and machine-learning products with practical community impact.',
    eligibleTracks: ['school_student', 'independent_innovator', 'mixed'],
    requiredUploads: ['demo_video', 'pitch_deck'],
    requiredQuestions: [],
    judgingCriteria: stemDefaultScoringCriteria,
    scoreWeightPercent: 100,
    publicProfileVisible: true,
    status: 'active',
    createdAt: nowIso(),
    updatedAt: nowIso(),
  };

  const price: StemPriceCategory = {
    id: randomUUID(),
    contestId: contest.id,
    name: 'Standard Innovator Entry',
    description: 'Standard independent innovator application fee.',
    appliesToTracks: ['independent_innovator', 'mixed'],
    appliesToApplicantTypes: ['independent_innovator', 'team_lead'],
    appliesToSchoolTypes: [],
    appliesToCategoryIds: [category.id],
    appliesToStates: [],
    currency: 'NGN',
    amount: 5000,
    paymentRequiredBeforeSubmission: false,
    paymentRequiredAfterShortlisting: true,
    paymentRequiredBeforeDemoDay: true,
    discountCodeEnabled: true,
    waiverCodeEnabled: true,
    sponsorCodeEnabled: true,
    visiblePublicly: true,
    adminOnly: false,
    status: 'active',
    createdAt: nowIso(),
    updatedAt: nowIso(),
  };

  const prize: StemPrizeCategory = {
    id: randomUUID(),
    contestId: contest.id,
    title: 'Overall Winner Prize',
    prizeType: 'overall_winner',
    description: 'Cash + incubation support + media showcase.',
    cashPrizeAmount: 2000000,
    eligibleCategoryIds: [category.id],
    eligibleTracks: ['school_student', 'independent_innovator', 'mixed'],
    numberOfWinners: 1,
    publiclyVisible: true,
    verificationRequiredBeforeAward: true,
    status: 'active',
    createdAt: nowIso(),
    updatedAt: nowIso(),
  };

  contest.categories.push(category);
  contest.priceCategories.push(price);
  contest.prizeCategories.push(prize);

  contests.set(contest.id, contest);
  contestsBySlug.set(contest.slug, contest.id);

  return { contests, contestsBySlug, schools, schoolJoinRequests, applications, statusEvents };
}

function normalizeStatus(input?: string): StemApplicationStatus {
  const allowed: StemApplicationStatus[] = [
    'draft',
    'awaiting_school_approval',
    'awaiting_guardian_consent',
    'awaiting_payment',
    'payment_failed',
    'submitted',
    'identity_verification_pending',
    'under_review',
    'more_information_requested',
    'shortlisted',
    'approved',
    'rejected',
    'waitlisted',
    'selected_for_showcase',
    'selected_for_bootcamp',
    'selected_for_finals',
    'public_profile_live',
    'voting_live',
    'eliminated',
    'winner',
    'disqualified',
    'withdrawn',
  ];

  if (input && allowed.includes(input as StemApplicationStatus)) {
    return input as StemApplicationStatus;
  }
  return 'draft';
}

function resolvePaymentStatus(contest: StemContest, applicantType: StemApplicantType) {
  if (contest.freeEntryEnabled && !contest.paidEntryEnabled) return 'not_required' as const;

  if (applicantType === 'student' && contest.freeEntryEnabled) {
    return 'waived' as const;
  }

  return 'pending' as const;
}

function getContestByIdOrThrow(contestId: string) {
  const store = getStore();
  const contest = store.contests.get(contestId);
  if (!contest) throw new Error('Contest not found.');
  return contest;
}

export function listStemContests(input?: { includeNonPublic?: boolean; status?: string }) {
  const contests = Array.from(getStore().contests.values());
  return contests.filter((contest) => {
    if (!input?.includeNonPublic && contest.visibility === 'hidden') return false;
    if (!input?.includeNonPublic && contest.status !== 'published' && contest.status !== 'open_for_registration' && contest.status !== 'voting_live') {
      return false;
    }
    if (input?.status && contest.status !== input.status) return false;
    return true;
  });
}

export function listStemAdminContests() {
  return Array.from(getStore().contests.values());
}

export function getStemContestBySlug(slug: string) {
  const store = getStore();
  const contestId = store.contestsBySlug.get(slug);
  if (!contestId) return null;
  return store.contests.get(contestId) || null;
}

export function getStemContestById(contestId: string) {
  return getStore().contests.get(contestId) || null;
}

export function createStemContestAdmin(input: Partial<StemContest>, actorId?: string) {
  const validation = validateStemContestConfig(input);
  if (!validation.isValid) {
    return { success: false, errors: validation.errors } as const;
  }

  const store = getStore();
  if (input.slug && store.contestsBySlug.has(input.slug)) {
    return { success: false, errors: { slug: 'Contest slug already exists.' } } as const;
  }

  const createdAt = nowIso();
  const contest: StemContest = {
    id: randomUUID(),
    slug: String(input.slug),
    title: String(input.title),
    season: String(input.season),
    subtitle: input.subtitle,
    description: String(input.description),
    objective: input.objective,
    bannerImage: input.bannerImage,
    logo: input.logo,
    sponsorLogo: input.sponsorLogo,
    organizer: input.organizer,
    partnerSponsor: input.partnerSponsor,
    supportContact: input.supportContact,
    faq: input.faq,
    termsAndConditions: input.termsAndConditions,
    privacyNote: input.privacyNote,
    status: input.status || 'draft',
    visibility: input.visibility || 'public',
    tracksAllowed: input.tracksAllowed || ['school_student', 'independent_innovator'],
    trackRules: input.trackRules || { ...stemDefaultTrackRules },
    applicantAgeMin: input.applicantAgeMin,
    applicantAgeMax: input.applicantAgeMax,
    schoolTypeEligibility: input.schoolTypeEligibility || [],
    innovatorEligibility: input.innovatorEligibility || [],
    stateEligibility: input.stateEligibility || [],
    requiredDocuments: input.requiredDocuments || [],
    requiredMediaUploads: input.requiredMediaUploads || [...stemDefaultUploads],
    requiredProjectFields: input.requiredProjectFields || [...stemDefaultProjectFields],
    teamSizeMin: input.teamSizeMin,
    teamSizeMax: input.teamSizeMax,
    judgingCriteriaDefault: input.judgingCriteriaDefault || [...stemDefaultScoringCriteria],
    votingEnabled: Boolean(input.votingEnabled),
    votingFeePerVote: input.votingFeePerVote,
    votingStartDate: input.votingStartDate,
    votingEndDate: input.votingEndDate,
    registrationOpenDate: input.registrationOpenDate,
    registrationCloseDate: input.registrationCloseDate,
    demoDayEnabled: Boolean(input.demoDayEnabled),
    demoLocations: input.demoLocations || [],
    sponsorBackedCategories: input.sponsorBackedCategories || [],
    freeEntryEnabled: input.freeEntryEnabled ?? true,
    paidEntryEnabled: input.paidEntryEnabled ?? false,
    couponEnabled: input.couponEnabled ?? false,
    waiverEnabled: input.waiverEnabled ?? false,
    schoolBulkRegistrationEnabled: input.schoolBulkRegistrationEnabled ?? false,
    publicProfileEnabled: input.publicProfileEnabled ?? false,
    finalistSelectionProcess: input.finalistSelectionProcess,
    winnerSelectionRules: input.winnerSelectionRules,
    reportingRequirements: input.reportingRequirements,
    categories: [],
    priceCategories: [],
    prizeCategories: [],
    createdBy: actorId,
    updatedBy: actorId,
    createdAt,
    updatedAt: createdAt,
  };

  store.contests.set(contest.id, contest);
  store.contestsBySlug.set(contest.slug, contest.id);
  return { success: true, contest } as const;
}

export function updateStemContestAdmin(contestId: string, patch: Partial<StemContest>, actorId?: string) {
  const store = getStore();
  const existing = getContestByIdOrThrow(contestId);

  if (patch.slug && patch.slug !== existing.slug && store.contestsBySlug.has(patch.slug)) {
    throw new Error('Contest slug already exists.');
  }

  if (patch.slug && patch.slug !== existing.slug) {
    store.contestsBySlug.delete(existing.slug);
    store.contestsBySlug.set(patch.slug, contestId);
  }

  const next: StemContest = {
    ...existing,
    ...patch,
    id: contestId,
    categories: existing.categories,
    priceCategories: existing.priceCategories,
    prizeCategories: existing.prizeCategories,
    updatedAt: nowIso(),
    updatedBy: actorId,
  };

  store.contests.set(contestId, next);
  return next;
}

export function publishStemContestAdmin(contestId: string, actorId?: string) {
  return updateStemContestAdmin(contestId, { status: 'published' }, actorId);
}

export function addStemContestCategory(contestId: string, payload: Partial<StemContestCategory>) {
  const store = getStore();
  const contest = getContestByIdOrThrow(contestId);
  if (!payload.name?.trim()) throw new Error('Category name is required.');

  const row: StemContestCategory = {
    id: randomUUID(),
    contestId,
    name: payload.name,
    description: payload.description,
    icon: payload.icon,
    banner: payload.banner,
    eligibleTracks: payload.eligibleTracks || contest.tracksAllowed,
    eligibleAgeRange: payload.eligibleAgeRange,
    eligibleSchoolLevels: payload.eligibleSchoolLevels || [],
    eligibleProjectStages: payload.eligibleProjectStages || [],
    requiredUploads: payload.requiredUploads || [],
    requiredQuestions: payload.requiredQuestions || [],
    judgingCriteria: payload.judgingCriteria || contest.judgingCriteriaDefault,
    scoreWeightPercent: payload.scoreWeightPercent,
    sponsorAssigned: payload.sponsorAssigned,
    prizeAssigned: payload.prizeAssigned,
    registrationFeeCategoryId: payload.registrationFeeCategoryId,
    votingFeeCategoryId: payload.votingFeeCategoryId,
    maxApplicants: payload.maxApplicants,
    maxFinalists: payload.maxFinalists,
    publicProfileVisible: payload.publicProfileVisible ?? true,
    safetyRequirements: payload.safetyRequirements,
    rules: payload.rules,
    status: payload.status || 'active',
    createdAt: nowIso(),
    updatedAt: nowIso(),
  };

  contest.categories.push(row);
  contest.updatedAt = nowIso();
  store.contests.set(contest.id, contest);
  return row;
}

export function addStemPriceCategory(contestId: string, payload: Partial<StemPriceCategory>) {
  const store = getStore();
  const contest = getContestByIdOrThrow(contestId);
  if (!payload.name?.trim()) throw new Error('Price category name is required.');

  const row: StemPriceCategory = {
    id: randomUUID(),
    contestId,
    name: payload.name,
    description: payload.description,
    appliesToTracks: payload.appliesToTracks || contest.tracksAllowed,
    appliesToApplicantTypes: payload.appliesToApplicantTypes || ['student', 'independent_innovator', 'team_lead', 'school_admin'],
    appliesToSchoolTypes: payload.appliesToSchoolTypes || [],
    appliesToCategoryIds: payload.appliesToCategoryIds || [],
    appliesToStates: payload.appliesToStates || [],
    currency: payload.currency || 'NGN',
    amount: payload.amount || 0,
    earlyBirdAmount: payload.earlyBirdAmount,
    lateFeeAmount: payload.lateFeeAmount,
    startDate: payload.startDate,
    endDate: payload.endDate,
    paymentRequiredBeforeSubmission: payload.paymentRequiredBeforeSubmission ?? false,
    paymentRequiredAfterShortlisting: payload.paymentRequiredAfterShortlisting ?? false,
    paymentRequiredBeforeDemoDay: payload.paymentRequiredBeforeDemoDay ?? false,
    refundPolicy: payload.refundPolicy,
    discountCodeEnabled: payload.discountCodeEnabled ?? false,
    waiverCodeEnabled: payload.waiverCodeEnabled ?? false,
    sponsorCodeEnabled: payload.sponsorCodeEnabled ?? false,
    maxApplicants: payload.maxApplicants,
    visiblePublicly: payload.visiblePublicly ?? true,
    adminOnly: payload.adminOnly ?? false,
    status: payload.status || 'active',
    createdAt: nowIso(),
    updatedAt: nowIso(),
  };

  contest.priceCategories.push(row);
  contest.updatedAt = nowIso();
  store.contests.set(contest.id, contest);
  return row;
}

export function addStemPrizeCategory(contestId: string, payload: Partial<StemPrizeCategory>) {
  const store = getStore();
  const contest = getContestByIdOrThrow(contestId);
  if (!payload.title?.trim()) throw new Error('Prize title is required.');

  const row: StemPrizeCategory = {
    id: randomUUID(),
    contestId,
    title: payload.title,
    description: payload.description,
    prizeType: payload.prizeType || 'category_winner',
    prizeValue: payload.prizeValue,
    cashPrizeAmount: payload.cashPrizeAmount,
    nonCashPrizeDescription: payload.nonCashPrizeDescription,
    sponsor: payload.sponsor,
    eligibleCategoryIds: payload.eligibleCategoryIds || [],
    eligibleTracks: payload.eligibleTracks || contest.tracksAllowed,
    numberOfWinners: payload.numberOfWinners || 1,
    selectionCriteria: payload.selectionCriteria,
    publiclyVisible: payload.publiclyVisible ?? true,
    terms: payload.terms,
    disbursementCondition: payload.disbursementCondition,
    verificationRequiredBeforeAward: payload.verificationRequiredBeforeAward ?? true,
    status: payload.status || 'active',
    createdAt: nowIso(),
    updatedAt: nowIso(),
  };

  contest.prizeCategories.push(row);
  contest.updatedAt = nowIso();
  store.contests.set(contest.id, contest);
  return row;
}

export function registerStemSchool(input: Omit<StemSchool, 'id' | 'status' | 'createdAt' | 'updatedAt'>) {
  const store = getStore();
  const id = randomUUID();
  const row: StemSchool = {
    ...input,
    id,
    status: 'submitted',
    createdAt: nowIso(),
    updatedAt: nowIso(),
  };
  store.schools.set(id, row);
  return row;
}

export function listStemSchools(status?: StemSchool['status']) {
  const rows = Array.from(getStore().schools.values());
  if (!status) return rows;
  return rows.filter((school) => school.status === status);
}

export function reviewStemSchool(schoolId: string, status: StemSchool['status'], note?: string, actorId?: string) {
  const store = getStore();
  const school = store.schools.get(schoolId);
  if (!school) throw new Error('School not found.');

  const next: StemSchool = {
    ...school,
    status,
    reviewNote: note,
    reviewedBy: actorId,
    updatedAt: nowIso(),
  };

  store.schools.set(schoolId, next);
  return next;
}

export function createSchoolJoinRequest(input: Omit<StemSchoolJoinRequest, 'id' | 'status' | 'createdAt' | 'updatedAt'>) {
  const store = getStore();
  const school = store.schools.get(input.schoolId);
  if (!school) throw new Error('School not found.');

  const row: StemSchoolJoinRequest = {
    ...input,
    id: randomUUID(),
    status: 'pending',
    createdAt: nowIso(),
    updatedAt: nowIso(),
  };

  store.schoolJoinRequests.set(row.id, row);
  return row;
}

export function reviewSchoolJoinRequest(requestId: string, status: 'approved' | 'rejected', note?: string, actorId?: string) {
  const store = getStore();
  const req = store.schoolJoinRequests.get(requestId);
  if (!req) throw new Error('School join request not found.');

  const next: StemSchoolJoinRequest = {
    ...req,
    status,
    reviewNote: note,
    reviewedBy: actorId,
    updatedAt: nowIso(),
  };
  store.schoolJoinRequests.set(requestId, next);
  return next;
}

export function listSchoolJoinRequests(schoolId?: string) {
  const rows = Array.from(getStore().schoolJoinRequests.values());
  if (!schoolId) return rows;
  return rows.filter((req) => req.schoolId === schoolId);
}

export function startStemApplication(input: StemStartApplicationInput) {
  const validation = validateStartApplicationInput(input);
  if (!validation.isValid) {
    return { success: false, errors: validation.errors } as const;
  }

  const store = getStore();
  const contest = getStemContestBySlug(input.contestSlug);
  if (!contest) {
    return { success: false, errors: { contestSlug: 'Contest not found.' } } as const;
  }
  if (contest.status !== 'published' && contest.status !== 'open_for_registration') {
    return { success: false, errors: { contestStatus: 'Contest is not accepting applications.' } } as const;
  }

  if (input.applicantType === 'student') {
    if (!input.schoolId) {
      return { success: false, errors: { schoolId: 'School is required for student track.' } } as const;
    }
    const school = store.schools.get(input.schoolId);
    if (!school) {
      return { success: false, errors: { schoolId: 'School not found.' } } as const;
    }
    if (contest.trackRules.schoolVerificationRequiredBeforeStudentApply && school.status !== 'verified') {
      return { success: false, errors: { schoolId: 'School is not verified yet.' } } as const;
    }
  }

  const initialStatus: StemApplicationStatus =
    input.applicantType === 'student' && contest.trackRules.studentNeedsSchoolApproval
      ? 'awaiting_school_approval'
      : 'draft';

  const app: StemApplication = {
    id: randomUUID(),
    reference: makeReference(contest.slug),
    contestId: contest.id,
    contestSlug: contest.slug,
    track: input.track,
    applicantType: input.applicantType,
    status: initialStatus,
    schoolId: input.schoolId,
    schoolJoinRequestId: input.schoolJoinRequestId,
    applicantUserId: input.applicantUserId,
    applicantName: input.applicantName,
    applicantEmail: input.applicantEmail,
    applicantPhone: input.applicantPhone,
    paymentStatus: resolvePaymentStatus(contest, input.applicantType),
    completionPercent: 0,
    formData: {
      'applicant.name': input.applicantName,
      'applicant.email': input.applicantEmail,
      'applicant.phone': input.applicantPhone,
    },
    projectData: {},
    uploadData: {},
    fraudFlags: [],
    safetyFlags: [],
    createdAt: nowIso(),
    updatedAt: nowIso(),
  };

  app.fraudFlags = detectStemFraudFlags(app);

  store.applications.set(app.id, app);
  pushStatusEvent(app.id, undefined, app.status, 'applicant', 'Application draft created');

  return { success: true, application: app, contest } as const;
}

export function getStemApplication(applicationId: string) {
  return getStore().applications.get(applicationId) || null;
}

export function saveStemApplicationDraft(applicationId: string, payload: {
  status?: StemApplicationStatus;
  categoryId?: string;
  priceCategoryId?: string;
  formData?: Record<string, unknown>;
  projectData?: Record<string, unknown>;
  uploadData?: Record<string, unknown>;
}) {
  const store = getStore();
  const app = store.applications.get(applicationId);
  if (!app) throw new Error('Application not found.');

  const contest = getContestByIdOrThrow(app.contestId);
  const merged = {
    ...app,
    status: normalizeStatus(payload.status || app.status),
    categoryId: payload.categoryId || app.categoryId,
    priceCategoryId: payload.priceCategoryId || app.priceCategoryId,
    formData: {
      ...app.formData,
      ...(payload.formData || {}),
    },
    projectData: {
      ...app.projectData,
      ...(payload.projectData || {}),
    },
    uploadData: {
      ...app.uploadData,
      ...(payload.uploadData || {}),
    },
    updatedAt: nowIso(),
  };

  const projectCombined = {
    ...merged.formData,
    ...merged.projectData,
    ...merged.uploadData,
  };

  merged.completionPercent = computeCompletionPercent(contest, projectCombined);
  merged.fraudFlags = detectStemFraudFlags(merged);

  store.applications.set(merged.id, merged);
  return merged;
}

export function submitStemApplication(applicationId: string) {
  const app = getStemApplication(applicationId);
  if (!app) throw new Error('Application not found.');

  const contest = getContestByIdOrThrow(app.contestId);
  const combined = {
    ...app.formData,
    ...app.projectData,
    ...app.uploadData,
  };

  const validation = validateApplicationDraft(contest, combined, 'submitted');
  if (!validation.isValid) {
    return {
      success: false,
      errors: validation.errors,
      application: app,
    } as const;
  }

  const oldStatus = app.status;
  const nextStatus: StemApplicationStatus =
    app.paymentStatus === 'pending' && contest.paidEntryEnabled ? 'awaiting_payment' : 'submitted';

  const submitted = saveStemApplicationDraft(applicationId, { status: nextStatus });
  submitted.submittedAt = nowIso();
  submitted.updatedAt = nowIso();

  getStore().applications.set(applicationId, submitted);
  pushStatusEvent(applicationId, oldStatus, nextStatus, 'applicant', 'Application submitted');

  return { success: true, application: submitted } as const;
}

export function listStemApplications(filter: StemApplicationFilter = {}) {
  const rows = Array.from(getStore().applications.values());

  return rows.filter((row) => {
    if (filter.contestId && row.contestId !== filter.contestId) return false;
    if (filter.contestSlug && row.contestSlug !== filter.contestSlug) return false;
    if (filter.status && row.status !== filter.status) return false;
    if (filter.applicantType && row.applicantType !== filter.applicantType) return false;
    if (filter.track && row.track !== filter.track) return false;
    if (filter.schoolId && row.schoolId !== filter.schoolId) return false;
    if (filter.paymentStatus && row.paymentStatus !== filter.paymentStatus) return false;

    if (filter.query) {
      const q = filter.query.toLowerCase();
      const haystack = [
        row.reference,
        row.applicantName || '',
        row.applicantEmail || '',
        row.applicantPhone || '',
      ]
        .join(' ')
        .toLowerCase();

      if (!haystack.includes(q)) return false;
    }

    if (filter.state) {
      const state = String(row.formData['applicant.state'] || row.projectData['project.state'] || '').toLowerCase();
      if (state !== filter.state.toLowerCase()) return false;
    }

    return true;
  });
}

export function reviewStemApplicationAdmin(applicationId: string, input: StemAdminApplicationReviewInput) {
  const store = getStore();
  const app = store.applications.get(applicationId);
  if (!app) throw new Error('Application not found.');

  const oldStatus = app.status;
  const updated: StemApplication = {
    ...app,
    status: input.status,
    fraudFlags: input.fraudFlags || app.fraudFlags,
    safetyFlags: input.safetyFlags || app.safetyFlags,
    updatedAt: nowIso(),
    formData: {
      ...app.formData,
      'admin.reviewNote': input.note || '',
      'admin.reviewScore': typeof input.score === 'number' ? input.score : app.formData['admin.reviewScore'],
    },
  };

  store.applications.set(applicationId, updated);
  pushStatusEvent(applicationId, oldStatus, input.status, 'admin', input.note);
  return updated;
}

export function getStemApplicationTimeline(applicationId: string) {
  return getStore().statusEvents.get(applicationId) || [];
}
