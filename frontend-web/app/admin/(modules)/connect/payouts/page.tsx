'use client';

import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { listPayouts, formatNaira } from '@/services/connectAdminService';
import type { ConnectPayout } from '@/types/connectAdmin';
import { PageHeader, ConnectTabs, Card, Badge, btn, th, td, timeAgo } from '../_ui';
import { Page, colors } from '@/components/ui/vuexy';

const STATUSES = ['all', 'pending', 'review', 'approved', 'paid', 'rejected'];

export default function ConnectPayoutsPage() {
  const [rows, setRows] = useState<ConnectPayout[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [status, setStatus] = useState('all');

  const filter = useMemo(() => (status === 'all' ? undefined : status), [status]);
  async function load() {
    setLoading(true); setError(null);
    try { setRows(await listPayouts(filter)); }
    catch (e) { setError(String(e)); }
    finally { setLoading(false); }
  }
  useEffect(() => { load(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [filter]);

  return (
    <Page>
      <PageHeader title="Payout / withdrawal queue" subtitle="Tier-gated payout approval workflow (§11.5 AF-04). Amounts in kobo → Naira." action={<button onClick={load} style={btn()}>Refresh</button>} />
      <ConnectTabs active="overview" />

      <Card>
        <label style={{ fontSize: '0.8rem', color: colors.muted, display: 'flex', alignItems: 'center', gap: '0.4rem' }}>
          Status
          <select value={status} onChange={(e) => setStatus(e.target.value)} style={{ padding: '0.35rem 0.5rem', border: `1px solid ${colors.inputBorder}`, borderRadius: '0.375rem', fontSize: '0.85rem', textTransform: 'capitalize' }}>
            {STATUSES.map((s) => <option key={s} value={s}>{s}</option>)}
          </select>
        </label>
      </Card>

      {error && <p style={{ color: colors.danger }}>{error}</p>}
      <Card>
        {loading ? <p style={{ color: colors.muted }}>Loading payouts…</p> : rows.length === 0 ? (
          <p style={{ color: colors.muted }}>No payouts in this state.</p>
        ) : (
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead><tr><th style={th()}>Reference</th><th style={th()}>User</th><th style={th()}>Amount</th><th style={th()}>Fee</th><th style={th()}>Tier</th><th style={th()}>Status</th><th style={th()}>Requested</th></tr></thead>
            <tbody>
              {rows.map((p) => (
                <tr key={p.id}>
                  <td style={td()}><strong>{p.reference}</strong></td>
                  <td style={td()}><Link href={`/admin/connect/users/${p.user_id}`} style={{ color: colors.info, textDecoration: 'none' }}>{p.handle}</Link></td>
                  <td style={td()}>{formatNaira(p.amount_kobo)}</td>
                  <td style={td()}>{formatNaira(p.fee_kobo)}</td>
                  <td style={td()}>T{p.tier}</td>
                  <td style={td()}><Badge status={p.status === 'paid' || p.status === 'approved' ? 'resolved' : p.status === 'rejected' ? 'critical' : p.status === 'review' ? 'investigating' : 'open'} label={p.status} /></td>
                  <td style={td()}>{timeAgo(p.requested_at)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Card>
    </Page>
  );
}
