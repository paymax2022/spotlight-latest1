'use client';

// 9.G.1 — Distribution scheduler + history.

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { listDistributions, scheduleDistribution, listAssets } from '@/services/fractionalreAdminService';
import type { AdminDistribution, AdminAsset, ScheduleDistributionInput } from '@/types/fractionalreAdmin';
import { PageHeader, FractionalReTabs, Card, Badge, btn, btnPrimary, th, td, input, label, money, timeAgo } from '../_ui';

const SOURCES: ScheduleDistributionInput['source'][] = ['rental_income', 'sale_proceeds', 'interest', 'other'];

export default function DistributionsPage() {
  const [dist, setDist] = useState<AdminDistribution[]>([]);
  const [assets, setAssets] = useState<AdminAsset[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const [working, setWorking] = useState(false);
  const [form, setForm] = useState<{ assetId: string; period: string; grossNaira: string; source: ScheduleDistributionInput['source'] }>({ assetId: '', period: '', grossNaira: '', source: 'rental_income' });

  async function load() {
    setLoading(true); setError(null);
    try { const [d, a] = await Promise.all([listDistributions(), listAssets()]); setDist(d); setAssets(a); }
    catch (e) { setError(String(e)); } finally { setLoading(false); }
  }
  useEffect(() => { load(); }, []);

  async function schedule() {
    if (!form.assetId || !form.period || !form.grossNaira) return;
    setWorking(true); setError(null); setMsg(null);
    try {
      await scheduleDistribution({ assetId: form.assetId, period: form.period, grossAmountKobo: Math.round(parseFloat(form.grossNaira) * 100), source: form.source });
      setMsg('Distribution run scheduled (Draft).'); setForm({ assetId: '', period: '', grossNaira: '', source: 'rental_income' }); await load();
    } catch (e) { setError(String(e)); } finally { setWorking(false); }
  }

  return (
    <div style={{ padding: '0.5rem 0.5rem 2rem' }}>
      <PageHeader title="Distributions" subtitle="Schedule payout runs; preview, then maker-checker approval." action={<button onClick={load} style={btn()}>Refresh</button>} />
      <FractionalReTabs active="distributions" />
      {error && <p style={{ color: '#dc2626' }}>{error}</p>}
      {msg && <p style={{ color: '#15803d' }}>{msg}</p>}

      <Card title="Schedule a distribution run">
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: '0.8rem', alignItems: 'end' }}>
          <div><label style={label()}>Asset</label><select value={form.assetId} onChange={(e) => setForm({ ...form, assetId: e.target.value })} style={input()}><option value="">Select…</option>{assets.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}</select></div>
          <div><label style={label()}>Period</label><input value={form.period} onChange={(e) => setForm({ ...form, period: e.target.value })} placeholder="2026-Q3" style={input()} /></div>
          <div><label style={label()}>Gross amount (₦)</label><input value={form.grossNaira} onChange={(e) => setForm({ ...form, grossNaira: e.target.value })} placeholder="38500000" style={input()} /></div>
          <div><label style={label()}>Source</label><select value={form.source} onChange={(e) => setForm({ ...form, source: e.target.value as ScheduleDistributionInput['source'] })} style={input()}>{SOURCES.map((s) => <option key={s} value={s}>{s.replace(/_/g, ' ')}</option>)}</select></div>
        </div>
        <button onClick={schedule} disabled={working || !form.assetId || !form.period || !form.grossNaira} style={{ ...btnPrimary(), marginTop: '0.8rem', opacity: working || !form.assetId || !form.period || !form.grossNaira ? 0.6 : 1 }}>{working ? 'Scheduling…' : 'Schedule run'}</button>
      </Card>

      <Card title="Distribution history">
        {loading ? <p style={{ color: '#6b7280' }}>Loading…</p> : dist.length === 0 ? <p style={{ color: '#6b7280' }}>No runs.</p> : (
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead><tr><th style={th()}>Asset</th><th style={th()}>Period</th><th style={th()}>Gross</th><th style={th()}>Source</th><th style={th()}>Status</th><th style={th()}>Maker / Checker</th><th style={th()}>Created</th><th style={th()} /></tr></thead>
            <tbody>{dist.map((d) => (
              <tr key={d.id}>
                <td style={td()}>{d.assetName}</td><td style={td()}>{d.period}</td><td style={td()}>{money(d.grossAmountKobo)}</td>
                <td style={{ ...td(), textTransform: 'capitalize' }}>{d.source.replace(/_/g, ' ')}</td>
                <td style={td()}><Badge status={d.status} /></td>
                <td style={td()}>{d.maker ?? '—'} / {d.checker ?? '—'}</td>
                <td style={td()}>{timeAgo(d.createdAt)}</td>
                <td style={td()}><Link href={`/admin/fractionalre/distributions/${d.id}`} style={{ color: '#1d4ed8' }}>Open →</Link></td>
              </tr>
            ))}</tbody>
          </table>
        )}
      </Card>
    </div>
  );
}
