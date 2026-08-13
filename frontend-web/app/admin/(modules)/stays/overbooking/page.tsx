'use client';

import { useEffect, useState } from 'react';
import { listOverbooking, formatNaira } from '@/services/staysAdminService';
import type { OverbookingCase, OverbookingStatus } from '@/types/staysAdmin';
import { StaysTabs, Badge, FilterBar, label, select, fmtDate, timeAgo, StateBlock, DisclosureNote } from '../_ui';
import { Page, PageHeader, Card, Button, colors, tint, thCell, tdCell } from '@/components/ui/vuexy';

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
    <Page>
      <PageHeader
        title="No-show & overbooking"
        subtitle="Handle overbooking incidents and no-show charges across both rails. Money is in ₦ (kobo minor units); guest PII is masked."
        actions={<Button variant="outline" onClick={load}>Refresh</Button>}
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
                  <th style={thCell}>Reservation</th>
                  <th style={thCell}>Property</th>
                  <th style={thCell}>Rail</th>
                  <th style={thCell}>Case type</th>
                  <th style={thCell}>Status</th>
                  <th style={thCell}>Guest</th>
                  <th style={thCell}>Check-in</th>
                  <th style={thCell}>Amount</th>
                  <th style={thCell}>Detail</th>
                  <th style={thCell}>Created</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((c) => (
                  <tr key={c.id}>
                    <td style={tdCell}><code style={{ fontSize: '0.78rem', background: tint(colors.muted, 0.12), padding: '0.1rem 0.35rem', borderRadius: '0.25rem' }}>{c.reservation_id}</code></td>
                    <td style={tdCell}>{c.property_name}</td>
                    <td style={tdCell}><Badge status={c.rail} /></td>
                    <td style={tdCell}><Badge status={c.case_type} label={c.case_type.replace(/_/g, ' ')} /></td>
                    <td style={tdCell}><Badge status={c.status} /></td>
                    <td style={tdCell}>{c.guest_masked}</td>
                    <td style={tdCell}>{fmtDate(c.check_in)}</td>
                    <td style={tdCell}>{formatNaira(c.amount_kobo)} <span style={{ color: colors.muted, fontSize: '0.72rem' }}>{c.currency}</span></td>
                    <td style={{ ...tdCell, maxWidth: 320 }}>{c.detail}</td>
                    <td style={tdCell}>{timeAgo(c.created_at)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </StateBlock>
      </Card>
    </Page>
  );
}
