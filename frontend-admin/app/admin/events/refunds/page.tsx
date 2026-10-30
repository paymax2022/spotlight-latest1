'use client';

import { useEffect, useState } from 'react';
import { listRefunds, getRefundStats, decideRefund, executeRefund, USE_MOCK, USE_MOCK_ENV } from '@/services/eventsCommerceAdminService';
import { formatNaira } from '@/services/eventsAdminService';
import type { EventRefund, RefundQueueStats } from '@/types/eventsCommerceAdmin';
import { toCsv, downloadCsv, koboToNaira } from '@/lib/csv';
import { PageHeader, EventsTabs, Card, Kpi, Badge, StateBlock, FilterBar, AuditNote, btn, btnPrimary, btnDanger, th, td, input, label, select, fmtDate } from '../_ui';
import { FixtureBanner } from '../../_shared/ui';
import { colors } from '@/components/ui/vuexy';

const STATUSES = ['REQUESTED', 'APPROVED', 'PROCESSING', 'FAILED', 'REFUNDED', 'REJECTED'];

export default function RefundsPage() {
  const [rows, setRows] = useState<EventRefund[]>([]);
  const [stats, setStats] = useState<RefundQueueStats | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [status, setStatus] = useState('REQUESTED');
  const [q, setQ] = useState('');
  const [busy, setBusy] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);

  async function load() {
    setLoading(true); setError(null);
    try {
      const [r, s] = await Promise.all([listRefunds({ status: status || undefined, q: q || undefined }), getRefundStats()]);
      setRows(r); setStats(s);
    } catch (e) { setError(String(e)); }
    finally { setLoading(false); }
  }
  useEffect(() => { load(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [status]);

  async function decide(r: EventRefund, approve: boolean) {
    const note = window.prompt(`${approve ? 'Approve' : 'Reject'} refund of ${formatNaira(r.refund_kobo)} for ${r.booking_ref ?? r.id}? This decision is audited and notifies the buyer. Enter a note${approve ? '' : ' (required — shown to the buyer)'}:`);
    if (note === null) return;
    if (!approve && !note.trim()) { setMsg('A reason is required to reject a refund.'); return; }
    setBusy(r.id); setMsg(null);
    try {
      const out = await decideRefund(r.id, approve, note.trim());
      setMsg(`Refund ${out.id} is now ${out.status}.`);
      await load();
    } catch (e) { setMsg(String(e)); }
    finally { setBusy(null); }
  }

  async function execute(r: EventRefund) {
    if (!window.confirm(`Pay ${formatNaira(r.refund_kobo)} to the buyer's wallet for ${r.booking_ref ?? r.id}? This moves money and revokes the ticket.`)) return;
    const key = crypto.randomUUID(); // one key per user action
    setBusy(r.id); setMsg(null);
    try {
      const out = await executeRefund(r.id, key);
      setMsg(`Refund ${out.id} is now ${out.status}.`);
      await load();
    } catch (e) { setMsg(String(e)); }
    finally { setBusy(null); }
  }

  function exportCsv() {
    const csv = toCsv(
      ['refund_id', 'status', 'event_id', 'event_title', 'booking_ref', 'buyer_name', 'tier', 'amount_kobo', 'amount_naira', 'fee_kobo', 'fee_naira', 'refund_kobo', 'refund_naira', 'reason', 'decision_note', 'failure_reason', 'created_at', 'decided_at'],
      rows.map((r) => [r.id, r.status, r.event_id, r.event_title, r.booking_ref, r.buyer_name, r.tier_name, r.amount_kobo, koboToNaira(r.amount_kobo), r.fee_kobo, koboToNaira(r.fee_kobo), r.refund_kobo, koboToNaira(r.refund_kobo), r.reason, r.decision_note, r.failure_reason, r.created_at, r.decided_at]),
    );
    downloadCsv(`event-refunds-${status || 'all'}-${new Date().toISOString().slice(0, 10)}.csv`, csv);
  }

  return (
    <div style={{ padding: '0.5rem 0.5rem 2rem' }}>
      <PageHeader title="Refund desk" subtitle="Ticket refund requests across every event, oldest first. Decide, then pay: execution is a separate, retryable money step." action={<button onClick={load} style={btn()} disabled={loading}>Refresh</button>} />
      <EventsTabs active="refunds" />
      <FixtureBanner active={USE_MOCK} envVar={USE_MOCK_ENV} />

      {stats && (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))', gap: '0.75rem', marginBottom: '1.25rem' }}>
          <Kpi label="Requested" value={String(stats.requested)} accent={colors.warning} />
          <Kpi label="Processing" value={String(stats.processing)} accent={colors.info} />
          <Kpi label="Failed" value={String(stats.failed)} accent={colors.danger} />
          <Kpi label="Refunded" value={String(stats.refunded)} />
          <Kpi label="Rejected" value={String(stats.rejected)} />
        </div>
      )}

      {msg && <AuditNote>{msg}</AuditNote>}

      <FilterBar>
        <div style={{ minWidth: 220 }}>
          <label style={label()}>Search</label>
          <input style={input()} placeholder="Event, booking ref, buyer, reason…" value={q} onChange={(e) => setQ(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && load()} />
        </div>
        <div>
          <label style={label()}>Status</label>
          <select style={select()} value={status} onChange={(e) => setStatus(e.target.value)}>
            <option value="">All</option>
            {STATUSES.map((s) => <option key={s} value={s}>{s.toLowerCase()}</option>)}
          </select>
        </div>
        <button style={btn()} onClick={load} disabled={loading}>Apply</button>
        <button style={btn()} onClick={exportCsv} disabled={loading || rows.length === 0}>Export CSV</button>
      </FilterBar>

      <Card>
        <StateBlock loading={loading} error={error} empty={rows.length === 0} emptyText="No refunds match.">
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead><tr>
              <th style={th()}>Booking</th><th style={th()}>Event</th><th style={th()}>Paid</th><th style={th()}>Fee kept</th>
              <th style={th()}>Refund</th><th style={th()}>Reason</th><th style={th()}>Status</th><th style={th()}>Actions</th>
            </tr></thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.id}>
                  <td style={td()}>{r.booking_ref ?? r.order_id}<div style={{ fontSize: '0.72rem', color: colors.muted }}>{r.buyer_name ?? r.buyer_id} · {fmtDate(r.created_at)}</div></td>
                  <td style={td()}>{r.event_title ?? r.event_id}<div style={{ fontSize: '0.72rem', color: colors.muted }}>{r.tier_name}</div></td>
                  <td style={td()}>{formatNaira(r.amount_kobo)}</td>
                  <td style={td()}>{formatNaira(r.fee_kobo)}</td>
                  <td style={td()}>{formatNaira(r.refund_kobo)}</td>
                  <td style={td()}>{r.reason || '—'}{r.failure_reason && <div style={{ fontSize: '0.72rem', color: colors.danger }}>{r.failure_reason}</div>}</td>
                  <td style={td()}><Badge status={r.status.toLowerCase()} /></td>
                  <td style={td()}>
                    <div style={{ display: 'flex', gap: '0.35rem', flexWrap: 'wrap' }}>
                      {r.status === 'REQUESTED' && <>
                        <button style={btnPrimary()} disabled={busy !== null} onClick={() => decide(r, true)}>{busy === r.id ? '…' : 'Approve'}</button>
                        <button style={btnDanger()} disabled={busy !== null} onClick={() => decide(r, false)}>Reject</button>
                      </>}
                      {(r.status === 'APPROVED' || r.status === 'PROCESSING' || r.status === 'FAILED') && (
                        <button style={btnPrimary()} disabled={busy !== null} onClick={() => execute(r)}>{busy === r.id ? '…' : r.status === 'APPROVED' ? 'Pay refund' : 'Retry payment'}</button>
                      )}
                      {(r.status === 'REFUNDED' || r.status === 'REJECTED') && <span style={{ color: colors.muted, fontSize: '0.78rem' }}>—</span>}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </StateBlock>
      </Card>
    </div>
  );
}
