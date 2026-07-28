'use client';

// 9.B.1 — Asset list by lifecycle, filters & search.

import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { listAssets } from '@/services/fractionalreAdminService';
import type { AdminAsset, AssetStatus } from '@/types/fractionalreAdmin';
import { PageHeader, FractionalReTabs, Card, Badge, btn, btnPrimary, th, td, input, money } from '../_ui';

const LIFECYCLE: AssetStatus[] = ['Draft', 'UnderReview', 'TitleVerification', 'Approved', 'FundingOpen', 'Funded', 'Operational', 'Distributing', 'Exited', 'Closed', 'Rejected'];

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
    <div style={{ padding: '0.5rem 0.5rem 2rem' }}>
      <PageHeader title="Assets" subtitle="All opportunities by lifecycle state." action={<Link href="/admin/fractionalre/assets/new" style={{ ...btnPrimary(), textDecoration: 'none' }}>+ Onboard asset</Link>} />
      <FractionalReTabs active="assets" />
      {error && <p style={{ color: '#dc2626' }}>{error}</p>}

      <div style={{ display: 'flex', gap: '0.6rem', marginBottom: '1rem', flexWrap: 'wrap' }}>
        <select value={filter} onChange={(e) => setFilter(e.target.value)} style={{ ...input(), width: 220 }}>
          <option value="">All lifecycle states</option>
          {LIFECYCLE.map((s) => <option key={s} value={s}>{s}</option>)}
        </select>
        <input placeholder="Search name or location…" value={q} onChange={(e) => setQ(e.target.value)} style={{ ...input(), width: 280 }} />
        <button onClick={load} style={btn()}>Refresh</button>
      </div>

      <Card>
        {loading ? <p style={{ color: '#6b7280' }}>Loading assets…</p> : rows.length === 0 ? <p style={{ color: '#6b7280' }}>No assets match.</p> : (
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead><tr><th style={th()}>Name</th><th style={th()}>Type</th><th style={th()}>Location</th><th style={th()}>Value</th><th style={th()}>Units sold</th><th style={th()}>Title</th><th style={th()}>Status</th><th style={th()} /></tr></thead>
            <tbody>
              {rows.map((a) => (
                <tr key={a.id}>
                  <td style={td()}>{a.name}</td>
                  <td style={{ ...td(), textTransform: 'capitalize' }}>{a.type.replace(/_/g, ' ')}</td>
                  <td style={td()}>{a.location}</td>
                  <td style={td()}>{money(a.totalValueKobo)}</td>
                  <td style={td()}>{a.unitsSold.toLocaleString('en-NG')} / {a.totalUnits.toLocaleString('en-NG')}</td>
                  <td style={td()}>{a.titleVerified ? <Badge status="verified" label="verified" /> : <Badge status="pending" label="unverified" />}</td>
                  <td style={td()}><Badge status={a.status} /></td>
                  <td style={td()}><Link href={`/admin/fractionalre/assets/${a.id}`} style={{ color: '#1d4ed8' }}>Open →</Link></td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Card>
    </div>
  );
}
