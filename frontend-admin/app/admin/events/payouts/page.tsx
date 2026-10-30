'use client';

import { useEffect, useState } from 'react';
import { listPayouts, getPayoutQueue, getPayoutStatement, approvePayout, rejectPayout, USE_MOCK, USE_MOCK_ENV } from '@/services/eventsCommerceAdminService';
import { formatNaira } from '@/services/eventsAdminService';
import type { OrganiserPayout, PayoutQueueLine, PayoutStatement } from '@/types/eventsCommerceAdmin';
import { toCsv, downloadCsv, koboToNaira } from '@/lib/csv';
import { PageHeader, EventsTabs, Card, Badge, DisclosureNote, StateBlock, FilterBar, AuditNote, btn, btnPrimary, btnDanger, th, td, label, select, fmtDate } from '../_ui';
import { FixtureBanner } from '../../_shared/ui';
import { colors } from '@/components/ui/vuexy';

const small = { fontSize: '0.72rem', color: colors.muted } as const;

export default function PayoutsPage() {
  const [queue, setQueue] = useState<PayoutQueueLine[]>([]);
  const [rows, setRows] = useState<OrganiserPayout[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [status, setStatus] = useState('');
  const [busy, setBusy] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const [stmt, setStmt] = useState<PayoutStatement | null>(null);
  const [stmtErr, setStmtErr] = useState<string | null>(null);

  async function load() {
    setLoading(true); setError(null);
    try {
      const [qq, pp] = await Promise.all([getPayoutQueue(), listPayouts(status || undefined)]);
      setQueue(qq); setRows(pp);
    } catch (e) { setError(String(e)); }
    finally { setLoading(false); }
  }
  useEffect(() => { load(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [status]);

  async function openStatement(eventId: string) {
    setBusy(`stmt:${eventId}`); setStmtErr(null);
    try { setStmt(await getPayoutStatement(eventId)); }
    catch (e) { setStmt(null); setStmtErr(String(e)); }
    finally { setBusy(null); }
  }

  async function approve(p: OrganiserPayout) {
    if (!window.confirm(`Approve payout ${p.id}: ${formatNaira(p.net_kobo)} to the organiser and ${formatNaira(p.fee_kobo)} platform fee? This moves money from escrow and is audited. You cannot approve a payout you requested.`)) return;
    const key = crypto.randomUUID(); // one key per user action
    setBusy(p.id); setMsg(null);
    try { const out = await approvePayout(p.id, key); setMsg(`Payout ${out.id} is now ${out.status}.`); await load(); }
    catch (e) { setMsg(String(e)); }
    finally { setBusy(null); }
  }

  async function reject(p: OrganiserPayout) {
    const reason = window.prompt(`Reject payout ${p.id} (${formatNaira(p.net_kobo)})? No money moves; the amount is re-offered to the next request. Reason (required, audited):`);
    if (reason === null) return;
    if (!reason.trim()) { setMsg('A reason is required to reject a payout.'); return; }
    setBusy(p.id); setMsg(null);
    try { const out = await rejectPayout(p.id, reason.trim()); setMsg(`Payout ${out.id} is now ${out.status}.`); await load(); }
    catch (e) { setMsg(String(e)); }
    finally { setBusy(null); }
  }

  function exportCsv() {
    const csv = toCsv(
      ['payout_id', 'status', 'event_id', 'organiser_id', 'gross_kobo', 'gross_naira', 'fee_kobo', 'fee_naira', 'net_kobo', 'net_naira', 'reserve_held_kobo', 'reserve_held_naira', 'refunds_kobo', 'disputed_kobo', 'fee_bps', 'reserve_bps', 'destination', 'requested_by', 'approved_by', 'ledger_reference', 'failure_reason', 'created_at', 'paid_at', 'failed_at'],
      rows.map((p) => [p.id, p.status, p.event_id, p.organiser_id, p.gross_kobo, koboToNaira(p.gross_kobo), p.fee_kobo, koboToNaira(p.fee_kobo), p.net_kobo, koboToNaira(p.net_kobo), p.reserve_held_kobo, koboToNaira(p.reserve_held_kobo), p.refunds_kobo, p.disputed_kobo, p.fee_bps, p.reserve_bps, p.destination, p.requested_by, p.approved_by, p.ledger_reference, p.failure_reason, p.created_at, p.paid_at, p.failed_at]),
    );
    downloadCsv(`event-payouts-${status || 'all'}-${new Date().toISOString().slice(0, 10)}.csv`, csv);
  }

  return (
    <div style={{ padding: '0.5rem 0.5rem 2rem' }}>
      <PageHeader title="Organiser payouts" subtitle="Settlement queue for closed events and the payout register. Release is maker-checker: whoever requested a payout can never approve it." action={<button onClick={load} style={btn()} disabled={loading}>Refresh</button>} />
      <EventsTabs active="payouts" />
      <FixtureBanner active={USE_MOCK} envVar={USE_MOCK_ENV} />
      <DisclosureNote><strong>Money movement.</strong> Approving posts escrow → organiser wallet and escrow → platform revenue legs under the payout&apos;s own idempotency keys, so a retry replays rather than double-pays. Reserve is held back until the reserve window closes. Amounts ₦ (stored as kobo).</DisclosureNote>

      {msg && <AuditNote>{msg}</AuditNote>}

      <Card title="Settlement queue (closed events)">
        <StateBlock loading={loading} error={error} empty={queue.length === 0} emptyText="No closed events.">
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead><tr>
              <th style={th()}>Event</th><th style={th()}>Eligibility</th><th style={th()}>Available</th><th style={th()}>Pending</th>
              <th style={th()}>Paid</th><th style={th()}>Reserve</th><th style={th()}></th>
            </tr></thead>
            <tbody>
              {queue.map((l) => (
                <tr key={l.event_id}>
                  <td style={td()}>{l.event_title}<div style={small}>{l.event_id} · ended {fmtDate(l.ends_at)}</div></td>
                  <td style={td()}><Badge status={l.eligible ? 'approved' : 'pending'} label={l.eligible ? 'eligible' : (l.reason ?? 'not eligible').replace(/_/g, ' ')} />{!l.eligible && <div style={small}>from {fmtDate(l.eligible_at)}</div>}</td>
                  <td style={td()}>{formatNaira(l.available_kobo)}</td>
                  <td style={td()}>{formatNaira(l.pending_kobo)}</td>
                  <td style={td()}>{formatNaira(l.paid_kobo)}</td>
                  <td style={td()}>{formatNaira(l.reserve_kobo)}</td>
                  <td style={td()}><button style={btn()} disabled={busy !== null} onClick={() => openStatement(l.event_id)}>{busy === `stmt:${l.event_id}` ? '…' : 'Statement'}</button></td>
                </tr>
              ))}
            </tbody>
          </table>
        </StateBlock>
      </Card>

      {stmtErr && <Card title="Payout statement"><p style={{ color: colors.danger }}>{stmtErr}</p></Card>}
      {stmt && (
        <Card title={`Payout statement — ${stmt.event_title}`} right={<button style={btn()} onClick={() => setStmt(null)}>Close</button>}>
          <table style={{ borderCollapse: 'collapse', minWidth: 360 }}>
            <tbody>
              {([
                ['Gross sales', stmt.gross_sales_kobo], ['Refunds', stmt.refunds_kobo], ['Disputed (held)', stmt.disputed_held_kobo],
                ['Eligible gross', stmt.eligible_gross_kobo], [`Platform fees (${stmt.fee_bps / 100}%)`, stmt.fees_kobo], [`Reserve (${stmt.reserve_bps / 100}%)`, stmt.reserve_kobo],
                ['Net earnings', stmt.net_earnings_kobo], ['Paid', stmt.paid_kobo], ['Pending', stmt.pending_kobo], ['Balance', stmt.balance_kobo], ['Available now', stmt.available_kobo],
              ] as [string, number][]).map(([k, v]) => (
                <tr key={k}><td style={td()}>{k}</td><td style={{ ...td(), textAlign: 'right', color: v < 0 ? colors.danger : colors.text }}>{formatNaira(v)}</td></tr>
              ))}
            </tbody>
          </table>
          <div style={{ ...small, marginTop: '0.5rem' }}>{stmt.eligible ? 'Eligible for payout.' : `Not eligible: ${(stmt.reason ?? '').replace(/_/g, ' ')} (from ${fmtDate(stmt.eligible_at)}).`} Reserve {stmt.reserve_active ? `held until ${fmtDate(stmt.reserve_release_at)}` : 'released'}. A negative balance means the organiser owes the platform.</div>
        </Card>
      )}

      <Card title="Payout register" right={
        <FilterBar>
          <div>
            <label style={label()}>Status</label>
            <select style={select()} value={status} onChange={(e) => setStatus(e.target.value)}>
              <option value="">All</option><option value="pending">Pending</option><option value="processing">Processing</option>
              <option value="paid">Paid</option><option value="failed">Failed</option>
            </select>
          </div>
          <button style={btn()} onClick={exportCsv} disabled={loading || rows.length === 0}>Export CSV</button>
        </FilterBar>
      }>
        <StateBlock loading={loading} error={error} empty={rows.length === 0} emptyText="No payouts match.">
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead><tr>
              <th style={th()}>Payout</th><th style={th()}>Event</th><th style={th()}>Gross</th><th style={th()}>Fee</th>
              <th style={th()}>Net</th><th style={th()}>Reserve held</th><th style={th()}>Status</th><th style={th()}>Actions</th>
            </tr></thead>
            <tbody>
              {rows.map((p) => (
                <tr key={p.id}>
                  <td style={td()}>{p.id}<div style={small}>requested {fmtDate(p.created_at)} by {p.requested_by}</div></td>
                  <td style={td()}>{p.event_id}<div style={small}>organiser {p.organiser_id}</div></td>
                  <td style={td()}>{formatNaira(p.gross_kobo)}</td>
                  <td style={td()}>{formatNaira(p.fee_kobo)}</td>
                  <td style={td()}>{formatNaira(p.net_kobo)}</td>
                  <td style={td()}>{formatNaira(p.reserve_held_kobo)}</td>
                  <td style={td()}><Badge status={p.status} />{p.failure_reason && <div style={{ ...small, color: colors.danger }}>{p.failure_reason}</div>}</td>
                  <td style={td()}>
                    {p.status === 'pending' ? (
                      <div style={{ display: 'flex', gap: '0.35rem', flexWrap: 'wrap' }}>
                        <button style={btnPrimary()} disabled={busy !== null} onClick={() => approve(p)}>{busy === p.id ? '…' : 'Approve'}</button>
                        <button style={btnDanger()} disabled={busy !== null} onClick={() => reject(p)}>Reject</button>
                      </div>
                    ) : <span style={{ color: colors.muted, fontSize: '0.78rem' }}>—</span>}
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
