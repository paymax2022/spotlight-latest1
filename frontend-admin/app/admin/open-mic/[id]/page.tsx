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
 * announce winner, edit contest, build/lock finale playlist) are not yet
 * ported.
 */
import { useCallback, useEffect, useState } from 'react';
import { useParams } from 'next/navigation';
import {
  getOpenMicContest,
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
} from '@/services/openMicAdminService';
import { Page, PageHeader, Card, Button, Badge, colors, thCell, tdCell } from '@/components/ui/vuexy';

const TABS = [
  'Applications', 'Submissions', 'Finalists', 'Winners', 'Payments',
  'Fraud Alerts', 'Beat Downloads', 'Votes', 'Notifications', 'Finale', 'Reports',
] as const;
type Tab = (typeof TABS)[number];

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
  const [tab, setTab] = useState<Tab>('Applications');

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
    getOpenMicContest(contestId).then(setContest).catch((e) => setContestError(e instanceof Error ? e.message : String(e)));
  }, [contestId]);

  const loadTab = useCallback(async () => {
    if (!contestId) return;
    setLoading(true);
    setError(null);
    try {
      switch (tab) {
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
