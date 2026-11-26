'use client';

/**
 * Open Mic — contest detail console (admin consolidation slice 4; see
 * docs/adr/ADR-047-admin-console-consolidation-path-a.md).
 *
 * Consolidates what were 11 separate frontend-web pages
 * (applications/submissions/finalists/winners/payments/fraud-alerts/
 * beat-downloads/votes/notifications/finale/reports, all under
 * app/admin/(dashboard)/open-mic/[contestId]/) into one tabbed page here,
 * rather than one file per tab — same data, one place. See
 * openMicAdminService.ts for exactly which read endpoints are wired and which
 * write actions (resolve alert, mark notification sent, generate finalists,
 * announce winner, build/lock finale playlist) are not yet ported. Editing
 * contest metadata now IS wired (Edit Contest tab, below) — PATCH
 * /api/admin/open-mic/contests/:id already existed server-side; this is its
 * first client wiring — as is reviewing a handed-in song (Submissions tab,
 * `OpenMicSubmissionReviewPanel`), which is the action that decides whether an
 * artist's track is playable by voters at all.
 */
import { useCallback, useEffect, useMemo, useState, type CSSProperties } from 'react';
import { useParams } from 'next/navigation';
import {
  getOpenMicContest,
  updateOpenMicContest,
  listOpenMicApplications,
  listOpenMicSubmissions,
  listOpenMicFinalists,
  listOpenMicPayments,
  listOpenMicFraudAlerts,
  listOpenMicBeatDownloads,
  getOpenMicVotingAnalytics,
  listOpenMicNotifications,
  getOpenMicFinalePlaylist,
  getOpenMicReportMetrics,
  applyOpenMicApplicantAction,
  updateOpenMicApplicantContact,
  isOpenMicApplicantActionDestructive,
  OPEN_MIC_APPLICANT_ACTIONS,
  OPEN_MIC_APPLICANT_ACTION_LABELS,
  type OpenMicApplicantAction,
  type OpenMicApplicationRow,
  type OpenMicContest,
  type OpenMicContestEditInput,
  type OpenMicSubmissionRow,
} from '@/services/openMicAdminService';
import { Page, PageHeader, Card, Button, Input, Badge, colors, thCell, tdCell } from '@/components/ui/vuexy';
import { submissionWindowNotice, toDateTimeLocalInput } from '@/features/openmic/submission-window';
import OpenMicSubmissionReviewPanel from '@/features/openmic/song-review-panel';
import { adminMediaUrl, uploadContestBanner } from '@/services/contestsAdminService';
import { beatDownloadCells, winnerPrizeCell } from './open-mic-cells';

const TABS = [
  'Edit Contest', 'Applications', 'Submissions', 'Finalists', 'Winners', 'Payments',
  'Fraud Alerts', 'Beat Downloads', 'Votes', 'Notifications', 'Finale', 'Reports',
] as const;
type Tab = (typeof TABS)[number];

const CONTEST_STATUSES = [
  'draft', 'scheduled', 'published', 'registration_open', 'beat_available',
  'submission_open', 'submission_closed', 'under_review', 'voting_live',
  'voting_closed', 'finalists_selected', 'grand_finale_scheduled',
  'grand_finale_live', 'winner_announced', 'completed', 'archived',
  'suspended', 'cancelled',
] as const;
const CONTEST_VISIBILITIES = ['public', 'private_invite_only', 'regional_only', 'hidden'] as const;
const SELECTION_MODELS = ['votes_only', 'judges_only', 'hybrid', 'admin_curated'] as const;
const PLAYBACK_MODES = ['all_approved', 'top_20', 'top_10', 'finalists_only'] as const;
const NIGERIA_STATES = [
  'Abia', 'Adamawa', 'Akwa Ibom', 'Anambra', 'Bauchi', 'Bayelsa', 'Benue', 'Borno',
  'Cross River', 'Delta', 'Ebonyi', 'Edo', 'Ekiti', 'Enugu', 'FCT', 'Gombe', 'Imo',
  'Jigawa', 'Kaduna', 'Kano', 'Katsina', 'Kebbi', 'Kogi', 'Kwara', 'Lagos', 'Nasarawa',
  'Niger', 'Ogun', 'Ondo', 'Osun', 'Oyo', 'Plateau', 'Rivers', 'Sokoto', 'Taraba',
  'Yobe', 'Zamfara',
];

const labelStyle: CSSProperties = { display: 'block', fontSize: 12, fontWeight: 600, color: colors.muted, marginBottom: 4 };
const fieldWrap: CSSProperties = { marginBottom: 14 };
const selectStyle: CSSProperties = { width: '100%', padding: '8px 10px', borderRadius: 6, border: `1px solid ${colors.inputBorder}`, fontSize: 13 };

type EditFormState = {
  title: string; description: string; bannerImageUrl: string; status: string; visibility: string;
  registrationFeeNgn: number; entryFeeRequired: boolean;
  votePrice: number; freeVotesPerDay: number; votingEnabled: boolean;
  freeVoting: boolean; paidVoting: boolean; leaderboardVisible: boolean; voteCountPublic: boolean;
  finalistsTarget: number; judgeWeight: number; publicVoteWeight: number; selectionModel: string;
  venueName: string; venueType: string; address: string; city: string; state: string;
  date: string; showStartTime: string; playbackMode: string;
  /** `datetime-local` wall-clock strings ('' = unset), hydrated from the stored
   *  ISO values by toDateTimeLocalInput and turned back into ISO on save. */
  submissionStartAt: string; submissionEndAt: string;
};

function formFromContest(c: OpenMicContest): EditFormState {
  return {
    title: c.title, description: c.description ?? '', bannerImageUrl: c.bannerImageUrl ?? '',
    status: c.status, visibility: c.visibility ?? 'public',
    registrationFeeNgn: c.registrationFeeNgn, entryFeeRequired: c.entryFeeRequired ?? false,
    votePrice: c.votingConfig.votePrice, freeVotesPerDay: c.votingConfig.freeVotesPerDay,
    votingEnabled: c.votingConfig.enabled ?? true, freeVoting: c.votingConfig.freeVoting ?? true,
    paidVoting: c.votingConfig.paidVoting ?? true, leaderboardVisible: c.votingConfig.leaderboardVisible ?? true,
    voteCountPublic: c.votingConfig.voteCountPublic ?? true,
    finalistsTarget: c.finalistsTarget, judgeWeight: c.judgeWeight ?? 30, publicVoteWeight: c.publicVoteWeight ?? 70,
    selectionModel: c.selectionModel,
    venueName: c.finale.venueName, venueType: c.finale.venueType, address: c.finale.address,
    city: c.finale.city, state: c.finale.state, date: c.finale.date ?? '', showStartTime: c.finale.showStartTime ?? '',
    playbackMode: c.finale.playbackMode ?? 'top_10',
    submissionStartAt: toDateTimeLocalInput(c.submissionStartAt), submissionEndAt: toDateTimeLocalInput(c.submissionEndAt),
  };
}

/**
 * What a datetime-local field holds → what the server stores. An empty field is
 * sent as null, not dropped, because PATCH merges `{...existing, ...patch}`: a
 * key that is absent leaves the old date in place, so clearing a window would
 * silently not clear it.
 */
function fromDateTimeLocalInput(value: string): string | null {
  const raw = String(value ?? '').trim();
  if (!raw) return null;
  const withSeconds = raw.length === 16 ? `${raw}:00` : raw;
  const ms = Date.parse(withSeconds);
  return Number.isNaN(ms) ? withSeconds : new Date(ms).toISOString();
}

function StatTile({ label, value, color }: { label: string; value: string | number; color?: string }) {
  return (
    <div style={{ background: colors.bg, border: `1px solid ${colors.border}`, borderRadius: 10, padding: '12px 14px' }}>
      <div style={{ fontSize: 12, color: colors.muted }}>{label}</div>
      <div style={{ fontSize: 20, fontWeight: 800, color: color ?? colors.text }}>{value}</div>
    </div>
  );
}

function Table({ columns, rows }: { columns: string[]; rows: Array<Array<React.ReactNode>> }) {
  if (rows.length === 0) return <p style={{ color: colors.muted, margin: 0 }}>Nothing here yet.</p>;
  return (
    <div style={{ overflowX: 'auto' }}>
      <table style={{ width: '100%', borderCollapse: 'collapse' }}>
        <thead>
          <tr>{columns.map((c) => <th key={c} style={thCell}>{c}</th>)}</tr>
        </thead>
        <tbody>
          {rows.map((row, i) => (
            <tr key={i}>{row.map((cell, j) => <td key={j} style={tdCell}>{cell}</td>)}</tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/**
 * One applicant's decisions, in their row.
 *
 * The actions a reviewer needs, wired to the same store path
 * /admin/registration uses, so approving here and approving there cannot drift
 * into two different records. Two rules the UI has to respect, both enforced
 * again server-side:
 *   - 'Request information' needs a note. Without one the applicant sees a
 *     status they cannot act on, and the email has nothing to ask for.
 *   - Only registration-plane rows are actionable. A legacy
 *     competition_enrollments row has no registrations record to write, and
 *     guessing which one it maps to would be worse than saying so.
 */
function ApplicantRowActions({ contestId, row, onRow }: {
  contestId: string;
  row: OpenMicApplicationRow;
  onRow: (patch: Partial<OpenMicApplicationRow>) => void;
}) {
  const [action, setAction] = useState<OpenMicApplicantAction | ''>('');
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);
  const [editing, setEditing] = useState(false);
  const [contact, setContact] = useState({
    stageName: row.stageName || '', email: row.email || '', phone: row.phone || '',
  });

  if (row.source !== 'registration') {
    return (
      <span style={{ fontSize: 12, color: colors.muted }}>
        Legacy enrollment — no apply-form record to manage
      </span>
    );
  }

  const needsNote = action === 'request_information';

  async function runAction() {
    if (!action) return;
    setBusy(true);
    setMessage(null);
    try {
      const result = await applyOpenMicApplicantAction(contestId, row.id, action, note.trim() || undefined);
      // The row updates in place rather than reloading the tab: a reload would
      // drop the message that just told the reviewer what happened. The precise
      // field is patched, not the three-state one — writing 'shortlisted' into
      // applicationStatus would put a value the coarse column cannot hold, and
      // the next reload would appear to undo the decision.
      onRow({ registrationStatus: result.status });
      setMessage({
        ok: true,
        text: action === 'request_information'
          ? (
              result.emailDelivered
                ? 'Marked and emailed the applicant.'
                // Two different reasons land here — no address on file, or no
                // mail provider configured — and neither one is a message the
                // applicant received, so the wording must not claim one.
                : 'Marked — no email went out (no address on file, or no mail provider configured).'
            )
          : `${OPEN_MIC_APPLICANT_ACTION_LABELS[action]} — saved.`,
      });
      setAction('');
      setNote('');
    } catch (e) {
      setMessage({ ok: false, text: e instanceof Error ? e.message : String(e) });
    } finally {
      setBusy(false);
    }
  }

  async function saveContact() {
    const patch: Record<string, string> = {};
    if (contact.stageName.trim() !== (row.stageName || '')) patch.stageName = contact.stageName.trim();
    if (contact.email.trim() !== (row.email || '')) patch.email = contact.email.trim();
    if (contact.phone.trim() !== (row.phone || '')) patch.phone = contact.phone.trim();
    if (!Object.keys(patch).length) {
      setMessage({ ok: false, text: 'Nothing changed.' });
      return;
    }
    setBusy(true);
    setMessage(null);
    try {
      await updateOpenMicApplicantContact(contestId, row.id, patch);
      onRow(patch);
      setMessage({ ok: true, text: 'Contact updated.' });
      setEditing(false);
    } catch (e) {
      setMessage({ ok: false, text: e instanceof Error ? e.message : String(e) });
    } finally {
      setBusy(false);
    }
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 6, minWidth: 260 }}>
      <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
        <select
          aria-label="Applicant action"
          value={action}
          onChange={(e) => setAction(e.target.value as OpenMicApplicantAction)}
          disabled={busy}
          style={{ ...selectStyle, width: 'auto', minWidth: 150 }}
        >
          <option value="">Choose action…</option>
          {OPEN_MIC_APPLICANT_ACTIONS.map((a) => (
            <option key={a} value={a}>{OPEN_MIC_APPLICANT_ACTION_LABELS[a]}</option>
          ))}
        </select>
        <Button
          variant={action && isOpenMicApplicantActionDestructive(action) ? 'danger' : 'primary'}
          onClick={runAction}
          disabled={busy || !action || (needsNote && !note.trim())}
        >
          {busy ? 'Working…' : 'Apply'}
        </Button>
        <Button variant="outline" onClick={() => setEditing((v) => !v)} disabled={busy}>
          {editing ? 'Cancel' : 'Edit contact'}
        </Button>
      </div>
      {needsNote && (
        <input
          aria-label="Information request note"
          placeholder="What do you need from the applicant? (required)"
          value={note}
          onChange={(e) => setNote(e.target.value)}
          disabled={busy}
          style={selectStyle}
        />
      )}
      {editing && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          <input
            aria-label="Stage name"
            placeholder="Stage name"
            value={contact.stageName}
            onChange={(e) => setContact((c) => ({ ...c, stageName: e.target.value }))}
            disabled={busy}
            style={selectStyle}
          />
          <input
            aria-label="Email"
            placeholder="Email"
            value={contact.email}
            onChange={(e) => setContact((c) => ({ ...c, email: e.target.value }))}
            disabled={busy}
            style={selectStyle}
          />
          <input
            aria-label="Phone"
            placeholder="Phone"
            value={contact.phone}
            onChange={(e) => setContact((c) => ({ ...c, phone: e.target.value }))}
            disabled={busy}
            style={selectStyle}
          />
          <Button onClick={saveContact} disabled={busy}>{busy ? 'Saving…' : 'Save contact'}</Button>
        </div>
      )}
      {message && (
        <p style={{ margin: 0, fontSize: 12, color: message.ok ? colors.success : colors.danger }}>{message.text}</p>
      )}
    </div>
  );
}

/** What a decision looks like to a reviewer scanning the list. */
function applicantStatusBadge(status: string) {
  const value = String(status || '').replace(/_/g, ' ');
  if (value === 'approved') return <Badge text={value} color={colors.success} />;
  if (value === 'rejected' || value === 'disqualified' || value === 'withdrawn' || value === 'eliminated') {
    return <Badge text={value} color={colors.danger} />;
  }
  if (value === 'more information requested' || value === 'waitlisted') return <Badge text={value} color={colors.warning} />;
  return <Badge text={value} color={colors.muted} />;
}

export default function OpenMicContestAdminPage() {
  const params = useParams();
  const contestId = params?.id as string;

  const [contest, setContest] = useState<OpenMicContest | null>(null);
  const [contestError, setContestError] = useState<string | null>(null);
  const [tab, setTab] = useState<Tab>('Edit Contest');

  const [editForm, setEditForm] = useState<EditFormState | null>(null);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [saveMessage, setSaveMessage] = useState('');
  const [bannerBusy, setBannerBusy] = useState(false);
  const [bannerError, setBannerError] = useState<string | null>(null);

  function setEditField<K extends keyof EditFormState>(key: K, value: EditFormState[K]) {
    setEditForm((prev) => (prev ? { ...prev, [key]: value } : prev));
  }

  const weightsInvalid = useMemo(
    () => !!editForm && editForm.judgeWeight + editForm.publicVoteWeight !== 100,
    [editForm],
  );

  // An inverted window is not a typo the server will notice: it simply refuses
  // every hand-in, which reads to the artist as "closed" and to the operator as
  // "nobody applied". The strict rule is describeSubmissionWindow's, so the
  // editor checks it before saving rather than after.
  const windowInvalid = useMemo(() => {
    if (!editForm) return false;
    const start = fromDateTimeLocalInput(editForm.submissionStartAt);
    const end = fromDateTimeLocalInput(editForm.submissionEndAt);
    if (!start || !end) return false;
    const startMs = Date.parse(start);
    const endMs = Date.parse(end);
    if (Number.isNaN(startMs) || Number.isNaN(endMs)) return false;
    return endMs <= startMs;
  }, [editForm]);

  async function saveContest() {
    if (!editForm || !contestId) return;
    if (weightsInvalid) {
      setSaveError('Judge weight and public vote weight must add up to 100%.');
      return;
    }
    if (windowInvalid) {
      setSaveError('The submission window cannot end before it starts — leave either date empty to clear it.');
      return;
    }
    setSaving(true);
    setSaveError(null);
    setSaveMessage('');
    try {
      const patch: OpenMicContestEditInput = {
        title: editForm.title,
        description: editForm.description,
        bannerImageUrl: editForm.bannerImageUrl.trim(),
        status: editForm.status,
        visibility: editForm.visibility,
        registrationFeeNgn: editForm.registrationFeeNgn,
        entryFeeRequired: editForm.entryFeeRequired,
        votingConfig: {
          votePrice: editForm.votePrice,
          freeVotesPerDay: editForm.freeVotesPerDay,
          enabled: editForm.votingEnabled,
          freeVoting: editForm.freeVoting,
          paidVoting: editForm.paidVoting,
          leaderboardVisible: editForm.leaderboardVisible,
          voteCountPublic: editForm.voteCountPublic,
        },
        finale: {
          venueName: editForm.venueName, venueType: editForm.venueType, address: editForm.address,
          city: editForm.city, state: editForm.state, date: editForm.date || undefined,
          showStartTime: editForm.showStartTime || undefined, playbackMode: editForm.playbackMode,
        },
        finalistsTarget: editForm.finalistsTarget,
        judgeWeight: editForm.judgeWeight,
        publicVoteWeight: editForm.publicVoteWeight,
        selectionModel: editForm.selectionModel,
        // Sent on every save, empty included, so clearing a date clears it:
        // updateContest spreads the patch over the stored row, so an absent key
        // would leave the old window in place no matter what the picker shows.
        submissionStartAt: fromDateTimeLocalInput(editForm.submissionStartAt),
        submissionEndAt: fromDateTimeLocalInput(editForm.submissionEndAt),
      };
      const updated = await updateOpenMicContest(contestId, patch);
      setContest(updated);
      setEditForm(formFromContest(updated));
      setSaveMessage('Contest updated.');
    } catch (e) {
      setSaveError(e instanceof Error ? e.message : String(e));
    } finally {
      setSaving(false);
    }
  }

  async function uploadBanner(event: React.ChangeEvent<HTMLInputElement>) {
    const file = event.currentTarget.files?.[0];
    event.currentTarget.value = '';
    if (!file) return;

    setBannerBusy(true);
    setBannerError(null);
    setSaveError(null);
    setSaveMessage('');
    try {
      const bannerImageUrl = await uploadContestBanner(file);
      setEditField('bannerImageUrl', bannerImageUrl);
      setSaveMessage('Banner uploaded. Save changes to apply it to this edition.');
    } catch (e) {
      setBannerError(e instanceof Error ? e.message : String(e));
    } finally {
      setBannerBusy(false);
    }
  }

  function removeBanner() {
    setEditField('bannerImageUrl', '');
    setBannerError(null);
    setSaveError(null);
    setSaveMessage('Banner removal is pending. Save changes to apply it.');
  }

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [rows, setRows] = useState<unknown>(null);
  // Which tab `rows` actually holds data for. Switching tabs re-renders
  // immediately with the NEW tab but the OLD rows/loading (loadTab only runs
  // after that render commits, via the effect below) — every branch below
  // reads `rows` unconditionally once its tab is active, so without this a
  // tab switch could render e.g. the Finalists branch (`rows.finalists.map`)
  // against Submissions' leftover array rows and crash. Gating on
  // `loadedTab === tab` instead of `!loading` means a tab only ever renders
  // against rows fetched for that same tab.
  const [loadedTab, setLoadedTab] = useState<Tab | null>(null);

  /**
   * The same rows the Submissions table shows, held apart from `rows` so the
   * review panel can refresh itself without flipping `loading`. Flipping it
   * would unmount the panel on every Apply click, which is precisely when the
   * operator needs to read the "status is now …" line and pick the next row.
   */
  const [submissionRows, setSubmissionRows] = useState<OpenMicSubmissionRow[] | null>(null);
  const [refreshingSubmissions, setRefreshingSubmissions] = useState(false);

  const refreshSubmissions = useCallback(async () => {
    if (!contestId) return;
    setRefreshingSubmissions(true);
    try {
      const list = await listOpenMicSubmissions(contestId);
      setSubmissionRows(list);
      setRows(list);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setRefreshingSubmissions(false);
    }
  }, [contestId]);

  useEffect(() => {
    if (!contestId) return;
    getOpenMicContest(contestId)
      .then((c) => { setContest(c); if (c) setEditForm(formFromContest(c)); })
      .catch((e) => setContestError(e instanceof Error ? e.message : String(e)));
  }, [contestId]);

  const loadTab = useCallback(async () => {
    if (!contestId) return;
    setLoading(true);
    setError(null);
    try {
      switch (tab) {
        // Edit Contest reads from `contest`/`editForm` (loaded separately,
        // above) rather than a per-tab endpoint — nothing to fetch here.
        case 'Edit Contest': break;
        case 'Applications': setRows(await listOpenMicApplications(contestId)); break;
        case 'Submissions': {
          // /api/admin/open-mic/submissions returns whole submission objects, so
          // songUrl/songObjectKey/reviewNote are already in the payload and the
          // queue needs no second request. It feeds `submissionRows` alone: this
          // tab no longer renders a table off `rows`.
          setSubmissionRows(await listOpenMicSubmissions(contestId));
          break;
        }
        case 'Finalists': setRows(await listOpenMicFinalists(contestId)); break;
        case 'Winners': setRows((await listOpenMicSubmissions(contestId)).filter((s) => s.isWinner)); break;
        case 'Payments': setRows(await listOpenMicPayments(contestId)); break;
        case 'Fraud Alerts': setRows(await listOpenMicFraudAlerts(contestId)); break;
        case 'Beat Downloads': setRows(await listOpenMicBeatDownloads(contestId)); break;
        case 'Votes': setRows(await getOpenMicVotingAnalytics(contestId)); break;
        case 'Notifications': setRows(await listOpenMicNotifications(contestId)); break;
        case 'Finale': setRows(await getOpenMicFinalePlaylist(contestId)); break;
        case 'Reports': {
          // metrics.totalApplicants is an enrollment-plane count, so it reads 0
          // for every contest whose applicants arrived through the public apply
          // form (registrations). The merged applicants list is the real
          // head-count and is what the Applications tab shows — the two tiles
          // must never disagree.
          const [metrics, applicants] = await Promise.all([
            getOpenMicReportMetrics(contestId),
            listOpenMicApplications(contestId),
          ]);
          setRows({ ...metrics, totalApplicants: applicants.length });
          break;
        }
      }
      setLoadedTab(tab);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }, [tab, contestId]);

  useEffect(() => { loadTab(); }, [loadTab]);

  /**
   * Writes one Applications row after a server change. The route has already
   * committed by the time this runs, so refetching the whole tab would only
   * cost the reviewer the confirmation message they just earned — the row is
   * patched in place instead.
   */
  function updateApplicationRow(id: string, patch: Partial<OpenMicApplicationRow>) {
    // `rows` is deliberately unknown-typed (one state for twelve tabs of
    // different shapes), so the updater parameter has to be spelled out.
    setRows((prev: unknown) => (Array.isArray(prev)
      ? (prev as OpenMicApplicationRow[]).map((row) => (row.id === id ? { ...row, ...patch } : row))
      : prev));
  }

  return (
    <Page>
      <PageHeader
        title={contest ? contest.title : 'Open Mic contest'}
        subtitle={contest ? `${contest.month}/${contest.year} · ${contest.season} · ${contest.status.replace(/_/g, ' ')}` : contestError ?? 'Loading…'}
      />

      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 16 }}>
        {TABS.map((t) => (
          <Button key={t} variant={tab === t ? 'primary' : 'outline'} sm onClick={() => setTab(t)}>{t}</Button>
        ))}
      </div>

      <Card>
        {loading && <p style={{ color: colors.muted }}>Loading {tab.toLowerCase()}…</p>}

        {error && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 12, alignItems: 'flex-start' }}>
            <p style={{ color: colors.danger, margin: 0 }}>{error}</p>
            <Button onClick={loadTab}>Retry</Button>
          </div>
        )}

        {!loading && !error && loadedTab === 'Edit Contest' && editForm && (
          <div style={{ maxWidth: 780, display: 'flex', flexDirection: 'column', gap: 20 }}>
            <section>
              <h3 style={{ fontSize: 13, fontWeight: 700, marginBottom: 10 }}>Contest Identity</h3>
              <div style={fieldWrap}>
                <label style={labelStyle}>Title</label>
                <Input value={editForm.title} onChange={(e) => setEditField('title', e.target.value)} style={{ width: '100%' }} />
              </div>
              <div style={fieldWrap}>
                <label style={labelStyle}>Description</label>
                <textarea value={editForm.description} onChange={(e) => setEditField('description', e.target.value)} rows={3}
                  style={{ width: '100%', padding: 8, borderRadius: 6, border: `1px solid ${colors.inputBorder}`, fontSize: 13 }} />
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
                <div style={fieldWrap}>
                  <label style={labelStyle}>Status</label>
                  <select value={editForm.status} onChange={(e) => setEditField('status', e.target.value)} style={selectStyle}>
                    {CONTEST_STATUSES.map((s) => <option key={s} value={s}>{s.replace(/_/g, ' ')}</option>)}
                  </select>
                </div>
                <div style={fieldWrap}>
                  <label style={labelStyle}>Visibility</label>
                  <select value={editForm.visibility} onChange={(e) => setEditField('visibility', e.target.value)} style={selectStyle}>
                    {CONTEST_VISIBILITIES.map((v) => <option key={v} value={v}>{v.replace(/_/g, ' ')}</option>)}
                  </select>
                </div>
              </div>
            </section>

            <section>
              <h3 style={{ fontSize: 13, fontWeight: 700, marginBottom: 10 }}>Contest Banner</h3>
              <p style={{ color: colors.muted, fontSize: 12, margin: '0 0 12px' }}>
                JPG, PNG, or WebP up to 8 MB. Uploading stores the image; save changes to publish it on the contest.
                Removing or replacing it unlinks the old image but does not delete its stored file.
              </p>
              {editForm.bannerImageUrl ? (
                <img
                  src={adminMediaUrl(editForm.bannerImageUrl)}
                  alt="Contest banner preview"
                  style={{ display: 'block', width: '100%', maxHeight: 240, objectFit: 'cover', borderRadius: 8, marginBottom: 12 }}
                />
              ) : (
                <p style={{ color: colors.muted, fontSize: 12, margin: '0 0 12px' }}>No banner is set for this edition.</p>
              )}
              <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
                <label htmlFor="open-mic-banner-file" style={{ ...labelStyle, margin: 0 }}>
                  {bannerBusy ? 'Uploading banner…' : editForm.bannerImageUrl ? 'Replace banner' : 'Add banner'}
                </label>
                <input
                  id="open-mic-banner-file"
                  aria-label="Contest banner image"
                  type="file"
                  accept=".jpg,.jpeg,.png,.webp,image/jpeg,image/png,image/webp"
                  onChange={uploadBanner}
                  disabled={bannerBusy || saving}
                />
                <Button
                  variant="danger"
                  onClick={removeBanner}
                  disabled={!editForm.bannerImageUrl || bannerBusy || saving}
                >
                  Remove banner
                </Button>
              </div>
              {bannerError && <p role="alert" style={{ color: colors.danger, fontSize: 12 }}>{bannerError}</p>}
            </section>

            <section>
              <h3 style={{ fontSize: 13, fontWeight: 700, marginBottom: 10 }}>Registration</h3>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
                <div style={fieldWrap}>
                  <label style={labelStyle}>Registration Fee (NGN)</label>
                  <Input type="number" value={editForm.registrationFeeNgn} onChange={(e) => setEditField('registrationFeeNgn', Number(e.target.value))} style={{ width: '100%' }} />
                </div>
                <div style={{ display: 'flex', alignItems: 'flex-end', paddingBottom: 10 }}>
                  <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13 }}>
                    <input type="checkbox" checked={editForm.entryFeeRequired} onChange={(e) => setEditField('entryFeeRequired', e.target.checked)} />
                    Paid registration required
                  </label>
                </div>
              </div>
            </section>

            <section>
              <h3 style={{ fontSize: 13, fontWeight: 700, marginBottom: 10 }}>Voting</h3>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
                <div style={fieldWrap}>
                  <label style={labelStyle}>Vote Price (NGN)</label>
                  <Input type="number" value={editForm.votePrice} onChange={(e) => setEditField('votePrice', Number(e.target.value))} style={{ width: '100%' }} />
                </div>
                <div style={fieldWrap}>
                  <label style={labelStyle}>Free Votes Per Day</label>
                  <Input type="number" value={editForm.freeVotesPerDay} onChange={(e) => setEditField('freeVotesPerDay', Number(e.target.value))} style={{ width: '100%' }} />
                </div>
              </div>
              <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap', fontSize: 13 }}>
                <label style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  <input type="checkbox" checked={editForm.votingEnabled} onChange={(e) => setEditField('votingEnabled', e.target.checked)} /> Voting enabled
                </label>
                <label style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  <input type="checkbox" checked={editForm.freeVoting} onChange={(e) => setEditField('freeVoting', e.target.checked)} /> Free voting
                </label>
                <label style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  <input type="checkbox" checked={editForm.paidVoting} onChange={(e) => setEditField('paidVoting', e.target.checked)} /> Paid voting
                </label>
                <label style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  <input type="checkbox" checked={editForm.leaderboardVisible} onChange={(e) => setEditField('leaderboardVisible', e.target.checked)} /> Leaderboard visible
                </label>
                <label style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  <input type="checkbox" checked={editForm.voteCountPublic} onChange={(e) => setEditField('voteCountPublic', e.target.checked)} /> Vote count public
                </label>
              </div>
            </section>

            <section>
              <h3 style={{ fontSize: 13, fontWeight: 700, marginBottom: 10 }}>Selection & Scoring</h3>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr 1fr', gap: 12 }}>
                <div style={fieldWrap}>
                  <label style={labelStyle}>Selection Model</label>
                  <select value={editForm.selectionModel} onChange={(e) => setEditField('selectionModel', e.target.value)} style={selectStyle}>
                    {SELECTION_MODELS.map((m) => <option key={m} value={m}>{m.replace(/_/g, ' ')}</option>)}
                  </select>
                </div>
                <div style={fieldWrap}>
                  <label style={labelStyle}>Finalists Target</label>
                  <Input type="number" value={editForm.finalistsTarget} onChange={(e) => setEditField('finalistsTarget', Number(e.target.value))} style={{ width: '100%' }} />
                </div>
                <div style={fieldWrap}>
                  <label style={labelStyle}>Judge Weight (%)</label>
                  <Input type="number" value={editForm.judgeWeight} onChange={(e) => setEditField('judgeWeight', Number(e.target.value))} style={{ width: '100%' }} />
                </div>
                <div style={fieldWrap}>
                  <label style={labelStyle}>Public Vote Weight (%)</label>
                  <Input type="number" value={editForm.publicVoteWeight} onChange={(e) => setEditField('publicVoteWeight', Number(e.target.value))} style={{ width: '100%' }} />
                </div>
              </div>
              {weightsInvalid && <p style={{ color: colors.danger, fontSize: 12, margin: 0 }}>Judge weight and public vote weight must add up to 100%.</p>}
            </section>

            <section>
              <h3 style={{ fontSize: 13, fontWeight: 700, marginBottom: 10 }}>Submission Window</h3>
              {/* The window is what decides whether an approved artist can hand a
                  song in at all, and the rule is strict-by-default: with neither
                  bound set, only the `submission_open` status accepts uploads.
                  Without these fields an operator could publish an edition, get
                  zero hand-ins, and have nothing on screen to explain it. */}
              <p
                role="status"
                style={{
                  margin: '0 0 12px', fontSize: 12,
                  color: submissionWindowNotice(contest).tone === 'ok' ? colors.success : colors.warning,
                }}
              >
                {submissionWindowNotice(contest).text}
              </p>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
                <div style={fieldWrap}>
                  <label style={labelStyle} htmlFor="submission-start-at">Submissions Open From</label>
                  <Input id="submission-start-at" type="datetime-local" value={editForm.submissionStartAt} onChange={(e) => setEditField('submissionStartAt', e.target.value)} style={{ width: '100%' }} />
                </div>
                <div style={fieldWrap}>
                  <label style={labelStyle} htmlFor="submission-end-at">Submissions Close At</label>
                  <Input id="submission-end-at" type="datetime-local" value={editForm.submissionEndAt} onChange={(e) => setEditField('submissionEndAt', e.target.value)} style={{ width: '100%' }} />
                </div>
              </div>
              {windowInvalid && (
                <p role="alert" style={{ color: colors.danger, fontSize: 12, margin: '0 0 12px' }}>
                  The close date is not after the open date. Save would lock every hand-in out.
                </p>
              )}
            </section>

            <section>
              <h3 style={{ fontSize: 13, fontWeight: 700, marginBottom: 10 }}>Finale Venue</h3>
              <div style={fieldWrap}>
                <label style={labelStyle}>Venue Name</label>
                <Input value={editForm.venueName} onChange={(e) => setEditField('venueName', e.target.value)} style={{ width: '100%' }} />
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
                <div style={fieldWrap}>
                  <label style={labelStyle}>Venue Type</label>
                  <select value={editForm.venueType} onChange={(e) => setEditField('venueType', e.target.value)} style={selectStyle}>
                    <option value="lounge">Lounge</option>
                    <option value="club">Club</option>
                    <option value="event_center">Event Center</option>
                    <option value="campus_venue">Campus Venue</option>
                    <option value="virtual">Virtual</option>
                  </select>
                </div>
                <div style={fieldWrap}>
                  <label style={labelStyle}>Playback Mode</label>
                  <select value={editForm.playbackMode} onChange={(e) => setEditField('playbackMode', e.target.value)} style={selectStyle}>
                    {PLAYBACK_MODES.map((m) => <option key={m} value={m}>{m.replace(/_/g, ' ')}</option>)}
                  </select>
                </div>
              </div>
              <div style={fieldWrap}>
                <label style={labelStyle}>Address</label>
                <Input value={editForm.address} onChange={(e) => setEditField('address', e.target.value)} style={{ width: '100%' }} />
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
                <div style={fieldWrap}>
                  <label style={labelStyle}>State</label>
                  <select value={editForm.state} onChange={(e) => setEditField('state', e.target.value)} style={selectStyle}>
                    <option value="">Select state</option>
                    {NIGERIA_STATES.map((s) => <option key={s} value={s}>{s}</option>)}
                  </select>
                </div>
                <div style={fieldWrap}>
                  <label style={labelStyle}>City</label>
                  <Input value={editForm.city} onChange={(e) => setEditField('city', e.target.value)} style={{ width: '100%' }} />
                </div>
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
                <div style={fieldWrap}>
                  <label style={labelStyle}>Finale Date</label>
                  <Input type="date" value={editForm.date} onChange={(e) => setEditField('date', e.target.value)} style={{ width: '100%' }} />
                </div>
                <div style={fieldWrap}>
                  <label style={labelStyle}>Show Start Time</label>
                  <Input type="time" value={editForm.showStartTime} onChange={(e) => setEditField('showStartTime', e.target.value)} style={{ width: '100%' }} />
                </div>
              </div>
            </section>

            <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
              <Button variant="primary" onClick={saveContest} disabled={saving}>{saving ? 'Saving…' : 'Save Changes'}</Button>
              {saveError && <p style={{ color: colors.danger, margin: 0, fontSize: 13 }}>{saveError}</p>}
              {saveMessage && <p style={{ color: colors.success, margin: 0, fontSize: 13 }}>{saveMessage}</p>}
            </div>
          </div>
        )}

        {!loading && !error && loadedTab === 'Applications' && (
          <Table
            columns={['Artist', 'Email', 'Phone', 'Application', 'Payment', 'Beat Download', 'Actions']}
            rows={(rows as Awaited<ReturnType<typeof listOpenMicApplications>>).map((a) => [
              a.stageName || a.artistName, a.email || '—', a.phone || '—',
              // The exact status when the server knows it (apply-form rows),
              // the console's three-state value otherwise (legacy rows).
              applicantStatusBadge(a.registrationStatus || a.applicationStatus), a.paymentStatus?.replace(/_/g, ' '), a.beatDownloadStatus?.replace(/_/g, ' '),
              <ApplicantRowActions
                key={a.id}
                contestId={contestId}
                row={a}
                onRow={(patch) => updateApplicationRow(a.id, patch)}
              />,
            ])}
          />
        )}

        {!error && loadedTab === 'Submissions' && (
          // The queue IS the tab: it carries every fact the separate table used
          // to (timestamp, votes, finalist, winner) plus the player and the
          // decision, so a song is read in one place. Rendered apart from
          // `loading` on purpose — it refetches itself after every decision
          // (refreshSubmissions), and unmounting it there would wipe the row the
          // operator is working through along with the confirmation they earned.
          submissionRows === null ? (
            <p style={{ color: colors.muted, margin: 0 }}>Loading submissions…</p>
          ) : (
            <OpenMicSubmissionReviewPanel
              submissions={submissionRows}
              onRefresh={refreshSubmissions}
              refreshing={refreshingSubmissions}
            />
          )
        )}

        {!loading && !error && loadedTab === 'Finalists' && (
          <Table
            columns={['Rank', 'Artist', 'Song', 'Votes']}
            rows={(rows as Awaited<ReturnType<typeof listOpenMicFinalists>>).finalists.map((f, i) => [
              `#${i + 1}`, f.stageName, f.songTitle, f.voteCount,
            ])}
          />
        )}

        {!loading && !error && loadedTab === 'Winners' && (
          <Table
            columns={['Winner', 'Song', 'Votes', 'Prize']}
            rows={(rows as Awaited<ReturnType<typeof listOpenMicSubmissions>>).map((w) => [
              w.stageName, w.songTitle, w.voteCount,
              winnerPrizeCell({ awardTitle: w.awardTitle, firstPrizeTitle: contest?.prizes?.[0]?.title }),
            ])}
          />
        )}

        {!loading && !error && loadedTab === 'Payments' && (
          <Table
            columns={['Type', 'Amount', 'Status', 'Reference', 'When']}
            rows={(rows as Awaited<ReturnType<typeof listOpenMicPayments>>).map((p) => [
              p.eventType?.replace(/_/g, ' '), `₦${p.amountNgn}`, p.paymentStatus, p.paymentReference || '—',
              p.createdAt ? new Date(p.createdAt).toLocaleString('en-NG') : '—',
            ])}
          />
        )}

        {!loading && !error && loadedTab === 'Fraud Alerts' && (
          <Table
            columns={['Severity', 'Reason', 'Votes in event', 'Status', 'When']}
            rows={(rows as Awaited<ReturnType<typeof listOpenMicFraudAlerts>>).map((a) => [
              <Badge key="s" text={a.severity} color={a.severity === 'high' ? colors.danger : a.severity === 'medium' ? colors.warning : colors.muted} />,
              a.reason, a.votesInEvent, a.status, a.createdAt ? new Date(a.createdAt).toLocaleString('en-NG') : '—',
            ])}
          />
        )}

        {!loading && !error && loadedTab === 'Beat Downloads' && (
          <Table
            columns={['Artist', 'Email', 'Terms', 'Paid Access', 'Downloaded At']}
            rows={(rows as Awaited<ReturnType<typeof listOpenMicBeatDownloads>>).map((d) => beatDownloadCells(d))}
          />
        )}

        {!loading && !error && loadedTab === 'Votes' && (() => {
          const v = rows as Awaited<ReturnType<typeof getOpenMicVotingAnalytics>>;
          return (
            <>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 12, marginBottom: 16 }}>
                <StatTile label="Total votes" value={v.totalVotes} />
                <StatTile label="Vote price" value={`₦${v.votePrice}`} />
                <StatTile label="Paid vote revenue" value={`₦${v.paidVoteRevenue}`} color={colors.success} />
              </div>
              <Table
                columns={['Artist', 'Song', 'Votes']}
                rows={v.leaderboard.map((s) => [s.stageName, s.songTitle, s.voteCount])}
              />
            </>
          );
        })()}

        {!loading && !error && loadedTab === 'Notifications' && (
          <Table
            columns={['Audience', 'Channel', 'Sent', 'When']}
            rows={(rows as Awaited<ReturnType<typeof listOpenMicNotifications>>).map((n) => [
              n.audience, n.channel, n.sent ? 'Sent' : 'Pending',
              n.createdAt ? new Date(n.createdAt).toLocaleString('en-NG') : '—',
            ])}
          />
        )}

        {!loading && !error && loadedTab === 'Finale' && (
          <>
            {contest && (
              <div style={{ marginBottom: 16, fontSize: 13, color: colors.muted }}>
                {contest.finale?.venueName} · {contest.finale?.venueType} · {contest.finale?.address}, {contest.finale?.city}, {contest.finale?.state}
                <br />
                Event date: {contest.finale?.date || 'TBA'} · Show time: {contest.finale?.showStartTime || 'TBA'}
              </div>
            )}
            <Table
              columns={['#', 'Artist', 'Song', 'Played']}
              rows={(rows as Awaited<ReturnType<typeof getOpenMicFinalePlaylist>>).map((item) => [
                item.order, item.stageName, item.songTitle, item.played ? 'Played' : 'Pending',
              ])}
            />
          </>
        )}

        {!loading && !error && loadedTab === 'Reports' && (() => {
          const m = rows as Awaited<ReturnType<typeof getOpenMicReportMetrics>>;
          return (
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 12 }}>
              <StatTile label="Applicants" value={m.totalApplicants} />
              <StatTile label="Beat downloads" value={m.beatDownloads} />
              <StatTile label="Approved songs" value={m.approvedSongs} />
              <StatTile label="Total votes" value={m.totalVotes} />
              <StatTile label="Voting revenue" value={`₦${m.votingRevenue}`} />
              <StatTile label="Entry fee revenue" value={`₦${m.entryRevenue}`} />
              <StatTile label="Total revenue" value={`₦${m.totalRevenue}`} color={colors.success} />
              <StatTile label="Finalists" value={m.finalists} />
              <StatTile label="Winners" value={m.winners} />
              <StatTile label="Failed payments" value={m.failedPayments} color={m.failedPayments > 0 ? colors.danger : undefined} />
              <StatTile label="Fraud alerts" value={m.suspiciousVotingAlerts} color={m.suspiciousVotingAlerts > 0 ? colors.warning : undefined} />
            </div>
          );
        })()}
      </Card>
    </Page>
  );
}
