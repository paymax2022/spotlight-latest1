'use client';

import { use, useEffect, useState } from 'react';
import Link from 'next/link';
import { getCustomer, setCustomerVerification } from '@/services/fxAdminService';
import type { CustomerDetail } from '@/types/fxAdmin';
import { PageHeader, Card, Badge, money } from '../../_ui';
import { Button, colors, thCell, tdCell } from '@/components/ui/vuexy';

export default function FxCustomerDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const [c, setC] = useState<CustomerDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function load() { setLoading(true); setError(null); try { setC(await getCustomer(id)); } catch (e) { setError(String(e)); } finally { setLoading(false); } }
  useEffect(() => { load(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [id]);

  async function decide(v: CustomerDetail['verification']) { setBusy(true); try { await setCustomerVerification(id, v); await load(); } finally { setBusy(false); } }

  if (loading) return <div style={{ padding: '0.5rem' }}><p style={{ color: colors.muted }}>Loading…</p></div>;
  if (error || !c) return <div style={{ padding: '0.5rem' }}><p style={{ color: colors.danger }}>{error ?? 'Not found'}</p><Link href="/admin/fx/customers" style={{ color: colors.info }}>← Back</Link></div>;

  const pending = c.verification === 'pending' || c.verification === 'review';
  const riskColor = c.riskScore >= 70 ? colors.danger : c.riskScore >= 40 ? colors.warning : colors.success;

  return (
    <div style={{ padding: '0.5rem 0.5rem 2rem' }}>
      <Link href="/admin/fx/customers" style={{ color: colors.info, textDecoration: 'none', fontSize: '0.85rem' }}>← Customers</Link>
      <div style={{ height: 8 }} />
      <PageHeader
        title={c.name}
        subtitle={`${c.type} · ${c.email} · ${c.country}`}
        action={
          pending ? (
            <div style={{ display: 'flex', gap: '0.5rem' }}>
              <Button variant="primary" style={{ background: colors.success, borderColor: colors.success }} disabled={busy} onClick={() => decide('approved')}>Approve</Button>
              <Button variant="outline" disabled={busy} onClick={() => decide('review')}>Request resubmit</Button>
              <Button variant="danger" disabled={busy} onClick={() => decide('rejected')}>Reject</Button>
            </div>
          ) : (
            <div style={{ display: 'flex', gap: '0.5rem' }}>
              {c.verification !== 'suspended' ? <Button variant="danger" disabled={busy} onClick={() => decide('suspended')}>Suspend</Button> : <Button variant="primary" style={{ background: colors.success, borderColor: colors.success }} disabled={busy} onClick={() => decide('approved')}>Reinstate</Button>}
            </div>
          )
        }
      />

      <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center', marginBottom: '1rem' }}>
        <Badge status={c.verification === 'approved' ? 'successful' : c.verification === 'rejected' || c.verification === 'suspended' ? 'failed' : 'pending'} label={c.verification} />
        <span style={{ fontSize: '0.85rem', color: colors.muted }}>Tier {c.tier}</span>
        <span style={{ fontSize: '0.85rem' }}>Risk score: <strong style={{ color: riskColor }}>{c.riskScore}</strong></span>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1.25rem' }}>
        <Card title="Profile">
          <KV k="Type" v={c.type} cap />
          <KV k="Email" v={c.email} />
          <KV k="Country" v={c.country} />
          <KV k="Ledger balance" v={money(c.balanceUsdCents, 'USD')} />
          {c.rcNumber ? <KV k="RC number" v={c.rcNumber} /> : null}
          <KV k="Joined" v={new Date(c.createdAt).toLocaleDateString('en-NG')} />
          {c.notes ? <KV k="Notes" v={c.notes} /> : null}
        </Card>

        <Card title="Documents">
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.85rem' }}>
            <tbody>
              {c.documents.map((d) => (
                <tr key={d.id} style={{ borderBottom: `1px solid ${colors.border}` }}>
                  <td style={tdCell}>{d.label} <span style={{ color: colors.muted }}>({d.type})</span></td>
                  <td style={{ ...tdCell, textAlign: 'right' }}><Badge status={d.verified ? 'successful' : 'pending'} label={d.verified ? 'Verified' : 'Unverified'} /></td>
                </tr>
              ))}
            </tbody>
          </table>
        </Card>
      </div>

      {c.directors?.length ? (
        <Card title="Directors & UBOs">
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.85rem' }}>
            <thead><tr style={{ textAlign: 'left', color: colors.muted, borderBottom: `1px solid ${colors.border}` }}><th style={thCell}>Name</th><th style={thCell}>Role</th><th style={thCell}>Ownership</th></tr></thead>
            <tbody>
              {c.directors.map((d, i) => (
                <tr key={i} style={{ borderBottom: `1px solid ${colors.border}` }}><td style={tdCell}><strong>{d.name}</strong></td><td style={tdCell}>{d.role}</td><td style={tdCell}>{d.ownershipPct}%</td></tr>
              ))}
            </tbody>
          </table>
        </Card>
      ) : null}
    </div>
  );
}

function KV({ k, v, cap }: { k: string; v: string; cap?: boolean }) {
  return (
    <div style={{ display: 'flex', justifyContent: 'space-between', padding: '0.35rem 0', borderBottom: `1px solid ${colors.border}`, fontSize: '0.85rem' }}>
      <span style={{ color: colors.muted }}>{k}</span>
      <span style={{ fontWeight: 600, textTransform: cap ? 'capitalize' : 'none' }}>{v}</span>
    </div>
  );
}
