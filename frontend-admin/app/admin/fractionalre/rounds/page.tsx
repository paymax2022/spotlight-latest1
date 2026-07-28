'use client';

// 9.C — Funding rounds list.

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { listRounds } from '@/services/fractionalreAdminService';
import type { AdminRound } from '@/types/fractionalreAdmin';
import { PageHeader, FractionalReTabs, Card, Badge, btn, th, td, money, timeAgo } from '../_ui';

export default function RoundsListPage() {
  const [rounds, setRounds] = useState<AdminRound[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  async function load() {
    setLoading(true); setError(null);
    try { setRounds(await listRounds()); } catch (e) { setError(String(e)); } finally { setLoading(false); }
  }
  useEffect(() => { load(); }, []);

  const pct = (r: AdminRound) => r.targetKobo ? Math.round((r.raisedKobo / r.targetKobo) * 100) : 0;

  return (
    <div style={{ padding: '0.5rem 0.5rem 2rem' }}>
      <PageHeader title="Funding rounds" subtitle="Setup, monitoring, extend/close/refund and allocation." action={<button onClick={load} style={btn()}>Refresh</button>} />
      <FractionalReTabs active="rounds" />
      {error && <p style={{ color: '#dc2626' }}>{error}</p>}

      <Card>
        {loading ? <p style={{ color: '#6b7280' }}>Loading rounds…</p> : rounds.length === 0 ? <p style={{ color: '#6b7280' }}>No rounds.</p> : (
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead><tr><th style={th()}>Asset</th><th style={th()}>Status</th><th style={th()}>Raised / target</th><th style={th()}>%</th><th style={th()}>Min threshold</th><th style={th()}>Investors</th><th style={th()}>Closes</th><th style={th()} /></tr></thead>
            <tbody>
              {rounds.map((r) => (
                <tr key={r.id}>
                  <td style={td()}>{r.assetName}</td>
                  <td style={td()}><Badge status={r.status} /></td>
                  <td style={td()}>{money(r.raisedKobo)} / {money(r.targetKobo)}</td>
                  <td style={{ ...td(), color: pct(r) >= 100 ? '#15803d' : pct(r) >= 67 ? '#d97706' : '#dc2626' }}>{pct(r)}%</td>
                  <td style={td()}>{money(r.minThresholdKobo)}</td>
                  <td style={td()}>{r.investorCount.toLocaleString('en-NG')}</td>
                  <td style={td()}>{timeAgo(r.closesAt)}</td>
                  <td style={td()}><Link href={`/admin/fractionalre/rounds/${r.id}`} style={{ color: '#1d4ed8' }}>Manage →</Link></td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Card>
    </div>
  );
}
