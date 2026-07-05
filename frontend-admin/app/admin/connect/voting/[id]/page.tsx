'use client';

import { use, useEffect, useState } from 'react';
import Link from 'next/link';
import { getVotingContest, formatNaira } from '@/services/connectAdminService';
import type { VotingContestDetail } from '@/types/connectAdmin';
import { PageHeader, Card, Badge, th, td } from '../../_ui';

export default function ConnectVotingDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const [c, setC] = useState<VotingContestDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  async function load() { setLoading(true); setError(null); try { setC(await getVotingContest(id)); } catch (e) { setError(String(e)); } finally { setLoading(false); } }
  useEffect(() => { load(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [id]);

  if (loading) return <div style={{ padding: '0.5rem' }}><p style={{ color: '#6b7280' }}>Loading…</p></div>;
  if (error || !c) return <div style={{ padding: '0.5rem' }}><p style={{ color: '#dc2626' }}>{error ?? 'Not found'}</p><Link href="/admin/connect/voting" style={{ color: '#1d4ed8' }}>← Back</Link></div>;

  return (
    <div style={{ padding: '0.5rem 0.5rem 2rem' }}>
      <Link href="/admin/connect/voting" style={{ color: '#1d4ed8', textDecoration: 'none', fontSize: '0.85rem' }}>← Voting integrity</Link>
      <div style={{ height: 8 }} />
      <PageHeader title={c.title} subtitle={`${c.status} · integrity ${c.integrity_score}/100`} />

      <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center', marginBottom: '1rem', flexWrap: 'wrap' }}>
        <Badge status={c.status === 'live' ? 'investigating' : c.status === 'finalized' ? 'resolved' : 'normal'} label={c.status} />
        <span style={{ fontSize: '0.85rem' }}>Paid volume: <strong>{formatNaira(c.paid_vote_volume_kobo)}</strong></span>
        <span style={{ fontSize: '0.85rem', color: '#6b7280' }}>{c.paid_votes.toLocaleString('en-NG')} paid · {c.free_votes.toLocaleString('en-NG')} free</span>
      </div>

      <Card title="Entrants & tallies">
        <table style={{ width: '100%', borderCollapse: 'collapse' }}>
          <thead><tr><th style={th()}>Entrant</th><th style={th()}>Paid votes</th><th style={th()}>Free votes</th><th style={th()}>Paid tally</th></tr></thead>
          <tbody>
            {c.entrants.map((e) => (
              <tr key={e.id}><td style={td()}><strong>{e.name}</strong></td><td style={td()}>{e.paid_votes.toLocaleString('en-NG')}</td><td style={td()}>{e.free_votes.toLocaleString('en-NG')}</td><td style={td()}>{formatNaira(e.tally_kobo)}</td></tr>
            ))}
          </tbody>
        </table>
      </Card>

      <Card title="Integrity flags (paid-vote audit)">
        {c.flags.length === 0 ? (
          <p style={{ color: '#6b7280' }}>No integrity flags.</p>
        ) : (
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead><tr><th style={th()}>Signal</th><th style={th()}>Reason codes</th><th style={th()}>Affected votes</th><th style={th()}>Amount</th><th style={th()}>Status</th></tr></thead>
            <tbody>
              {c.flags.map((f) => (
                <tr key={f.id}>
                  <td style={{ ...td(), textTransform: 'capitalize' }}>{f.signal.replace(/_/g, ' ')}</td>
                  <td style={td()}>{f.reason_codes.map((rc) => <Badge key={rc} status="high" label={rc} />)}</td>
                  <td style={td()}>{f.affected_votes.toLocaleString('en-NG')}</td>
                  <td style={td()}>{formatNaira(f.amount_kobo)}</td>
                  <td style={td()}><Badge status={f.status === 'upheld' ? 'critical' : f.status === 'dismissed' ? 'closed' : f.status === 'reviewing' ? 'investigating' : 'open'} label={f.status} /></td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
        {c.notes ? <p style={{ fontSize: '0.8rem', color: '#9ca3af', marginTop: '0.75rem' }}>{c.notes}</p> : null}
      </Card>
    </div>
  );
}
