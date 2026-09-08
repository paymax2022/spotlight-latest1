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
 * first client wiring.
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
  type OpenMicContest,
  type OpenMicContestEditInput,
} from '@/services/openMicAdminService';
import { Page, PageHeader, Card, Button, Input, Badge, colors, thCell, tdCell } from '@/components/ui/vuexy';

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
  title: string; description: string; status: string; visibility: string;
  registrationFeeNgn: number; entryFeeRequired: boolean;
  votePrice: number; freeVotesPerDay: number; votingEnabled: boolean;
  freeVoting: boolean; paidVoting: boolean; leaderboardVisible: boolean; voteCountPublic: boolean;
  finalistsTarget: number; judgeWeight: number; publicVoteWeight: number; selectionModel: string;
  venueName: string; venueType: string; address: string; city: string; state: string;
  date: string; showStartTime: string; playbackMode: string;
};

function formFromContest(c: OpenMicContest): EditFormState {
  return {
    title: c.title, description: c.description ?? '', status: c.status, visibility: c.visibility ?? 'public',
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
  };
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

  function setEditField<K extends keyof EditFormState>(key: K, value: EditFormState[K]) {
    setEditForm((prev) => (prev ? { ...prev, [key]: value } : prev));
  }

  const weightsInvalid = useMemo(
    () => !!editForm && editForm.judgeWeight + editForm.publicVoteWeight !== 100,
    [editForm],
  );

  async function saveContest() {
    if (!editForm || !contestId) return;
    if (weightsInvalid) {
      setSaveError('Judge weight and public vote weight must add up to 100%.');
      return;
    }
    setSaving(true);
    setSaveError(null);
    setSaveMessage('');
    try {
      const patch: OpenMicContestEditInput = {
        title: editForm.title,
        description: editForm.description,
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
        case 'Submissions': setRows(await listOpenMicSubmissions(contestId)); break;
        case 'Finalists': setRows(await listOpenMicFinalists(contestId)); break;
        case 'Winners': setRows((await listOpenMicSubmissions(contestId)).filter((s) => s.isWinner)); break;
        case 'Payments': setRows(await listOpenMicPayments(contestId)); break;
        case 'Fraud Alerts': setRows(await listOpenMicFraudAlerts(contestId)); break;
        case 'Beat Downloads': setRows(await listOpenMicBeatDownloads(contestId)); break;
        case 'Votes': setRows(await getOpenMicVotingAnalytics(contestId)); break;
        case 'Notifications': setRows(await listOpenMicNotifications(contestId)); break;
        case 'Finale': setRows(await getOpenMicFinalePlaylist(contestId)); break;
        case 'Reports': setRows(await getOpenMicReportMetrics(contestId)); break;
      }
      setLoadedTab(tab);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }, [tab, contestId]);

  useEffect(() => { loadTab(); }, [loadTab]);

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
            columns={['Artist', 'Email', 'Phone', 'Application', 'Payment', 'Beat Download']}
            rows={(rows as Awaited<ReturnType<typeof listOpenMicApplications>>).map((a) => [
              a.stageName || a.artistName, a.email || '—', a.phone || '—',
              a.applicationStatus?.replace(/_/g, ' '), a.paymentStatus?.replace(/_/g, ' '), a.beatDownloadStatus?.replace(/_/g, ' '),
            ])}
          />
        )}

        {!loading && !error && loadedTab === 'Submissions' && (
          <Table
            columns={['Artist', 'Song', 'Status', 'Votes', 'Finalist', 'Winner']}
            rows={(rows as Awaited<ReturnType<typeof listOpenMicSubmissions>>).map((s) => [
              s.stageName, s.songTitle, s.status?.replace(/_/g, ' '), s.voteCount,
              s.isFinalist ? <Badge key="f" text="Finalist" color={colors.primary} /> : '—',
              s.isWinner ? <Badge key="w" text="Winner" color={colors.success} /> : '—',
            ])}
          />
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
              w.stageName, w.songTitle, w.voteCount, contest?.prizes?.[0]?.title || 'Winner Perks',
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
            rows={(rows as Awaited<ReturnType<typeof listOpenMicBeatDownloads>>).map((d) => [
              d.artistName, d.artistEmail || '—', d.termsAccepted ? 'Accepted' : 'No',
              d.paidAccessConfirmed ? 'Confirmed' : 'Not confirmed',
              d.downloadedAt ? new Date(d.downloadedAt).toLocaleString('en-NG') : '—',
            ])}
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
