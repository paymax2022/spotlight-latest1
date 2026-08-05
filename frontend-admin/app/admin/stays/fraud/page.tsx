'use client';

import { useEffect, useState } from 'react';
import { listFraud, formatNaira, formatMoney } from '@/services/staysAdminService';
import type { FraudCase } from '@/types/staysAdmin';
import {
  StaysTabs,
  Kpi,
  Badge,
  StateBlock,
  FilterBar,
  DisclosureNote,
  label,
  select,
  timeAgo,
} from '../_ui';
import { Page, PageHeader, Button, colors, tint, thCell, tdCell } from '@/components/ui/vuexy';

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
    <Page>
      <PageHeader
        title="Fraud & risk console"
        subtitle="Risk-scored reservations across both rails. High-risk cases (≥80) are surfaced for manual review before booking is allowed to settle."
        actions={<Button variant="outline" sm onClick={load}>Refresh</Button>}
      />
      <StaysTabs active="trust" />

      <DisclosureNote>
        Risk signals combine velocity, device, payment and identity heuristics. Blocking a case
        holds funds in escrow — no debit is released until ops clears or refunds the reservation.
      </DisclosureNote>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(180px, 1fr))', gap: '0.75rem', marginBottom: '1.25rem' }}>
        <Kpi label="Open cases" value={openCount.toLocaleString('en-NG')} accent={openCount > 0 ? colors.warning : undefined} />
        <Kpi label="Blocked" value={blockedCount.toLocaleString('en-NG')} accent={blockedCount > 0 ? colors.danger : undefined} />
        <Kpi label="At-risk amount" value={formatNaira(atRisk)} sub="Open + reviewing holds" accent={atRisk > 0 ? colors.danger : undefined} />
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
              <th style={thCell}>Reservation</th>
              <th style={thCell}>Rail</th>
              <th style={thCell}>Guest</th>
              <th style={thCell}>Risk</th>
              <th style={thCell}>Signals</th>
              <th style={thCell}>Amount</th>
              <th style={thCell}>Status</th>
              <th style={thCell}>Detail</th>
              <th style={thCell}>Flagged</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => {
              const high = r.risk_score >= 80;
              return (
                <tr key={r.id} style={high ? { background: tint(colors.danger, 0.08) } : undefined}>
                  <td style={tdCell}><code style={{ fontSize: '0.78rem' }}>{r.reservation_id}</code></td>
                  <td style={tdCell}><Badge status={r.rail} /></td>
                  <td style={tdCell}>{r.guest_masked}</td>
                  <td style={{ ...tdCell, fontWeight: 700, color: high ? colors.danger : colors.text }}>{r.risk_score}</td>
                  <td style={tdCell}>
                    <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.25rem' }}>
                      {r.signals.length === 0 ? '—' : r.signals.map((s) => <Badge key={s} status={s} label={s.replace(/_/g, ' ')} />)}
                    </div>
                  </td>
                  <td style={tdCell}>{formatMoney(r.amount_kobo, r.currency)}</td>
                  <td style={tdCell}><Badge status={r.status} /></td>
                  <td style={{ ...tdCell, maxWidth: 280 }}>{r.detail}</td>
                  <td style={tdCell}>{timeAgo(r.created_at)}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </StateBlock>
    </Page>
  );
}
