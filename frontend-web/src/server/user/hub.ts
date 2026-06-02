import { listRegistrationContests, listRegistrationApplications } from '@/src/server/registration/store';
import { listContests as listOpenMicContests, listApplications as listOpenMicApplications, listSubmissions as listOpenMicSubmissions } from '@/src/server/openmic/persistence';
import { listContests as listStemContests, listApplications as listStemApplications } from '@/src/server/stem/persistence';
import type { RequestUser } from '@/src/lib/auth/request';
import type { SpotlightUserProfile } from './profile';

export type SpotlightOpportunity = {
  id: string;
  slug: string;
  title: string;
  programType: string;
  shortDescription: string;
  deadline?: string;
  location?: string;
  deliveryMode: 'virtual' | 'physical' | 'hybrid';
  applicationFee?: number;
  prizeOrBenefit?: string;
  eligibility?: string;
  status: string;
  applyHref: string;
  detailsHref: string;
  source: 'registration' | 'open_mic' | 'stem';
};

export type UnifiedApplication = {
  id: string;
  programId: string;
  programName: string;
  programType: string;
  reference?: string;
  submittedAt?: string;
  deadline?: string;
  status: string;
  nextAction: string;
  detailsHref: string;
  editHref?: string;
  source: 'registration' | 'open_mic_application' | 'open_mic_submission' | 'stem';
};

function normalizeStatus(status: string | undefined) {
  return String(status || 'draft').replaceAll('_', ' ');
}

function nextAction(status: string) {
  const value = status.toLowerCase();
  if (value.includes('draft')) return 'Continue application';
  if (value.includes('correction') || value.includes('information')) return 'Upload correction';
  if (value.includes('shortlist') || value.includes('invited')) return 'Check invitation details';
  if (value.includes('rejected')) return 'Review outcome';
  return 'Track status';
}

export async function listOpenOpportunities(): Promise<SpotlightOpportunity[]> {
  const [registrationResult, openMicResult, stemResult] = await Promise.allSettled([
    Promise.resolve(listRegistrationContests()),
    listOpenMicContests(),
    listStemContests(),
  ]);
  const registration = registrationResult.status === 'fulfilled' ? registrationResult.value : [];
  const openMic = openMicResult.status === 'fulfilled' ? openMicResult.value : [];
  const stem = stemResult.status === 'fulfilled' ? stemResult.value : [];

  const registrationItems = registration.map((item): SpotlightOpportunity => ({
    id: item.slug,
    slug: item.slug,
    title: item.title,
    programType: item.contestCategory.replaceAll('_', ' '),
    shortDescription: `${item.seasonOrEdition || 'Spotlight'} ${item.contestType.replaceAll('_', ' ')}`,
    deadline: undefined,
    location: item.auditionStates?.length ? item.auditionStates.join(', ') : item.regionScope,
    deliveryMode: item.contestType.includes('hybrid') ? 'hybrid' : item.contestType.includes('online') ? 'virtual' : 'physical',
    applicationFee: item.registrationFeeNgn || 0,
    prizeOrBenefit: item.supportsVoting ? 'Public voting visibility and Spotlight progression' : 'Spotlight program opportunity',
    eligibility: item.applicantCategories?.join(', ') || 'Open to eligible Spotlight applicants',
    status: 'open',
    applyHref: `/apply/${item.slug}`,
    detailsHref: `/apply/${item.slug}`,
    source: 'registration',
  }));

  const openMicItems = openMic.map((item): SpotlightOpportunity => ({
    id: item.id,
    slug: item.slug,
    title: item.title,
    programType: 'Open Mic Contest',
    shortDescription: item.description || 'Monthly open mic contest for emerging artists.',
    deadline: item.submissionEndAt || item.registrationEndAt,
    location: [item.finale?.venueName, item.finale?.city, item.finale?.state].filter(Boolean).join(', ') || 'Hybrid',
    deliveryMode: 'hybrid',
    applicationFee: item.entryFeeRequired ? item.registrationFeeNgn : 0,
    prizeOrBenefit: item.prizes?.[0]?.title || 'Performance and visibility opportunity',
    eligibility: 'Artists with completed Open Mic profile and official beat submission',
    status: item.status,
    applyHref: `/open-mic/${item.slug}/apply`,
    detailsHref: `/open-mic/${item.slug}`,
    source: 'open_mic',
  }));

  const stemItems = stem.map((item): SpotlightOpportunity => ({
    id: item.id,
    slug: item.slug,
    title: item.title,
    programType: 'STEM Contest',
    shortDescription: item.description || 'STEM innovation opportunity for students and schools.',
    deadline: item.registrationCloseDate,
    location: item.demoLocations?.length ? item.demoLocations.join(', ') : 'National',
    deliveryMode: 'hybrid',
    applicationFee: item.priceCategories?.[0]?.amount || 0,
    prizeOrBenefit: item.prizeCategories?.[0]?.title || 'Mentorship, recognition, and awards',
    eligibility: item.categories?.[0]?.name || 'Eligible STEM applicants',
    status: item.status,
    applyHref: `/stem/contests`,
    detailsHref: `/stem/contests`,
    source: 'stem',
  }));

  return [...openMicItems, ...stemItems, ...registrationItems].sort((a, b) => a.title.localeCompare(b.title));
}

export async function listUserApplications(user: RequestUser): Promise<UnifiedApplication[]> {
  // allSettled prevents one broken data source from failing the entire dashboard.
  const [regResult, openMicAppResult, openMicSubResult, stemResult] = await Promise.allSettled([
    Promise.resolve(listRegistrationApplications({}).filter((item) => item.userId === user.id)),
    listOpenMicApplications({ userId: user.id }),
    listOpenMicSubmissions({ userId: user.id }),
    listStemApplications({ applicantUserId: user.id }),
  ]);

  const registration      = regResult.status      === 'fulfilled' ? regResult.value      : [];
  const openMicApps       = openMicAppResult.status === 'fulfilled' ? openMicAppResult.value : [];
  const openMicSubmissions = openMicSubResult.status === 'fulfilled' ? openMicSubResult.value : [];
  const stemApps          = stemResult.status     === 'fulfilled' ? stemResult.value     : [];

  const registrationRows = registration.map((item): UnifiedApplication => ({
    id: item.id,
    programId: item.contestSlug,
    programName: item.contestSlug,
    programType: 'Spotlight Application',
    reference: item.reference,
    submittedAt: item.submittedAt || item.updatedAt,
    status: item.status,
    nextAction: nextAction(item.status),
    detailsHref: `/apply/${item.contestSlug}?applicationId=${item.id}`,
    editHref: item.status === 'draft' ? `/apply/${item.contestSlug}?applicationId=${item.id}` : undefined,
    source: 'registration',
  }));

  const openMicApplicationRows = openMicApps.map((item): UnifiedApplication => ({
    id: item.id,
    programId: item.contestId,
    programName: item.contestSlug,
    programType: 'Open Mic Application',
    reference: item.id,
    submittedAt: item.appliedAt,
    status: item.applicationStatus,
    nextAction: nextAction(item.applicationStatus),
    detailsHref: `/open-mic/${item.contestSlug}/apply`,
    editHref: undefined,
    source: 'open_mic_application',
  }));

  const openMicSubmissionRows = openMicSubmissions.map((item): UnifiedApplication => ({
    id: item.id,
    programId: item.contestId,
    programName: item.contestSlug,
    programType: 'Open Mic Song Submission',
    reference: item.id,
    submittedAt: item.submittedAt,
    status: item.status,
    nextAction: nextAction(item.status),
    detailsHref: `/dashboard/open-mic/${item.contestSlug}`,
    source: 'open_mic_submission',
  }));

  const stemRows = stemApps.map((item): UnifiedApplication => ({
    id: item.id,
    programId: item.contestId,
    programName: item.contestSlug,
    programType: 'STEM Contest',
    reference: item.reference,
    submittedAt: item.submittedAt,
    status: item.status,
    nextAction: nextAction(item.status),
    detailsHref: `/stem/contests`,
    editHref: item.status === 'draft' ? `/stem/contests` : undefined,
    source: 'stem',
  }));

  return [...registrationRows, ...openMicApplicationRows, ...openMicSubmissionRows, ...stemRows].sort((a, b) =>
    String(b.submittedAt || '').localeCompare(String(a.submittedAt || ''))
  );
}

export function summarizeApplications(applications: UnifiedApplication[]) {
  const byStatus = (needle: string) => applications.filter((item) => item.status.toLowerCase().includes(needle)).length;
  return {
    total: applications.length,
    drafts: byStatus('draft'),
    submitted: byStatus('submitted'),
    shortlisted: byStatus('shortlist'),
    pendingCorrections: applications.filter((item) => /correction|information/i.test(item.status)).length,
    rejected: byStatus('rejected'),
    approved: byStatus('approved'),
  };
}

export function recommendedOpportunities(profile: SpotlightUserProfile, opportunities: SpotlightOpportunity[]) {
  const types = new Set(profile.profileTypes);
  return opportunities.filter((item) => {
    const text = `${item.programType} ${item.title}`.toLowerCase();
    if (types.has('artist') || types.has('general_applicant')) return /music|open mic|artist|talent/.test(text);
    if (types.has('student')) return /stem|school/.test(text);
    if (types.has('sme_founder')) return /sme|pitch|business/.test(text);
    if (types.has('football_talent')) return /football/.test(text);
    if (types.has('actor')) return /acting|film|casting|audition/.test(text);
    return true;
  }).slice(0, 6);
}

export { normalizeStatus };
