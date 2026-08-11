'use client';

// SC-33 · Collections Dashboard — invoices issued/paid/overdue with totals.
// Invoice balance is derived from payment events (SF-2); this view is read-only.

import { useEffect, useMemo, useState } from 'react';
import { getCollectionsOverview, listInvoices } from '@/services/academyFeesService';
import type { CollectionsOverview, InvoiceRow, InvoiceStatus } from '@/types/academyFees';
import {
  PageHeader, Card, Badge, Kpi, StateBlock, DisclosureNote, Bar,
  btn, th, td, select, formatNaira, fmtDate,
} from '../../_ui';
import { FeesTabs, FeesGuard } from '../_ui';

const STATUSES: (InvoiceStatus | 'all')[] = ['all', 'issued', 'partial', 'paid', 'overdue', 'frozen'];

export default function FeesCollectionsPage() {
  const [overview, setOverview] = useState<CollectionsOverview | null>(null);
  const [invoices, setInvoices] = useState<InvoiceRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [filter, setFilter] = useState<InvoiceStatus | 'all'>('all');

  async function load() {
    setLoading(true); setError(null);
    try { const [o, inv] = await Promise.all([getCollectionsOverview(), listInvoices()]); setOverview(o); setInvoices(inv); }
    catch (e) { setError(String(e)); }
    finally { setLoading(false); }
  }
  useEffect(() => { load(); }, []);

  const rows = useMemo(() => filter === 'all' ? invoices : invoices.filter((i) => i.status === filter), [invoices, filter]);
  const collectionRate = overview && overview.billed_kobo > 0 ? overview.collected_kobo / overview.billed_kobo : 0;

  return (
    <FeesGuard permission="academy.fees.collections">
    <div style={{ padding: '0.5rem 0.5rem 2rem' }}>
      <PageHeader title="Collections Dashboard" subtitle="Invoices issued, paid, partial and overdue with billed / collected / outstanding totals across the school." action={<button onClick={load} style={btn()}>Refresh</button>} />
      <FeesTabs active="collections" />
      <DisclosureNote>Requires <code>academy.fees.collections</code>. Invoice balances are <strong>derived from payment events (SF-2)</strong>, never edited directly. All money in ₦ (kobo internally).</DisclosureNote>

      <StateBlock loading={loading} error={error} empty={false}>
        {overview && (
          <>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(190px, 1fr))', gap: '0.75rem', marginBottom: '1.25rem' }}>
              <Kpi label="Invoices issued" value={overview.invoices_issued.toString()} />
              <Kpi label="Paid" value={overview.invoices_paid.toString()} accent="#15803d" />
              <Kpi label="Partial" value={overview.invoices_partial.toString()} accent="#1d4ed8" />
              <Kpi label="Overdue" value={overview.invoices_overdue.toString()} accent={overview.invoices_overdue > 0 ? '#b91c1c' : undefined} />
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(220px, 1fr))', gap: '0.75rem', marginBottom: '1.25rem' }}>
              <Kpi label="Billed" value={formatNaira(overview.billed_kobo)} />
              <Kpi label="Collected" value={formatNaira(overview.collected_kobo)} accent="#15803d" />
              <Kpi label="Outstanding" value={formatNaira(overview.outstanding_kobo)} accent={overview.outstanding_kobo > 0 ? '#9a3412' : undefined} />
            </div>

            <Card title="Collection rate">
              <Bar value={overview.collected_kobo} max={overview.billed_kobo} color="#15803d" labelRight={`${(collectionRate * 100).toFixed(1)}% collected · ${formatNaira(overview.collected_kobo)} / ${formatNaira(overview.billed_kobo)}`} />
            </Card>
          </>
        )}

        <Card title="Invoices" right={<select style={select()} value={filter} onChange={(e) => setFilter(e.target.value as InvoiceStatus | 'all')}>{STATUSES.map((s) => <option key={s} value={s}>{s === 'all' ? 'All statuses' : s}</option>)}</select>}>
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead><tr><th style={th()}>Invoice</th><th style={th()}>Student</th><th style={th()}>Class</th><th style={th()}>Guardian</th><th style={th()}>Billed</th><th style={th()}>Paid</th><th style={th()}>Outstanding</th><th style={th()}>Due</th><th style={th()}>Status</th></tr></thead>
            <tbody>
              {rows.map((i) => (
                <tr key={i.id}>
                  <td style={td()}><code style={{ fontSize: '0.78rem' }}>{i.id}</code></td>
                  <td style={td()}><strong>{i.student_name}</strong></td>
                  <td style={td()}>{i.class_name}</td>
                  <td style={td()}>{i.guardian_email}</td>
                  <td style={td()}>{formatNaira(i.billed_kobo)}</td>
                  <td style={td()}>{formatNaira(i.paid_kobo)}</td>
                  <td style={td()}>{formatNaira(Math.max(0, i.billed_kobo - i.paid_kobo))}</td>
                  <td style={td()}>{fmtDate(i.due_date)}</td>
                  <td style={td()}><Badge status={i.status} /></td>
                </tr>
              ))}
              {rows.length === 0 && <tr><td style={td()} colSpan={9}><span style={{ color: '#6b7280' }}>No invoices match this filter.</span></td></tr>}
            </tbody>
          </table>
        </Card>
      </StateBlock>
    </div>
    </FeesGuard>
  );
}
