'use client';

import { useEffect, useState } from 'react';
import { listRefunds, decideRefund, formatNaira } from '@/services/staysAdminService';
import type { RefundRequest, RefundStatus } from '@/types/staysAdmin';
import { PageHeader, StaysTabs, Card, Badge, FilterBar, btn, btnPrimary, btnDanger, th, td, label, select, timeAgo, StateBlock, DisclosureNote } from '../_ui';

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
    <div style={{ padding: '0.5rem 0.5rem 2rem' }}>
      <PageHeader
        title="Refunds & disputes"
        subtitle="Refund and dispute queue. Money is in ₦ (kobo minor units); supplier rail is disclosed per request."
        action={<button onClick={load} style={btn()}>Refresh</button>}
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
                  <th style={th()}>Reference</th>
                  <th style={th()}>Reservation</th>
                  <th style={th()}>Rail</th>
                  <th style={th()}>Reason</th>
                  <th style={th()}>Path</th>
                  <th style={th()}>Amount</th>
                  <th style={th()}>Guest</th>
                  <th style={th()}>Status</th>
                  <th style={th()}>Requested</th>
                  <th style={th()}>Decision</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.id} style={r.fast_path ? { background: '#fef2f2', borderLeft: '3px solid #b91c1c' } : undefined}>
                    <td style={td()}>{r.reference}</td>
                    <td style={td()}><code style={{ fontSize: '0.78rem', background: '#f3f4f6', padding: '0.1rem 0.35rem', borderRadius: '0.25rem' }}>{r.reservation_id}</code></td>
                    <td style={td()}><Badge status={r.rail} /></td>
                    <td style={td()}>{r.reason.replace(/_/g, ' ')}</td>
                    <td style={td()}>{r.fast_path ? <Badge status="high" label="Fast-path" /> : <Badge status="low" label="Standard" />}</td>
                    <td style={td()}>{formatNaira(r.amount_kobo)} <span style={{ color: '#9ca3af', fontSize: '0.72rem' }}>{r.currency}</span></td>
                    <td style={td()}>{r.guest_masked}</td>
                    <td style={td()}><Badge status={r.status} /></td>
                    <td style={td()}>{timeAgo(r.requested_at)}</td>
                    <td style={td()}>
                      <div style={{ display: 'flex', gap: '0.35rem', flexWrap: 'wrap' }}>
                        <button disabled={busyId === r.id} onClick={() => decide(r.id, 'approved')} style={btn()}>Approve</button>
                        <button disabled={busyId === r.id} onClick={() => decide(r.id, 'paid')} style={btnPrimary()}>Pay</button>
                        <button disabled={busyId === r.id} onClick={() => decide(r.id, 'rejected')} style={btnDanger()}>Reject</button>
                      </div>
                    </td>
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
