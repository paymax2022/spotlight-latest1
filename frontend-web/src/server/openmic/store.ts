import { randomUUID } from 'crypto';
import { defaultPrizePackages, defaultVotingConfig } from '@/src/features/openmic/constants';
import type {
  OpenMicApplication,
  OpenMicApplicationStatus,
  OpenMicBeatConfig,
  OpenMicBeatDownloadLog,
  OpenMicBeatDownloadStatus,
  OpenMicContest,
  OpenMicEntryStatus,
  OpenMicFraudAlert,
  OpenMicNotification,
  OpenMicPaymentEvent,
  OpenMicPaymentStatus,
  OpenMicSubmission,
  OpenMicSubmissionReviewInput,
  OpenMicVoteInput,
} from '@/src/features/openmic/types';

type OpenMicStore = {
  contests: Map<string, OpenMicContest>;
  contestsBySlug: Map<string, string>;
  applications: Map<string, OpenMicApplication>;
  submissions: Map<string, OpenMicSubmission>;
  downloads: OpenMicBeatDownloadLog[];
  payments: OpenMicPaymentEvent[];
  notifications: OpenMicNotification[];
  fraudAlerts: OpenMicFraudAlert[];
};

const store: OpenMicStore = {
  contests: new Map<string, OpenMicContest>(),
  contestsBySlug: new Map<string, string>(),
  applications: new Map<string, OpenMicApplication>(),
  submissions: new Map<string, OpenMicSubmission>(),
  downloads: [],
  payments: [],
  notifications: [],
  fraudAlerts: [],
};

function queueNotification(input: Omit<OpenMicNotification, 'id' | 'createdAt' | 'status'>) {
  const row: OpenMicNotification = {
    id: randomUUID(),
    status: 'queued',
    createdAt: nowIso(),
    ...input,
  };
  store.notifications.unshift(row);
  return row;
}

function logPaymentEvent(input: Omit<OpenMicPaymentEvent, 'id' | 'createdAt'>) {
  const row: OpenMicPaymentEvent = {
    id: randomUUID(),
    createdAt: nowIso(),
    ...input,
  };
  store.payments.unshift(row);
  return row;
}

function parseMs(input?: string | null) {
  if (!input) return Number.NaN;
  const ms = new Date(input).getTime();
  return Number.isFinite(ms) ? ms : Number.NaN;
}

function isWithinWindow(nowMs: number, start?: string, end?: string) {
  const startMs = parseMs(start);
  const endMs = parseMs(end);
  if (!Number.isFinite(startMs) || !Number.isFinite(endMs)) return false;
  return nowMs >= startMs && nowMs <= endMs;
}
function nowIso() {
  return new Date().toISOString();
}

function slugify(input: string) {
  return input
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/(^-|-$)/g, '');
}

function addMonths(year: number, monthOneBased: number, offset: number) {
  const date = new Date(Date.UTC(year, monthOneBased - 1 + offset, 1));
  return { year: date.getUTCFullYear(), month: date.getUTCMonth() + 1 };
}

function monthName(month: number) {
  return new Date(Date.UTC(2026, month - 1, 1)).toLocaleString('en-US', { month: 'long' });
}

function ensureSeeded() {
  // Intentionally no-op: Open Mic data should come from real DB records.
}

export function listContests(input?: { includeNonPublic?: boolean; month?: number; year?: number }) {
  ensureSeeded();
  return [...store.contests.values()]
    .filter((contest) => {
      if (!input?.includeNonPublic && contest.visibility === 'hidden') return false;
      if (typeof input?.month === 'number' && contest.month !== input.month) return false;
      if (typeof input?.year === 'number' && contest.year !== input.year) return false;
      return true;
    })
    .sort((a, b) => (a.year === b.year ? b.month - a.month : b.year - a.year));
}

export function getContestBySlug(slug: string) {
  ensureSeeded();
  const id = store.contestsBySlug.get(slug);
  if (!id) return null;
  return store.contests.get(id) || null;
}

export function getContestById(contestId: string) {
  ensureSeeded();
  return store.contests.get(contestId) || null;
}

export function createContest(input: Partial<OpenMicContest>, actorId?: string) {
  ensureSeeded();
  const now = nowIso();
  const title = String(input.title || '').trim();
  const description = String(input.description || '').trim();
  const month = Number(input.month || 0);
  const year = Number(input.year || 0);
  const slug = slugify(String(input.slug || title || `spotlight-open-mic-${year}-${month}`));

  const errors: Record<string, string> = {};
  if (!title) errors.title = 'Contest title is required.';
  if (!description) errors.description = 'Contest description is required.';
  if (!month || month < 1 || month > 12) errors.month = 'Valid month is required.';
  if (!year || year < 2020) errors.year = 'Valid year is required.';
  if (!slug) errors.slug = 'Contest slug is required.';
  if (store.contestsBySlug.has(slug)) errors.slug = 'Contest slug already exists.';
  if (Object.keys(errors).length > 0) return { success: false as const, errors };

  const contestId = randomUUID();
  const contest: OpenMicContest = {
    id: contestId,
    title,
    slug,
    month,
    year,
    season: input.season || `Season ${year}`,
    description,
    objective: input.objective,
    theme: input.theme,
    hashtag: input.hashtag || '#SpotlightOpenMic',
    status: input.status || 'draft',
    visibility: input.visibility || 'public',
    registrationFeeNgn: input.registrationFeeNgn || 0,
    entryFeeRequired: input.entryFeeRequired === true,
    votingConfig: input.votingConfig || { ...defaultVotingConfig },
    recurrence: input.recurrence || {
      enabled: false,
      repeatMonths: 1,
      autoCreateNext: false,
      autoCopySettings: true,
      autoPublishFuture: false,
      requireNewBeatEveryMonth: true,
    },
    selectionModel: input.selectionModel || 'hybrid',
    finalistsTarget: input.finalistsTarget || 10,
    judgeWeight: input.judgeWeight ?? 30,
    publicVoteWeight: input.publicVoteWeight ?? 70,
    registrationStartAt: input.registrationStartAt,
    registrationEndAt: input.registrationEndAt,
    submissionStartAt: input.submissionStartAt,
    submissionEndAt: input.submissionEndAt,
    reviewEndAt: input.reviewEndAt,
    finale: input.finale || {
      venueName: 'Spotlight Open Mic Lounge',
      venueType: 'lounge',
      address: 'To be announced',
      city: 'Lagos',
      state: 'Lagos',
      playbackMode: 'top_10',
    },
    finalePlaylist: input.finalePlaylist || [],
    finalePlaylistLocked: input.finalePlaylistLocked === true,
    prizes: input.prizes || [...defaultPrizePackages],
    beat: input.beat
      ? {
          ...(input.beat as Partial<OpenMicBeatConfig>),
          id: randomUUID(),
          contestId,
          beatTitle: input.beat.beatTitle || 'Official Beat',
          producerName: input.beat.producerName || 'Spotlight Producer',
          producerCredit: input.beat.producerCredit || input.beat.producerName || 'Spotlight Producer',
          createdAt: now,
          updatedAt: now,
          usageRules:
            input.beat.usageRules ||
            'Beat is provided for Spotlight Open Mic contest participation only.',
          allowDownload: input.beat.allowDownload ?? true,
          previewOnly: input.beat.previewOnly ?? false,
          requiresPaidEntryForDownload: input.beat.requiresPaidEntryForDownload ?? false,
          explicitLyricsAllowed: input.beat.explicitLyricsAllowed ?? false,
          cleanVersionRequired: input.beat.cleanVersionRequired ?? true,
        }
      : undefined,
    createdBy: actorId,
    updatedBy: actorId,
    createdAt: now,
    updatedAt: now,
  };

  store.contests.set(contestId, contest);
  store.contestsBySlug.set(slug, contestId);

  if (contest.recurrence.enabled && contest.recurrence.repeatMonths > 1) {
    generateRecurringContests(contest, actorId);
  }

  return { success: true as const, contest };
}

function generateRecurringContests(baseContest: OpenMicContest, actorId?: string) {
  for (let offset = 1; offset < baseContest.recurrence.repeatMonths; offset += 1) {
    const { year, month } = addMonths(baseContest.year, baseContest.month, offset);
    const label = `${monthName(month)} Edition`;
    const slug = `${slugify(baseContest.slug)}-${year}-${String(month).padStart(2, '0')}`;
    if (store.contestsBySlug.has(slug)) continue;

    const now = nowIso();
    const newContest: OpenMicContest = {
      ...baseContest,
      id: randomUUID(),
      title: `${baseContest.title.split(' - ')[0]} - ${label}`,
      slug,
      month,
      year,
      status: baseContest.recurrence.autoPublishFuture ? 'published' : 'draft',
      beat: baseContest.recurrence.requireNewBeatEveryMonth
        ? undefined
        : baseContest.beat
        ? {
            ...baseContest.beat,
            id: randomUUID(),
            contestId: '',
            createdAt: now,
            updatedAt: now,
          }
        : undefined,
      createdAt: now,
      updatedAt: now,
      createdBy: actorId || baseContest.createdBy,
      updatedBy: actorId || baseContest.updatedBy,
    };
    if (newContest.beat) newContest.beat.contestId = newContest.id;

    store.contests.set(newContest.id, newContest);
    store.contestsBySlug.set(newContest.slug, newContest.id);
  }
}

export function updateContest(contestId: string, patch: Partial<OpenMicContest>, actorId?: string) {
  ensureSeeded();
  const existing = store.contests.get(contestId);
  if (!existing) throw new Error('Contest not found.');
  if (patch.slug && patch.slug !== existing.slug && store.contestsBySlug.has(slugify(patch.slug))) {
    throw new Error('Contest slug already exists.');
  }

  const updated: OpenMicContest = {
    ...existing,
    ...patch,
    slug: patch.slug ? slugify(patch.slug) : existing.slug,
    updatedBy: actorId || existing.updatedBy,
    updatedAt: nowIso(),
  };

  if (updated.slug !== existing.slug) {
    store.contestsBySlug.delete(existing.slug);
    store.contestsBySlug.set(updated.slug, updated.id);
  }

  store.contests.set(contestId, updated);
  return updated;
}

export function upsertBeat(contestId: string, payload: Partial<OpenMicBeatConfig>) {
  ensureSeeded();
  const contest = store.contests.get(contestId);
  if (!contest) throw new Error('Contest not found.');
  const now = nowIso();
  const beat: OpenMicBeatConfig = {
    id: contest.beat?.id || randomUUID(),
    contestId,
    beatTitle: payload.beatTitle || contest.beat?.beatTitle || 'Official Beat',
    producerName: payload.producerName || contest.beat?.producerName || 'Spotlight Producer',
    producerCredit: payload.producerCredit || contest.beat?.producerCredit || 'Spotlight',
    previewUrl: payload.previewUrl || contest.beat?.previewUrl,
    downloadUrl: payload.downloadUrl || contest.beat?.downloadUrl,
    bpm: payload.bpm ?? contest.beat?.bpm,
    musicalKey: payload.musicalKey || contest.beat?.musicalKey,
    genre: payload.genre || contest.beat?.genre,
    mood: payload.mood || contest.beat?.mood,
    durationSeconds: payload.durationSeconds ?? contest.beat?.durationSeconds,
    usageRules: payload.usageRules || contest.beat?.usageRules || 'Contest-only beat usage.',
    allowDownload: payload.allowDownload ?? contest.beat?.allowDownload ?? true,
    previewOnly: payload.previewOnly ?? contest.beat?.previewOnly ?? false,
    requiresPaidEntryForDownload:
      payload.requiresPaidEntryForDownload ?? contest.beat?.requiresPaidEntryForDownload ?? false,
    explicitLyricsAllowed: payload.explicitLyricsAllowed ?? contest.beat?.explicitLyricsAllowed ?? false,
    cleanVersionRequired: payload.cleanVersionRequired ?? contest.beat?.cleanVersionRequired ?? true,
    maxSongDurationSeconds:
      payload.maxSongDurationSeconds ?? contest.beat?.maxSongDurationSeconds ?? 180,
    createdAt: contest.beat?.createdAt || now,
    updatedAt: now,
  };

  contest.beat = beat;
  contest.updatedAt = now;
  store.contests.set(contestId, contest);
  return beat;
}

export function logBeatDownload(input: {
  contestSlug: string;
  userId?: string;
  artistName: string;
  artistEmail?: string;
  termsAccepted: boolean;
  paidAccessConfirmed?: boolean;
}) {
  ensureSeeded();
  const contest = getContestBySlug(input.contestSlug);
  if (!contest) throw new Error('Contest not found.');
  if (!contest.beat) throw new Error('Beat not available.');
  if (!input.termsAccepted) throw new Error('Beat usage agreement must be accepted.');
  const nowMs = Date.now();
  const beatWindowOpen =
    contest.status === 'beat_available' ||
    contest.status === 'submission_open' ||
    contest.status === 'registration_open' ||
    isWithinWindow(nowMs, contest.registrationStartAt, contest.registrationEndAt) ||
    isWithinWindow(nowMs, contest.submissionStartAt, contest.submissionEndAt);
  if (!beatWindowOpen) {
    throw new Error('Beat download window is currently closed.');
  }
  if (contest.beat.allowDownload === false || contest.beat.previewOnly === true) {
    throw new Error('Beat download is locked for this contest.');
  }
  if (contest.beat.requiresPaidEntryForDownload && !input.paidAccessConfirmed) {
    throw new Error('Paid entry is required before beat download.');
  }
  const matchedApplication = findApplicationForContest(contest.id, input.artistEmail, input.artistName);
  if (matchedApplication) {
    if (matchedApplication.applicationStatus !== 'approved') {
      throw new Error('Your application is not yet approved for beat download.');
    }
    if (
      contest.beat.requiresPaidEntryForDownload &&
      !['paid', 'waived'].includes(matchedApplication.paymentStatus)
    ) {
      throw new Error('Entry payment must be completed before beat download.');
    }
  }

  const row: OpenMicBeatDownloadLog = {
    id: randomUUID(),
    beatId: contest.beat.id,
    contestId: contest.id,
    userId: input.userId,
    artistName: input.artistName,
    artistEmail: input.artistEmail,
    termsAccepted: input.termsAccepted,
    paidAccessConfirmed: Boolean(input.paidAccessConfirmed),
    downloadedAt: nowIso(),
  };
  store.downloads.unshift(row);
  if (matchedApplication) {
    reviewApplication(matchedApplication.id, { beatDownloadStatus: 'downloaded' });
  }
  return row;
}

export function listBeatDownloads(contestId?: string) {
  ensureSeeded();
  if (!contestId) return [...store.downloads];
  return store.downloads.filter((row) => row.contestId === contestId);
}

export function createApplication(
  payload: Omit<
    OpenMicApplication,
    | 'id'
    | 'contestId'
    | 'contestSlug'
    | 'applicationStatus'
    | 'paymentStatus'
    | 'beatDownloadStatus'
    | 'appliedAt'
    | 'createdAt'
    | 'updatedAt'
    | 'approvedAt'
    | 'rejectedAt'
    | 'rejectionReason'
  > & {
    contestSlug: string;
    paymentStatus?: OpenMicPaymentStatus;
  }
) {
  ensureSeeded();
  const contest = getContestBySlug(payload.contestSlug);
  if (!contest) return { success: false as const, errors: { contestSlug: 'Contest not found.' } };

  const nowMs = Date.now();
  const withinApplicationWindow =
    contest.status === 'registration_open' ||
    contest.status === 'published' ||
    isWithinWindow(nowMs, contest.registrationStartAt, contest.registrationEndAt);
  if (!withinApplicationWindow) {
    return { success: false as const, errors: { applicationWindow: 'Application is currently closed.' } };
  }

  const normalizedEmail = String(payload.email || '').trim().toLowerCase();
  const normalizedStageName = String(payload.stageName || '').trim().toLowerCase();
  const existing = [...store.applications.values()].find((row) => {
    if (row.contestId !== contest.id) return false;
    if (row.applicationStatus === 'rejected') return false;
    return (
      (normalizedEmail.length > 0 && row.email.trim().toLowerCase() === normalizedEmail) ||
      (normalizedStageName.length > 0 && row.stageName.trim().toLowerCase() === normalizedStageName)
    );
  });
  if (existing) {
    return { success: false as const, errors: { duplicateApplication: 'You already applied for this contest.' } };
  }

  const now = nowIso();
  const paymentStatus: OpenMicPaymentStatus =
    payload.paymentStatus || (contest.entryFeeRequired ? 'pending' : 'not_required');
  const applicationStatus: OpenMicApplicationStatus =
    contest.beat?.requiresPaidEntryForDownload || contest.entryFeeRequired ? 'pending' : 'approved';
  const beatDownloadStatus: OpenMicBeatDownloadStatus =
    applicationStatus === 'approved' ? 'available' : 'not_available';

  const application: OpenMicApplication = {
    id: randomUUID(),
    contestId: contest.id,
    contestSlug: contest.slug,
    userId: payload.userId,
    fullName: payload.fullName,
    stageName: payload.stageName,
    email: payload.email,
    phone: payload.phone,
    gender: payload.gender,
    ageRange: payload.ageRange,
    city: payload.city,
    state: payload.state,
    instagramHandle: payload.instagramHandle,
    tiktokHandle: payload.tiktokHandle,
    musicGenre: payload.musicGenre,
    artistBio: payload.artistBio,
    profilePhotoUrl: payload.profilePhotoUrl,
    applicationStatus,
    paymentStatus,
    beatDownloadStatus,
    hasAgreedToRules: payload.hasAgreedToRules,
    hasAgreedToBeatTerms: payload.hasAgreedToBeatTerms,
    hasAgreedToVotingTerms: payload.hasAgreedToVotingTerms,
    appliedAt: now,
    approvedAt: applicationStatus === 'approved' ? now : undefined,
    createdAt: now,
    updatedAt: now,
  };
  store.applications.set(application.id, application);
  queueNotification({
    contestId: contest.id,
    applicationId: application.id,
    audience: 'artist',
    channel: 'in_app',
    eventKey: 'application_received',
    title: 'Application Received',
    message: `Your application for ${contest.title} has been received.`,
  });
  queueNotification({
    contestId: contest.id,
    applicationId: application.id,
    audience: 'admin',
    channel: 'in_app',
    eventKey: 'new_artist_application',
    title: 'New Open Mic Application',
    message: `${application.stageName} applied for ${contest.title}.`,
  });
  if (contest.entryFeeRequired) {
    logPaymentEvent({
      contestId: contest.id,
      applicationId: application.id,
      eventType: 'entry_fee',
      amountNgn: contest.registrationFeeNgn,
      paymentStatus: application.paymentStatus === 'waived' ? 'waived' : 'pending',
      metadata: { stageName: application.stageName, email: application.email },
    });
  }
  return { success: true as const, application };
}

export function listApplications(input?: {
  contestId?: string;
  applicationStatus?: OpenMicApplicationStatus;
  paymentStatus?: OpenMicPaymentStatus;
}) {
  ensureSeeded();
  return [...store.applications.values()]
    .filter((row) => {
      if (input?.contestId && row.contestId !== input.contestId) return false;
      if (input?.applicationStatus && row.applicationStatus !== input.applicationStatus) return false;
      if (input?.paymentStatus && row.paymentStatus !== input.paymentStatus) return false;
      return true;
    })
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

export function getApplicationById(applicationId: string) {
  ensureSeeded();
  return store.applications.get(applicationId) || null;
}

export function findApplicationForContest(contestId: string, email?: string, stageName?: string) {
  ensureSeeded();
  const normalizedEmail = String(email || '').trim().toLowerCase();
  const normalizedStageName = String(stageName || '').trim().toLowerCase();
  return (
    [...store.applications.values()].find((row) => {
      if (row.contestId !== contestId) return false;
      if (normalizedEmail && row.email.trim().toLowerCase() === normalizedEmail) return true;
      if (normalizedStageName && row.stageName.trim().toLowerCase() === normalizedStageName) return true;
      return false;
    }) || null
  );
}

export function reviewApplication(
  applicationId: string,
  patch: {
    applicationStatus?: OpenMicApplicationStatus;
    paymentStatus?: OpenMicPaymentStatus;
    beatDownloadStatus?: OpenMicBeatDownloadStatus;
    rejectionReason?: string;
  }
) {
  ensureSeeded();
  const current = store.applications.get(applicationId);
  if (!current) throw new Error('Application not found.');
  const now = nowIso();
  const nextStatus = patch.applicationStatus || current.applicationStatus;
  const nextBeatDownloadStatus: OpenMicBeatDownloadStatus =
    patch.beatDownloadStatus ||
    (nextStatus === 'approved' ? 'available' : nextStatus === 'rejected' ? 'not_available' : current.beatDownloadStatus);

  const updated: OpenMicApplication = {
    ...current,
    applicationStatus: nextStatus,
    paymentStatus: patch.paymentStatus || current.paymentStatus,
    beatDownloadStatus: nextBeatDownloadStatus,
    approvedAt: nextStatus === 'approved' ? now : current.approvedAt,
    rejectedAt: nextStatus === 'rejected' ? now : current.rejectedAt,
    rejectionReason: patch.rejectionReason || current.rejectionReason,
    updatedAt: now,
  };
  store.applications.set(applicationId, updated);
  if (nextStatus === 'approved') {
    queueNotification({
      contestId: updated.contestId,
      applicationId: updated.id,
      audience: 'artist',
      channel: 'in_app',
      eventKey: 'application_approved',
      title: 'Application Approved',
      message: `Your application for ${updated.contestSlug} was approved. Beat download is now available.`,
    });
  }
  if (nextStatus === 'rejected') {
    queueNotification({
      contestId: updated.contestId,
      applicationId: updated.id,
      audience: 'artist',
      channel: 'in_app',
      eventKey: 'application_rejected',
      title: 'Application Rejected',
      message: updated.rejectionReason || 'Your application was not approved for this edition.',
    });
  }
  if (patch.paymentStatus && ['paid', 'waived'].includes(patch.paymentStatus)) {
    logPaymentEvent({
      contestId: updated.contestId,
      applicationId: updated.id,
      eventType: 'entry_fee',
      amountNgn: 0,
      paymentStatus: patch.paymentStatus === 'paid' ? 'successful' : 'waived',
      metadata: { stageName: updated.stageName, paymentStatus: patch.paymentStatus },
    });
  }
  return updated;
}

export function createSubmission(
  payload: Omit<
    OpenMicSubmission,
    | 'id'
    | 'contestId'
    | 'contestSlug'
    | 'status'
    | 'voteCount'
    | 'leaderboardScore'
    | 'isFinalist'
    | 'isWinner'
    | 'createdAt'
    | 'updatedAt'
  > & { contestSlug: string }
) {
  ensureSeeded();
  const contest = getContestBySlug(payload.contestSlug);
  if (!contest) {
    return { success: false as const, errors: { contestSlug: 'Contest not found.' } };
  }
  if (!contest.beat) {
    return { success: false as const, errors: { beat: 'Official beat not yet available.' } };
  }
  const linkedApplication = findApplicationForContest(contest.id, payload.email, payload.stageName);
  if (!linkedApplication) {
    return { success: false as const, errors: { application: 'Please apply for this contest before submitting a song.' } };
  }
  if (linkedApplication.applicationStatus !== 'approved') {
    return { success: false as const, errors: { application: 'Your application has not been approved yet.' } };
  }
  if (contest.entryFeeRequired && !['paid', 'waived'].includes(linkedApplication.paymentStatus)) {
    return { success: false as const, errors: { payment: 'Entry fee payment is required before song submission.' } };
  }
  const nowMs = Date.now();
  const withinSubmissionWindow =
    contest.status === 'submission_open' ||
    isWithinWindow(nowMs, contest.submissionStartAt, contest.submissionEndAt);
  if (!withinSubmissionWindow) {
    return {
      success: false as const,
      errors: { submissionWindow: 'Song submission is currently closed for this contest.' },
    };
  }

  const stageNameKey = String(payload.stageName || '').trim().toLowerCase();
  const emailKey = String(payload.email || '').trim().toLowerCase();
  const duplicate = [...store.submissions.values()].find((item) => {
    if (item.contestId !== contest.id) return false;
    if (['rejected', 'disqualified'].includes(item.status)) return false;
    const existingStage = String(item.stageName || '').trim().toLowerCase();
    const existingEmail = String(item.email || '').trim().toLowerCase();
    const sameStage = stageNameKey.length > 0 && existingStage === stageNameKey;
    const sameEmail = emailKey.length > 0 && existingEmail === emailKey;
    return sameStage || sameEmail;
  });
  if (duplicate) {
    return {
      success: false as const,
      errors: { duplicateApplication: 'You already have an active submission for this contest.' },
    };
  }

  if (!payload.officialBeatConfirmed || !payload.ownershipConfirmed || !payload.noUnauthorizedSamplesConfirmed) {
    return {
      success: false as const,
      errors: { declaration: 'Beat usage and rights declarations are required.' },
    };
  }

  const now = nowIso();
  const submission: OpenMicSubmission = {
    id: randomUUID(),
    contestId: contest.id,
    contestSlug: contest.slug,
    artistUserId: payload.artistUserId,
    stageName: payload.stageName,
    realName: payload.realName,
    email: payload.email,
    phone: payload.phone,
    genre: payload.genre,
    songTitle: payload.songTitle,
    songMood: payload.songMood,
    language: payload.language,
    songUrl: payload.songUrl,
    videoUrl: payload.videoUrl,
    lyricsUrl: payload.lyricsUrl,
    artworkUrl: payload.artworkUrl,
    story: payload.story,
    votingSlogan: payload.votingSlogan,
    fanMessage: payload.fanMessage,
    explicitVersion: payload.explicitVersion,
    cleanVersionAvailable: payload.cleanVersionAvailable,
    officialBeatConfirmed: payload.officialBeatConfirmed,
    ownershipConfirmed: payload.ownershipConfirmed,
    noUnauthorizedSamplesConfirmed: payload.noUnauthorizedSamplesConfirmed,
    finaleAvailabilityConfirmed: payload.finaleAvailabilityConfirmed,
    status: 'submitted',
    voteCount: 0,
    leaderboardScore: 0,
    isFinalist: false,
    isWinner: false,
    submittedAt: now,
    createdAt: now,
    updatedAt: now,
  };

  store.submissions.set(submission.id, submission);
  queueNotification({
    contestId: contest.id,
    submissionId: submission.id,
    audience: 'artist',
    channel: 'in_app',
    eventKey: 'song_submitted',
    title: 'Song Submitted',
    message: `Your song "${submission.songTitle}" is now pending admin review.`,
  });
  queueNotification({
    contestId: contest.id,
    submissionId: submission.id,
    audience: 'admin',
    channel: 'in_app',
    eventKey: 'song_awaiting_review',
    title: 'Song Awaiting Review',
    message: `${submission.stageName} submitted "${submission.songTitle}".`,
  });
  return { success: true as const, submission };
}

export function listSubmissions(input?: { contestId?: string; status?: OpenMicEntryStatus }) {
  ensureSeeded();
  return [...store.submissions.values()]
    .filter((item) => {
      if (input?.contestId && item.contestId !== input.contestId) return false;
      if (input?.status && item.status !== input.status) return false;
      return true;
    })
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

export function getSubmissionById(submissionId: string) {
  ensureSeeded();
  return store.submissions.get(submissionId) || null;
}

export function reviewSubmission(submissionId: string, review: OpenMicSubmissionReviewInput) {
  ensureSeeded();
  const current = store.submissions.get(submissionId);
  if (!current) throw new Error('Submission not found.');
  const now = nowIso();
  const updated: OpenMicSubmission = {
    ...current,
    status: review.status,
    reviewNote: review.note,
    approvedAt: review.status === 'approved' ? now : current.approvedAt,
    publishedAt: review.status === 'published_for_voting' ? now : current.publishedAt,
    isFinalist: review.status === 'finalist' ? true : current.isFinalist,
    isWinner: review.status === 'winner' ? true : current.isWinner,
    updatedAt: now,
  };
  store.submissions.set(submissionId, updated);
  if (review.status === 'published_for_voting') {
    queueNotification({
      contestId: updated.contestId,
      submissionId: updated.id,
      audience: 'artist',
      channel: 'in_app',
      eventKey: 'song_approved_for_voting',
      title: 'Song Approved for Voting',
      message: `Your song "${updated.songTitle}" is now live for public voting.`,
    });
  }
  if (review.status === 'rejected' || review.status === 'correction_requested') {
    queueNotification({
      contestId: updated.contestId,
      submissionId: updated.id,
      audience: 'artist',
      channel: 'in_app',
      eventKey: review.status === 'rejected' ? 'song_rejected' : 'song_correction_requested',
      title: review.status === 'rejected' ? 'Song Rejected' : 'Song Correction Required',
      message: review.note || 'Please review admin feedback on your submission.',
    });
  }
  return updated;
}

export function castVote(input: OpenMicVoteInput) {
  ensureSeeded();
  const submission = store.submissions.get(input.submissionId);
  if (!submission || submission.contestId !== input.contestId) {
    throw new Error('Submission not found for this contest.');
  }
  if (submission.status !== 'published_for_voting' && submission.status !== 'finalist') {
    throw new Error('Submission is not open for voting.');
  }
  if (input.votes <= 0) throw new Error('Vote count must be greater than zero.');

  const contest = store.contests.get(input.contestId);
  if (!contest) throw new Error('Contest not found.');
  if (!contest.votingConfig.enabled) throw new Error('Voting is disabled for this contest.');
  if (input.source === 'paid' && !contest.votingConfig.paidVoting) {
    throw new Error('Paid voting is disabled for this contest.');
  }
  if (input.source === 'free' && !contest.votingConfig.freeVoting) {
    throw new Error('Free voting is disabled for this contest.');
  }
  const nowMs = Date.now();
  const withinVotingWindow =
    contest.status === 'voting_live' ||
    isWithinWindow(nowMs, contest.votingConfig.votingStartAt, contest.votingConfig.votingEndAt);
  if (!withinVotingWindow) {
    throw new Error('Voting is currently closed.');
  }
  if (contest.votingConfig.minVotePurchase && input.votes < contest.votingConfig.minVotePurchase) {
    throw new Error(`Minimum vote quantity is ${contest.votingConfig.minVotePurchase}.`);
  }
  if (contest.votingConfig.maxVotePurchase && input.votes > contest.votingConfig.maxVotePurchase) {
    throw new Error(`Maximum vote quantity per transaction is ${contest.votingConfig.maxVotePurchase}.`);
  }

  const nextVotes = submission.voteCount + input.votes;
  const weightedScore = nextVotes * (contest.publicVoteWeight / 100);
  const updated: OpenMicSubmission = {
    ...submission,
    voteCount: nextVotes,
    leaderboardScore: Number(weightedScore.toFixed(2)),
    updatedAt: nowIso(),
  };
  store.submissions.set(updated.id, updated);
  if (input.source === 'paid') {
    logPaymentEvent({
      contestId: input.contestId,
      submissionId: input.submissionId,
      eventType: 'vote_payment',
      amountNgn: (contest.votingConfig.votePrice || 0) * input.votes,
      paymentStatus: 'successful',
      paymentReference: input.paymentReference,
      metadata: { voterName: input.voterName, votes: input.votes },
    });
  }
  const suspiciousThreshold = contest.votingConfig.suspiciousVoteThreshold ?? 100;
  const suspiciousHighThreshold = contest.votingConfig.suspiciousVoteHighThreshold ?? 300;
  if (input.votes >= suspiciousThreshold) {
    const alert: OpenMicFraudAlert = {
      id: randomUUID(),
      contestId: input.contestId,
      submissionId: input.submissionId,
      severity: input.votes >= suspiciousHighThreshold ? 'high' : 'medium',
      reason: 'Large vote quantity in single transaction',
      votesInEvent: input.votes,
      status: 'open',
      createdAt: nowIso(),
    };
    store.fraudAlerts.unshift(alert);
    queueNotification({
      contestId: input.contestId,
      submissionId: input.submissionId,
      audience: 'admin',
      channel: 'in_app',
      eventKey: 'voting_spike_alert',
      title: 'Voting Spike Alert',
      message: `${input.votes} votes were cast in one transaction for ${submission.stageName}.`,
    });
  }
  return updated;
}

export function getLeaderboard(contestId: string) {
  ensureSeeded();
  return listSubmissions({ contestId })
    .filter((item) => item.status === 'published_for_voting' || item.status === 'finalist' || item.status === 'winner')
    .sort((a, b) => {
      if (b.leaderboardScore === a.leaderboardScore) return b.voteCount - a.voteCount;
      return b.leaderboardScore - a.leaderboardScore;
    });
}

export function generateFinalists(contestId: string) {
  ensureSeeded();
  const contest = store.contests.get(contestId);
  if (!contest) throw new Error('Contest not found.');
  const nowMs = Date.now();
  const votingEndMs = parseMs(contest.votingConfig.votingEndAt);
  if (contest.status !== 'voting_closed' && Number.isFinite(votingEndMs) && nowMs <= votingEndMs) {
    throw new Error('Voting must close before selecting finalists.');
  }
  const ranked = getLeaderboard(contestId);
  const finalists = ranked.slice(0, contest.finalistsTarget);
  finalists.forEach((item) => {
    store.submissions.set(item.id, {
      ...item,
      status: 'finalist',
      isFinalist: true,
      updatedAt: nowIso(),
    });
  });
  contest.status = 'finalists_selected';
  contest.updatedAt = nowIso();
  store.contests.set(contestId, contest);
  finalists.forEach((item) => {
    queueNotification({
      contestId,
      submissionId: item.id,
      audience: 'artist',
      channel: 'in_app',
      eventKey: 'finalist_selected',
      title: 'Finalist Selected',
      message: `Congratulations ${item.stageName}, you qualified for the monthly finale.`,
    });
  });
  return finalists;
}

export function buildFinalePlaylistFromFinalists(contestId: string) {
  ensureSeeded();
  const contest = store.contests.get(contestId);
  if (!contest) throw new Error('Contest not found.');
  const finalists = getLeaderboard(contestId)
    .filter((item) => item.isFinalist || item.status === 'finalist' || item.status === 'winner')
    .slice(0, contest.finalistsTarget);
  const playlist = finalists.map((item, idx) => ({
    order: idx + 1,
    submissionId: item.id,
    stageName: item.stageName,
    songTitle: item.songTitle,
    status: item.status,
  }));
  contest.finalePlaylist = playlist;
  contest.updatedAt = nowIso();
  store.contests.set(contestId, contest);
  return playlist;
}

export function saveFinalePlaylist(
  contestId: string,
  entries: Array<{ submissionId: string; order?: number }>
) {
  ensureSeeded();
  const contest = store.contests.get(contestId);
  if (!contest) throw new Error('Contest not found.');
  if (contest.finalePlaylistLocked) {
    throw new Error('Finale playlist is locked. Unlock before editing order.');
  }
  const playlist = entries
    .map((entry, idx) => {
      const submission = store.submissions.get(entry.submissionId);
      if (!submission || submission.contestId !== contestId) return null;
      return {
        order: entry.order ?? idx + 1,
        submissionId: submission.id,
        stageName: submission.stageName,
        songTitle: submission.songTitle,
        status: submission.status,
      };
    })
    .filter(Boolean)
    .sort((a, b) => (a!.order === b!.order ? a!.songTitle.localeCompare(b!.songTitle) : a!.order - b!.order)) as OpenMicContest['finalePlaylist'];

  contest.finalePlaylist = playlist;
  contest.updatedAt = nowIso();
  store.contests.set(contestId, contest);
  return playlist;
}

export function getFinalePlaylist(contestId: string) {
  ensureSeeded();
  const contest = store.contests.get(contestId);
  if (!contest) throw new Error('Contest not found.');
  return contest.finalePlaylist || [];
}

export function setFinalePlaylistLocked(contestId: string, locked: boolean) {
  ensureSeeded();
  const contest = store.contests.get(contestId);
  if (!contest) throw new Error('Contest not found.');
  contest.finalePlaylistLocked = locked;
  contest.updatedAt = nowIso();
  store.contests.set(contestId, contest);
  return contest;
}

export function updateFinalePlaybackItem(
  contestId: string,
  submissionId: string,
  patch: {
    played?: boolean;
    djCueNote?: string;
    judgeScore?: number;
    audienceReactionScore?: number;
  }
) {
  ensureSeeded();
  const contest = store.contests.get(contestId);
  if (!contest) throw new Error('Contest not found.');

  const idx = contest.finalePlaylist.findIndex((item) => item.submissionId === submissionId);
  if (idx < 0) throw new Error('Playlist item not found.');

  const existing = contest.finalePlaylist[idx];
  const next = {
    ...existing,
    djCueNote: patch.djCueNote ?? existing.djCueNote,
    judgeScore: typeof patch.judgeScore === 'number' ? patch.judgeScore : existing.judgeScore,
    audienceReactionScore:
      typeof patch.audienceReactionScore === 'number'
        ? patch.audienceReactionScore
        : existing.audienceReactionScore,
    played: typeof patch.played === 'boolean' ? patch.played : existing.played,
    playedAt:
      typeof patch.played === 'boolean'
        ? patch.played
          ? nowIso()
          : undefined
        : existing.playedAt,
  };
  contest.finalePlaylist[idx] = next;
  contest.updatedAt = nowIso();
  store.contests.set(contestId, contest);
  return next;
}

export function announceWinner(contestId: string, submissionId: string) {
  ensureSeeded();
  const contest = store.contests.get(contestId);
  const submission = store.submissions.get(submissionId);
  if (!contest) throw new Error('Contest not found.');
  if (!submission || submission.contestId !== contestId) throw new Error('Submission not found for contest.');
  if (!(submission.isFinalist || submission.status === 'finalist')) {
    throw new Error('Only finalists can be announced as winners.');
  }
  if (!['finalists_selected', 'grand_finale_scheduled', 'grand_finale_live', 'winner_announced'].includes(contest.status)) {
    throw new Error('Contest is not in winner-announcement stage.');
  }

  const updated = {
    ...submission,
    status: 'winner' as const,
    isWinner: true,
    isFinalist: true,
    updatedAt: nowIso(),
  };
  store.submissions.set(updated.id, updated);

  contest.status = 'winner_announced';
  contest.updatedAt = nowIso();
  store.contests.set(contest.id, contest);
  queueNotification({
    contestId,
    submissionId: updated.id,
    audience: 'artist',
    channel: 'in_app',
    eventKey: 'winner_announced',
    title: 'Winner Announcement',
    message: `Congratulations ${updated.stageName}, you are this month’s Open Mic winner.`,
  });

  return updated;
}

export function listPaymentEvents(contestId?: string) {
  ensureSeeded();
  if (!contestId) return [...store.payments];
  return store.payments.filter((row) => row.contestId === contestId);
}

export function listNotifications(contestId?: string) {
  ensureSeeded();
  if (!contestId) return [...store.notifications];
  return store.notifications.filter((row) => row.contestId === contestId);
}

export function listFraudAlerts(contestId?: string) {
  ensureSeeded();
  if (!contestId) return [...store.fraudAlerts];
  return store.fraudAlerts.filter((row) => row.contestId === contestId);
}

export function markNotificationSent(notificationId: string) {
  ensureSeeded();
  const row = store.notifications.find((item) => item.id === notificationId);
  if (!row) throw new Error('Notification not found.');
  row.status = 'sent';
  row.sentAt = nowIso();
  return row;
}

export function resolveFraudAlert(alertId: string, resolutionNote?: string) {
  ensureSeeded();
  const row = store.fraudAlerts.find((item) => item.id === alertId);
  if (!row) throw new Error('Fraud alert not found.');
  row.status = 'resolved';
  row.resolvedAt = nowIso();
  row.resolutionNote = resolutionNote || row.resolutionNote;
  return row;
}

export function updatePaymentEventStatus(
  paymentEventId: string,
  nextStatus: OpenMicPaymentEvent['paymentStatus']
) {
  ensureSeeded();
  const row = store.payments.find((item) => item.id === paymentEventId);
  if (!row) throw new Error('Payment event not found.');
  row.paymentStatus = nextStatus;
  return row;
}
