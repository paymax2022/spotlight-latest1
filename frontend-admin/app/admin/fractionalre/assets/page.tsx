'use client';

// 9.B.1 — Asset list by lifecycle, filters & search.

import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { listAssets } from '@/services/fractionalreAdminService';
import type { AdminAsset, AssetStatus } from '@/types/fractionalreAdmin';
import { FractionalReTabs, money } from '../_ui';
import { Page, PageHeader, Card, Button, Input, Badge, colors, thCell, tdCell } from '@/components/ui/vuexy';

const LIFECYCLE: AssetStatus[] = ['Draft', 'UnderReview', 'TitleVerification', 'Approved', 'FundingOpen', 'Funded', 'Operational', 'Distributing', 'Exited', 'Closed', 'Rejected'];

const STATUS_COLOR: Record<string, string> = {
  active: colors.success, verified: colors.success, completed: colors.success, approved: colors.success, funded: colors.success, operational: colors.success,
  pending: colors.warning, underreview: colors.warning, titleverification: colors.warning, draft: colors.secondary,
  rejected: colors.danger, halted: colors.danger, suspended: colors.danger, cancelled: colors.danger, expired: colors.danger,
  fundingopen: colors.info, open: colors.info, distributing: colors.warning, exited: colors.secondary, closed: colors.secondary,
};

function statusColor(status: string): string {
  return STATUS_COLOR[status.toLowerCase()] ?? colors.secondary;
}

export default function AssetsListPage() {
  const [assets, setAssets] = useState<AdminAsset[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [filter, setFilter] = useState<string>('');
  const [q, setQ] = useState('');

  async function load() {
    setLoading(true); setError(null);
    try { setAssets(await listAssets()); } catch (e) { setError(String(e)); } finally { setLoading(false); }
  }
  useEffect(() => { load(); }, []);

  const rows = useMemo(() => assets.filter((a) =>
    (!filter || a.status === filter) &&
    (!q || a.name.toLowerCase().includes(q.toLowerCase()) || a.location.toLowerCase().includes(q.toLowerCase()))), [assets, filter, q]);

  return (
    <Page>
      <PageHeader title="Assets" subtitle="All opportunities by lifecycle state." actions={<Link href="/admin/fractionalre/assets/new"><Button variant="primary">+ Onboard asset</Button></Link>} />
      <FractionalReTabs active="assets" />
      {error && <p style={{ color: colors.danger }}>{error}</p>}

      <div style={{ display: 'flex', gap: '0.6rem', marginBottom: '1rem', flexWrap: 'wrap' }}>
        <select value={filter} onChange={(e) => setFilter(e.target.value)} className="vx-input" style={{ width: 220 }}>
          <option value="">All lifecycle states</option>
          {LIFECYCLE.map((s) => <option key={s} value={s}>{s}</option>)}
        </select>
        <Input placeholder="Search name or location…" value={q} onChange={(e) => setQ(e.target.value)} style={{ width: 280 }} />
        <Button onClick={load}>Refresh</Button>
      </div>

      <Card style={{ padding: 0, overflow: 'auto' }}>
        {loading ? <p style={{ color: colors.muted, padding: 14 }}>Loading assets…</p> : rows.length === 0 ? <p style={{ color: colors.muted, padding: 14 }}>No assets match.</p> : (
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead><tr><th style={thCell}>Name</th><th style={thCell}>Type</th><th style={thCell}>Location</th><th style={thCell}>Value</th><th style={thCell}>Units sold</th><th style={thCell}>Title</th><th style={thCell}>Status</th><th style={thCell} /></tr></thead>
            <tbody>
              {rows.map((a) => (
                <tr key={a.id}>
                  <td style={tdCell}>{a.name}</td>
                  <td style={{ ...tdCell, textTransform: 'capitalize' }}>{a.type.replace(/_/g, ' ')}</td>
                  <td style={tdCell}>{a.location}</td>
                  <td style={tdCell}>{money(a.totalValueKobo)}</td>
                  <td style={tdCell}>{a.unitsSold.toLocaleString('en-NG')} / {a.totalUnits.toLocaleString('en-NG')}</td>
                  <td style={tdCell}>{a.titleVerified ? <Badge text="verified" color={colors.success} /> : <Badge text="unverified" color={colors.warning} />}</td>
                  <td style={tdCell}><Badge text={a.status.replace(/_/g, ' ')} color={statusColor(a.status)} /></td>
                  <td style={tdCell}><Link href={`/admin/fractionalre/assets/${a.id}`} style={{ color: colors.info }}>Open →</Link></td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Card>
    </Page>
  );
}
