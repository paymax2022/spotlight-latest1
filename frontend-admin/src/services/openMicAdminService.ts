/**
 * Open Mic admin data — the third and largest console served over PATH A
 * (ADMIN CONSOLIDATION slice 4; see docs/adr/ADR-047-admin-console-consolidation-path-a.md).
 *
 * Its data has no Go module; it lives in frontend-web's openmic/persistence
 * (Supabase-backed) and arrives via /api/web-proxy, same shape as contests
 * (slice 3) and scoring (slice 4a). Every route this calls already existed in
 * frontend-web with proper Bearer-JWT auth (assertOpenMicReadAdmin /
 * assertOpenMicAdmin / assertOpenMicScoreAdmin, all thin wrappers over the same
 * assertAdminPermission used everywhere else) — nothing changed there, only a
 * client + service on this side reaching it through the proxy.
 *
 * SCOPE CUT, documented rather than silent: this ports every READ surface the
 * original 12 frontend-web pages had (applications, submissions, finalists,
 * winners, payments, fraud alerts, beat downloads, votes/leaderboard,
 * notifications, finale playlist, reports) plus the contest list. It does NOT
 * port the write actions those pages' original components offered — resolving
 * a fraud alert, marking a notification sent, reconciling a payment event,
 * triggering finalist generation, announcing a winner, editing contest
 * metadata, or building/locking the finale playlist. Each of those API routes
 * already exists and is Path-A-ready (see the GET counterparts wired below);
 * wiring the write side is follow-up work, not done here.
 */
import { webProxyBase } from '@/config/env';

export type OpenMicContest = {
  id: string;
  title: string;
  slug: string;
  status: string;
  month: number;
  year: number;
  season: string;
  registrationFeeNgn: number;
  votingConfig: { votePrice: number; freeVotesPerDay: number };
  finale: { venueName: string; venueType: string; address: string; city: string; state: string; date?: string; showStartTime?: string };
  prizes: Array<{ title: string }>;
  finalistsTarget: number;
  selectionModel: string;
};

export type OpenMicApplicationRow = {
  id: string;
  artistName: string;
  stageName: string;
  email: string;
  phone: string;
  applicationStatus: string;
  paymentStatus: string;
  beatDownloadStatus: string;
  appliedAt: string;
};

export type OpenMicSubmissionRow = {
  id: string;
  stageName: string;
  songTitle: string;
  status: string;
  voteCount: number;
  isFinalist: boolean;
  isWinner: boolean;
  genre?: string;
  submittedAt?: string;
};

export type OpenMicPaymentEventRow = {
  id: string;
  eventType: string;
  amountNgn: number;
  paymentStatus: string;
  paymentReference?: string;
  createdAt: string;
};

export type OpenMicFraudAlertRow = {
  id: string;
  submissionId: string;
  severity: string;
  reason: string;
  votesInEvent: number;
  status: string;
  createdAt: string;
};

export type OpenMicBeatDownloadRow = {
  id: string;
  artistName: string;
  artistEmail?: string;
  termsAccepted: boolean;
  paidAccessConfirmed: boolean;
  downloadedAt: string;
};

export type OpenMicNotificationRow = {
  id: string;
  audience: string;
  channel: string;
  sent: boolean;
  createdAt: string;
};

export type OpenMicFinalePlaylistItem = {
  order: number;
  submissionId: string;
  stageName: string;
  songTitle: string;
  played?: boolean;
};

export type OpenMicReportMetrics = {
  totalApplicants: number;
  approvedSongs: number;
  beatDownloads: number;
  totalVotes: number;
  votingRevenue: number;
  entryRevenue: number;
  totalRevenue: number;
  finalists: number;
  winners: number;
  suspiciousVotingAlerts: number;
  failedPayments: number;
};

function webBase(): string {
  return webProxyBase();
}

function authHeaders(): Record<string, string> {
  if (typeof window === 'undefined') return {};
  const token = localStorage.getItem('spotlight_admin_access_token') || '';
  return token ? { Authorization: `Bearer ${token}` } : {};
}

async function getJson<T extends Record<string, unknown>>(path: string, label: string): Promise<T> {
  const res = await fetch(`${webBase()}${path}`, { cache: 'no-store', headers: authHeaders() });
  const json = (await res.json().catch(() => ({}))) as Record<string, unknown>;
  if (res.status === 401) throw new Error(`${label} failed: 401 — sign in again.`);
  if (res.status === 403) throw new Error(`${label} failed: 403 — this account cannot view Open Mic admin data.`);
  if (!res.ok) throw new Error(`${label} failed: ${(json.error as string) || res.status}`);
  return json as T;
}

export async function listOpenMicContests(): Promise<OpenMicContest[]> {
  const json = await getJson<{ contests: OpenMicContest[] }>('/api/admin/open-mic/contests', 'Open Mic contests');
  return json.contests ?? [];
}

export async function getOpenMicContest(id: string): Promise<OpenMicContest | null> {
  const json = await getJson<{ contest: OpenMicContest | null }>(`/api/admin/open-mic/contests/${id}`, 'Open Mic contest');
  return json.contest ?? null;
}

export async function listOpenMicApplications(contestId: string): Promise<OpenMicApplicationRow[]> {
  const json = await getJson<{ applications: OpenMicApplicationRow[] }>(
    `/api/admin/open-mic/contests/${contestId}/applications`, 'Applications');
  return json.applications ?? [];
}

export async function listOpenMicSubmissions(contestId: string): Promise<OpenMicSubmissionRow[]> {
  const json = await getJson<{ submissions: OpenMicSubmissionRow[] }>(
    `/api/admin/open-mic/submissions?contestId=${encodeURIComponent(contestId)}`, 'Submissions');
  return json.submissions ?? [];
}

export async function listOpenMicFinalists(contestId: string): Promise<{ finalists: OpenMicSubmissionRow[]; leaderboard: OpenMicSubmissionRow[] }> {
  const json = await getJson<{ finalists: OpenMicSubmissionRow[]; leaderboard: OpenMicSubmissionRow[] }>(
    `/api/admin/open-mic/contests/${contestId}/finalists`, 'Finalists');
  return { finalists: json.finalists ?? [], leaderboard: json.leaderboard ?? [] };
}

export async function listOpenMicPayments(contestId: string): Promise<OpenMicPaymentEventRow[]> {
  const json = await getJson<{ events: OpenMicPaymentEventRow[] }>(
    `/api/admin/open-mic/contests/${contestId}/payments`, 'Payment events');
  return json.events ?? [];
}

export async function listOpenMicFraudAlerts(contestId: string): Promise<OpenMicFraudAlertRow[]> {
  const json = await getJson<{ alerts: OpenMicFraudAlertRow[] }>(
    `/api/admin/open-mic/contests/${contestId}/fraud-alerts`, 'Fraud alerts');
  return json.alerts ?? [];
}

export async function listOpenMicBeatDownloads(contestId: string): Promise<OpenMicBeatDownloadRow[]> {
  const json = await getJson<{ downloads: OpenMicBeatDownloadRow[] }>(
    `/api/admin/open-mic/contests/${contestId}/beat-downloads`, 'Beat downloads');
  return json.downloads ?? [];
}

export async function getOpenMicVotingAnalytics(contestId: string): Promise<{
  totalVotes: number; votePrice: number; paidVoteRevenue: number; leaderboard: OpenMicSubmissionRow[];
}> {
  const json = await getJson<{ totalVotes: number; votePrice: number; paidVoteRevenue: number; leaderboard: OpenMicSubmissionRow[] }>(
    `/api/admin/open-mic/contests/${contestId}/votes`, 'Voting analytics');
  return {
    totalVotes: json.totalVotes ?? 0,
    votePrice: json.votePrice ?? 0,
    paidVoteRevenue: json.paidVoteRevenue ?? 0,
    leaderboard: json.leaderboard ?? [],
  };
}

export async function listOpenMicNotifications(contestId: string): Promise<OpenMicNotificationRow[]> {
  const json = await getJson<{ notifications: OpenMicNotificationRow[] }>(
    `/api/admin/open-mic/contests/${contestId}/notifications`, 'Notifications');
  return json.notifications ?? [];
}

export async function getOpenMicFinalePlaylist(contestId: string): Promise<OpenMicFinalePlaylistItem[]> {
  const json = await getJson<{ playlist: OpenMicFinalePlaylistItem[] }>(
    `/api/admin/open-mic/contests/${contestId}/playlist`, 'Finale playlist');
  return json.playlist ?? [];
}

export async function getOpenMicReportMetrics(contestId: string): Promise<OpenMicReportMetrics> {
  const json = await getJson<{ metrics: OpenMicReportMetrics }>(
    `/api/admin/open-mic/contests/${contestId}/reports`, 'Reports');
  return json.metrics;
}

export type CreateOpenMicContestInput = {
  title: string;
  slug: string;
  description: string;
  month: number;
  year: number;
  season: string;
  status: string;
  registrationFeeNgn: number;
  entryFeeRequired: boolean;
  recurrence: {
    enabled: boolean;
    repeatMonths: number;
    autoCreateNext: boolean;
    autoCopySettings: boolean;
    autoPublishFuture: boolean;
    requireNewBeatEveryMonth: boolean;
  };
  beat: {
    beatTitle: string;
    producerName: string;
    producerCredit: string;
    downloadUrl: string;
    previewUrl: string;
    usageRules: string;
    allowDownload: boolean;
    previewOnly: boolean;
    requiresPaidEntryForDownload: boolean;
    cleanVersionRequired: boolean;
    explicitLyricsAllowed: boolean;
  };
  finalistsTarget: number;
  judgeWeight: number;
  publicVoteWeight: number;
  finale: {
    venueName: string;
    venueType: string;
    address: string;
    city: string;
    state: string;
    playbackMode: string;
  };
};

/**
 * Create a monthly Open Mic contest edition. Ported from frontend-web's
 * OpenMicAdminContestBuilder (app/admin/(dashboard)/open-mic/contests/new) —
 * same payload shape, same route (POST /api/admin/open-mic/contests, guarded
 * by assertOpenMicAdmin), reached through the web proxy like every other read
 * above.
 *
 * NOT ported: the "upload a beat file" control. The web proxy forwards the
 * request body as text (see frontend-admin/app/api/web-proxy/[...path]/route.ts),
 * which corrupts a binary multipart upload — it only works for JSON bodies.
 * This form keeps the "paste a beat URL" path (already the primary path in
 * the original UI) and drops the file-picker; paste a pre-hosted URL instead.
 */
export async function createOpenMicContest(
  input: CreateOpenMicContestInput,
): Promise<{ success: boolean; contest?: OpenMicContest; errors?: Record<string, string> }> {
  const res = await fetch(`${webBase()}/api/admin/open-mic/contests`, {
    method: 'POST',
    headers: { ...authHeaders(), 'Content-Type': 'application/json' },
    body: JSON.stringify(input),
  });
  const json = (await res.json().catch(() => ({}))) as {
    success?: boolean; contest?: OpenMicContest; errors?: Record<string, string>; error?: string;
  };
  if (res.status === 401) throw new Error('Create contest failed: 401 — sign in again.');
  if (res.status === 403) throw new Error('Create contest failed: 403 — this account cannot create Open Mic contests.');
  if (!res.ok && !json.errors) throw new Error(`Create contest failed: ${json.error || res.status}`);
  return { success: Boolean(json.success), contest: json.contest, errors: json.errors };
}
