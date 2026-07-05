'use client';

import { useEffect, useState } from 'react';
import { getDepositRecon, formatNaira } from '@/services/staysExtranetService';
import type { DepositReconRow } from '@/types/staysExtranet';
import { PageHeader, ExtranetTabs, Card, Kpi, PropertyScopeNote, Badge, StateBlock, FilterBar, btn, select, label, th, td, fmtDate } from '../_ui';

export default function DepositReconPage() {
  const [rows, setRows] = useState<DepositReconRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [status, setStatus] = useState('all');

  async function load() {
    setLoading(true); setError(null);
    try { setRows(await getDepositRecon()); }
    catch (e) { setError(String(e)); } finally { setLoading(false); }
  }
  useEffect(() => { load(); }, []);

  const filtered = rows.filter((r) => status === 'all' || r.status === status);
  const flagged = rows.filter((r) => r.status === 'flagged').length;
  const pending = rows.filter((r) => r.status === 'pending').length;

  return (
    <div style={{ padding: '0.5rem 0.5rem 2rem' }}>
      <PageHeader title="Deposit / pay-at-property reconciliation" subtitle="Match deposits held by Paymax against amounts you collected at the property. Flagged rows need attention." action={<button onClick={load} style={btn()}>Refresh</button>} />
      <ExtranetTabs active="finance" />
      <PropertyScopeNote propertyName="Lekki Grand Hotel & Suites" />

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(180px, 1fr))', gap: '0.75rem', marginBottom: '1.25rem' }}>
        <Kpi label="Rows" value={rows.length.toLocaleString('en-NG')} />
        <Kpi label="Pending" value={pending.toLocaleString('en-NG')} accent={pending > 0 ? '#9a3412' : undefined} />
        <Kpi label="Flagged" value={flagged.toLocaleString('en-NG')} accent={flagged > 0 ? '#b91c1c' : '#15803d'} />
      </div>

      <FilterBar>
        <div><label style={label()}>Status</label><select style={select()} value={status} onChange={(e) => setStatus(e.target.value)}>{['all', 'reconciled', 'pending', 'flagged'].map((s) => <option key={s} value={s}>{s}</option>)}</select></div>
      </FilterBar>

      <Card title={`Reconciliation (${filtered.length})`}>
        <StateBlock loading={loading} error={error} empty={filtered.length === 0} emptyText="No rows for this filter.">
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead><tr><th style={th()}>Reservation</th><th style={th()}>Guest</th><th style={th()}>Check-in</th><th style={th()}>Deposit held</th><th style={th()}>Collected at property</th><th style={th()}>Status</th><th style={th()} /></tr></thead>
            <tbody>
              {filtered.map((r) => (
                <tr key={r.reservation_ref}>
                  <td style={td()}><code style={{ fontSize: '0.78rem' }}>{r.reservation_ref}</code></td>
                  <td style={td()}>{r.guest_name}</td>
                  <td style={td()}>{fmtDate(r.check_in)}</td>
                  <td style={td()}>{formatNaira(r.deposit_kobo)}</td>
                  <td style={td()}>{formatNaira(r.collected_at_property_kobo)}</td>
                  <td style={td()}><Badge status={r.status} /></td>
                  <td style={td()}>{r.status !== 'reconciled' ? <button style={btn()}>Reconcile</button> : '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </StateBlock>
      </Card>
    </div>
  );
}
