'use client';

import { useCallback, useEffect, useState } from 'react';
import {
  searchBusTickets, getManualRefundQueue, resolveManualRefund,
  type AdminBusTicket, type BusRefundStatus, type ManualRefundMethod,
} from '@/services/busAdminService';
import {
  PageHeader, MobilityTabs, Card, Badge, StateNote, AuditedNotice,
  btn, btnPrimary, btnDisabled, input, nairaFull,
  useMobilityPermissions, MOBILITY_PERMS,
} from '../../_ui';
import { colors, thCell, tdCell } from '@/components/ui/vuexy';

const PAGE = 25;
type View = 'queue' | 'all';

export default function BusTicketsPage() {
  const { can } = useMobilityPermissions();
  const canManage = can(MOBILITY_PERMS.busManage);

  const [view, setView] = useState<View>('queue');
  const [q, setQ] = useState('');
  const [refundStatus, setRefundStatus] = useState<BusRefundStatus | ''>('');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [stuckMinutes, setStuckMinutes] = useState(30);
  const [offset, setOffset] = useState(0);

  const [rows, setRows] = useState<AdminBusTicket[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState('');

  const [resolving, setResolving] = useState<AdminBusTicket | null>(null);
  const [method, setMethod] = useState<ManualRefundMethod>('wallet_refund');
  const [reason, setReason] = useState('');
  const [reference, setReference] = useState('');
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    setLoading(true); setError(null);
    try {
      const page = view === 'queue'
        ? await getManualRefundQueue(stuckMinutes, PAGE, offset)
        : await searchBusTickets({ q, refundStatus, from, to, limit: PAGE, offset });
      setRows(page.tickets ?? []); setTotal(page.total ?? 0);
    } catch (e) { setError(String(e)); setRows([]); setTotal(0); }
    finally { setLoading(false); }
  }, [view, stuckMinutes, offset, q, refundStatus, from, to]);

  useEffect(() => { void load(); }, [load]);

  const switchView = (v: View) => { setView(v); setOffset(0); };
  const openResolve = (t: AdminBusTicket) => {
    setResolving(t); setReason(''); setReference('');
    setMethod(t.manualRefundMethod ?? (t.settlementStatus === 'settled' ? 'wallet_refund' : 'offline'));
  };

  const submitResolve = async () => {
    if (!resolving) return;
    if (!reason.trim()) { setError('A reason is required.'); return; }
    if (method === 'offline' && !reference.trim()) { setError('An external refund reference is required for an offline refund.'); return; }
    setBusy(true); setError(null); setMessage('');
    try {
      const res = await resolveManualRefund(resolving.id, method, reason.trim(), reference.trim());
      setMessage(res.replayed
        ? `Ticket ${res.ticketId} was already resolved (${res.method ?? 'unknown'}); nothing changed.`
        : `Refunded ${nairaFull(res.refundedKobo)} via ${res.method} (audited).`);
      setResolving(null); await load();
    } catch (e) { setError(`Resolve failed: ${String(e)}`); }
    finally { setBusy(false); }
  };

  const pageNo = Math.floor(offset / PAGE) + 1;
  const pages = Math.max(1, Math.ceil(total / PAGE));

  return (
    <div style={{ padding: '0.5rem 0.5rem 2rem' }}>
      <PageHeader
        title="Bus Tickets & Refunds"
        subtitle="Search tickets and resolve refunds that could not go back through the wallet automatically."
        action={<button onClick={() => void load()} style={btn()} disabled={loading}>{loading ? 'Loading…' : 'Refresh'}</button>}
      />
      <MobilityTabs active="bus-tickets" />
      <AuditedNotice text="Resolving a refund requires mobility.bus.manage. Wallet refunds reverse the settled operator share and platform fee; offline refunds move no ledger money." />

      <div style={{ display: 'flex', gap: '0.4rem', marginBottom: '0.75rem' }}>
        <button style={view === 'queue' ? btnPrimary() : btn()} onClick={() => switchView('queue')}>Refund queue</button>
        <button style={view === 'all' ? btnPrimary() : btn()} onClick={() => switchView('all')}>All tickets</button>
      </div>

      {message && <StateNote kind="loading">{message}</StateNote>}
      {error && <StateNote kind="error">{error}</StateNote>}

      <Card title={view === 'queue' ? 'Manual / stuck refunds' : 'Ticket search'} right={<span style={{ fontSize: '0.8rem', color: colors.muted }}>{total} total</span>}>
        <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap', marginBottom: '0.75rem' }}>
          {view === 'queue' ? (
            <label style={{ fontSize: '0.8rem' }}>Stuck after (min)
              <input type="number" min={1} value={stuckMinutes} style={{ ...input(), width: '6rem', marginLeft: '0.4rem' }}
                onChange={(e) => { setStuckMinutes(Math.max(1, Number(e.target.value) || 30)); setOffset(0); }} />
            </label>
          ) : (
            <>
              <input placeholder="Ticket id, QR, passenger name or phone" value={q} style={{ ...input(), maxWidth: '20rem' }}
                onChange={(e) => { setQ(e.target.value); setOffset(0); }} />
              <select value={refundStatus} style={{ ...input(), width: '11rem' }}
                onChange={(e) => { setRefundStatus(e.target.value as BusRefundStatus | ''); setOffset(0); }}>
                <option value="">Any refund status</option>
                {['none', 'pending', 'failed', 'manual_required', 'refunded'].map((s) => <option key={s} value={s}>{s}</option>)}
              </select>
              <input type="date" value={from} style={{ ...input(), width: '10rem' }} onChange={(e) => { setFrom(e.target.value); setOffset(0); }} />
              <input type="date" value={to} style={{ ...input(), width: '10rem' }} onChange={(e) => { setTo(e.target.value); setOffset(0); }} />
            </>
          )}
        </div>

        {loading ? <StateNote kind="loading">Loading tickets…</StateNote>
          : rows.length === 0 ? <StateNote kind="empty">{view === 'queue' ? 'No refunds need attention.' : 'No tickets match.'}</StateNote>
          : (
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.85rem' }}>
              <thead><tr style={{ textAlign: 'left', color: colors.muted, borderBottom: `1px solid ${colors.border}` }}>
                <th style={thCell}>Ticket</th><th style={thCell}>Passenger</th><th style={thCell}>Trip</th><th style={thCell}>Fare</th>
                <th style={thCell}>Status</th><th style={thCell}>Refund</th><th style={thCell}>Settlement</th><th style={thCell}></th>
              </tr></thead>
              <tbody>
                {rows.map((t) => (
                  <tr key={t.id} style={{ borderBottom: `1px solid ${colors.border}` }}>
                    <td style={tdCell}><span style={{ fontFamily: 'monospace', fontSize: '0.75rem' }}>{t.id}</span>
                      <div style={{ fontSize: '0.72rem', color: colors.muted }}>{new Date(t.createdAt).toLocaleString()}</div></td>
                    <td style={tdCell}>{t.passengerName}<div style={{ fontSize: '0.72rem', color: colors.muted }}>{t.passengerPhone ?? '—'} · seat {t.seatNumber}</div></td>
                    <td style={tdCell}>{t.routeLabel}<div style={{ fontSize: '0.72rem', color: colors.muted }}>{t.operatorName || '—'} · {new Date(t.departureTime).toLocaleString()}</div></td>
                    <td style={tdCell}>{nairaFull(t.fareKobo)}</td>
                    <td style={tdCell}><Badge status={t.status} /></td>
                    <td style={tdCell}><Badge status={t.refundStatus} />
                      {t.manualRefundMethod && <div style={{ fontSize: '0.72rem', color: colors.muted }}>{t.manualRefundMethod}{t.manualRefundReference ? ` · ${t.manualRefundReference}` : ''}</div>}</td>
                    <td style={tdCell}>{t.settlementStatus ?? '—'}
                      {t.providerKobo != null && <div style={{ fontSize: '0.72rem', color: colors.muted }}>op {nairaFull(t.providerKobo)} · fee {nairaFull(t.feeKobo ?? 0)}</div>}</td>
                    <td style={tdCell}>
                      {t.refundStatus === 'manual_required' && (
                        <button disabled={!canManage} style={canManage ? btnPrimary() : btnDisabled()} onClick={() => openResolve(t)}>Resolve</button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}

        <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center', marginTop: '0.75rem' }}>
          <button style={offset > 0 ? btn() : btnDisabled()} disabled={offset === 0 || loading} onClick={() => setOffset(Math.max(0, offset - PAGE))}>Previous</button>
          <span style={{ fontSize: '0.8rem', color: colors.muted }}>Page {pageNo} of {pages}</span>
          <button style={offset + PAGE < total ? btn() : btnDisabled()} disabled={offset + PAGE >= total || loading} onClick={() => setOffset(offset + PAGE)}>Next</button>
        </div>
      </Card>

      {resolving && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.35)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 50 }}>
          <div style={{ background: colors.card, borderRadius: '0.5rem', padding: '1.25rem', width: 'min(480px, 92vw)' }}>
            <h3 style={{ marginTop: 0 }}>Resolve refund · {nairaFull(resolving.fareKobo)}</h3>
            <p style={{ fontSize: '0.82rem', color: colors.muted }}>
              {resolving.passengerName} · {resolving.routeLabel}. The fare was already paid out to {resolving.operatorName || 'the operator'}.
            </p>
            <label style={{ display: 'block', fontSize: '0.82rem', marginBottom: '0.5rem' }}>Method
              <select value={method} style={input()} onChange={(e) => setMethod(e.target.value as ManualRefundMethod)}>
                <option value="wallet_refund" disabled={resolving.settlementStatus !== 'settled'}>Wallet refund (reverse operator share + platform fee)</option>
                <option value="offline">Offline (already refunded outside the platform)</option>
              </select>
            </label>
            {method === 'offline' && (
              <label style={{ display: 'block', fontSize: '0.82rem', marginBottom: '0.5rem' }}>External reference
                <input value={reference} style={input()} placeholder="Bank transfer / support ticket ref" onChange={(e) => setReference(e.target.value)} />
              </label>
            )}
            <label style={{ display: 'block', fontSize: '0.82rem', marginBottom: '0.75rem' }}>Reason
              <textarea value={reason} rows={3} style={input()} onChange={(e) => setReason(e.target.value)} />
            </label>
            <div style={{ display: 'flex', gap: '0.5rem', justifyContent: 'flex-end' }}>
              <button style={btn()} onClick={() => setResolving(null)} disabled={busy}>Cancel</button>
              <button style={busy ? btnDisabled() : btnPrimary(colors.success)} disabled={busy} onClick={() => void submitResolve()}>
                {busy ? 'Resolving…' : 'Resolve refund'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
