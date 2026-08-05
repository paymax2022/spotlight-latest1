'use client';

// A-EST-01 — Estate dashboard. KPI cards + recent activity.

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { getEstateKpis, getEstateActivity } from '@/services/estateAdminService';
import type { EstateKpis, EstateActivity } from '@/types/estateAdmin';
import { EstateTabs, Kpi, money, timeAgo } from './_ui';
import { Page, PageHeader, Card, Button, Badge, colors, thCell, tdCell } from '@/components/ui/vuexy';

const cap = (s: string) => s.replace(/(^|\s)\S/g, (c) => c.toUpperCase());
function statusColor(status: string): string {
  if (['active', 'paid', 'verified', 'online', 'on_duty', 'resolved', 'completed'].includes(status)) return colors.success;
  if (['pending', 'scheduled', 'investigating', 'maintenance', 'medium'].includes(status)) return colors.warning;
  if (['overdue', 'banned', 'restricted', 'rejected', 'suspended', 'offline', 'open', 'missed', 'high', 'critical'].includes(status)) return colors.danger;
  if (status === 'low') return colors.info;
  return colors.secondary;
}

export default function EstateDashboardPage() {
  const [kpis, setKpis] = useState<EstateKpis | null>(null);
  const [activity, setActivity] = useState<EstateActivity[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  async function load() {
    setLoading(true); setError(null);
    try {
      const [k, a] = await Promise.all([getEstateKpis(), getEstateActivity()]);
      setKpis(k); setActivity(a);
    } catch (e) { setError(String(e)); }
    finally { setLoading(false); }
  }
  useEffect(() => { load(); }, []);

  const collectedPct = kpis && kpis.expectedThisCycleKobo > 0
    ? Math.round((kpis.collectionsThisCycleKobo / kpis.expectedThisCycleKobo) * 100) : 0;

  return (
    <Page>
      <PageHeader title="Estate operations" subtitle="Residents, collections, security and vendors across the estate." actions={<Button variant="outline" sm onClick={load}>Refresh</Button>} />
      <EstateTabs active="dashboard" />
      {error && <p style={{ color: colors.danger }}>{error}</p>}

      {loading || !kpis ? (
        <p style={{ color: colors.muted }}>Loading dashboard…</p>
      ) : (
        <>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(190px, 1fr))', gap: '0.75rem', marginBottom: '1.5rem' }}>
            <Kpi label="Residents" value={kpis.residents.toLocaleString('en-NG')} sub={`${kpis.units} units`} accent={colors.info} />
            <Kpi label="Collections this cycle" value={money(kpis.collectionsThisCycleKobo)} sub={`${collectedPct}% of ${money(kpis.expectedThisCycleKobo)}`} accent={colors.success} />
            <Kpi label="Arrears" value={money(kpis.arrearsKobo)} accent={kpis.arrearsKobo ? colors.warning : colors.success} />
            <Kpi label="Open incidents" value={String(kpis.openIncidents)} accent={kpis.openIncidents ? colors.danger : colors.success} />
            <Kpi label="Active vendors" value={String(kpis.activeVendors)} accent={colors.info} />
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: '1rem', marginBottom: '1.25rem' }}>
            <Card title="Collections"><p style={{ color: colors.muted, fontSize: '0.85rem' }}>{money(kpis.collectionsThisCycleKobo)} collected this cycle.</p><Link href="/admin/estate/dues" style={{ fontSize: '0.85rem', color: colors.info }}>Open dues →</Link></Card>
            <Card title="Security"><p style={{ color: colors.muted, fontSize: '0.85rem' }}>{kpis.openIncidents} open incident(s).</p><Link href="/admin/estate/gates" style={{ fontSize: '0.85rem', color: colors.info }}>Gates & incidents →</Link></Card>
            <Card title="Vendors"><p style={{ color: colors.muted, fontSize: '0.85rem' }}>{kpis.activeVendors} active vendor(s).</p><Link href="/admin/estate/vendors" style={{ fontSize: '0.85rem', color: colors.info }}>Vendor directory →</Link></Card>
          </div>

          <Card title="Recent activity">
            {activity.length === 0 ? <p style={{ color: colors.muted }}>No recent activity.</p> : (
              <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                <thead><tr><th style={thCell}>Type</th><th style={thCell}>Summary</th><th style={thCell}>Actor</th><th style={thCell}>When</th></tr></thead>
                <tbody>
                  {activity.map((a) => (
                    <tr key={a.id}>
                      <td style={tdCell}><Badge text={cap(a.kind)} color={statusColor(a.kind)} /></td>
                      <td style={tdCell}>{a.summary}</td>
                      <td style={tdCell}>{a.actor}</td>
                      <td style={tdCell}>{timeAgo(a.at)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </Card>
        </>
      )}
    </Page>
  );
}
