'use client';

import { useEffect, useState } from 'react';
import { getPayouts, formatNaira } from '@/services/staysExtranetService';
import type { Payout } from '@/types/staysExtranet';
import { PageHeader, ExtranetTabs, Card, Kpi, PropertyScopeNote, Badge, StateBlock, FilterBar, btn, select, label, th, td, fmtDate } from '../_ui';

export default function PayoutsPage() {
  const [rows, setRows] = useState<Payout[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [status, setStatus] = useState('all');

  async function load() {
    setLoading(true); setError(null);
    try { setRows(await getPayouts()); }
    catch (e) { setError(String(e)); } finally { setLoading(false); }
  }
  useEffect(() => { load(); }, []);

  const filtered = rows.filter((r) => status === 'all' || r.status === status);
  const paid = rows.filter((r) => r.status === 'paid').reduce((s, r) => s + r.net_kobo, 0);
  const upcoming = rows.filter((r) => r.status === 'scheduled').reduce((s, r) => s + r.net_kobo, 0);

  return (
    <div style={{ padding: '0.5rem 0.5rem 2rem' }}>
      <PageHeader title="Payouts & statements" subtitle="Your settlement statements. Paymax pays out net (after commission) in Nigerian Naira to your verified bank account." action={<button onClick={load} style={btn()}>Refresh</button>} />
      <ExtranetTabs active="finance" />
      <PropertyScopeNote propertyName="Lekki Grand Hotel & Suites" />

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(200px, 1fr))', gap: '0.75rem', marginBottom: '1.25rem' }}>
        <Kpi label="Paid to date (net)" value={formatNaira(paid)} sub="NGN" accent="#15803d" />
        <Kpi label="Scheduled (net)" value={formatNaira(upcoming)} sub="NGN" accent="#340075" />
        <Kpi label="Statements" value={rows.length.toLocaleString('en-NG')} />
      </div>

      <FilterBar>
        <div><label style={label()}>Status</label><select style={select()} value={status} onChange={(e) => setStatus(e.target.value)}>{['all', 'paid', 'scheduled', 'pending', 'held'].map((s) => <option key={s} value={s}>{s}</option>)}</select></div>
      </FilterBar>

      <Card title={`Payout statements (${filtered.length})`}>
        <StateBlock loading={loading} error={error} empty={filtered.length === 0} emptyText="No payouts for this filter.">
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead><tr><th style={th()}>Period</th><th style={th()}>Gross</th><th style={th()}>Commission</th><th style={th()}>Net payout</th><th style={th()}>Reference</th><th style={th()}>Paid</th><th style={th()}>Status</th><th style={th()} /></tr></thead>
            <tbody>
              {filtered.map((p) => (
                <tr key={p.id}>
                  <td style={td()}>{p.period}</td>
                  <td style={td()}>{formatNaira(p.gross_kobo)}</td>
                  <td style={td()}>−{formatNaira(p.commission_kobo)}</td>
                  <td style={td()}><strong>{formatNaira(p.net_kobo)}</strong> <span style={{ color: '#9ca3af', fontSize: '0.72rem' }}>{p.currency}</span></td>
                  <td style={td()}><code style={{ fontSize: '0.78rem' }}>{p.reference ?? '—'}</code></td>
                  <td style={td()}>{fmtDate(p.paid_at)}</td>
                  <td style={td()}><Badge status={p.status} /></td>
                  <td style={td()}><button style={btn()}>Download statement</button></td>
                </tr>
              ))}
            </tbody>
          </table>
        </StateBlock>
      </Card>
    </div>
  );
}
