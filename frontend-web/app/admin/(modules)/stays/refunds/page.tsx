'use client';

import { useEffect, useState } from 'react';
import { listRefunds, decideRefund, formatNaira } from '@/services/staysAdminService';
import type { RefundRequest, RefundStatus } from '@/types/staysAdmin';
import { StaysTabs, Badge, FilterBar, label, select, timeAgo, StateBlock, DisclosureNote } from '../_ui';
import { Page, PageHeader, Card, Button, colors, tint, thCell, tdCell } from '@/components/ui/vuexy';

const STATUSES: RefundStatus[] = ['pending', 'approved', 'paid', 'rejected'];

export default function StaysRefundsPage() {
  const [rows, setRows] = useState<RefundRequest[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [status, setStatus] = useState('');
  const [fastPath, setFastPath] = useState(''); // '' = all, 'yes', 'no'
  const [busyId, setBusyId] = useState<string | null>(null);

  function fastPathOpt(): boolean | undefined {
    if (fastPath === 'yes') return true;
    if (fastPath === 'no') return false;
    return undefined;
  }

  async function load() {
    setLoading(true); setError(null);
    try {
      setRows(await listRefunds({ status: status || undefined, fast_path: fastPathOpt() }));
    } catch (e) { setError(String(e)); }
    finally { setLoading(false); }
  }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { load(); }, [status, fastPath]);

  async function decide(id: string, decision: RefundStatus) {
    setBusyId(id); setError(null);
    try { await decideRefund(id, { decision }); await load(); }
    catch (e) { setError(String(e)); }
    finally { setBusyId(null); }
  }

  return (
    <Page>
      <PageHeader
        title="Refunds & disputes"
        subtitle="Refund and dispute queue. Money is in ₦ (kobo minor units); supplier rail is disclosed per request."
        actions={<Button variant="outline" onClick={load}>Refresh</Button>}
      />
      <StaysTabs active="reservations" />

      <DisclosureNote>
        <strong>Fast-path</strong> rows are paid-but-unconfirmed cases (PRD §12): the guest was charged but the supplier never confirmed the booking, so the funds must be refunded urgently. These are highlighted below and should be cleared first.
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
            <label style={label()}>Fast-path</label>
            <select style={select()} value={fastPath} onChange={(e) => setFastPath(e.target.value)}>
              <option value="">All</option>
              <option value="yes">Fast-path only</option>
              <option value="no">Standard only</option>
            </select>
          </div>
        </FilterBar>
      </Card>

      <Card title={`Refund requests${rows.length ? ` (${rows.length})` : ''}`}>
        <StateBlock loading={loading} error={error} empty={rows.length === 0} emptyText="No refund requests match these filters.">
          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse' }}>
              <thead>
                <tr>
                  <th style={thCell}>Reference</th>
                  <th style={thCell}>Reservation</th>
                  <th style={thCell}>Rail</th>
                  <th style={thCell}>Reason</th>
                  <th style={thCell}>Path</th>
                  <th style={thCell}>Amount</th>
                  <th style={thCell}>Guest</th>
                  <th style={thCell}>Status</th>
                  <th style={thCell}>Requested</th>
                  <th style={thCell}>Decision</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.id} style={r.fast_path ? { background: tint(colors.danger, 0.06), borderLeft: `3px solid ${colors.danger}` } : undefined}>
                    <td style={tdCell}>{r.reference}</td>
                    <td style={tdCell}><code style={{ fontSize: '0.78rem', background: tint(colors.muted, 0.12), padding: '0.1rem 0.35rem', borderRadius: '0.25rem' }}>{r.reservation_id}</code></td>
                    <td style={tdCell}><Badge status={r.rail} /></td>
                    <td style={tdCell}>{r.reason.replace(/_/g, ' ')}</td>
                    <td style={tdCell}>{r.fast_path ? <Badge status="high" label="Fast-path" /> : <Badge status="low" label="Standard" />}</td>
                    <td style={tdCell}>{formatNaira(r.amount_kobo)} <span style={{ color: colors.muted, fontSize: '0.72rem' }}>{r.currency}</span></td>
                    <td style={tdCell}>{r.guest_masked}</td>
                    <td style={tdCell}><Badge status={r.status} /></td>
                    <td style={tdCell}>{timeAgo(r.requested_at)}</td>
                    <td style={tdCell}>
                      <div style={{ display: 'flex', gap: '0.35rem', flexWrap: 'wrap' }}>
                        <Button variant="outline" sm disabled={busyId === r.id} onClick={() => decide(r.id, 'approved')}>Approve</Button>
                        <Button variant="primary" sm disabled={busyId === r.id} onClick={() => decide(r.id, 'paid')}>Pay</Button>
                        <Button variant="danger" sm disabled={busyId === r.id} onClick={() => decide(r.id, 'rejected')}>Reject</Button>
                      </div>
                    </td>
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
