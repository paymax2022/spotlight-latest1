'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import { getFloat, formatNaira } from '@/services/referralAdminOpsService';
import type { Float } from '@/types/referralAdminOps';
import { Page, PageHeader, Card, Badge, colors, thCell, tdCell } from '@/components/ui/vuexy';

function statusColor(status: string): string {
  const s = status.toLowerCase();
  if (['active', 'approved', 'resolved', 'eligible', 'paid'].includes(s)) return colors.success;
  if (['closed', 'ended', 'draft'].includes(s)) return colors.secondary;
  if (['rejected', 'clawed_back', 'critical'].includes(s)) return colors.danger;
  if (['open', 'pending', 'high'].includes(s)) return colors.warning;
  return colors.secondary;
}

function StatusBadge({ status, label: lbl }: { status: string; label?: string }) {
  return <Badge text={lbl ?? status.replace(/_/g, ' ')} color={statusColor(status)} />;
}

function Kpi({ label, value, sub, accent }: { label: string; value: string; sub?: string; accent?: string }) {
  return (
    <Card style={{ padding: '14px 16px' }}>
      <div style={{ fontSize: 11, textTransform: 'uppercase', letterSpacing: 0.5, color: colors.muted, fontWeight: 700 }}>{label}</div>
      <div style={{ fontSize: 22, fontWeight: 800, marginTop: 4, color: accent ?? colors.text }}>{value}</div>
      {sub ? <div style={{ fontSize: 12, color: colors.muted, marginTop: 2 }}>{sub}</div> : null}
    </Card>
  );
}

export default function FloatPage() {
  const [data, setData] = useState<Float | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  async function load() {
    setLoading(true); setError(null);
    try { setData(await getFloat()); }
    catch (e) { setError(String(e)); }
    finally { setLoading(false); }
  }
  useEffect(() => { load(); }, []);

  return (
    <Page>
      <PageHeader
        title="Finance — Float management"
        subtitle="Reward float positions across providers & wallets (A-FIN-05). Positions below threshold flagged for top-up."
        actions={<Link href="/admin/referral/finance" className="vx-btn vx-btn--outline vx-btn--sm" style={{ textDecoration: 'none' }}>← Payouts</Link>}
      />

      {loading ? (
        <p style={{ color: colors.muted }}>Loading…</p>
      ) : error ? (
        <p style={{ color: colors.danger }}>{error}</p>
      ) : !data ? null : (
        <>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(190px,1fr))', gap: 12, marginBottom: 20 }}>
            <Kpi label="Total balance" value={formatNaira(data.total_balance_kobo)} />
            <Kpi label="Reserved" value={formatNaira(data.total_reserved_kobo)} accent={colors.warning} />
            <Kpi label="Available" value={formatNaira(data.total_available_kobo)} accent={colors.success} />
          </div>

          <Card title="Float positions">
            <div style={{ overflowX: 'auto' }}>
              <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                <thead><tr>
                  <th style={thCell}>Account</th><th style={thCell}>Provider</th><th style={thCell}>Balance</th>
                  <th style={thCell}>Reserved</th><th style={thCell}>Available</th><th style={thCell}>Threshold</th><th style={thCell}>Status</th>
                </tr></thead>
                <tbody>
                  {data.positions.map((p) => (
                    <tr key={p.id}>
                      <td style={tdCell}>{p.account}</td>
                      <td style={tdCell}>{p.provider}</td>
                      <td style={tdCell}>{formatNaira(p.balance_kobo)}</td>
                      <td style={tdCell}>{formatNaira(p.reserved_kobo)}</td>
                      <td style={tdCell}><strong>{formatNaira(p.available_kobo)}</strong></td>
                      <td style={tdCell}>{formatNaira(p.threshold_kobo)}</td>
                      <td style={tdCell}><StatusBadge status={p.status === 'healthy' ? 'active' : p.status === 'low' ? 'high' : 'critical'} label={p.status} /></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Card>
        </>
      )}
    </Page>
  );
}
