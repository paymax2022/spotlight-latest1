'use client';

// 9.B.4 — Asset detail / record: full data, cap-table link, documents,
// audit trail, role-gated lifecycle controls.

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { getAsset, transitionAsset, getAudit } from '@/services/fractionalreAdminService';
import type { AdminAsset, AssetStatus, AuditEntry } from '@/types/fractionalreAdmin';
import { FractionalReTabs, money, timeAgo } from '../../_ui';
import { Page, PageHeader, Card, Button, Input, Badge, colors, thCell, tdCell } from '@/components/ui/vuexy';

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

const STATUS_COLOR: Record<string, string> = {
  active: colors.success, verified: colors.success, completed: colors.success, approved: colors.success, funded: colors.success, operational: colors.success,
  pending: colors.warning, underreview: colors.warning, titleverification: colors.warning, draft: colors.secondary,
  rejected: colors.danger, halted: colors.danger, suspended: colors.danger, cancelled: colors.danger, expired: colors.danger,
  fundingopen: colors.info, open: colors.info, distributing: colors.warning, exited: colors.secondary, closed: colors.secondary,
};

function statusColor(status: string): string {
  return STATUS_COLOR[status.toLowerCase()] ?? colors.secondary;
}

export default function AssetDetailPage() {
  const { id } = useParams<{ id: string }>() ?? { id: '' };
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
    <Page>
      <PageHeader title={asset?.name ?? 'Asset'} subtitle="Asset record, documents, lifecycle and audit." actions={<Link href="/admin/fractionalre/assets"><Button>← All assets</Button></Link>} />
      <FractionalReTabs active="assets" />
      {error && <p style={{ color: colors.danger }}>{error}</p>}

      {loading || !asset ? <p style={{ color: colors.muted }}>Loading asset…</p> : (
        <>
          <div style={{ display: 'grid', gridTemplateColumns: '2fr 1fr', gap: '1rem' }}>
            <Card>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.75rem' }}>
                <h2 style={{ fontSize: '1.05rem', fontWeight: 700, margin: 0 }}>Overview</h2>
                <Badge text={asset.status.replace(/_/g, ' ')} color={statusColor(asset.status)} />
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.6rem 1.5rem', fontSize: '0.85rem' }}>
                <div><span style={{ color: colors.muted }}>Type:</span> <span style={{ textTransform: 'capitalize' }}>{asset.type.replace(/_/g, ' ')}</span></div>
                <div><span style={{ color: colors.muted }}>Location:</span> {asset.location}</div>
                <div><span style={{ color: colors.muted }}>Total value:</span> {money(asset.totalValueKobo)}</div>
                <div><span style={{ color: colors.muted }}>Unit price:</span> {money(asset.unitPriceKobo)}</div>
                <div><span style={{ color: colors.muted }}>Units:</span> {asset.unitsSold.toLocaleString('en-NG')} / {asset.totalUnits.toLocaleString('en-NG')}</div>
                <div><span style={{ color: colors.muted }}>Sponsor:</span> {asset.sponsorName ?? '—'}</div>
                <div><span style={{ color: colors.muted }}>Target yield:</span> {(asset.returnsModel.targetYieldBps / 100).toFixed(2)}% p.a.</div>
                <div><span style={{ color: colors.muted }}>Tenor:</span> {asset.returnsModel.tenorMonths} months</div>
                <div><span style={{ color: colors.muted }}>Distribution:</span> {asset.returnsModel.distributionFrequency}</div>
                <div><span style={{ color: colors.muted }}>Title:</span> {asset.titleVerified ? <Badge text="verified" color={colors.success} /> : <Badge text="unverified" color={colors.warning} />}</div>
              </div>
              <div style={{ marginTop: '1rem', display: 'flex', gap: '0.6rem', flexWrap: 'wrap' }}>
                <Link href={`/admin/fractionalre/cap-table?asset=${asset.id}`}><Button sm>Cap table</Button></Link>
                <Link href={`/admin/fractionalre/assets/${asset.id}/title`}><Button sm>Title verification</Button></Link>
                <Link href={`/admin/fractionalre/rounds?asset=${asset.id}`}><Button sm>Funding rounds</Button></Link>
              </div>
            </Card>

            <Card title="Lifecycle controls">
              <p style={{ fontSize: '0.8rem', color: colors.muted, marginTop: 0 }}>Transitions are role-gated. Reason is logged to audit.</p>
              {options.length === 0 ? <p style={{ color: colors.muted, fontSize: '0.85rem' }}>No forward transitions from <strong>{asset.status}</strong>.</p> : (
                <div style={{ display: 'grid', gap: '0.6rem' }}>
                  <select value={toStatus} onChange={(e) => setToStatus(e.target.value)} className="vx-input">
                    <option value="">Transition to…</option>
                    {options.map((s) => <option key={s} value={s}>{s}</option>)}
                  </select>
                  <Input placeholder="Reason (required)" value={reason} onChange={(e) => setReason(e.target.value)} />
                  <Button variant="primary" onClick={doTransition} disabled={!toStatus || !reason || working}>{working ? 'Working…' : 'Apply transition'}</Button>
                </div>
              )}
            </Card>
          </div>

          <Card title="Documents">
            {asset.documents.length === 0 ? <p style={{ color: colors.muted }}>No documents attached.</p> : (
              <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                <thead><tr><th style={thCell}>Kind</th><th style={thCell}>Name</th><th style={thCell}>Version</th><th style={thCell}>Uploaded</th></tr></thead>
                <tbody>{asset.documents.map((d) => (
                  <tr key={d.id}><td style={{ ...tdCell, textTransform: 'capitalize' }}>{d.kind}</td><td style={tdCell}>{d.name}</td><td style={tdCell}>v{d.version}</td><td style={tdCell}>{timeAgo(d.uploadedAt)}</td></tr>
                ))}</tbody>
              </table>
            )}
          </Card>

          <Card title="Audit trail">
            {audit.length === 0 ? <p style={{ color: colors.muted }}>No audit entries.</p> : (
              <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                <thead><tr><th style={thCell}>When</th><th style={thCell}>Actor</th><th style={thCell}>Action</th><th style={thCell}>Reason</th></tr></thead>
                <tbody>{audit.map((e) => (
                  <tr key={e.id}><td style={tdCell}>{timeAgo(e.at)}</td><td style={tdCell}>{e.actorName}</td><td style={tdCell}>{e.action}</td><td style={tdCell}>{e.reason ?? '—'}</td></tr>
                ))}</tbody>
              </table>
            )}
          </Card>
        </>
      )}
    </Page>
  );
}
