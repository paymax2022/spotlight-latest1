'use client';

// 9.G.2 — Calculation & preview: pro-rata per cap table, fees, withholding,
// net per investor + exception list.
// 9.G.3 — Maker-checker approval UI (maker ≠ checker enforced).

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { previewDistribution, listDistributions, submitDistribution, approveDistribution } from '@/services/fractionalreAdminService';
import type { DistributionPreview, AdminDistribution } from '@/types/fractionalreAdmin';
import { PageHeader, FractionalReTabs, Card, Kpi, Badge, SodNote, btn, btnPrimary, th, td, money } from '../../_ui';

export default function DistributionDetailPage() {
  const { id } = useParams<{ id: string }>();
  const [preview, setPreview] = useState<DistributionPreview | null>(null);
  const [dist, setDist] = useState<AdminDistribution | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const [working, setWorking] = useState(false);

  async function load() {
    setLoading(true); setError(null);
    try {
      const [p, all] = await Promise.all([previewDistribution(id), listDistributions()]);
      setPreview(p); setDist(all.find((d) => d.id === id) ?? null);
    } catch (e) { setError(String(e)); } finally { setLoading(false); }
  }
  useEffect(() => { if (id) load(); }, [id]);

  async function submit() {
    setWorking(true); setError(null); setMsg(null);
    try { await submitDistribution(id, { reason: 'Calculations reviewed' }); setMsg('Submitted for approval (maker). A different user must approve.'); await load(); }
    catch (e) { setError(String(e)); } finally { setWorking(false); }
  }
  async function approve() {
    const reason = window.prompt('Approval reason:') || '';
    if (!reason) return;
    setWorking(true); setError(null); setMsg(null);
    try { await approveDistribution(id, { reason }); setMsg('Approved (checker) — proceeds to execution & reconciliation.'); await load(); }
    catch (e) { setError(String(e)); } finally { setWorking(false); }
  }

  const status = dist?.status ?? 'Draft';
  const canSubmit = status === 'Draft' || status === 'Calculated';
  const canApprove = status === 'PendingApproval';

  return (
    <div style={{ padding: '0.5rem 0.5rem 2rem' }}>
      <PageHeader title="Distribution run" subtitle={dist ? `${dist.assetName} · ${dist.period}` : id} action={<Link href="/admin/fractionalre/distributions" style={{ ...btn(), textDecoration: 'none' }}>← All runs</Link>} />
      <FractionalReTabs active="distributions" />
      {error && <p style={{ color: '#dc2626' }}>{error}</p>}
      {msg && <p style={{ color: '#15803d' }}>{msg}</p>}

      {loading || !preview ? <p style={{ color: '#6b7280' }}>Loading preview…</p> : (
        <>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(180px, 1fr))', gap: '0.75rem', marginBottom: '1.25rem' }}>
            <Kpi label="Gross" value={money(preview.grossAmountKobo)} accent="#1d4ed8" />
            <Kpi label="Fees" value={money(preview.totalFeesKobo)} accent="#d97706" />
            <Kpi label="Withholding tax" value={money(preview.totalWithholdingKobo)} accent="#6b21a8" />
            <Kpi label="Net to investors" value={money(preview.totalNetKobo)} accent="#16a34a" />
            <Kpi label="Status" value={status} accent="#374151" />
          </div>

          <SodNote>
            Maker-checker: the <strong>maker</strong> ({dist?.maker ?? '—'}) submits; the <strong>Distribution Approver</strong> ({dist?.checker ?? 'unassigned'}) releases.
            Maker ≠ checker is enforced server-side — the same user cannot approve their own submission.
          </SodNote>

          <Card title="Per-investor breakdown (pro-rata)">
            <table style={{ width: '100%', borderCollapse: 'collapse' }}>
              <thead><tr><th style={th()}>Investor</th><th style={th()}>Units</th><th style={th()}>%</th><th style={th()}>Gross</th><th style={th()}>Fee</th><th style={th()}>WHT</th><th style={th()}>Net</th></tr></thead>
              <tbody>{preview.lineItems.map((l) => (
                <tr key={l.investorId}><td style={td()}>{l.investorName}</td><td style={td()}>{l.units}</td><td style={td()}>{l.ownershipPct}%</td><td style={td()}>{money(l.grossKobo)}</td><td style={td()}>{money(l.feeKobo)}</td><td style={td()}>{money(l.withholdingTaxKobo)}</td><td style={{ ...td(), fontWeight: 600 }}>{money(l.netKobo)}</td></tr>
              ))}</tbody>
            </table>
          </Card>

          {preview.exceptions.length > 0 && (
            <Card title="Exceptions (held)">
              <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                <thead><tr><th style={th()}>Investor</th><th style={th()}>Net</th><th style={th()}>Reason</th></tr></thead>
                <tbody>{preview.exceptions.map((l) => (
                  <tr key={l.investorId}><td style={td()}>{l.investorName}</td><td style={td()}>{money(l.netKobo)}</td><td style={td()}><Badge status="high" label={l.exception ?? 'exception'} /></td></tr>
                ))}</tbody>
              </table>
            </Card>
          )}

          <Card title="Approval">
            <div style={{ display: 'flex', gap: '0.6rem', flexWrap: 'wrap' }}>
              <button disabled={!canSubmit || working} onClick={submit} style={{ ...btnPrimary('#d97706'), opacity: !canSubmit || working ? 0.6 : 1 }}>Submit for approval (maker)</button>
              <button disabled={!canApprove || working} onClick={approve} style={{ ...btnPrimary('#16a34a'), opacity: !canApprove || working ? 0.6 : 1 }}>Approve & release (checker)</button>
            </div>
            <p style={{ fontSize: '0.78rem', color: '#6b7280', marginBottom: 0 }}>Current status: <strong>{status}</strong>.</p>
          </Card>
        </>
      )}
    </div>
  );
}
