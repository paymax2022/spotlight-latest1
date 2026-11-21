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
 * WRITES WIRED SO FAR: contest metadata (updateOpenMicContest), creating a
 * contest, beat upload, and every applicant decision plus the applicant contact
 * edit (applyOpenMicApplicantAction / updateOpenMicApplicantContact) — the last
 * two are why the Applications tab can now be worked from this page instead of
 * /admin/registration.
 *
 * STILL NOT PORTED, documented rather than silent: resolving a fraud alert,
 * marking a notification sent, reconciling a payment event, triggering
 * finalist generation, announcing a winner, and building/locking the finale
 * playlist. Each of those API routes already exists and is Path-A-ready (see
 * the GET counterparts wired below); wiring the write side is follow-up work.
 */
import { webProxyBase } from '@/config/env';

export type OpenMicContest = {
  id: string;
  title: string;
  slug: string;
  description?: string;
  status: string;
  visibility?: string;
  month: number;
  year: number;
  season: string;
  registrationFeeNgn: number;
  entryFeeRequired?: boolean;
  votingConfig: {
    votePrice: number;
    freeVotesPerDay: number;
    enabled?: boolean;
    freeVoting?: boolean;
    paidVoting?: boolean;
    leaderboardVisible?: boolean;
    voteCountPublic?: boolean;
  };
  finale: {
    venueName: string; venueType: string; address: string; city: string; state: string;
    date?: string; showStartTime?: string; playbackMode?: string;
  };
  prizes: Array<{ title: string }>;
  finalistsTarget: number;
  judgeWeight?: number;
  publicVoteWeight?: number;
  selectionModel: string;
};

/**
 * Fields editable from the admin console's Edit Contest tab. A subset of
 * OpenMicContest's writable surface — PATCH /api/admin/open-mic/contests/:id
 * (updateContest) accepts more (recurrence, prizes, beat, playlist), but
 * those aren't exposed here yet. votingConfig/finale are whole-object
 * replacements server-side (no deep merge), so the caller must send the
 * complete sub-object, not a partial one.
 */
export type OpenMicContestEditInput = Partial<{
  title: string;
  description: string;
  status: string;
  visibility: string;
  registrationFeeNgn: number;
  entryFeeRequired: boolean;
  votingConfig: OpenMicContest['votingConfig'];
  finale: OpenMicContest['finale'];
  finalistsTarget: number;
  judgeWeight: number;
  publicVoteWeight: number;
  selectionModel: string;
}>;

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
  /**
   * Which data plane the applicant came from: 'registration' is the live apply
   * form (registrations + the promoted contestants roster row), 'enrollment' is
   * the older competition_enrollments plane. The server merges and de-duplicates
   * them, so one person is one row; the field is here because a mixed list is
   * not one table and the tab should not pretend otherwise.
   */
  source?: 'registration' | 'enrollment';
  /**
   * The applicant's exact `registrations.status` ('shortlisted',
   * 'more_information_requested', …), sent by the server for registration-plane
   * rows only. `applicationStatus` above collapses nineteen registration states
   * into the console's three — right for the Reports tile, wrong for the tab
   * that makes those decisions, where a reload would show a just-shortlisted
   * applicant as Pending. The Applications column prefers this field.
   */
  registrationStatus?: string;
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
  return {};
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

/**
 * PATCH /api/admin/open-mic/contests/:id (assertOpenMicAdmin — write access,
 * stricter than the read-only assertOpenMicReadAdmin the GET above uses).
 * Already existed server-side; this is the first client wiring for it.
 */
export async function updateOpenMicContest(
  id: string,
  patch: OpenMicContestEditInput,
): Promise<OpenMicContest> {
  const res = await fetch(`${webBase()}/api/admin/open-mic/contests/${id}`, {
    method: 'PATCH',
    headers: { ...authHeaders(), 'Content-Type': 'application/json' },
    body: JSON.stringify(patch),
  });
  const json = (await res.json().catch(() => ({}))) as { success?: boolean; contest?: OpenMicContest; error?: string };
  if (res.status === 401) throw new Error('Update contest failed: 401 — sign in again.');
  if (res.status === 403) throw new Error('Update contest failed: 403 — this account cannot edit Open Mic contests.');
  if (res.status === 404) throw new Error('Update contest failed: contest not found.');
  if (!res.ok || !json.contest) throw new Error(`Update contest failed: ${json.error || res.status}`);
  return json.contest;
}

/**
 * The contest's applicants — merged across both planes by
 * GET /api/admin/open-mic/contests/:id/applicants.
 *
 * This used to call /contests/:id/applications, which reads
 * `competition_enrollments` only. The public apply form writes `registrations`
 * (keyed by contest slug) instead, so an Open Mic applicant who applied today
 * was invisible here and the Reports tile counted 0 — while the same person
 * showed normally under /admin/registration. The /applications route is left
 * untouched for its enrollment-plane semantics; the merge lives server-side in
 * src/server/registration-v2/open-mic-applicants.ts.
 */
export async function listOpenMicApplications(contestId: string): Promise<OpenMicApplicationRow[]> {
  const json = await getJson<{ applications: OpenMicApplicationRow[] }>(
    `/api/admin/open-mic/contests/${contestId}/applicants`, 'Applications');
  return json.applications ?? [];
}

/**
 * Applicant decisions, ported from the /admin/registration console so an Open
 * Mic edition can be worked end to end without leaving its page. The list and
 * the labels live here because the tab renders one control per action and the
 * server route validates the same seven values — drift between the two would
 * mean a button that 400s.
 */
export const OPEN_MIC_APPLICANT_ACTIONS = [
  'approve', 'shortlist', 'waitlist', 'reject', 'disqualify', 'request_information', 'withdraw',
] as const;
export type OpenMicApplicantAction = (typeof OPEN_MIC_APPLICANT_ACTIONS)[number];

export const OPEN_MIC_APPLICANT_ACTION_LABELS: Record<OpenMicApplicantAction, string> = {
  approve: 'Approve',
  shortlist: 'Shortlist',
  waitlist: 'Waitlist',
  reject: 'Reject',
  disqualify: 'Disqualify',
  request_information: 'Request information',
  withdraw: 'Withdraw',
};

/** Actions that end the applicant's run; the console colours them as destructive. */
const DESTRUCTIVE_ACTIONS: readonly OpenMicApplicantAction[] = ['reject', 'disqualify', 'withdraw'];

export function isOpenMicApplicantActionDestructive(action: OpenMicApplicantAction): boolean {
  return DESTRUCTIVE_ACTIONS.includes(action);
}

async function postJson<T extends Record<string, unknown>>(
  path: string,
  method: 'POST' | 'PATCH',
  label: string,
  body: Record<string, unknown>,
): Promise<T> {
  const res = await fetch(`${webBase()}${path}`, {
    method,
    headers: { ...authHeaders(), 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  const json = (await res.json().catch(() => ({}))) as Record<string, unknown>;
  if (res.status === 401) throw new Error(`${label} failed: 401 — sign in again.`);
  if (res.status === 403) throw new Error(`${label} failed: 403 — this account cannot manage Open Mic applicants.`);
  if (!res.ok) throw new Error(`${label} failed: ${String(json.error || res.status)}`);
  return json as T;
}

export type OpenMicApplicantActionResult = { status: string; emailDelivered: boolean };

/**
 * POST /api/admin/open-mic/contests/:id/applicants/:applicationId
 * (assertOpenMicAdmin). 'request_information' additionally needs a note — the
 * route refuses it blank and emails the applicant when it is not.
 */
export async function applyOpenMicApplicantAction(
  contestId: string,
  applicationId: string,
  action: OpenMicApplicantAction,
  note?: string,
): Promise<OpenMicApplicantActionResult> {
  const json = await postJson<{ success?: boolean; status?: string; emailDelivered?: boolean }>(
    `/api/admin/open-mic/contests/${contestId}/applicants/${applicationId}`,
    'POST',
    OPEN_MIC_APPLICANT_ACTION_LABELS[action],
    note ? { action, note } : { action },
  );
  return { status: String(json.status || ''), emailDelivered: Boolean(json.emailDelivered) };
}

/**
 * PATCH the same route — corrects a mistyped email/phone/stage name, which is
 * what breaks a request-for-information before the applicant ever sees it.
 * Only the fields passed are written; both email columns stay in sync
 * server-side so the list and the mailer agree.
 */
export async function updateOpenMicApplicantContact(
  contestId: string,
  applicationId: string,
  patch: Partial<{ stageName: string; email: string; phone: string }>,
): Promise<void> {
  await postJson<{ success?: boolean }>(
    `/api/admin/open-mic/contests/${contestId}/applicants/${applicationId}`,
    'PATCH',
    'Applicant contact',
    patch,
  );
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
 * Ported here in full except the beat file-picker, which `uploadOpenMicBeat`
 * below now provides: a pasted URL is not a playable value, because the public
 * beat reader only serves /api/open-mic/beats/… paths.
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

/**
 * Upload the official beat mp3. This is the one write the Path-A port skipped:
 * the note above createOpenMicContest claimed the web proxy could not carry a
 * binary body, and app/api/web-proxy/[...path]/route.ts has since been fixed to
 * forward request.arrayBuffer() verbatim with the caller's Content-Type, so the
 * multipart boundary survives and the file lands intact.
 *
 * Returns the two root-relative reader paths served by GET /api/open-mic/beats/[fileKey];
 * the caller files them as the contest's beat URLs. Throws with the server's own wording
 * so the form can show why an upload was refused.
 */
export async function uploadOpenMicBeat(
  file: File,
  contestId?: string,
): Promise<{ previewUrl: string; downloadUrl: string }> {
  const body = new FormData();
  body.append('file', file);
  const qs = contestId ? `?contestId=${encodeURIComponent(contestId)}` : '';
  const res = await fetch(`${webBase()}/api/admin/open-mic/beats${qs}`, {
    method: 'POST',
    body,
  });
  const json = (await res.json().catch(() => ({}))) as {
    success?: boolean; error?: string; beat?: { previewUrl?: string; downloadUrl?: string };
  };
  if (res.status === 401) throw new Error('Beat upload failed: 401 — sign in again.');
  if (res.status === 403) throw new Error('Beat upload failed: 403 — this account cannot edit Open Mic contests.');
  if (!res.ok || !json.success) throw new Error(`Beat upload failed: ${json.error || res.status}`);
  const downloadUrl = String(json.beat?.downloadUrl || '');
  if (!downloadUrl) throw new Error('Beat upload failed: the server returned no beat URL.');
  return { previewUrl: String(json.beat?.previewUrl || downloadUrl), downloadUrl };
}
