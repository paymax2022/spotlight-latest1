'use client';

// 9.B.4 — Asset detail / record: full data, cap-table link, documents,
// audit trail, role-gated lifecycle controls.

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { getAsset, transitionAsset, getAudit } from '@/services/fractionalreAdminService';
import type { AdminAsset, AssetStatus, AuditEntry } from '@/types/fractionalreAdmin';
import { PageHeader, FractionalReTabs, Card, Badge, btn, btnPrimary, th, td, input, money, timeAgo } from '../../_ui';

// Allowed forward transitions per lifecycle state (role-gated on the backend).
const NEXT: Record<string, AssetStatus[]> = {
  Draft: ['UnderReview', 'Rejected'],
  UnderReview: ['TitleVerification', 'Rejected'],
  TitleVerification: ['Approved', 'Rejected'],
  Approved: ['FundingOpen'],
  FundingOpen: ['Funded'],
  Funded: ['Operational'],
  Operational: ['Distributing', 'Exited'],
  Distributing: ['Operational', 'Exited'],
  Exited: ['Closed'],
};

export default function AssetDetailPage() {
  const { id } = useParams<{ id: string }>();
  const [asset, setAsset] = useState<AdminAsset | null>(null);
  const [audit, setAudit] = useState<AuditEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [toStatus, setToStatus] = useState<string>('');
  const [reason, setReason] = useState('');
  const [working, setWorking] = useState(false);

  async function load() {
    setLoading(true); setError(null);
    try {
      const a = await getAsset(id);
      setAsset(a);
      setAudit(await getAudit({ entityType: 'asset' }));
    } catch (e) { setError(String(e)); } finally { setLoading(false); }
  }
  useEffect(() => { if (id) load(); }, [id]);

  async function doTransition() {
    if (!asset || !toStatus || !reason) return;
    setWorking(true); setError(null);
    try {
      const updated = await transitionAsset(asset.id, { toStatus: toStatus as AssetStatus, reason });
      setAsset(updated); setToStatus(''); setReason('');
    } catch (e) { setError(String(e)); } finally { setWorking(false); }
  }

  const options = asset ? NEXT[asset.status] ?? [] : [];

  return (
    <div style={{ padding: '0.5rem 0.5rem 2rem' }}>
      <PageHeader title={asset?.name ?? 'Asset'} subtitle="Asset record, documents, lifecycle and audit." action={<Link href="/admin/fractionalre/assets" style={{ ...btn(), textDecoration: 'none' }}>← All assets</Link>} />
      <FractionalReTabs active="assets" />
      {error && <p style={{ color: '#dc2626' }}>{error}</p>}

      {loading || !asset ? <p style={{ color: '#6b7280' }}>Loading asset…</p> : (
        <>
          <div style={{ display: 'grid', gridTemplateColumns: '2fr 1fr', gap: '1rem' }}>
            <Card title="Overview" right={<Badge status={asset.status} />}>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.6rem 1.5rem', fontSize: '0.85rem' }}>
                <div><span style={{ color: '#6b7280' }}>Type:</span> <span style={{ textTransform: 'capitalize' }}>{asset.type.replace(/_/g, ' ')}</span></div>
                <div><span style={{ color: '#6b7280' }}>Location:</span> {asset.location}</div>
                <div><span style={{ color: '#6b7280' }}>Total value:</span> {money(asset.totalValueKobo)}</div>
                <div><span style={{ color: '#6b7280' }}>Unit price:</span> {money(asset.unitPriceKobo)}</div>
                <div><span style={{ color: '#6b7280' }}>Units:</span> {asset.unitsSold.toLocaleString('en-NG')} / {asset.totalUnits.toLocaleString('en-NG')}</div>
                <div><span style={{ color: '#6b7280' }}>Sponsor:</span> {asset.sponsorName ?? '—'}</div>
                <div><span style={{ color: '#6b7280' }}>Target yield:</span> {(asset.returnsModel.targetYieldBps / 100).toFixed(2)}% p.a.</div>
                <div><span style={{ color: '#6b7280' }}>Tenor:</span> {asset.returnsModel.tenorMonths} months</div>
                <div><span style={{ color: '#6b7280' }}>Distribution:</span> {asset.returnsModel.distributionFrequency}</div>
                <div><span style={{ color: '#6b7280' }}>Title:</span> {asset.titleVerified ? <Badge status="verified" /> : <Badge status="pending" label="unverified" />}</div>
              </div>
              <div style={{ marginTop: '1rem', display: 'flex', gap: '0.6rem', flexWrap: 'wrap' }}>
                <Link href={`/admin/fractionalre/cap-table?asset=${asset.id}`} style={{ ...btn(), textDecoration: 'none' }}>Cap table</Link>
                <Link href={`/admin/fractionalre/assets/${asset.id}/title`} style={{ ...btn(), textDecoration: 'none' }}>Title verification</Link>
                <Link href={`/admin/fractionalre/rounds?asset=${asset.id}`} style={{ ...btn(), textDecoration: 'none' }}>Funding rounds</Link>
              </div>
            </Card>

            <Card title="Lifecycle controls">
              <p style={{ fontSize: '0.8rem', color: '#6b7280', marginTop: 0 }}>Transitions are role-gated. Reason is logged to audit.</p>
              {options.length === 0 ? <p style={{ color: '#6b7280', fontSize: '0.85rem' }}>No forward transitions from <strong>{asset.status}</strong>.</p> : (
                <div style={{ display: 'grid', gap: '0.6rem' }}>
                  <select value={toStatus} onChange={(e) => setToStatus(e.target.value)} style={input()}>
                    <option value="">Transition to…</option>
                    {options.map((s) => <option key={s} value={s}>{s}</option>)}
                  </select>
                  <input placeholder="Reason (required)" value={reason} onChange={(e) => setReason(e.target.value)} style={input()} />
                  <button onClick={doTransition} disabled={!toStatus || !reason || working} style={{ ...btnPrimary(), opacity: !toStatus || !reason || working ? 0.6 : 1 }}>{working ? 'Working…' : 'Apply transition'}</button>
                </div>
              )}
            </Card>
          </div>

          <Card title="Documents">
            {asset.documents.length === 0 ? <p style={{ color: '#6b7280' }}>No documents attached.</p> : (
              <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                <thead><tr><th style={th()}>Kind</th><th style={th()}>Name</th><th style={th()}>Version</th><th style={th()}>Uploaded</th></tr></thead>
                <tbody>{asset.documents.map((d) => (
                  <tr key={d.id}><td style={{ ...td(), textTransform: 'capitalize' }}>{d.kind}</td><td style={td()}>{d.name}</td><td style={td()}>v{d.version}</td><td style={td()}>{timeAgo(d.uploadedAt)}</td></tr>
                ))}</tbody>
              </table>
            )}
          </Card>

          <Card title="Audit trail">
            {audit.length === 0 ? <p style={{ color: '#6b7280' }}>No audit entries.</p> : (
              <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                <thead><tr><th style={th()}>When</th><th style={th()}>Actor</th><th style={th()}>Action</th><th style={th()}>Reason</th></tr></thead>
                <tbody>{audit.map((e) => (
                  <tr key={e.id}><td style={td()}>{timeAgo(e.at)}</td><td style={td()}>{e.actorName}</td><td style={td()}>{e.action}</td><td style={td()}>{e.reason ?? '—'}</td></tr>
                ))}</tbody>
              </table>
            )}
          </Card>
        </>
      )}
    </div>
  );
}
