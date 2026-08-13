'use client';

// 9.G.2 — Calculation & preview: pro-rata per cap table, fees, withholding,
// net per investor + exception list.
// 9.G.3 — Maker-checker approval UI (maker ≠ checker enforced).

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { previewDistribution, listDistributions, submitDistribution, approveDistribution } from '@/services/fractionalreAdminService';
import type { DistributionPreview, AdminDistribution } from '@/types/fractionalreAdmin';
import { FractionalReTabs, Kpi, SodNote, money } from '../../_ui';
import { Page, PageHeader, Card, Button, Badge, colors, thCell, tdCell } from '@/components/ui/vuexy';

export default function DistributionDetailPage() {
  const { id } = useParams<{ id: string }>() ?? { id: '' };
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
    <Page>
      <PageHeader title="Distribution run" subtitle={dist ? `${dist.assetName} · ${dist.period}` : id} actions={<Link href="/admin/fractionalre/distributions"><Button>← All runs</Button></Link>} />
      <FractionalReTabs active="distributions" />
      {error && <p style={{ color: colors.danger }}>{error}</p>}
      {msg && <p style={{ color: colors.success }}>{msg}</p>}

      {loading || !preview ? <p style={{ color: colors.muted }}>Loading preview…</p> : (
        <>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(180px, 1fr))', gap: '0.75rem', marginBottom: '1.25rem' }}>
            <Kpi label="Gross" value={money(preview.grossAmountKobo)} accent={colors.info} />
            <Kpi label="Fees" value={money(preview.totalFeesKobo)} accent={colors.warning} />
            <Kpi label="Withholding tax" value={money(preview.totalWithholdingKobo)} accent={colors.secondary} />
            <Kpi label="Net to investors" value={money(preview.totalNetKobo)} accent={colors.success} />
            <Kpi label="Status" value={status} accent={colors.muted} />
          </div>

          <SodNote>
            Maker-checker: the <strong>maker</strong> ({dist?.maker ?? '—'}) submits; the <strong>Distribution Approver</strong> ({dist?.checker ?? 'unassigned'}) releases.
            Maker ≠ checker is enforced server-side — the same user cannot approve their own submission.
          </SodNote>

          <Card title="Per-investor breakdown (pro-rata)">
            <table style={{ width: '100%', borderCollapse: 'collapse' }}>
              <thead><tr><th style={thCell}>Investor</th><th style={thCell}>Units</th><th style={thCell}>%</th><th style={thCell}>Gross</th><th style={thCell}>Fee</th><th style={thCell}>WHT</th><th style={thCell}>Net</th></tr></thead>
              <tbody>{preview.lineItems.map((l) => (
                <tr key={l.investorId}><td style={tdCell}>{l.investorName}</td><td style={tdCell}>{l.units}</td><td style={tdCell}>{l.ownershipPct}%</td><td style={tdCell}>{money(l.grossKobo)}</td><td style={tdCell}>{money(l.feeKobo)}</td><td style={tdCell}>{money(l.withholdingTaxKobo)}</td><td style={{ ...tdCell, fontWeight: 600 }}>{money(l.netKobo)}</td></tr>
              ))}</tbody>
            </table>
          </Card>

          {preview.exceptions.length > 0 && (
            <Card title="Exceptions (held)">
              <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                <thead><tr><th style={thCell}>Investor</th><th style={thCell}>Net</th><th style={thCell}>Reason</th></tr></thead>
                <tbody>{preview.exceptions.map((l) => (
                  <tr key={l.investorId}><td style={tdCell}>{l.investorName}</td><td style={tdCell}>{money(l.netKobo)}</td><td style={tdCell}><Badge text={l.exception ?? 'exception'} color={colors.danger} /></td></tr>
                ))}</tbody>
              </table>
            </Card>
          )}

          <Card title="Approval">
            <div style={{ display: 'flex', gap: '0.6rem', flexWrap: 'wrap' }}>
              <Button disabled={!canSubmit || working} onClick={submit}>Submit for approval (maker)</Button>
              <Button variant="primary" disabled={!canApprove || working} onClick={approve}>Approve & release (checker)</Button>
            </div>
            <p style={{ fontSize: '0.78rem', color: colors.muted, marginBottom: 0 }}>Current status: <strong>{status}</strong>.</p>
          </Card>
        </>
      )}
    </Page>
  );
}
