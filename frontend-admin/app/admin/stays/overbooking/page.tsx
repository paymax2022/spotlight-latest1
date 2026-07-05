'use client';

import { useEffect, useState } from 'react';
import { listOverbooking, formatNaira } from '@/services/staysAdminService';
import type { OverbookingCase, OverbookingStatus } from '@/types/staysAdmin';
import { PageHeader, StaysTabs, Card, Badge, FilterBar, btn, th, td, label, select, fmtDate, timeAgo, StateBlock, DisclosureNote } from '../_ui';

const STATUSES: OverbookingStatus[] = ['open', 'rebooked', 'refunded', 'resolved'];
const CASE_TYPES: OverbookingCase['case_type'][] = ['overbooking', 'no_show'];

export default function StaysOverbookingPage() {
  const [rows, setRows] = useState<OverbookingCase[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [status, setStatus] = useState('');
  const [caseType, setCaseType] = useState('');

  async function load() {
    setLoading(true); setError(null);
    try {
      setRows(await listOverbooking({ status: status || undefined, case_type: caseType || undefined }));
    } catch (e) { setError(String(e)); }
    finally { setLoading(false); }
  }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { load(); }, [status, caseType]);

  return (
    <div style={{ padding: '0.5rem 0.5rem 2rem' }}>
      <PageHeader
        title="No-show & overbooking"
        subtitle="Handle overbooking incidents and no-show charges across both rails. Money is in ₦ (kobo minor units); guest PII is masked."
        action={<button onClick={load} style={btn()}>Refresh</button>}
      />
      <StaysTabs active="reservations" />

      <DisclosureNote>
        Overbooking cases (hotel cannot honour a confirmed booking) require rebook or refund + goodwill; no-show cases apply policy charges. Both are money-affecting and audit-logged.
      </DisclosureNote>

      <Card title="Filters">
        <FilterBar>
          <div style={{ minWidth: 180 }}>
            <label style={label()}>Status</label>
            <select style={select()} value={status} onChange={(e) => setStatus(e.target.value)}>
              <option value="">All statuses</option>
              {STATUSES.map((s) => <option key={s} value={s}>{s}</option>)}
            </select>
          </div>
          <div style={{ minWidth: 180 }}>
            <label style={label()}>Case type</label>
            <select style={select()} value={caseType} onChange={(e) => setCaseType(e.target.value)}>
              <option value="">All types</option>
              {CASE_TYPES.map((c) => <option key={c} value={c}>{c.replace(/_/g, ' ')}</option>)}
            </select>
          </div>
        </FilterBar>
      </Card>

      <Card title={`Cases${rows.length ? ` (${rows.length})` : ''}`}>
        <StateBlock loading={loading} error={error} empty={rows.length === 0} emptyText="No cases match these filters.">
          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse' }}>
              <thead>
                <tr>
                  <th style={th()}>Reservation</th>
                  <th style={th()}>Property</th>
                  <th style={th()}>Rail</th>
                  <th style={th()}>Case type</th>
                  <th style={th()}>Status</th>
                  <th style={th()}>Guest</th>
                  <th style={th()}>Check-in</th>
                  <th style={th()}>Amount</th>
                  <th style={th()}>Detail</th>
                  <th style={th()}>Created</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((c) => (
                  <tr key={c.id}>
                    <td style={td()}><code style={{ fontSize: '0.78rem', background: '#f3f4f6', padding: '0.1rem 0.35rem', borderRadius: '0.25rem' }}>{c.reservation_id}</code></td>
                    <td style={td()}>{c.property_name}</td>
                    <td style={td()}><Badge status={c.rail} /></td>
                    <td style={td()}><Badge status={c.case_type} label={c.case_type.replace(/_/g, ' ')} /></td>
                    <td style={td()}><Badge status={c.status} /></td>
                    <td style={td()}>{c.guest_masked}</td>
                    <td style={td()}>{fmtDate(c.check_in)}</td>
                    <td style={td()}>{formatNaira(c.amount_kobo)} <span style={{ color: '#9ca3af', fontSize: '0.72rem' }}>{c.currency}</span></td>
                    <td style={{ ...td(), maxWidth: 320 }}>{c.detail}</td>
                    <td style={td()}>{timeAgo(c.created_at)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </StateBlock>
      </Card>
    </div>
  );
}
