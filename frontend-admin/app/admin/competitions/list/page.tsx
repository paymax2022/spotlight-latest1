'use client';

import { useState, useMemo, useEffect, useCallback } from 'react';
import Link from 'next/link';
import { Page, PageHeader, Card, Button, Input, Badge, colors, tint, thCell, tdCell } from '@/components/ui/vuexy';
import { listVotingContests } from '@/services/competitionsService';
import { getContestStageCounts } from '@/services/contestsAdminService';
import type { VotingContest } from '@/types/competitions';

// Real contests as seen by the mobile app — GET /api/v1/connect/contests, the
// SAME endpoint mobile's getContests() calls. Previously this page rendered a
// hardcoded MOCK_COMPETITIONS array seeded straight into localStorage on
// first load, so "editing" a competition here never touched anything real
// and the list bore no relation to what mobile users actually see. There is
// no prize-pool / awards / benefits concept in the real data — connect_contests
// has none — so that part of the old UI is gone rather than faked.

const statusColor: Record<string, string> = {
  draft: colors.muted,
  open: colors.success,
  closed: colors.secondary,
};

function formatNaira(kobo: number): string {
  return new Intl.NumberFormat('en-NG', { style: 'currency', currency: 'NGN', maximumFractionDigits: 0 }).format(kobo / 100);
}

function fmtDate(v: string | null | undefined): string {
  return v ? new Date(v).toLocaleDateString('en-NG') : '—';
}

export default function CompetitionsListPage() {
  const [search, setSearch] = useState('');
  const [filterStatus, setFilterStatus] = useState<string>('');
  const [contests, setContests] = useState<VotingContest[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [stageCounts, setStageCounts] = useState<Record<string, number>>({});

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const rows = await listVotingContests();
      setContests(rows);
      // Best-effort: a stage-count failure shouldn't block the contest list itself.
      getContestStageCounts(rows.map((c) => c.id))
        .then(setStageCounts)
        .catch(() => setStageCounts({}));
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load contests');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void load(); }, [load]);

  const filtered = useMemo(() => {
    return contests.filter((c) => {
      const matchSearch = c.title.toLowerCase().includes(search.toLowerCase());
      const matchStatus = !filterStatus || c.status === filterStatus;
      return matchSearch && matchStatus;
    });
  }, [search, filterStatus, contests]);

  return (
    <Page>
      <PageHeader
        title="Competitions"
        subtitle="Real contests as seen by the mobile app (public.connect_contests)."
        actions={<Link href="/admin/competitions/create"><Button variant="primary">+ New Competition</Button></Link>}
      />

      {error && <p style={{ color: colors.danger }}>{error}</p>}

      <Card title="Filters" style={{ marginBottom: 16 }}>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: 12, marginTop: 12 }}>
          <Input placeholder="Search contests..." value={search} onChange={(e) => setSearch(e.target.value)} />
          <select value={filterStatus} onChange={(e) => setFilterStatus(e.target.value)} style={{
            padding: '0.4rem 0.55rem', border: `1px solid ${colors.inputBorder}`, borderRadius: '0.375rem',
            fontSize: '0.85rem', background: colors.card, cursor: 'pointer', color: colors.text,
          }}>
            <option value="">All Status</option>
            <option value="draft">Draft</option>
            <option value="open">Open</option>
            <option value="closed">Closed</option>
          </select>
        </div>
      </Card>

      <Card style={{ padding: 0, overflow: 'hidden' }}>
        <table style={{ borderCollapse: 'collapse', width: '100%' }}>
          <thead>
            <tr>
              <th style={thCell}>Title</th>
              <th style={thCell}>Status</th>
              <th style={thCell}>Stages</th>
              <th style={thCell}>Contestants</th>
              <th style={thCell}>Total Votes</th>
              <th style={thCell}>Paid Vote Price</th>
              <th style={thCell}>Opens / Closes</th>
              <th style={thCell}>Actions</th>
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr><td style={{ ...tdCell, color: colors.muted }} colSpan={8}>Loading…</td></tr>
            ) : filtered.length === 0 ? (
              <tr><td style={{ ...tdCell, color: colors.muted }} colSpan={8}>No contests found.</td></tr>
            ) : (
              filtered.map((c) => {
                const stageCount = stageCounts[c.id] ?? 0;
                return (
                <tr key={c.id} style={{ background: c.status === 'open' ? tint(colors.success, 0.04) : 'transparent' }}>
                  <td style={tdCell}><strong>{c.title}</strong></td>
                  <td style={tdCell}><Badge text={c.status} color={statusColor[c.status] ?? colors.muted} /></td>
                  <td style={tdCell}>
                    <Badge
                      text={stageCount === 1 ? '1 stage' : `${stageCount} stages`}
                      color={stageCount > 0 ? colors.info : colors.muted}
                    />
                  </td>
                  <td style={tdCell}>{c.contestant_count.toLocaleString()}</td>
                  <td style={tdCell}>{c.total_votes.toLocaleString()}</td>
                  <td style={tdCell}>{c.paid_vote_kobo > 0 ? formatNaira(c.paid_vote_kobo) : 'Free only'}</td>
                  <td style={tdCell}>{fmtDate(c.opens_at)} – {fmtDate(c.closes_at)}</td>
                  <td style={tdCell}>
                    <Link href={`/admin/competitions/results?contestId=${c.id}`}>
                      <Button variant="outline" sm>Leaderboard</Button>
                    </Link>
                  </td>
                </tr>
                );
              })
            )}
          </tbody>
        </table>
        <div style={{ padding: '12px 14px', borderTop: `1px solid ${colors.border}`, fontSize: '0.85rem', color: colors.muted }}>
          Showing {filtered.length} of {contests.length} contests
        </div>
      </Card>
    </Page>
  );
}
