'use client';

import { useEffect, useState } from 'react';
import { getInvoices, formatNaira } from '@/services/staysExtranetService';
import type { Invoice } from '@/types/staysExtranet';
import { PageHeader, ExtranetTabs, Card, Kpi, PropertyScopeNote, Badge, StateBlock, FilterBar, btn, select, label, th, td, fmtDate } from '../_ui';

export default function InvoicesPage() {
  const [rows, setRows] = useState<Invoice[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [status, setStatus] = useState('all');

  async function load() {
    setLoading(true); setError(null);
    try { setRows(await getInvoices()); }
    catch (e) { setError(String(e)); } finally { setLoading(false); }
  }
  useEffect(() => { load(); }, []);

  const filtered = rows.filter((r) => status === 'all' || r.status === status);
  const overdue = rows.filter((r) => r.status === 'overdue').reduce((s, r) => s + r.amount_kobo, 0);

  return (
    <div style={{ padding: '0.5rem 0.5rem 2rem' }}>
      <PageHeader title="Invoices" subtitle="Commission and service-fee invoices issued by Paymax. Amounts in Naira." action={<button onClick={load} style={btn()}>Refresh</button>} />
      <ExtranetTabs active="finance" />
      <PropertyScopeNote propertyName="Lekki Grand Hotel & Suites" />

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(200px, 1fr))', gap: '0.75rem', marginBottom: '1.25rem' }}>
        <Kpi label="Invoices" value={rows.length.toLocaleString('en-NG')} />
        <Kpi label="Overdue amount" value={formatNaira(overdue)} accent={overdue > 0 ? '#b91c1c' : '#15803d'} />
      </div>

      <FilterBar>
        <div><label style={label()}>Status</label><select style={select()} value={status} onChange={(e) => setStatus(e.target.value)}>{['all', 'paid', 'pending', 'overdue'].map((s) => <option key={s} value={s}>{s}</option>)}</select></div>
      </FilterBar>

      <Card title={`Invoices (${filtered.length})`}>
        <StateBlock loading={loading} error={error} empty={filtered.length === 0} emptyText="No invoices for this filter.">
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead><tr><th style={th()}>Invoice #</th><th style={th()}>Issued</th><th style={th()}>Type</th><th style={th()}>Amount</th><th style={th()}>Status</th><th style={th()} /></tr></thead>
            <tbody>
              {filtered.map((inv) => (
                <tr key={inv.id}>
                  <td style={td()}><code style={{ fontSize: '0.78rem' }}>{inv.number}</code></td>
                  <td style={td()}>{fmtDate(inv.issued_at)}</td>
                  <td style={td()}>{inv.type.replace(/_/g, ' ')}</td>
                  <td style={td()}>{formatNaira(inv.amount_kobo)} <span style={{ color: '#9ca3af', fontSize: '0.72rem' }}>{inv.currency}</span></td>
                  <td style={td()}><Badge status={inv.status} /></td>
                  <td style={td()}><button style={btn()}>Download PDF</button></td>
                </tr>
              ))}
            </tbody>
          </table>
        </StateBlock>
      </Card>
    </div>
  );
}
