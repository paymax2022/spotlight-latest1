'use client';

// 9.E.2 — Investor profile + remaining annual allowance.
// 9.E.3 — Limit monitoring + override (logged).
// 9.E.4 — Classification review.

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { getInvestor, overrideLimit, classifyInvestor } from '@/services/fractionalreAdminService';
import type { AdminInvestorDetail, InvestorClassification } from '@/types/fractionalreAdmin';
import { FractionalReTabs, Kpi, SodNote, money, naira } from '../../_ui';
import { Page, PageHeader, Card, Button, Input, Badge, colors, thCell, tdCell } from '@/components/ui/vuexy';

const KYC_COLOR: Record<string, string> = { unverified: colors.secondary, pending: colors.warning, verified: colors.success, rejected: colors.danger, expired: colors.danger };
const CLASS_COLOR: Record<string, string> = { retail: colors.info, qualified: colors.secondary, hni: colors.success, institutional: colors.secondary };
const SOURCE_COLOR: Record<string, string> = { primary: colors.info, secondary: colors.secondary, matched: colors.secondary, correction: colors.warning };

const labelStyle = { fontSize: '0.78rem', fontWeight: 600, color: colors.text, display: 'block', marginBottom: 4 } as const;

export default function InvestorDetailPage() {
  const { id } = useParams<{ id: string }>();
  const [inv, setInv] = useState<AdminInvestorDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const [working, setWorking] = useState(false);
  const [overrideNaira, setOverrideNaira] = useState('');
  const [overrideReason, setOverrideReason] = useState('');
  const [newClass, setNewClass] = useState<InvestorClassification | ''>('');
  const [classReason, setClassReason] = useState('');

  async function load() {
    setLoading(true); setError(null);
    try { setInv(await getInvestor(id)); } catch (e) { setError(String(e)); } finally { setLoading(false); }
  }
  useEffect(() => { if (id) load(); }, [id]);

  async function applyOverride() {
    if (!overrideNaira || !overrideReason) return;
    setWorking(true); setError(null); setMsg(null);
    try { await overrideLimit(id, { newAnnualCapKobo: Math.round(parseFloat(overrideNaira) * 100), reason: overrideReason }); setMsg('Limit override applied and logged.'); await load(); }
    catch (e) { setError(String(e)); } finally { setWorking(false); }
  }
  async function applyClass() {
    if (!newClass || !classReason) return;
    setWorking(true); setError(null); setMsg(null);
    try { await classifyInvestor(id, { classification: newClass, reason: classReason }); setMsg('Classification updated.'); await load(); }
    catch (e) { setError(String(e)); } finally { setWorking(false); }
  }

  return (
    <Page>
      <PageHeader title={inv?.name ?? 'Investor'} subtitle="Profile, allowance, limit monitoring and classification." actions={<Link href="/admin/fractionalre/investors"><Button>← All investors</Button></Link>} />
      <FractionalReTabs active="investors" />
      {error && <p style={{ color: colors.danger }}>{error}</p>}
      {msg && <p style={{ color: colors.success }}>{msg}</p>}

      {loading || !inv ? <p style={{ color: colors.muted }}>Loading investor…</p> : (
        <>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(180px, 1fr))', gap: '0.75rem', marginBottom: '1.25rem' }}>
            <Kpi label="AUM" value={money(inv.aumKobo)} accent={colors.info} />
            <Kpi label="Annual cap" value={money(inv.limit.annualCapKobo)} accent={colors.secondary} sub={`${inv.limit.capPct}% platform cap`} />
            <Kpi label="Invested this year" value={money(inv.limit.investedThisYearKobo)} accent={colors.warning} />
            <Kpi label="Remaining allowance" value={money(inv.limit.remainingAllowanceKobo)} accent={inv.limit.breached ? colors.danger : colors.success} sub={inv.limit.breached ? 'BREACHED' : 'within cap'} />
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1rem' }}>
            <Card title="Profile">
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.5rem 1rem', fontSize: '0.85rem' }}>
                <div><span style={{ color: colors.muted }}>Email:</span> {inv.email}</div>
                <div><span style={{ color: colors.muted }}>Phone:</span> {inv.phone}</div>
                <div><span style={{ color: colors.muted }}>KYC:</span> <Badge text={inv.kycStatus} color={KYC_COLOR[inv.kycStatus.toLowerCase()] ?? colors.secondary} /></div>
                <div><span style={{ color: colors.muted }}>Classification:</span> <Badge text={inv.classification} color={CLASS_COLOR[inv.classification.toLowerCase()] ?? colors.secondary} /></div>
                <div><span style={{ color: colors.muted }}>Income on file:</span> {money(inv.incomeOnFileKobo)}</div>
                <div><span style={{ color: colors.muted }}>Risk profile:</span> {inv.riskProfile}</div>
              </div>
            </Card>

            <Card title="Limit monitoring (compliance)">
              <p style={{ fontSize: '0.85rem', color: colors.muted, marginTop: 0 }}>Remaining annual allowance: <strong style={{ color: inv.limit.breached ? colors.danger : colors.text }}>{naira(inv.limit.remainingAllowanceKobo)}</strong></p>
              {inv.limit.overrideActive && <Badge text="override active" color={colors.success} />}
              <div style={{ display: 'grid', gap: '0.5rem', marginTop: '0.6rem', maxWidth: 320 }}>
                <div><label style={labelStyle}>New annual cap (₦)</label><Input value={overrideNaira} onChange={(e) => setOverrideNaira(e.target.value)} placeholder="10000000" /></div>
                <div><label style={labelStyle}>Reason (logged)</label><Input value={overrideReason} onChange={(e) => setOverrideReason(e.target.value)} /></div>
                <Button onClick={applyOverride} disabled={working || !overrideNaira || !overrideReason} style={{ background: colors.warning, borderColor: colors.warning, color: '#fff' }}>Override limit (logged)</Button>
              </div>
            </Card>
          </div>

          <SodNote>Classification upgrades (HNI / qualified) require evidence review and are logged. Limit overrides bypass the platform-wide 10% cap and are surfaced on the compliance dashboard.</SodNote>
          <Card title="Classification review">
            <div style={{ display: 'grid', gap: '0.6rem', maxWidth: 360 }}>
              <div><label style={labelStyle}>New classification</label>
                <select value={newClass} onChange={(e) => setNewClass(e.target.value as InvestorClassification)} className="vx-input">
                  <option value="">Select…</option>{['retail', 'qualified', 'hni', 'institutional'].map((s) => <option key={s} value={s}>{s}</option>)}
                </select>
              </div>
              <div><label style={labelStyle}>Reason / evidence ref</label><Input value={classReason} onChange={(e) => setClassReason(e.target.value)} /></div>
              <Button variant="primary" onClick={applyClass} disabled={working || !newClass || !classReason}>Apply classification</Button>
            </div>
          </Card>

          <Card title="Holdings">
            {inv.holdings.length === 0 ? <p style={{ color: colors.muted }}>No holdings.</p> : (
              <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                <thead><tr><th style={thCell}>Asset (cap entry)</th><th style={thCell}>Units</th><th style={thCell}>Ownership</th><th style={thCell}>Source</th></tr></thead>
                <tbody>{inv.holdings.map((h) => (
                  <tr key={h.id}><td style={tdCell}>{h.investorName} · {h.certificateRef}</td><td style={tdCell}>{h.units}</td><td style={tdCell}>{h.ownershipPct}%</td><td style={tdCell}><Badge text={h.source} color={SOURCE_COLOR[h.source] ?? colors.secondary} /></td></tr>
                ))}</tbody>
              </table>
            )}
          </Card>
        </>
      )}
    </Page>
  );
}
