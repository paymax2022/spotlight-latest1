'use client';

// 9.E.2 — Investor profile + remaining annual allowance.
// 9.E.3 — Limit monitoring + override (logged).
// 9.E.4 — Classification review.

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { getInvestor, overrideLimit, classifyInvestor } from '@/services/fractionalreAdminService';
import type { AdminInvestorDetail, InvestorClassification } from '@/types/fractionalreAdmin';
import { PageHeader, FractionalReTabs, Card, Kpi, Badge, SodNote, btn, btnPrimary, th, td, input, label, money, naira } from '../../_ui';

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
    <div style={{ padding: '0.5rem 0.5rem 2rem' }}>
      <PageHeader title={inv?.name ?? 'Investor'} subtitle="Profile, allowance, limit monitoring and classification." action={<Link href="/admin/fractionalre/investors" style={{ ...btn(), textDecoration: 'none' }}>← All investors</Link>} />
      <FractionalReTabs active="investors" />
      {error && <p style={{ color: '#dc2626' }}>{error}</p>}
      {msg && <p style={{ color: '#15803d' }}>{msg}</p>}

      {loading || !inv ? <p style={{ color: '#6b7280' }}>Loading investor…</p> : (
        <>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(180px, 1fr))', gap: '0.75rem', marginBottom: '1.25rem' }}>
            <Kpi label="AUM" value={money(inv.aumKobo)} accent="#1d4ed8" />
            <Kpi label="Annual cap" value={money(inv.limit.annualCapKobo)} accent="#6b21a8" sub={`${inv.limit.capPct}% platform cap`} />
            <Kpi label="Invested this year" value={money(inv.limit.investedThisYearKobo)} accent="#d97706" />
            <Kpi label="Remaining allowance" value={money(inv.limit.remainingAllowanceKobo)} accent={inv.limit.breached ? '#dc2626' : '#16a34a'} sub={inv.limit.breached ? 'BREACHED' : 'within cap'} />
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1rem' }}>
            <Card title="Profile">
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.5rem 1rem', fontSize: '0.85rem' }}>
                <div><span style={{ color: '#6b7280' }}>Email:</span> {inv.email}</div>
                <div><span style={{ color: '#6b7280' }}>Phone:</span> {inv.phone}</div>
                <div><span style={{ color: '#6b7280' }}>KYC:</span> <Badge status={inv.kycStatus} /></div>
                <div><span style={{ color: '#6b7280' }}>Classification:</span> <Badge status={inv.classification} /></div>
                <div><span style={{ color: '#6b7280' }}>Income on file:</span> {money(inv.incomeOnFileKobo)}</div>
                <div><span style={{ color: '#6b7280' }}>Risk profile:</span> {inv.riskProfile}</div>
              </div>
            </Card>

            <Card title="Limit monitoring (compliance)">
              <p style={{ fontSize: '0.85rem', color: '#6b7280', marginTop: 0 }}>Remaining annual allowance: <strong style={{ color: inv.limit.breached ? '#dc2626' : '#111827' }}>{naira(inv.limit.remainingAllowanceKobo)}</strong></p>
              {inv.limit.overrideActive && <Badge status="active" label="override active" />}
              <div style={{ display: 'grid', gap: '0.5rem', marginTop: '0.6rem', maxWidth: 320 }}>
                <div><label style={label()}>New annual cap (₦)</label><input value={overrideNaira} onChange={(e) => setOverrideNaira(e.target.value)} style={input()} placeholder="10000000" /></div>
                <div><label style={label()}>Reason (logged)</label><input value={overrideReason} onChange={(e) => setOverrideReason(e.target.value)} style={input()} /></div>
                <button onClick={applyOverride} disabled={working || !overrideNaira || !overrideReason} style={{ ...btnPrimary('#d97706'), opacity: working || !overrideNaira || !overrideReason ? 0.6 : 1 }}>Override limit (logged)</button>
              </div>
            </Card>
          </div>

          <SodNote>Classification upgrades (HNI / qualified) require evidence review and are logged. Limit overrides bypass the platform-wide 10% cap and are surfaced on the compliance dashboard.</SodNote>
          <Card title="Classification review">
            <div style={{ display: 'grid', gap: '0.6rem', maxWidth: 360 }}>
              <div><label style={label()}>New classification</label>
                <select value={newClass} onChange={(e) => setNewClass(e.target.value as InvestorClassification)} style={input()}>
                  <option value="">Select…</option>{['retail', 'qualified', 'hni', 'institutional'].map((s) => <option key={s} value={s}>{s}</option>)}
                </select>
              </div>
              <div><label style={label()}>Reason / evidence ref</label><input value={classReason} onChange={(e) => setClassReason(e.target.value)} style={input()} /></div>
              <button onClick={applyClass} disabled={working || !newClass || !classReason} style={{ ...btnPrimary(), opacity: working || !newClass || !classReason ? 0.6 : 1 }}>Apply classification</button>
            </div>
          </Card>

          <Card title="Holdings">
            {inv.holdings.length === 0 ? <p style={{ color: '#6b7280' }}>No holdings.</p> : (
              <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                <thead><tr><th style={th()}>Asset (cap entry)</th><th style={th()}>Units</th><th style={th()}>Ownership</th><th style={th()}>Source</th></tr></thead>
                <tbody>{inv.holdings.map((h) => (
                  <tr key={h.id}><td style={td()}>{h.investorName} · {h.certificateRef}</td><td style={td()}>{h.units}</td><td style={td()}>{h.ownershipPct}%</td><td style={td()}><Badge status={h.source} /></td></tr>
                ))}</tbody>
              </table>
            )}
          </Card>
        </>
      )}
    </div>
  );
}
