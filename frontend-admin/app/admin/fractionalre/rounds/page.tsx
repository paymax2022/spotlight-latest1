'use client';

// 9.C — Funding rounds list.

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { listRounds } from '@/services/fractionalreAdminService';
import type { AdminRound } from '@/types/fractionalreAdmin';
import { FractionalReTabs, money, timeAgo } from '../_ui';
import { Page, PageHeader, Card, Button, Badge, colors, thCell, tdCell } from '@/components/ui/vuexy';

const STATUS_COLOR: Record<string, string> = {
  fundingopen: colors.info, funded: colors.success, closing: colors.warning, distributing: colors.warning,
  refunding: colors.warning, closed: colors.secondary, cancelled: colors.danger,
};

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
    <Page>
      <PageHeader title="Funding rounds" subtitle="Setup, monitoring, extend/close/refund and allocation." actions={<Button onClick={load}>Refresh</Button>} />
      <FractionalReTabs active="rounds" />
      {error && <p style={{ color: colors.danger }}>{error}</p>}

      <Card style={{ padding: 0, overflow: 'auto' }}>
        {loading ? <p style={{ color: colors.muted, padding: 14 }}>Loading rounds…</p> : rounds.length === 0 ? <p style={{ color: colors.muted, padding: 14 }}>No rounds.</p> : (
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead><tr><th style={thCell}>Asset</th><th style={thCell}>Status</th><th style={thCell}>Raised / target</th><th style={thCell}>%</th><th style={thCell}>Min threshold</th><th style={thCell}>Investors</th><th style={thCell}>Closes</th><th style={thCell} /></tr></thead>
            <tbody>
              {rounds.map((r) => (
                <tr key={r.id}>
                  <td style={tdCell}>{r.assetName}</td>
                  <td style={tdCell}><Badge text={r.status.replace(/_/g, ' ')} color={STATUS_COLOR[r.status.toLowerCase()] ?? colors.secondary} /></td>
                  <td style={tdCell}>{money(r.raisedKobo)} / {money(r.targetKobo)}</td>
                  <td style={{ ...tdCell, color: pct(r) >= 100 ? colors.success : pct(r) >= 67 ? colors.warning : colors.danger }}>{pct(r)}%</td>
                  <td style={tdCell}>{money(r.minThresholdKobo)}</td>
                  <td style={tdCell}>{r.investorCount.toLocaleString('en-NG')}</td>
                  <td style={tdCell}>{timeAgo(r.closesAt)}</td>
                  <td style={tdCell}><Link href={`/admin/fractionalre/rounds/${r.id}`} style={{ color: colors.info }}>Manage →</Link></td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Card>
    </Page>
  );
}
