'use client';

// 9.G.1 — Distribution scheduler + history.

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { listDistributions, scheduleDistribution, listAssets } from '@/services/fractionalreAdminService';
import type { AdminDistribution, AdminAsset, ScheduleDistributionInput } from '@/types/fractionalreAdmin';
import { FractionalReTabs, money, timeAgo } from '../_ui';
import { Page, PageHeader, Card, Button, Input, Badge, colors, thCell, tdCell } from '@/components/ui/vuexy';

const SOURCES: ScheduleDistributionInput['source'][] = ['rental_income', 'sale_proceeds', 'interest', 'other'];

const STATUS_COLOR: Record<string, string> = {
  draft: colors.secondary, calculated: colors.warning, pendingapproval: colors.warning, executing: colors.warning,
  distributing: colors.warning, completed: colors.success, partiallyfailed: colors.danger, refunding: colors.warning,
};

const labelStyle = { fontSize: '0.78rem', fontWeight: 600, color: colors.text, display: 'block', marginBottom: 4 } as const;

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
    <Page>
      <PageHeader title="Distributions" subtitle="Schedule payout runs; preview, then maker-checker approval." actions={<Button onClick={load}>Refresh</Button>} />
      <FractionalReTabs active="distributions" />
      {error && <p style={{ color: colors.danger }}>{error}</p>}
      {msg && <p style={{ color: colors.success }}>{msg}</p>}

      <Card title="Schedule a distribution run">
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: '0.8rem', alignItems: 'end' }}>
          <div><label style={labelStyle}>Asset</label><select value={form.assetId} onChange={(e) => setForm({ ...form, assetId: e.target.value })} className="vx-input"><option value="">Select…</option>{assets.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}</select></div>
          <div><label style={labelStyle}>Period</label><Input value={form.period} onChange={(e) => setForm({ ...form, period: e.target.value })} placeholder="2026-Q3" /></div>
          <div><label style={labelStyle}>Gross amount (₦)</label><Input value={form.grossNaira} onChange={(e) => setForm({ ...form, grossNaira: e.target.value })} placeholder="38500000" /></div>
          <div><label style={labelStyle}>Source</label><select value={form.source} onChange={(e) => setForm({ ...form, source: e.target.value as ScheduleDistributionInput['source'] })} className="vx-input">{SOURCES.map((s) => <option key={s} value={s}>{s.replace(/_/g, ' ')}</option>)}</select></div>
        </div>
        <Button variant="primary" onClick={schedule} disabled={working || !form.assetId || !form.period || !form.grossNaira} style={{ marginTop: '0.8rem' }}>{working ? 'Scheduling…' : 'Schedule run'}</Button>
      </Card>

      <Card title="Distribution history">
        {loading ? <p style={{ color: colors.muted }}>Loading…</p> : dist.length === 0 ? <p style={{ color: colors.muted }}>No runs.</p> : (
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead><tr><th style={thCell}>Asset</th><th style={thCell}>Period</th><th style={thCell}>Gross</th><th style={thCell}>Source</th><th style={thCell}>Status</th><th style={thCell}>Maker / Checker</th><th style={thCell}>Created</th><th style={thCell} /></tr></thead>
            <tbody>{dist.map((d) => (
              <tr key={d.id}>
                <td style={tdCell}>{d.assetName}</td><td style={tdCell}>{d.period}</td><td style={tdCell}>{money(d.grossAmountKobo)}</td>
                <td style={{ ...tdCell, textTransform: 'capitalize' }}>{d.source.replace(/_/g, ' ')}</td>
                <td style={tdCell}><Badge text={d.status.replace(/_/g, ' ')} color={STATUS_COLOR[d.status.toLowerCase()] ?? colors.secondary} /></td>
                <td style={tdCell}>{d.maker ?? '—'} / {d.checker ?? '—'}</td>
                <td style={tdCell}>{timeAgo(d.createdAt)}</td>
                <td style={tdCell}><Link href={`/admin/fractionalre/distributions/${d.id}`} style={{ color: colors.info }}>Open →</Link></td>
              </tr>
            ))}</tbody>
          </table>
        )}
      </Card>
    </Page>
  );
}
