import { createAdminClient, createClient } from '@/lib/supabase/server';
import { hasUsableSupabaseConfig, hasUsableSupabaseReadConfig } from '@/lib/supabase/runtime';
import { OPEN_MIC_CONTEST_TYPE } from '@/src/features/openmic/constants';
import { buildSongObjectKey, songContestRef, songReaderUrl } from '@/src/features/openmic/song-storage';
import { getSongSubmissionEligibility } from './submission-eligibility';
import { projectReview } from './review-rules';
import { isOpenMicContestRow } from './edition-identity';
import { randomUUID } from 'node:crypto';
import { recordVoteFraudSignals, recordVoteAudit } from '@/src/server/voting/core';
import type {
  OpenMicApplication,
  OpenMicApplicationStatus,
  OpenMicBeatDownloadLog,
  OpenMicBeatDownloadStatus,
  OpenMicContest,
  OpenMicFraudAlert,
  OpenMicNotification,
  OpenMicPaymentEvent,
  OpenMicPaymentStatus,
  OpenMicSubmission,
  OpenMicSubmissionReviewInput,
  OpenMicVoteInput,
} from '@/src/features/openmic/types';
import {
  announceWinner as announceWinnerMemory,
  buildFinalePlaylistFromFinalists as buildFinalePlaylistFromFinalistsMemory,
  castVote as castVoteMemory,
  createApplication as createApplicationMemory,
  createContest as createContestMemory,
  createSubmission as createSubmissionMemory,
  findApplicationForContest as findApplicationForContestMemory,
  generateFinalists as generateFinalistsMemory,
  getApplicationById as getApplicationByIdMemory,
  getContestById as getContestByIdMemory,
  getContestBySlug as getContestBySlugMemory,
  getFinalePlaylist as getFinalePlaylistMemory,
  getLeaderboard as getLeaderboardMemory,
  getSubmissionById as getSubmissionByIdMemory,
  listApplications as listApplicationsMemory,
  listBeatDownloads as listBeatDownloadsMemory,
  listContests as listContestsMemory,
  listFraudAlerts as listFraudAlertsMemory,
  listNotifications as listNotificationsMemory,
  listPaymentEvents as listPaymentEventsMemory,
  listSubmissions as listSubmissionsMemory,
  logBeatDownload as logBeatDownloadMemory,
  reviewApplication as reviewApplicationMemory,
  reviewSubmission as reviewSubmissionMemory,
  saveFinalePlaylist as saveFinalePlaylistMemory,
  setFinalePlaylistLocked as setFinalePlaylistLockedMemory,
  updateFinalePlaybackItem as updateFinalePlaybackItemMemory,
  updateContest as updateContestMemory,
  upsertBeat as upsertBeatMemory,
} from './store';

function shouldUseDb() {
  return hasUsableSupabaseConfig();
}

function shouldFallback(error: unknown) {
  // Open Mic now runs in DB-only mode; do not fall back to in-memory store.
  return false;
}

function safeArray<T>(value: unknown): T[] {
  return Array.isArray(value) ? (value as T[]) : [];
}

function sanitizeJson<T>(value: T): T {
  try {
    return JSON.parse(JSON.stringify(value)) as T;
  } catch {
    return value;
  }
}

function isWithinWindow(nowMs: number, start?: string, end?: string) {
  const startMs = start ? Date.parse(start) : Number.NaN;
  const endMs = end ? Date.parse(end) : Number.NaN;
  const afterStart = Number.isNaN(startMs) ? true : nowMs >= startMs;
  const beforeEnd = Number.isNaN(endMs) ? true : nowMs <= endMs;
  return afterStart && beforeEnd;
}

async function resolveApplicantUserId(
  supabase: ReturnType<typeof createAdminClient>,
  email: string,
  fullName: string
) {
  const normalizedEmail = String(email || '').trim().toLowerCase();
  if (!normalizedEmail) return undefined;

  const existing = await supabase
    .from('user_profiles')
    .select('id')
    .ilike('email', normalizedEmail)
    .limit(1)
    .maybeSingle();
  if (existing.error) throw existing.error;
  if (existing.data?.id) return existing.data.id as string;

  const password = `${randomUUID()}Aa!1`;
  const created = await supabase.auth.admin.createUser({
    email: normalizedEmail,
    password,
    email_confirm: true,
    user_metadata: { full_name: fullName || normalizedEmail },
  });
  if (created.error) {
    const retry = await supabase
      .from('user_profiles')
      .select('id')
      .ilike('email', normalizedEmail)
      .limit(1)
      .maybeSingle();
    if (retry.error) throw retry.error;
    if (retry.data?.id) return retry.data.id as string;
    throw new Error(created.error.message || 'Failed to create applicant account');
  }

  const createdId = created.data?.user?.id;
  if (!createdId) throw new Error('Failed to resolve applicant user id.');
  return createdId;
}

function mapContestRow(row: any): OpenMicContest {
  const assets = (row.sponsor_assets || {}) as Record<string, any>;
  const recurrence = (assets.recurrence || {}) as Record<string, any>;
  const finale = (assets.finale || {}) as Record<string, any>;
  const voting = (assets.voting || {}) as Record<string, any>;
  // The edition's live beat, not whichever row the join happened to return first:
  // `competition_beats` keeps retired rows for the audit trail and the embed has no
  // ordering guarantee, so `[0]` could point an applicant at last month's file.
  const beatRows = safeArray<any>(row.competition_beats).filter(Boolean);
  const beat =
    beatRows.find((item) => item.is_active === true) ||
    beatRows.slice().sort((a, b) => String(b.created_at || '').localeCompare(String(a.created_at || '')))[0];

  return {
    id: row.id,
    title: row.name,
    slug: row.slug,
    month: Number(assets.month || new Date().getMonth() + 1),
    year: Number(assets.year || new Date().getFullYear()),
    season: String(assets.season || 'Season'),
    description: row.description || '',
    bannerImageUrl: String(row.banner_image_url || ''),
    objective: assets.objective || undefined,
    theme: assets.theme || undefined,
    hashtag: assets.hashtag || undefined,
    status: String(assets.status || row.status || 'draft').toLowerCase() as OpenMicContest['status'],
    visibility: String(row.visibility || 'public').toLowerCase() as OpenMicContest['visibility'],
    registrationFeeNgn: Number(row.entry_fee_ngn || 0),
    entryFeeRequired: Number(row.entry_fee_ngn || 0) > 0,
    votingConfig: {
      enabled: voting.enabled !== false,
      freeVoting: voting.freeVoting !== false,
      freeVotesPerDay: Number(voting.freeVotesPerDay ?? 3),
      paidVoting: voting.paidVoting !== false,
      votePrice: Number(row.vote_price_ngn || voting.votePrice || 0),
      voteBundlePrice: voting.voteBundlePrice ?? undefined,
      voteBundleCount: voting.voteBundleCount ?? undefined,
      leaderboardVisible: voting.leaderboardVisible !== false,
      voteCountPublic: voting.voteCountPublic !== false,
      minVotePurchase: voting.minVotePurchase ?? undefined,
      maxVotePurchase: voting.maxVotePurchase ?? undefined,
      suspiciousVoteThreshold: voting.suspiciousVoteThreshold ?? undefined,
      suspiciousVoteHighThreshold: voting.suspiciousVoteHighThreshold ?? undefined,
      votingStartAt: voting.votingStartAt || undefined,
      votingEndAt: voting.votingEndAt || undefined,
    },
    recurrence: {
      enabled: recurrence.enabled === true,
      repeatMonths: Number(recurrence.repeatMonths || 1),
      autoCreateNext: recurrence.autoCreateNext === true,
      autoCopySettings: recurrence.autoCopySettings !== false,
      autoPublishFuture: recurrence.autoPublishFuture === true,
      requireNewBeatEveryMonth: recurrence.requireNewBeatEveryMonth !== false,
    },
    selectionModel: String(assets.selectionModel || 'hybrid') as OpenMicContest['selectionModel'],
    finalistsTarget: Number(assets.finalistsTarget || row.shortlisting_limit || 10),
    judgeWeight: Number(row.judge_weight || 30),
    publicVoteWeight: Number(row.public_vote_weight || 70),
    registrationStartAt: row.start_date || undefined,
    registrationEndAt: row.end_date || undefined,
    submissionStartAt: assets.submissionStartAt || undefined,
    submissionEndAt: assets.submissionEndAt || undefined,
    reviewEndAt: assets.reviewEndAt || undefined,
    finale: {
      venueName: finale.venueName || 'Spotlight Lounge',
      venueType: finale.venueType || 'lounge',
      address: finale.address || '',
      city: finale.city || '',
      state: finale.state || '',
      date: finale.date || undefined,
      artistArrivalTime: finale.artistArrivalTime || undefined,
      doorsOpenTime: finale.doorsOpenTime || undefined,
      showStartTime: finale.showStartTime || undefined,
      winnerAnnouncementTime: finale.winnerAnnouncementTime || undefined,
      playbackMode: finale.playbackMode || 'top_10',
    },
    finalePlaylist: safeArray<any>(assets.finalePlaylist).map((row, idx) => ({
      order: Number(row.order || idx + 1),
      submissionId: String(row.submissionId || ''),
      stageName: String(row.stageName || ''),
      songTitle: String(row.songTitle || ''),
      status: String(row.status || 'approved') as any,
      durationSeconds: row.durationSeconds ?? undefined,
      djCueNote: row.djCueNote ?? undefined,
      played: row.played === true,
      playedAt: row.playedAt ?? undefined,
      judgeScore: row.judgeScore ?? undefined,
      audienceReactionScore: row.audienceReactionScore ?? undefined,
    })),
    finalePlaylistLocked: assets.finalePlaylistLocked === true,
    prizes: safeArray<any>(row.prize_structure).map((prize) => ({
      id: String(prize.id || prize.title || Math.random()),
      title: String(prize.title || 'Prize'),
      description: String(prize.description || ''),
      prizeType: String(prize.prizeType || 'monthly_winner'),
      cashValueNgn: prize.cashValueNgn ?? undefined,
      nonCashValue: prize.nonCashValue ?? undefined,
      sponsor: prize.sponsor ?? undefined,
      numberOfWinners: Number(prize.numberOfWinners || 1),
    })),
    beat: beat
      ? {
          id: beat.id,
          contestId: row.id,
          beatTitle: beat.title || 'Official Beat',
          producerName: beat.producer_credit || '',
          producerCredit: beat.producer_credit || '',
          previewUrl: beat.preview_url || undefined,
          downloadUrl: beat.download_url || undefined,
          genre: beat.genre || undefined,
          usageRules: beat.rules_text || '',
          allowDownload: beat.is_active === true,
          previewOnly: false,
          requiresPaidEntryForDownload: beat.requires_enrollment === true,
          explicitLyricsAllowed: true,
          cleanVersionRequired: false,
          createdAt: beat.created_at,
          updatedAt: beat.updated_at,
        }
      : undefined,
    createdBy: row.created_by || undefined,
    updatedBy: row.created_by || undefined,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function mapSubmissionRow(row: any): OpenMicSubmission {
  const meta = (row.lyrical_concept_summary ? JSON.parse(row.lyrical_concept_summary) : {}) as Record<string, any>;
  return {
    id: row.id,
    contestId: row.competition_id,
    contestSlug: meta.contestSlug || '',
    artistUserId: row.user_id || undefined,
    stageName: meta.stageName || '',
    realName: meta.realName || undefined,
    email: meta.email || undefined,
    phone: meta.phone || undefined,
    country: meta.country || undefined,
    state: meta.state || undefined,
    lga: meta.lga || undefined,
    instagramHandle: meta.instagramHandle || undefined,
    tiktokHandle: meta.tiktokHandle || undefined,
    youtubeHandle: meta.youtubeHandle || undefined,
    facebookHandle: meta.facebookHandle || undefined,
    xHandle: meta.xHandle || undefined,
    genre: row.category || '',
    songTitle: row.entry_title || '',
    songMood: meta.songMood || undefined,
    language: meta.language || undefined,
    songUrl: (meta.songObjectKey || meta.r2ObjectKey)
      ? `/api/open-mic/songs/${row.id}`
      : (meta.songUrl || ''),
    songObjectKey: meta.songObjectKey || meta.r2ObjectKey || undefined,
    songFileName: meta.songFileName || undefined,
    videoUrl: row.video_link || undefined,
    lyricsUrl: meta.lyricsUrl || undefined,
    artworkUrl: meta.artworkUrl || undefined,
    story: row.entry_description || undefined,
    votingSlogan: meta.votingSlogan || undefined,
    fanMessage: meta.fanMessage || undefined,
    explicitVersion: row.explicit_content_declared === true,
    cleanVersionAvailable: meta.cleanVersionAvailable === true,
    officialBeatConfirmed: meta.officialBeatConfirmed === true,
    ownershipConfirmed: row.originality_confirmed === true,
    noUnauthorizedSamplesConfirmed: meta.noUnauthorizedSamplesConfirmed === true,
    finaleAvailabilityConfirmed: meta.finaleAvailabilityConfirmed === true,
    status: String(row.status || 'draft').toLowerCase() as OpenMicSubmission['status'],
    reviewNote: row.moderation_feedback || undefined,
    voteCount: Number(row.public_vote_count || 0),
    leaderboardScore: Number(row.leaderboard_score || 0),
    isFinalist: String(row.status || '').toLowerCase() === 'finalist' || String(row.status || '').toLowerCase() === 'winner',
    isWinner: String(row.status || '').toLowerCase() === 'winner',
    submittedAt: row.submitted_at || undefined,
    approvedAt: row.reviewed_at || undefined,
    publishedAt: row.live_at || undefined,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function mapApplicationRow(row: any): OpenMicApplication {
  const meta = ((row.application_data && typeof row.application_data === 'object'
    ? row.application_data
    : row.metadata && typeof row.metadata === 'object'
      ? row.metadata
      : {}) || {}) as Record<string, any>;
  const applicationStatus = String(row.status || meta.applicationStatus || 'pending').toLowerCase() as OpenMicApplicationStatus;
  const paymentStatus = String(meta.paymentStatus || (row.payment_status || 'pending')).toLowerCase() as OpenMicPaymentStatus;
  const beatDownloadStatus = String(meta.beatDownloadStatus || 'not_available').toLowerCase() as OpenMicBeatDownloadStatus;
  const createdAt = row.created_at || row.applied_at || row.enrolled_at || meta.appliedAt || meta.createdAt || new Date(0).toISOString();
  const updatedAt = row.updated_at || meta.updatedAt || createdAt;
  return {
    id: row.id,
    contestId: row.competition_id,
    contestSlug: String(meta.contestSlug || ''),
    userId: row.user_id || undefined,
    fullName: String(meta.fullName || ''),
    stageName: String(meta.stageName || ''),
    email: String(meta.email || ''),
    phone: String(meta.phone || ''),
    gender: String(meta.gender || 'prefer_not_to_say') as OpenMicApplication['gender'],
    ageRange: String(meta.ageRange || '18_24') as OpenMicApplication['ageRange'],
    country: String(meta.country || 'Nigeria'),
    city: String(meta.city || ''),
    state: String(meta.state || ''),
    lga: String(meta.lga || ''),
    instagramHandle: meta.instagramHandle || undefined,
    tiktokHandle: meta.tiktokHandle || undefined,
    youtubeHandle: meta.youtubeHandle || undefined,
    facebookHandle: meta.facebookHandle || undefined,
    xHandle: meta.xHandle || undefined,
    musicGenre: String(meta.musicGenre || ''),
    artistBio: meta.artistBio || undefined,
    profilePhotoUrl: meta.profilePhotoUrl || undefined,
    applicationStatus,
    paymentStatus,
    beatDownloadStatus,
    hasAgreedToRules: meta.hasAgreedToRules === true,
    hasAgreedToBeatTerms: meta.hasAgreedToBeatTerms === true,
    hasAgreedToVotingTerms: meta.hasAgreedToVotingTerms === true,
    appliedAt: createdAt,
    approvedAt: meta.approvedAt || undefined,
    rejectedAt: meta.rejectedAt || undefined,
    rejectionReason: meta.rejectionReason || undefined,
    createdAt,
    updatedAt,
  };
}

export async function listContests(input?: { includeNonPublic?: boolean; month?: number; year?: number }) {
  if (!hasUsableSupabaseReadConfig()) return [];
  try {
    const supabase = await createClient();
    const { data, error } = await supabase
      .from('contests')
      .select('*, competition_beats(*)')
      .order('created_at', { ascending: false });
    if (error) throw error;
    // Membership in the Open Mic plane is decided by `isOpenMicContestRow`, not by
    // a `contest_type` eq: an edition published from the registration plane is
    // typed `public_voting_contest`, and the old hard filter hid it from every
    // Open Mic screen — beat, application, song upload — while the admin contest
    // list and the mobile Connect API both showed it live. `contests` holds a few
    // dozen rows, so narrowing here instead of in SQL costs nothing measurable and
    // keeps exactly one definition of "which row is Open Mic".
    return safeArray<any>(data)
      .filter(isOpenMicContestRow)
      .map(mapContestRow)
      .filter((contest) => {
      if (!input?.includeNonPublic && contest.visibility === 'hidden') return false;
      if (typeof input?.month === 'number' && contest.month !== input.month) return false;
      if (typeof input?.year === 'number' && contest.year !== input.year) return false;
      return true;
    });
  } catch (error) {
    throw error;
  }
}

function mapPaymentEventRow(row: any): OpenMicPaymentEvent {
  return {
    id: row.id,
    contestId: row.contest_id,
    applicationId: row.application_id || undefined,
    submissionId: row.submission_id || undefined,
    eventType: row.event_type as OpenMicPaymentEvent['eventType'],
    amountNgn: Number(row.amount_ngn || 0),
    paymentStatus: row.payment_status as OpenMicPaymentEvent['paymentStatus'],
    paymentReference: row.payment_reference || undefined,
    provider: row.provider || undefined,
    metadata: row.metadata || {},
    createdAt: row.created_at,
  };
}

export async function listPaymentEvents(contestId?: string): Promise<OpenMicPaymentEvent[]> {
  if (!shouldUseDb()) return [];
  try {
    const supabase = createAdminClient();
    let query = supabase.from('open_mic_payment_events').select('*').order('created_at', { ascending: false });
    if (contestId) query = query.eq('contest_id', contestId);
    const { data, error } = await query;
    if (error) throw error;
    return safeArray<any>(data).map(mapPaymentEventRow);
  } catch (error) {
    if (!shouldFallback(error)) throw error;
    return listPaymentEventsMemory(contestId);
  }
}

function mapNotificationRow(row: any): OpenMicNotification {
  return {
    id: row.id,
    contestId: row.contest_id || undefined,
    applicationId: row.application_id || undefined,
    submissionId: row.submission_id || undefined,
    audience: row.audience as OpenMicNotification['audience'],
    channel: row.channel as OpenMicNotification['channel'],
    eventKey: row.event_key || '',
    title: row.title || '',
    message: row.message || '',
    status: row.status as OpenMicNotification['status'],
    sentAt: row.sent_at || undefined,
    createdAt: row.created_at,
  };
}

export async function listNotifications(contestId?: string): Promise<OpenMicNotification[]> {
  if (!shouldUseDb()) return [];
  try {
    const supabase = createAdminClient();
    let query = supabase.from('open_mic_notifications').select('*').order('created_at', { ascending: false });
    if (contestId) query = query.eq('contest_id', contestId);
    const { data, error } = await query;
    if (error) throw error;
    return safeArray<any>(data).map(mapNotificationRow);
  } catch (error) {
    if (!shouldFallback(error)) throw error;
    return listNotificationsMemory(contestId);
  }
}

function mapFraudAlertRow(row: any): OpenMicFraudAlert {
  return {
    id: row.id,
    contestId: row.contest_id,
    submissionId: row.submission_id,
    severity: row.severity as OpenMicFraudAlert['severity'],
    reason: row.reason || '',
    votesInEvent: Number(row.votes_in_event || 0),
    status: row.status as OpenMicFraudAlert['status'],
    resolvedAt: row.resolved_at || undefined,
    resolutionNote: row.resolution_note || undefined,
    createdAt: row.created_at,
  };
}

export async function listFraudAlerts(contestId?: string): Promise<OpenMicFraudAlert[]> {
  if (!shouldUseDb()) return [];
  try {
    const supabase = createAdminClient();
    let query = supabase.from('open_mic_fraud_alerts').select('*').order('created_at', { ascending: false });
    if (contestId) query = query.eq('contest_id', contestId);
    const { data, error } = await query;
    if (error) throw error;
    return safeArray<any>(data).map(mapFraudAlertRow);
  } catch (error) {
    if (!shouldFallback(error)) throw error;
    return listFraudAlertsMemory(contestId);
  }
}

/**
 * Record a payment event (entry fee, vote payment, refund). Called by
 * `reviewApplication` when an application reaches `paid`/`waived` (an `entry_fee`
 * row) and by `castVote` for a paid vote (a `vote_payment` row sized from the
 * contest's own vote price) — which is what the console's Payments tab lists.
 */
export async function createPaymentEvent(input: {
  contestId: string;
  applicationId?: string;
  submissionId?: string;
  eventType: OpenMicPaymentEvent['eventType'];
  amountNgn: number;
  paymentStatus?: OpenMicPaymentEvent['paymentStatus'];
  paymentReference?: string;
  provider?: string;
  metadata?: Record<string, unknown>;
}): Promise<OpenMicPaymentEvent> {
  const supabase = createAdminClient();
  const { data, error } = await supabase
    .from('open_mic_payment_events')
    .insert({
      contest_id: input.contestId,
      application_id: input.applicationId || null,
      submission_id: input.submissionId || null,
      event_type: input.eventType,
      amount_ngn: Math.max(0, Math.round(input.amountNgn)),
      payment_status: input.paymentStatus || 'pending',
      payment_reference: input.paymentReference || null,
      provider: input.provider || null,
      metadata: input.metadata || {},
    })
    .select('*')
    .single();
  if (error) throw error;
  return mapPaymentEventRow(data);
}

/**
 * Record a notification. Called by the three places an artist is owed one:
 * `createApplication` (receipt), `reviewApplication` (approved/rejected) and
 * `reviewSubmission` (the review note, best-effort so a notice that cannot be
 * queued never turns a landed decision into a 500).
 */
export async function createNotification(input: {
  contestId?: string;
  applicationId?: string;
  submissionId?: string;
  audience: OpenMicNotification['audience'];
  channel: OpenMicNotification['channel'];
  eventKey: string;
  title: string;
  message: string;
}): Promise<OpenMicNotification> {
  const supabase = createAdminClient();
  const { data, error } = await supabase
    .from('open_mic_notifications')
    .insert({
      contest_id: input.contestId || null,
      application_id: input.applicationId || null,
      submission_id: input.submissionId || null,
      audience: input.audience,
      channel: input.channel,
      event_key: input.eventKey,
      title: input.title,
      message: input.message,
    })
    .select('*')
    .single();
  if (error) throw error;
  return mapNotificationRow(data);
}

/**
 * Record a fraud alert. Called by `castVote` when one transaction reaches the
 * contest's `suspiciousVoteThreshold`, which is what feeds the console's Fraud
 * Alerts tab.
 */
export async function createFraudAlert(input: {
  contestId: string;
  submissionId: string;
  severity: OpenMicFraudAlert['severity'];
  reason: string;
  votesInEvent: number;
}): Promise<OpenMicFraudAlert> {
  const supabase = createAdminClient();
  const { data, error } = await supabase
    .from('open_mic_fraud_alerts')
    .insert({
      contest_id: input.contestId,
      submission_id: input.submissionId,
      severity: input.severity,
      reason: input.reason,
      votes_in_event: input.votesInEvent,
    })
    .select('*')
    .single();
  if (error) throw error;
  return mapFraudAlertRow(data);
}

export async function bulkMarkNotificationsSent(contestId: string, notificationIds: string[]): Promise<OpenMicNotification[]> {
  const supabase = createAdminClient();
  const { data, error } = await supabase
    .from('open_mic_notifications')
    .update({ status: 'sent', sent_at: new Date().toISOString() })
    .eq('contest_id', contestId)
    .in('id', notificationIds)
    .select('*');
  if (error) throw error;
  return safeArray<any>(data).map(mapNotificationRow);
}

export async function bulkResolveFraudAlerts(
  contestId: string,
  alertIds: string[],
  resolutionNote?: string
): Promise<OpenMicFraudAlert[]> {
  const supabase = createAdminClient();
  const { data, error } = await supabase
    .from('open_mic_fraud_alerts')
    .update({ status: 'resolved', resolved_at: new Date().toISOString(), resolution_note: resolutionNote || null })
    .eq('contest_id', contestId)
    .in('id', alertIds)
    .select('*');
  if (error) throw error;
  return safeArray<any>(data).map(mapFraudAlertRow);
}

export async function bulkUpdatePaymentEventStatus(
  contestId: string,
  paymentEventIds: string[],
  nextStatus: OpenMicPaymentEvent['paymentStatus']
): Promise<OpenMicPaymentEvent[]> {
  const supabase = createAdminClient();
  const { data, error } = await supabase
    .from('open_mic_payment_events')
    .update({ payment_status: nextStatus, updated_at: new Date().toISOString() })
    .eq('contest_id', contestId)
    .in('id', paymentEventIds)
    .select('*');
  if (error) throw error;
  return safeArray<any>(data).map(mapPaymentEventRow);
}

export async function getContestBySlug(slug: string) {
  if (!hasUsableSupabaseReadConfig()) return null;
  try {
    const supabase = createAdminClient();
    const { data, error } = await supabase
      .from('contests')
      .select('*, competition_beats(*)')
      .eq('slug', slug)
      .maybeSingle();
    if (error) throw error;
    if (!data) return null;
    // Slug alone is not enough to call a row an Open Mic edition, and the type is
    // no longer enough either; see `listContests`.
    if (!isOpenMicContestRow(data)) return null;
    return mapContestRow(data);
  } catch (error) {
    throw error;
  }
}

export async function getContestById(contestId: string) {
  if (!hasUsableSupabaseReadConfig()) return null;
  try {
    const supabase = createAdminClient();
    const { data, error } = await supabase
      .from('contests')
      .select('*, competition_beats(*)')
      .eq('id', contestId)
      .maybeSingle();
    if (error) throw error;
    if (!data) return null;
    return mapContestRow(data);
  } catch (error) {
    throw error;
  }
}

export async function createContest(input: Partial<OpenMicContest>, actorId?: string) {
  if (!shouldUseDb()) throw new Error('Open Mic DB is not configured.');
  let createdInMemory: ReturnType<typeof createContestMemory> | null = null;
  try {
    createdInMemory = createContestMemory(input, actorId);
    if (!createdInMemory.success) return createdInMemory;
    const contest = createdInMemory.contest;
    const supabase = createAdminClient();

    const { error } = await supabase.from('contests').insert({
      id: contest.id,
      name: contest.title,
      slug: contest.slug,
      description: contest.description,
      contest_type: OPEN_MIC_CONTEST_TYPE,
      status: contest.status === 'published' || contest.status === 'registration_open' ? 'active' : 'draft',
      visibility: contest.visibility,
      banner_image_url: String(contest.bannerImageUrl || '').trim(),
      start_date: contest.registrationStartAt || null,
      end_date: contest.registrationEndAt || null,
      entry_fee_ngn: contest.registrationFeeNgn,
      vote_price_ngn: contest.votingConfig.votePrice,
      shortlisting_limit: contest.finalistsTarget,
      judge_weight: contest.judgeWeight,
      public_vote_weight: contest.publicVoteWeight,
      sponsor_assets: {
        month: contest.month,
        year: contest.year,
        season: contest.season,
        objective: contest.objective,
        theme: contest.theme,
        hashtag: contest.hashtag,
        status: contest.status,
        recurrence: contest.recurrence,
        voting: contest.votingConfig,
        finale: contest.finale,
        finalePlaylist: contest.finalePlaylist,
        selectionModel: contest.selectionModel,
        finalistsTarget: contest.finalistsTarget,
      },
      prize_structure: contest.prizes,
      created_by: actorId || null,
    });
    if (error) throw error;
    return createdInMemory;
  } catch (error) {
    throw error;
  }
}

export async function updateContest(contestId: string, patch: Partial<OpenMicContest>, actorId?: string) {
  if (!shouldUseDb()) throw new Error('Open Mic DB is not configured.');
  try {
    const patchKeys = Object.keys(patch || {});
    const statusOnlyPatch = patchKeys.length === 1 && patchKeys[0] === 'status' && typeof patch.status === 'string';

    // Fast-path for admin status toggles from contest list:
    // avoid depending on in-memory presence or full contest hydration.
    if (statusOnlyPatch) {
      const supabase = createAdminClient();
      const mappedStatus = patch.status === 'published' || patch.status === 'registration_open' ? 'active' : 'draft';
      const current = await getContestById(contestId);
      const statusScopedSponsorAssets = sanitizeJson({
        month: current?.month,
        year: current?.year,
        season: current?.season,
        objective: current?.objective,
        theme: current?.theme,
        hashtag: current?.hashtag,
        status: patch.status,
        recurrence: current?.recurrence,
        voting: current?.votingConfig,
        finale: current?.finale,
        finalePlaylist: current?.finalePlaylist || [],
        finalePlaylistLocked: current?.finalePlaylistLocked === true,
        selectionModel: current?.selectionModel || 'hybrid',
        finalistsTarget: current?.finalistsTarget ?? 10,
      });
      const { data, error } = await supabase
        .from('contests')
        .update({
          status: mappedStatus,
          sponsor_assets: statusScopedSponsorAssets,
        })
        .eq('id', contestId)
        .select('*')
        .maybeSingle();
      if (error) throw error;
      if (data) {
        // Keep in-memory projection aligned where possible.
        try {
          updateContestMemory(contestId, patch, actorId);
        } catch {
          // no-op
        }
        return mapContestRow(data);
      }
      throw new Error('Contest not found.');
    }

    const existing = await getContestById(contestId);
    if (!existing) throw new Error('Contest not found.');
    const updated: OpenMicContest = {
      ...existing,
      ...patch,
      slug: patch.slug
        ? String(patch.slug)
            .trim()
            .toLowerCase()
            .replace(/[^a-z0-9]+/g, '-')
            .replace(/(^-|-$)/g, '')
        : existing.slug,
      updatedBy: actorId || existing.updatedBy,
      updatedAt: new Date().toISOString(),
    };

    // Keep in-memory projection aligned when available, without failing DB updates
    try {
      updateContestMemory(contestId, patch, actorId);
    } catch {
      // no-op
    }

    const sponsorAssetsBase = sanitizeJson({
      month: updated.month,
      year: updated.year,
      season: updated.season,
      objective: updated.objective,
      theme: updated.theme,
      hashtag: updated.hashtag,
      status: updated.status,
      recurrence: updated.recurrence,
      voting: updated.votingConfig,
      finale: updated.finale,
      finalePlaylist: updated.finalePlaylist,
      finalePlaylistLocked: updated.finalePlaylistLocked === true,
      selectionModel: updated.selectionModel,
      finalistsTarget: updated.finalistsTarget,
    });

    const dbPatch: Record<string, unknown> = {};
    if (patch.title !== undefined) dbPatch.name = updated.title;
    if (patch.slug !== undefined) dbPatch.slug = updated.slug;
    if (patch.description !== undefined) dbPatch.description = updated.description;
    if (patch.bannerImageUrl !== undefined) dbPatch.banner_image_url = String(patch.bannerImageUrl || '').trim();
    if (patch.visibility !== undefined) dbPatch.visibility = updated.visibility;
    if (patch.status !== undefined) {
      dbPatch.status = updated.status === 'published' || updated.status === 'registration_open' ? 'active' : 'draft';
      dbPatch.sponsor_assets = sponsorAssetsBase;
    }
    if (patch.registrationFeeNgn !== undefined) dbPatch.entry_fee_ngn = updated.registrationFeeNgn;
    if (patch.votingConfig !== undefined || patch.publicVoteWeight !== undefined || patch.judgeWeight !== undefined || patch.finalistsTarget !== undefined) {
      dbPatch.vote_price_ngn = updated.votingConfig.votePrice;
      dbPatch.shortlisting_limit = updated.finalistsTarget;
      dbPatch.judge_weight = updated.judgeWeight;
      dbPatch.public_vote_weight = updated.publicVoteWeight;
      dbPatch.sponsor_assets = sponsorAssetsBase;
    }
    if (patch.recurrence !== undefined || patch.finale !== undefined || patch.selectionModel !== undefined) {
      dbPatch.sponsor_assets = sponsorAssetsBase;
    }
    if (patch.prizes !== undefined) dbPatch.prize_structure = sanitizeJson(updated.prizes);
    if (patch.registrationStartAt !== undefined) dbPatch.start_date = updated.registrationStartAt || null;
    if (patch.registrationEndAt !== undefined) dbPatch.end_date = updated.registrationEndAt || null;

    // If patch contained no recognized fields, still keep status-safety and return updated memory projection.
    if (Object.keys(dbPatch).length === 0) return updated;

    const supabase = createAdminClient();
    const { error } = await supabase
      .from('contests')
      .update(dbPatch)
      .eq('id', contestId);
    if (error) throw error;
    return updated;
  } catch (error) {
    throw error;
  }
}

export async function upsertBeat(contestId: string, payload: any) {
  if (!shouldUseDb()) throw new Error('Open Mic DB is not configured.');
  try {
    const contest = await getContestById(contestId);
    if (!contest) throw new Error('Contest not found.');
    const now = new Date().toISOString();
    const beat = {
      id: contest.beat?.id || randomUUID(),
      contestId,
      beatTitle: payload?.beatTitle || contest.beat?.beatTitle || 'Official Beat',
      producerName: payload?.producerName || contest.beat?.producerName || 'Spotlight Producer',
      producerCredit:
        payload?.producerCredit ||
        contest.beat?.producerCredit ||
        payload?.producerName ||
        contest.beat?.producerName ||
        'Spotlight Producer',
      previewUrl: payload?.previewUrl || contest.beat?.previewUrl,
      downloadUrl: payload?.downloadUrl || contest.beat?.downloadUrl,
      bpm: payload?.bpm ?? contest.beat?.bpm,
      musicalKey: payload?.musicalKey || contest.beat?.musicalKey,
      genre: payload?.genre || contest.beat?.genre,
      mood: payload?.mood || contest.beat?.mood,
      durationSeconds: payload?.durationSeconds ?? contest.beat?.durationSeconds,
      usageRules:
        payload?.usageRules ||
        contest.beat?.usageRules ||
        'Beat is provided for this Spotlight Open Mic contest only.',
      allowDownload: payload?.allowDownload ?? contest.beat?.allowDownload ?? true,
      previewOnly: payload?.previewOnly ?? contest.beat?.previewOnly ?? false,
      requiresPaidEntryForDownload:
        payload?.requiresPaidEntryForDownload ??
        contest.beat?.requiresPaidEntryForDownload ??
        contest.entryFeeRequired,
      explicitLyricsAllowed: payload?.explicitLyricsAllowed ?? contest.beat?.explicitLyricsAllowed ?? false,
      cleanVersionRequired: payload?.cleanVersionRequired ?? contest.beat?.cleanVersionRequired ?? true,
      maxSongDurationSeconds: payload?.maxSongDurationSeconds ?? contest.beat?.maxSongDurationSeconds ?? 180,
      createdAt: contest.beat?.createdAt || now,
      updatedAt: now,
    };
    const supabase = createAdminClient();
    // One live beat per edition. Earlier rows stay for the audit trail — a song
    // already uploaded against them keeps its `beat_id` — but they must not
    // compete for the title, because an applicant can only record over one file.
    const { error: retireError } = await supabase
      .from('competition_beats')
      .update({ is_active: false })
      .eq('competition_id', contestId)
      .eq('is_active', true)
      .neq('id', beat.id);
    if (retireError) throw retireError;
    const { error } = await supabase.from('competition_beats').upsert({
      id: beat.id,
      competition_id: contestId,
      title: beat.beatTitle,
      genre: beat.genre || '',
      producer_credit: beat.producerCredit || beat.producerName,
      preview_url: beat.previewUrl || '',
      download_url: beat.downloadUrl || '',
      rules_text: beat.usageRules,
      requires_enrollment: beat.requiresPaidEntryForDownload,
      is_active: true,
    });
    if (error) throw error;
    return beat;
  } catch (error) {
    if (!shouldFallback(error)) throw error;
    return upsertBeatMemory(contestId, payload);
  }
}

export async function logBeatDownload(input: Parameters<typeof logBeatDownloadMemory>[0]) {
  if (!shouldUseDb()) throw new Error('Open Mic DB is not configured.');
  const contest = await getContestBySlug(input.contestSlug);
  if (!contest) throw new Error('Contest not found.');
  if (!contest.beat) throw new Error('Beat not available.');
  if (!input.termsAccepted) throw new Error('Beat usage agreement must be accepted.');
  if (contest.beat.allowDownload === false || contest.beat.previewOnly === true) {
    throw new Error('Beat download is locked for this contest.');
  }
  if (contest.beat.requiresPaidEntryForDownload && !input.paidAccessConfirmed) {
    throw new Error('Paid entry is required before beat download.');
  }

  const logged: OpenMicBeatDownloadLog = {
    id: randomUUID(),
    beatId: contest.beat.id,
    contestId: contest.id,
    userId: input.userId,
    artistName: input.artistName,
    artistEmail: input.artistEmail,
    termsAccepted: input.termsAccepted,
    paidAccessConfirmed: Boolean(input.paidAccessConfirmed),
    downloadedAt: new Date().toISOString(),
  };

  try {
    const supabase = createAdminClient();
    await supabase.from('beat_download_logs').insert({
      id: logged.id,
      beat_id: logged.beatId,
      competition_id: logged.contestId,
      user_id: logged.userId || null,
      ip_hash: '',
      user_agent_hash: '',
      downloaded_at: logged.downloadedAt,
    });
  } catch {
    // Beat access should not fail because the analytics/logging table is unavailable or has a different shape.
  }

  return logged;
}

/**
 * An enrichment read that the listing can do without.
 *
 * `beat_download_logs` is the row that exists; the artist's name is a join, and this
 * module's own writer treats the log table as best-effort ("beat access should not
 * fail because the analytics table is unavailable"). A console listing follows the
 * same rule in the other direction: a profile read that fails must not turn the
 * Beat Downloads tab into an error page, because the downloads themselves — and the
 * timestamp an operator is investigating — are already in hand. It degrades to
 * "identity unknown", which the console renders as a dash.
 */
async function optionalRead(
  label: string,
  // PromiseLike, not Promise: a PostgrestFilterBuilder is thenable but is not a
  // Promise, so a `Promise` parameter made every call site below fail `tsc`
  // ("missing the following properties: catch, finally"). `await` accepts either.
  run: () => PromiseLike<{ data: unknown; error: unknown }>
): Promise<any[]> {
  try {
    const { data, error } = await run();
    if (error) throw error;
    return safeArray<any>(data);
  } catch (error) {
    console.warn(
      `[open-mic] ${label} unavailable:`,
      error instanceof Error ? error.message : error
    );
    return [];
  }
}

/**
 * The beat hand-offs recorded for one edition, with the artist the database knows.
 *
 * The log table stores who downloaded, not who they are: `artist_name` and
 * `artist_email` are arguments of `logBeatDownload` that the insert has nowhere to
 * put, so the identity has to come back from the profile and enrollment rows.
 * Terms and paid access are the other half: a download is only possible when the
 * caller has accepted the usage agreement, but that agreement is not recorded per
 * download, so the honest value is `null` unless an enrollment row carries one —
 * the console shows "Not recorded" rather than asserting a consent nobody stored.
 */
export async function listBeatDownloads(contestId?: string) {
  if (!shouldUseDb()) return [];
  try {
    const supabase = createAdminClient();
    let query = supabase.from('beat_download_logs').select('*').order('downloaded_at', { ascending: false });
    if (contestId) query = query.eq('competition_id', contestId);
    const { data, error } = await query;
    if (error) throw error;
    const rows = safeArray<any>(data);

    const userIds = Array.from(
      new Set(rows.map((row) => String(row.user_id || '')).filter(Boolean))
    );
    const [profileRows, enrollmentRows] = userIds.length
      ? await Promise.all([
          optionalRead('beat download profiles', () =>
            supabase.from('user_profiles').select('id, full_name, display_name, email').in('id', userIds)
          ),
          contestId
            ? optionalRead('beat download enrollments', () =>
                supabase
                  .from('competition_enrollments')
                  .select('user_id, stage_name, email, terms_accepted, payment_status')
                  .eq('competition_id', contestId)
                  .in('user_id', userIds)
              )
            : Promise.resolve([] as any[]),
        ])
      : ([] as any[][]);

    const profiles = new Map(profileRows.map((row) => [String(row.id), row]));
    const enrollments = new Map(enrollmentRows.map((row) => [String(row.user_id), row]));

    return rows.map((row) => {
      const userId = String(row.user_id || '');
      const profile = profiles.get(userId);
      const enrollment = enrollments.get(userId);
      return {
        id: row.id,
        beatId: row.beat_id,
        contestId: row.competition_id,
        userId: userId || undefined,
        artistName: enrollment?.stage_name || profile?.display_name || profile?.full_name || '',
        artistEmail: profile?.email || enrollment?.email || '',
        termsAccepted: enrollment ? enrollment.terms_accepted === true : null,
        paidAccessConfirmed: enrollment
          ? ['paid', 'waived'].includes(String(enrollment.payment_status || ''))
          : null,
        downloadedAt: row.downloaded_at,
      };
    });
  } catch (error) {
    if (!shouldFallback(error)) throw error;
    return listBeatDownloadsMemory(contestId);
  }
}

/**
 * The most recent beat download recorded for one artist in one edition.
 *
 * `beat_download_logs` is the only place the beat hand-off is recorded, and
 * `logBeatDownload` deliberately treats a failed insert as non-fatal ("beat
 * access should not fail because the analytics table is unavailable"), so this
 * read is just as tolerant: a missing or oddly-shaped table means "we cannot
 * show that step", never an error for the caller.
 */
export async function latestBeatDownloadAt(input: {
  contestId: string;
  userId?: string | null;
}): Promise<string | null> {
  if (!shouldUseDb()) return null;
  const contestId = String(input.contestId || '').trim();
  if (!contestId) return null;
  try {
    const supabase = createAdminClient();
    let query = supabase
      .from('beat_download_logs')
      .select('downloaded_at')
      .eq('competition_id', contestId)
      .order('downloaded_at', { ascending: false })
      .limit(1);
    const userId = String(input.userId || '').trim();
    if (userId) query = query.eq('user_id', userId);
    const { data, error } = await query;
    if (error) throw error;
    const first = safeArray<any>(data)[0];
    const at = first?.downloaded_at;
    return at ? String(at) : null;
  } catch (error) {
    console.warn(
      '[open-mic] beat download history unavailable:',
      error instanceof Error ? error.message : error,
    );
    return null;
  }
}

/**
 * Every artist the beat log records for one edition, as user ids.
 *
 * The Applications tab has a "Beat Download" column, and the only way it could fill
 * it was `metadata.beatDownloadStatus` — a value `createApplication` stamps once when
 * the row is inserted and `logBeatDownload` never updates (the download route writes
 * the log table and nothing else). So the tab reported "not available" for artists the
 * log shows downloading, contradicting the Beat Downloads tab on the same page.
 *
 * This is the log read for that question: one column, no profile join, and — the same
 * posture as `latestBeatDownloadAt` above — an unreadable table answers "nobody is
 * recorded" rather than failing the list, because the column is a convenience and the
 * applicants are the point of the tab.
 */
export async function listBeatDownloadUserIds(contestId: string): Promise<string[]> {
  if (!shouldUseDb()) return [];
  const id = String(contestId || '').trim();
  if (!id) return [];
  try {
    const { data, error } = await createAdminClient()
      .from('beat_download_logs')
      .select('user_id')
      .eq('competition_id', id);
    if (error) throw error;
    return Array.from(
      new Set(safeArray<any>(data).map((row) => String(row?.user_id || '')).filter(Boolean))
    );
  } catch (error) {
    console.warn(
      '[open-mic] beat download ids unavailable:',
      error instanceof Error ? error.message : error,
    );
    return [];
  }
}

export async function createApplication(input: Parameters<typeof createApplicationMemory>[0]) {
  if (!shouldUseDb()) throw new Error('Open Mic DB is not configured.');
  try {
    const contest = await getContestBySlug(input.contestSlug);
    if (!contest) {
      return { success: false as const, errors: { contestSlug: 'Contest not found.' } };
    }

    const nowMs = Date.now();
    const withinApplicationWindow =
      contest.status === 'registration_open' ||
      contest.status === 'published' ||
      isWithinWindow(nowMs, contest.registrationStartAt, contest.registrationEndAt);
    if (!withinApplicationWindow) {
      return { success: false as const, errors: { applicationWindow: 'Application is currently closed.' } };
    }

    const supabase = createAdminClient();
    const normalizedEmail = String(input.email || '').trim().toLowerCase();
    const normalizedStageName = String(input.stageName || '').trim().toLowerCase();

    const existingRows = await supabase
      .from('competition_enrollments')
      .select('id, status, email, stage_name, metadata')
      .eq('competition_id', contest.id);
    if (existingRows.error) throw existingRows.error;
    const duplicate = safeArray<any>(existingRows.data).find((row) => {
      const rowStatus = String(row.status || '').toLowerCase();
      if (rowStatus === 'rejected') return false;
      const meta = (row.metadata || {}) as Record<string, unknown>;
      const rowEmail = String(row.email || meta.email || '').trim().toLowerCase();
      const rowStage = String(row.stage_name || meta.stageName || '').trim().toLowerCase();
      return (normalizedEmail && rowEmail === normalizedEmail) || (normalizedStageName && rowStage === normalizedStageName);
    });
    if (duplicate) {
      return { success: false as const, errors: { duplicateApplication: 'You already applied for this contest.' } };
    }

    const applicantUserId = input.userId || (await resolveApplicantUserId(supabase, input.email, input.fullName));

    const paymentStatus: OpenMicPaymentStatus =
      input.paymentStatus || (contest.entryFeeRequired ? 'pending' : 'not_required');
    const applicationStatus: OpenMicApplicationStatus =
      contest.beat?.requiresPaidEntryForDownload || contest.entryFeeRequired ? 'pending' : 'approved';
    const beatDownloadStatus: OpenMicBeatDownloadStatus =
      applicationStatus === 'approved' ? 'available' : 'not_available';
    const now = new Date().toISOString();
    const app: OpenMicApplication = {
      id: randomUUID(),
      contestId: contest.id,
      contestSlug: contest.slug,
      userId: applicantUserId,
      fullName: input.fullName,
      stageName: input.stageName,
      email: input.email,
      phone: input.phone,
      gender: input.gender,
      ageRange: input.ageRange,
      country: input.country,
      city: input.city,
      state: input.state,
      lga: input.lga,
      instagramHandle: input.instagramHandle,
      tiktokHandle: input.tiktokHandle,
      youtubeHandle: input.youtubeHandle,
      facebookHandle: input.facebookHandle,
      xHandle: input.xHandle,
      musicGenre: input.musicGenre,
      artistBio: input.artistBio,
      profilePhotoUrl: input.profilePhotoUrl,
      applicationStatus,
      paymentStatus,
      beatDownloadStatus,
      hasAgreedToRules: input.hasAgreedToRules,
      hasAgreedToBeatTerms: input.hasAgreedToBeatTerms,
      hasAgreedToVotingTerms: input.hasAgreedToVotingTerms,
      appliedAt: now,
      approvedAt: applicationStatus === 'approved' ? now : undefined,
      createdAt: now,
      updatedAt: now,
    };

    const insertPayload: Record<string, unknown> = {
      id: app.id,
      competition_id: app.contestId,
      status: app.applicationStatus,
      payment_status: app.paymentStatus,
      stage_name: app.stageName,
      legal_name: app.fullName,
      gender: app.gender,
      phone: app.phone,
      email: app.email,
      state: app.state,
      city: app.city,
      genre_style: app.musicGenre,
      short_bio: app.artistBio || '',
      profile_photo_url: app.profilePhotoUrl || '',
      terms_accepted: app.hasAgreedToRules,
      consent_accepted: app.hasAgreedToBeatTerms,
      eligibility_confirmed: app.hasAgreedToVotingTerms,
      metadata: {
        contestSlug: app.contestSlug,
        fullName: app.fullName,
        stageName: app.stageName,
        email: app.email,
        phone: app.phone,
        gender: app.gender,
        ageRange: app.ageRange,
        country: app.country,
        city: app.city,
        state: app.state,
        lga: app.lga,
        instagramHandle: app.instagramHandle,
        tiktokHandle: app.tiktokHandle,
        youtubeHandle: app.youtubeHandle,
        facebookHandle: app.facebookHandle,
        xHandle: app.xHandle,
        musicGenre: app.musicGenre,
        artistBio: app.artistBio,
        profilePhotoUrl: app.profilePhotoUrl,
        beatDownloadStatus: app.beatDownloadStatus,
        hasAgreedToRules: app.hasAgreedToRules,
        hasAgreedToBeatTerms: app.hasAgreedToBeatTerms,
        hasAgreedToVotingTerms: app.hasAgreedToVotingTerms,
        applicationStatus: app.applicationStatus,
        paymentStatus: app.paymentStatus,
      },
    };
    if (app.userId) insertPayload.user_id = app.userId;

    const { error } = await supabase.from('competition_enrollments').insert(insertPayload);
    if (error) throw error;
    await createNotification({
      contestId: app.contestId,
      applicationId: app.id,
      audience: 'artist',
      channel: 'in_app',
      eventKey: 'application_received',
      title: 'Application Received',
      message: `Your application for ${app.contestSlug} has been received.`,
    });
    return { success: true as const, application: app };
  } catch (error) {
    if (!shouldFallback(error)) throw error;
    return createApplicationMemory(input);
  }
}

export async function listApplications(input?: {
  contestId?: string;
  userId?: string;
  applicationStatus?: OpenMicApplicationStatus;
  paymentStatus?: OpenMicPaymentStatus;
}) {
  if (!shouldUseDb()) return [];
  try {
    const supabase = createAdminClient();
    let query = supabase.from('competition_enrollments').select('*');
    if (input?.contestId) query = query.eq('competition_id', input.contestId);
    if (input?.userId) query = query.eq('user_id', input.userId);
    if (input?.applicationStatus) query = query.eq('status', input.applicationStatus);
    if (input?.paymentStatus) query = query.eq('payment_status', input.paymentStatus);
    const { data, error } = await query;
    if (error) throw error;
    return safeArray<any>(data)
      .map(mapApplicationRow)
      .sort((a, b) => String(b.createdAt || '').localeCompare(String(a.createdAt || '')));
  } catch (error) {
    if (!shouldFallback(error)) throw error;
    return listApplicationsMemory(input);
  }
}

export async function getApplicationById(applicationId: string) {
  if (!shouldUseDb()) return null;
  try {
    const supabase = createAdminClient();
    const { data, error } = await supabase
      .from('competition_enrollments')
      .select('*')
      .eq('id', applicationId)
      .maybeSingle();
    if (error) throw error;
    if (!data) return null;
    return mapApplicationRow(data);
  } catch (error) {
    if (!shouldFallback(error)) throw error;
    return getApplicationByIdMemory(applicationId);
  }
}

export async function findApplicationForContest(contestId: string, email?: string, stageName?: string) {
  if (!shouldUseDb()) return null;
  try {
    const all = await listApplications({ contestId });
    const normalizedEmail = String(email || '').trim().toLowerCase();
    const normalizedStage = String(stageName || '').trim().toLowerCase();
    return (
      all.find((row) => {
        if (normalizedEmail && row.email.trim().toLowerCase() === normalizedEmail) return true;
        if (normalizedStage && row.stageName.trim().toLowerCase() === normalizedStage) return true;
        return false;
      }) || null
    );
  } catch (error) {
    if (!shouldFallback(error)) throw error;
    return findApplicationForContestMemory(contestId, email, stageName);
  }
}

export async function reviewApplication(
  applicationId: string,
  patch: {
    applicationStatus?: OpenMicApplicationStatus;
    paymentStatus?: OpenMicPaymentStatus;
    beatDownloadStatus?: OpenMicBeatDownloadStatus;
    rejectionReason?: string;
  }
) {
  if (!shouldUseDb()) throw new Error('Open Mic DB is not configured.');
  try {
    const updated = reviewApplicationMemory(applicationId, patch);
    const supabase = createAdminClient();
    const { error } = await supabase
      .from('competition_enrollments')
      .update({
        status: updated.applicationStatus,
        payment_status: updated.paymentStatus,
        metadata: {
          contestSlug: updated.contestSlug,
          fullName: updated.fullName,
          stageName: updated.stageName,
          email: updated.email,
          phone: updated.phone,
          gender: updated.gender,
          ageRange: updated.ageRange,
          country: updated.country,
          city: updated.city,
          state: updated.state,
          lga: updated.lga,
          instagramHandle: updated.instagramHandle,
          tiktokHandle: updated.tiktokHandle,
          youtubeHandle: updated.youtubeHandle,
          facebookHandle: updated.facebookHandle,
          xHandle: updated.xHandle,
          musicGenre: updated.musicGenre,
          artistBio: updated.artistBio,
          profilePhotoUrl: updated.profilePhotoUrl,
          beatDownloadStatus: updated.beatDownloadStatus,
          hasAgreedToRules: updated.hasAgreedToRules,
          hasAgreedToBeatTerms: updated.hasAgreedToBeatTerms,
          hasAgreedToVotingTerms: updated.hasAgreedToVotingTerms,
          approvedAt: updated.approvedAt,
          rejectedAt: updated.rejectedAt,
          rejectionReason: updated.rejectionReason,
        },
      })
      .eq('id', applicationId);
    if (error) throw error;
    if (updated.applicationStatus === 'approved') {
      await createNotification({
        contestId: updated.contestId,
        applicationId: updated.id,
        audience: 'artist',
        channel: 'in_app',
        eventKey: 'application_approved',
        title: 'Application Approved',
        message: `Hi ${updated.stageName}, your application has been approved.`,
      });
    }
    if (updated.applicationStatus === 'rejected') {
      await createNotification({
        contestId: updated.contestId,
        applicationId: updated.id,
        audience: 'artist',
        channel: 'in_app',
        eventKey: 'application_rejected',
        title: 'Application Rejected',
        message: updated.rejectionReason || 'Your application was not approved.',
      });
    }
    if (['paid', 'waived'].includes(updated.paymentStatus)) {
      await createPaymentEvent({
        contestId: updated.contestId,
        applicationId: updated.id,
        eventType: 'entry_fee',
        amountNgn: updated.paymentStatus === 'paid' ? (await getContestById(updated.contestId))?.registrationFeeNgn || 0 : 0,
        paymentStatus: updated.paymentStatus === 'paid' ? 'successful' : 'waived',
      });
    }
    return updated;
  } catch (error) {
    if (!shouldFallback(error)) throw error;
    return reviewApplicationMemory(applicationId, patch);
  }
}

export async function createSubmission(input: Parameters<typeof createSubmissionMemory>[0]) {
  if (!shouldUseDb()) throw new Error('Open Mic DB is not configured.');
  try {
    const contest = await getContestBySlug(input.contestSlug);
    if (!contest) {
      return { success: false as const, errors: { contestSlug: 'Contest not found.' } };
    }
    if (!contest.beat) {
      return { success: false as const, errors: { beat: 'Official beat not yet available.' } };
    }

    // Approval is a union across the three planes a reviewer may have used
    // (`src/server/openmic/submission-eligibility.ts`). The lookup below is
    // by e-mail/stage name and returns `null` for an applicant who registered
    // through `/apply`, which used to mean "no application, no gate".
    const nowMs = Date.now();
    const eligibility = await getSongSubmissionEligibility(contest, input.artistUserId, nowMs);
    const linkedApplication = await findApplicationForContest(contest.id, input.email, input.stageName);
    // A row that predates `competition_enrollments.user_id` can only be matched by
    // e-mail, so it still counts; a row owned by a different account never does.
    const legacyApproval = Boolean(
      linkedApplication && linkedApplication.applicationStatus === 'approved' && !linkedApplication.userId,
    );
    if (eligibility.source === 'none' && !legacyApproval) {
      return { success: false as const, errors: { application: 'Your application has not been approved yet.' } };
    }
    if (contest.entryFeeRequired && linkedApplication && !['paid', 'waived'].includes(linkedApplication.paymentStatus)) {
      return { success: false as const, errors: { payment: 'Entry fee payment is required before song submission.' } };
    }

    if (!eligibility.window.open) {
      return { success: false as const, errors: { submissionWindow: 'Song submission is currently closed for this contest.' } };
    }

    if (!input.officialBeatConfirmed || !input.ownershipConfirmed || !input.noUnauthorizedSamplesConfirmed) {
      return {
        success: false as const,
        errors: { declaration: 'Beat usage and rights declarations are required.' },
      };
    }

    const supabase = createAdminClient();
    const submissionId = input.submissionId || randomUUID();
    const stageNameKey = String(input.stageName || '').trim().toLowerCase();
    const emailKey = String(input.email || '').trim().toLowerCase();
    const existingRows = await supabase
      .from('competition_entries')
      .select('id, status, entry_title, lyrical_concept_summary')
      .eq('competition_id', contest.id);
    if (existingRows.error) throw existingRows.error;
    const duplicate = safeArray<any>(existingRows.data).find((row) => {
      if (String(row.id) === submissionId) return false;
      const rowStatus = String(row.status || '').toLowerCase();
      if (['rejected', 'disqualified'].includes(rowStatus)) return false;
      let summary: Record<string, unknown> = {};
      try {
        summary = row.lyrical_concept_summary ? (JSON.parse(String(row.lyrical_concept_summary)) as Record<string, unknown>) : {};
      } catch {
        summary = {};
      }
      const existingStage = String(summary.stageName || '').trim().toLowerCase();
      const existingEmail = String(summary.email || '').trim().toLowerCase();
      return (stageNameKey && existingStage === stageNameKey) || (emailKey && existingEmail === emailKey);
    });
    if (duplicate) {
      return { success: false as const, errors: { duplicateApplication: 'You already have an active submission for this contest.' } };
    }

    const submissionUserId =
      input.artistUserId ||
      linkedApplication?.userId ||
      (await resolveApplicantUserId(supabase, input.email || '', input.realName || input.stageName));
    if (!submissionUserId) {
      return { success: false as const, errors: { user: 'Unable to resolve applicant account for submission.' } };
    }

    const now = new Date().toISOString();
    const expectedObjectKey = input.songObjectKey
      ? buildSongObjectKey({
          contestRef: songContestRef(contest),
          artistUserId: submissionUserId,
          submissionId,
        })
      : '';
    if (input.songObjectKey && input.songObjectKey !== expectedObjectKey) {
      return { success: false as const, errors: { songObjectKey: 'Uploaded song object key is invalid.' } };
    }
    // The public reader, not the admin route: this value is what a contestant's
    // own profile and the mobile app end up playing, and the admin path requires
    // an admin session.
    const submissionSongUrl = input.songObjectKey ? songReaderUrl(submissionId) : input.songUrl;
    const normalizedGenre = String(input.genre || contest.beat?.genre || 'Unspecified').trim() || 'Unspecified';
    const normalizedSongTitle =
      String(input.songTitle || '').trim() ||
      String(input.songFileName || '').replace(/\.mp3$/i, '').trim() ||
      `${input.stageName} submission`;

    const submission: OpenMicSubmission = {
      id: submissionId,
      contestId: contest.id,
      contestSlug: contest.slug,
      artistUserId: submissionUserId,
      stageName: input.stageName,
      realName: input.realName,
      email: input.email,
      phone: input.phone,
      country: input.country,
      state: input.state,
      lga: input.lga,
      instagramHandle: input.instagramHandle,
      tiktokHandle: input.tiktokHandle,
      youtubeHandle: input.youtubeHandle,
      facebookHandle: input.facebookHandle,
      xHandle: input.xHandle,
      genre: normalizedGenre,
      songTitle: normalizedSongTitle,
      songMood: input.songMood,
      language: input.language,
      songUrl: submissionSongUrl,
      songObjectKey: input.songObjectKey,
      songFileName: input.songFileName,
      videoUrl: input.videoUrl,
      lyricsUrl: input.lyricsUrl,
      artworkUrl: input.artworkUrl,
      story: input.story,
      votingSlogan: input.votingSlogan,
      fanMessage: input.fanMessage,
      explicitVersion: input.explicitVersion,
      cleanVersionAvailable: input.cleanVersionAvailable,
      officialBeatConfirmed: input.officialBeatConfirmed,
      ownershipConfirmed: input.ownershipConfirmed,
      noUnauthorizedSamplesConfirmed: input.noUnauthorizedSamplesConfirmed,
      finaleAvailabilityConfirmed: input.finaleAvailabilityConfirmed,
      status: 'published_for_voting',
      voteCount: 0,
      leaderboardScore: 0,
      isFinalist: false,
      isWinner: false,
      submittedAt: now,
      publishedAt: now,
      createdAt: now,
      updatedAt: now,
    };

    const { error } = await supabase.from('competition_entries').upsert({
      id: submission.id,
      competition_id: submission.contestId,
      user_id: submission.artistUserId || null,
      beat_id: contest?.beat?.id || null,
      entry_title: submission.songTitle,
      entry_description: submission.story || '',
      lyrical_concept_summary: JSON.stringify({
        contestSlug: submission.contestSlug,
        stageName: submission.stageName,
        realName: submission.realName,
        email: submission.email,
        phone: submission.phone,
        country: submission.country,
        state: submission.state,
        lga: submission.lga,
        instagramHandle: submission.instagramHandle,
        tiktokHandle: submission.tiktokHandle,
        youtubeHandle: submission.youtubeHandle,
        facebookHandle: submission.facebookHandle,
        xHandle: submission.xHandle,
        songMood: submission.songMood,
        language: submission.language,
        songUrl: submission.songUrl,
        songObjectKey: submission.songObjectKey,
        r2ObjectKey: submission.songObjectKey,
        songFileName: submission.songFileName,
        mimeType: submission.songObjectKey ? 'audio/mp3' : undefined,
        uploadStatus: submission.songObjectKey ? 'submitted' : undefined,
        videoUrl: submission.videoUrl,
        lyricsUrl: submission.lyricsUrl,
        artworkUrl: submission.artworkUrl,
        votingSlogan: submission.votingSlogan,
        fanMessage: submission.fanMessage,
        cleanVersionAvailable: submission.cleanVersionAvailable,
        officialBeatConfirmed: submission.officialBeatConfirmed,
        noUnauthorizedSamplesConfirmed: submission.noUnauthorizedSamplesConfirmed,
        finaleAvailabilityConfirmed: submission.finaleAvailabilityConfirmed,
      }),
      category: submission.genre,
      video_link: submission.videoUrl || '',
      explicit_content_declared: submission.explicitVersion,
      originality_confirmed: submission.ownershipConfirmed,
      status: 'published_for_voting',
      submitted_at: submission.submittedAt || null,
      live_at: submission.submittedAt || null,
    });
    if (error) throw error;
    return { success: true as const, submission };
  } catch (error) {
    if (!shouldFallback(error)) throw error;
    return createSubmissionMemory(input);
  }
}

export async function recordSubmissionUploadComplete(input: {
  contestSlug: string;
  artistUserId: string;
  submissionId: string;
  objectKey: string;
  fileName?: string;
  mimeType: string;
}) {
  if (!shouldUseDb()) throw new Error('Open Mic DB is not configured.');

  const contest = await getContestBySlug(input.contestSlug);
  if (!contest) throw new Error('Contest not found.');

  const expectedObjectKey = buildSongObjectKey({
    contestRef: songContestRef(contest),
    artistUserId: input.artistUserId,
    submissionId: input.submissionId,
  });
  if (input.objectKey !== expectedObjectKey) {
    throw new Error('Uploaded song object key is invalid.');
  }

  const now = new Date().toISOString();
  const songUrl = songReaderUrl(input.submissionId);
  const supabase = createAdminClient();
  const { error } = await supabase.from('competition_entries').upsert({
    id: input.submissionId,
    competition_id: contest.id,
    user_id: input.artistUserId,
    beat_id: contest.beat?.id || null,
    entry_title: input.fileName || 'Uploaded Open Mic song',
    entry_description: '',
    lyrical_concept_summary: JSON.stringify({
      contestSlug: contest.slug,
      songUrl,
      songObjectKey: input.objectKey,
      r2ObjectKey: input.objectKey,
      songFileName: input.fileName,
      mimeType: input.mimeType,
      uploadStatus: 'uploaded',
      uploadedAt: now,
    }),
    category: 'Open Mic',
    video_link: '',
    explicit_content_declared: false,
    originality_confirmed: false,
    status: 'draft',
    submitted_at: null,
  });
  if (error) throw error;

  return {
    submissionId: input.submissionId,
    contestId: contest.slug || contest.id,
    artistId: input.artistUserId,
    r2ObjectKey: input.objectKey,
    mimeType: input.mimeType,
    status: 'uploaded',
  };
}

export async function listSubmissions(input?: { contestId?: string; userId?: string; status?: OpenMicSubmission['status'] }) {
  if (!shouldUseDb()) return [];
  try {
    const supabase = createAdminClient();
    let query = supabase.from('competition_entries').select('*');
    if (input?.contestId) query = query.eq('competition_id', input.contestId);
    if (input?.userId) query = query.eq('user_id', input.userId);
    if (input?.status) query = query.eq('status', input.status);
    const { data, error } = await query;
    if (error) throw error;
    const mapped = safeArray<any>(data)
      .map(mapSubmissionRow)
      .sort((a, b) => String(b.createdAt || '').localeCompare(String(a.createdAt || '')));

    // The announced award, for the rows that have one. `announceWinner` writes a
    // `winner_records` row next to flipping the entry's status, and the console's
    // Winners tab shows that award — so the read happens only once a winner row is
    // in the page, never for an artist's own dashboard list.
    const winnerIds = mapped.filter((row) => row.isWinner).map((row) => row.id);
    if (!winnerIds.length || !input?.contestId) return mapped;
    const awards = await optionalRead('winner awards', () =>
      createAdminClient()
        .from('winner_records')
        .select('entry_id, award_title, winner_tier')
        .eq('competition_id', input.contestId)
        .in('entry_id', winnerIds)
    );
    const byEntry = new Map(awards.map((row) => [String(row.entry_id), row]));
    return mapped.map((row) => (byEntry.has(row.id) ? { ...row, awardTitle: byEntry.get(row.id)?.award_title || null } : row));
  } catch (error) {
    if (!shouldFallback(error)) throw error;
    return listSubmissionsMemory(input);
  }
}

export async function getSubmissionById(submissionId: string) {
  if (!shouldUseDb()) return null;
  try {
    const supabase = createAdminClient();
    const { data, error } = await supabase.from('competition_entries').select('*').eq('id', submissionId).maybeSingle();
    if (error) throw error;
    if (!data) return null;
    return mapSubmissionRow(data);
  } catch (error) {
    if (!shouldFallback(error)) throw error;
    return getSubmissionByIdMemory(submissionId);
  }
}

export async function reviewSubmission(submissionId: string, review: OpenMicSubmissionReviewInput, actorId?: string) {
  if (!shouldUseDb()) throw new Error('Open Mic DB is not configured.');
  try {
    // The row on disk is the only valid input. This used to ask the in-memory
    // store to compute the update, and that store throws
    // "Submission not found." for anything it has not seen — which in DB mode is
    // everything, so no admin could ever approve, reject or publish a hand-in.
    const previous = await getSubmissionById(submissionId);
    if (!previous) throw new Error('Submission not found.');
    const { patch, notification } = projectReview(previous, review, new Date().toISOString());
    const supabase = createAdminClient();
    const { error } = await supabase
      .from('competition_entries')
      .update({
        status: patch.status,
        moderation_feedback: patch.reviewNote || '',
        reviewed_at: patch.approvedAt || null,
        live_at: patch.publishedAt || null,
      })
      .eq('id', submissionId);
    if (error) throw error;

    await supabase.from('moderation_logs').insert({
      entry_id: submissionId,
      competition_id: previous.contestId,
      actor_id: actorId || null,
      action: review.status,
      previous_status: previous.status || '',
      new_status: patch.status,
      reason: review.note || '',
      notes: review.note || '',
      flags_json: {},
    });

    // The artist has to learn the decision, and for a rejection the note is the
    // only thing that makes it actionable. Best-effort on purpose: the status
    // write and the audit row above ARE the decision, and a notice that cannot
    // be queued must not turn an approval that landed into a 500 the operator
    // reads as a failure — that invites a second click and a second audit row.
    if (notification) {
      try {
        await createNotification({
          contestId: previous.contestId,
          submissionId,
          audience: 'artist',
          channel: 'in_app',
          ...notification,
        });
      } catch (notifyError) {
        console.warn('[open-mic] review decision landed but the artist notice did not:',
          notifyError instanceof Error ? notifyError.message : notifyError);
      }
    }
    return { ...previous, ...patch };
  } catch (error) {
    if (!shouldFallback(error)) throw error;
    return reviewSubmissionMemory(submissionId, review);
  }
}

export async function castVote(input: OpenMicVoteInput) {
  if (!shouldUseDb()) throw new Error('Open Mic DB is not configured.');
  try {
    const supabase = createAdminClient();

    // 1. Insert vote record
    const { error: voteError } = await supabase.from('competition_entry_votes').insert({
      entry_id: input.submissionId,
      competition_id: input.contestId,
      user_id: input.voterUserId || null,
      vote_type: input.source,
      vote_count: input.votes,
      payment_reference: input.paymentReference || '',
      voter_ip: '',
      device_fingerprint: '',
      metadata: { voterName: input.voterName || '' },
    });
    if (voteError) throw voteError;

    // 2. Recompute vote count from the source of truth (votes table)
    //    This prevents drift from any out-of-band inserts or retries.
    const { data: totals, error: fetchError } = await supabase
      .from('competition_entry_votes')
      .select('vote_count')
      .eq('entry_id', input.submissionId);
    if (fetchError) throw fetchError;

    const newVoteCount = (totals ?? []).reduce((s: number, r: any) => s + (Number(r.vote_count) || 0), 0);
    const newScore = newVoteCount;

    const { error: updateError } = await supabase
      .from('competition_entries')
      .update({
        public_vote_count: newVoteCount,
        leaderboard_score: newScore,
      })
      .eq('id', input.submissionId);
    if (updateError) throw updateError;

    // Build a minimal updated object matching what callers expect
    const updated = { voteCount: newVoteCount, leaderboardScore: newScore };
    if (input.source === 'paid') {
      const contest = await getContestById(input.contestId);
      await createPaymentEvent({
        contestId: input.contestId,
        submissionId: input.submissionId,
        eventType: 'vote_payment',
        amountNgn: (contest?.votingConfig.votePrice || 0) * input.votes,
        paymentStatus: 'successful',
        paymentReference: input.paymentReference || undefined,
        metadata: { votes: input.votes, source: input.source },
      });
    }
    const contest = await getContestById(input.contestId);
    const suspiciousThreshold = contest?.votingConfig.suspiciousVoteThreshold ?? 100;
    const suspiciousHighThreshold = contest?.votingConfig.suspiciousVoteHighThreshold ?? 300;
    if (input.votes >= suspiciousThreshold) {
      await createFraudAlert({
        contestId: input.contestId,
        submissionId: input.submissionId,
        severity: input.votes >= suspiciousHighThreshold ? 'high' : 'medium',
        reason: 'Large vote quantity in single transaction',
        votesInEvent: input.votes,
      });
    }

    // Fraud signals (velocity/high-volume) + a canonical vote-audit entry in
    // vote_audit_logs, in addition to the open-mic-specific records above. The
    // domain table (competition_entry_votes) is untouched.
    if (input.source === 'paid') {
      const votePrice = contest?.votingConfig.votePrice ?? 0;
      const amountKobo = Math.round(votePrice * input.votes * 100);
      const fraud = await recordVoteFraudSignals({
        domain: 'open-mic',
        contestId: input.contestId,
        contestantId: input.submissionId,
        votes: input.votes,
        paymentReference: input.paymentReference ?? null,
        userId: input.voterUserId ?? null,
        amountExpectedKobo: amountKobo,
        amountPaidKobo: amountKobo,
        highVolumeThreshold: suspiciousThreshold,
        highVolumeHardThreshold: suspiciousHighThreshold,
      });
      await recordVoteAudit({
        domain: 'open-mic',
        action: 'vote_credited',
        actorId: input.voterUserId ?? 'anonymous',
        entityId: input.submissionId,
        entityType: 'competition_entry',
        contestId: input.contestId,
        contestantId: input.submissionId,
        paymentReference: input.paymentReference ?? null,
        votes: input.votes,
        amountPaidKobo: amountKobo,
        amountExpectedKobo: amountKobo,
        fraudScore: fraud.score,
      });
    }
    return updated;
  } catch (error) {
    if (!shouldFallback(error)) throw error;
    return castVoteMemory(input);
  }
}

export async function getLeaderboard(contestId: string) {
  if (!shouldUseDb()) return [];
  try {
    const supabase = createAdminClient();
    const { data, error } = await supabase
      .from('competition_entries')
      .select('*')
      .eq('competition_id', contestId)
      .in('status', ['submitted', 'published_for_voting', 'finalist', 'winner', 'live_for_voting'])
      .order('leaderboard_score', { ascending: false })
      .order('public_vote_count', { ascending: false });
    if (error) throw error;
    return safeArray<any>(data).map(mapSubmissionRow);
  } catch (error) {
    if (!shouldFallback(error)) throw error;
    return getLeaderboardMemory(contestId);
  }
}

export async function generateFinalists(contestId: string) {
  if (!shouldUseDb()) throw new Error('Open Mic DB is not configured.');
  try {
    const finalists = generateFinalistsMemory(contestId);
    const supabase = createAdminClient();
    const finalistIds = finalists.map((f) => f.id);
    if (finalistIds.length > 0) {
      const { error } = await supabase
        .from('competition_entries')
        .update({ status: 'finalist' })
        .in('id', finalistIds);
      if (error) throw error;
    }
    return finalists;
  } catch (error) {
    if (!shouldFallback(error)) throw error;
    return generateFinalistsMemory(contestId);
  }
}

export async function announceWinner(contestId: string, submissionId: string, actorId?: string) {
  if (!shouldUseDb()) throw new Error('Open Mic DB is not configured.');
  try {
    const winner = announceWinnerMemory(contestId, submissionId);
    const supabase = createAdminClient();
    const { error: updateError } = await supabase
      .from('competition_entries')
      .update({ status: 'winner' })
      .eq('id', submissionId);
    if (updateError) throw updateError;

    const { error: winnerErr } = await supabase.from('winner_records').insert({
      competition_id: contestId,
      entry_id: submissionId,
      winner_tier: 'winner',
      award_title: 'Monthly Winner',
      announcement_note: 'Spotlight Open Mic monthly winner',
      announced_by: actorId || null,
      published: true,
    });
    if (winnerErr) throw winnerErr;
    return winner;
  } catch (error) {
    if (!shouldFallback(error)) throw error;
    return announceWinnerMemory(contestId, submissionId);
  }
}

export async function getFinalePlaylist(contestId: string) {
  if (!shouldUseDb()) return [];
  try {
    const contest = await getContestById(contestId);
    if (!contest) throw new Error('Contest not found.');
    return contest.finalePlaylist || [];
  } catch (error) {
    if (!shouldFallback(error)) throw error;
    return getFinalePlaylistMemory(contestId);
  }
}

export async function saveFinalePlaylist(
  contestId: string,
  entries: Array<{ submissionId: string; order?: number }>
) {
  if (!shouldUseDb()) throw new Error('Open Mic DB is not configured.');
  try {
    const playlist = saveFinalePlaylistMemory(contestId, entries);
    const contest = await getContestById(contestId);
    if (!contest) throw new Error('Contest not found.');
    const supabase = createAdminClient();
    const { error } = await supabase
      .from('contests')
      .update({
        sponsor_assets: {
          month: contest.month,
          year: contest.year,
          season: contest.season,
          objective: contest.objective,
          theme: contest.theme,
          hashtag: contest.hashtag,
          status: contest.status,
          recurrence: contest.recurrence,
          voting: contest.votingConfig,
          finale: contest.finale,
          finalePlaylist: playlist,
          finalePlaylistLocked: contest.finalePlaylistLocked === true,
          selectionModel: contest.selectionModel,
          finalistsTarget: contest.finalistsTarget,
        },
      })
      .eq('id', contestId);
    if (error) throw error;
    return playlist;
  } catch (error) {
    if (!shouldFallback(error)) throw error;
    return saveFinalePlaylistMemory(contestId, entries);
  }
}

export async function buildFinalePlaylistFromFinalists(contestId: string) {
  if (!shouldUseDb()) throw new Error('Open Mic DB is not configured.');
  try {
    const playlist = buildFinalePlaylistFromFinalistsMemory(contestId);
    await saveFinalePlaylist(contestId, playlist.map((item) => ({ submissionId: item.submissionId, order: item.order })));
    return playlist;
  } catch (error) {
    if (!shouldFallback(error)) throw error;
    return buildFinalePlaylistFromFinalistsMemory(contestId);
  }
}

export async function setFinalePlaylistLocked(contestId: string, locked: boolean) {
  if (!shouldUseDb()) throw new Error('Open Mic DB is not configured.');
  try {
    const contest = setFinalePlaylistLockedMemory(contestId, locked);
    const supabase = createAdminClient();
    const { error } = await supabase
      .from('contests')
      .update({
        sponsor_assets: {
          month: contest.month,
          year: contest.year,
          season: contest.season,
          objective: contest.objective,
          theme: contest.theme,
          hashtag: contest.hashtag,
          status: contest.status,
          recurrence: contest.recurrence,
          voting: contest.votingConfig,
          finale: contest.finale,
          finalePlaylist: contest.finalePlaylist,
          finalePlaylistLocked: contest.finalePlaylistLocked === true,
          selectionModel: contest.selectionModel,
          finalistsTarget: contest.finalistsTarget,
        },
      })
      .eq('id', contestId);
    if (error) throw error;
    return contest;
  } catch (error) {
    if (!shouldFallback(error)) throw error;
    return setFinalePlaylistLockedMemory(contestId, locked);
  }
}

export async function updateFinalePlaybackItem(
  contestId: string,
  submissionId: string,
  patch: {
    played?: boolean;
    djCueNote?: string;
    judgeScore?: number;
    audienceReactionScore?: number;
  }
) {
  if (!shouldUseDb()) throw new Error('Open Mic DB is not configured.');
  try {
    const item = updateFinalePlaybackItemMemory(contestId, submissionId, patch);
    const contest = await getContestById(contestId);
    if (!contest) throw new Error('Contest not found.');
    const supabase = createAdminClient();
    const { error } = await supabase
      .from('contests')
      .update({
        sponsor_assets: {
          month: contest.month,
          year: contest.year,
          season: contest.season,
          objective: contest.objective,
          theme: contest.theme,
          hashtag: contest.hashtag,
          status: contest.status,
          recurrence: contest.recurrence,
          voting: contest.votingConfig,
          finale: contest.finale,
          finalePlaylist: contest.finalePlaylist,
          finalePlaylistLocked: contest.finalePlaylistLocked === true,
          selectionModel: contest.selectionModel,
          finalistsTarget: contest.finalistsTarget,
        },
      })
      .eq('id', contestId);
    if (error) throw error;
    return item;
  } catch (error) {
    if (!shouldFallback(error)) throw error;
    return updateFinalePlaybackItemMemory(contestId, submissionId, patch);
  }
}
