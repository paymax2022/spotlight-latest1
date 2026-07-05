'use client';

import { useEffect, useState } from 'react';
import { listFraud, formatNaira, formatMoney } from '@/services/staysAdminService';
import type { FraudCase } from '@/types/staysAdmin';
import {
  PageHeader,
  StaysTabs,
  Kpi,
  Badge,
  StateBlock,
  FilterBar,
  DisclosureNote,
  btn,
  th,
  td,
  label,
  select,
  timeAgo,
} from '../_ui';

const STATUSES = ['open', 'reviewing', 'cleared', 'blocked'];

export default function StaysFraudPage() {
  const [rows, setRows] = useState<FraudCase[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [status, setStatus] = useState('');

  async function load() {
    setLoading(true); setError(null);
    try { setRows(await listFraud(status ? { status } : undefined)); }
    catch (e) { setError(String(e)); }
    finally { setLoading(false); }
  }
  useEffect(() => { load(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [status]);

  const openCount = rows.filter((r) => r.status === 'open').length;
  const blockedCount = rows.filter((r) => r.status === 'blocked').length;
  const atRisk = rows
    .filter((r) => r.status === 'open' || r.status === 'reviewing')
    .reduce((sum, r) => sum + r.amount_kobo, 0);

  return (
    <div style={{ padding: '0.5rem 0.5rem 2rem' }}>
      <PageHeader
        title="Fraud & risk console"
        subtitle="Risk-scored reservations across both rails. High-risk cases (≥80) are surfaced for manual review before booking is allowed to settle."
        action={<button onClick={load} style={btn()}>Refresh</button>}
      />
      <StaysTabs active="trust" />

      <DisclosureNote>
        Risk signals combine velocity, device, payment and identity heuristics. Blocking a case
        holds funds in escrow — no debit is released until ops clears or refunds the reservation.
      </DisclosureNote>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(180px, 1fr))', gap: '0.75rem', marginBottom: '1.25rem' }}>
        <Kpi label="Open cases" value={openCount.toLocaleString('en-NG')} accent={openCount > 0 ? '#9a3412' : undefined} />
        <Kpi label="Blocked" value={blockedCount.toLocaleString('en-NG')} accent={blockedCount > 0 ? '#b91c1c' : undefined} />
        <Kpi label="At-risk amount" value={formatNaira(atRisk)} sub="Open + reviewing holds" accent={atRisk > 0 ? '#b91c1c' : undefined} />
      </div>

      <FilterBar>
        <div>
          <label style={label()}>Status</label>
          <select style={select()} value={status} onChange={(e) => setStatus(e.target.value)}>
            <option value="">All statuses</option>
            {STATUSES.map((s) => <option key={s} value={s}>{s}</option>)}
          </select>
        </div>
      </FilterBar>

      <StateBlock loading={loading} error={error} empty={rows.length === 0} emptyText="No fraud cases found.">
        <table style={{ width: '100%', borderCollapse: 'collapse' }}>
          <thead>
            <tr>
              <th style={th()}>Reservation</th>
              <th style={th()}>Rail</th>
              <th style={th()}>Guest</th>
              <th style={th()}>Risk</th>
              <th style={th()}>Signals</th>
              <th style={th()}>Amount</th>
              <th style={th()}>Status</th>
              <th style={th()}>Detail</th>
              <th style={th()}>Flagged</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => {
              const high = r.risk_score >= 80;
              return (
                <tr key={r.id} style={high ? { background: '#fef2f2' } : undefined}>
                  <td style={td()}><code style={{ fontSize: '0.78rem' }}>{r.reservation_id}</code></td>
                  <td style={td()}><Badge status={r.rail} /></td>
                  <td style={td()}>{r.guest_masked}</td>
                  <td style={{ ...td(), fontWeight: 700, color: high ? '#b91c1c' : '#374151' }}>{r.risk_score}</td>
                  <td style={td()}>
                    <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.25rem' }}>
                      {r.signals.length === 0 ? '—' : r.signals.map((s) => <Badge key={s} status={s} label={s.replace(/_/g, ' ')} />)}
                    </div>
                  </td>
                  <td style={td()}>{formatMoney(r.amount_kobo, r.currency)}</td>
                  <td style={td()}><Badge status={r.status} /></td>
                  <td style={{ ...td(), maxWidth: 280 }}>{r.detail}</td>
                  <td style={td()}>{timeAgo(r.created_at)}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </StateBlock>
    </div>
  );
}
