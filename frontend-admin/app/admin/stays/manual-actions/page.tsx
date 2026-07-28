'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { listReservations, manualAction, formatNaira } from '@/services/staysAdminService';
import type { ReservationSummary, ManualActionType, ManualActionResult } from '@/types/staysAdmin';
import { PageHeader, StaysTabs, Card, Badge, btn, btnPrimary, btnDanger, th, td, label, select, input, fmtDate, StateBlock, DisclosureNote } from '../_ui';

const ACTIONS: { value: ManualActionType; label: string; danger?: boolean }[] = [
  { value: 'confirm', label: 'Confirm' },
  { value: 'force_cancel', label: 'Force-cancel', danger: true },
  { value: 'rebook', label: 'Rebook' },
  { value: 'release_hold', label: 'Release hold', danger: true },
];

export default function StaysManualActionsPage() {
  const [rows, setRows] = useState<ReservationSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [selectedId, setSelectedId] = useState('');
  const [action, setAction] = useState<ManualActionType>('confirm');
  const [reason, setReason] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [result, setResult] = useState<ManualActionResult | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);

  // Inline per-row reason state.
  const [rowFor, setRowFor] = useState<{ id: string; action: ManualActionType } | null>(null);
  const [rowReason, setRowReason] = useState('');

  async function load() {
    setLoading(true); setError(null);
    try { setRows(await listReservations()); }
    catch (e) { setError(String(e)); }
    finally { setLoading(false); }
  }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { load(); }, []);

  async function runAction(id: string, act: ManualActionType, why: string) {
    if (!id) { setActionError('Pick a reservation first.'); return; }
    if (!why.trim()) { setActionError('A reason is mandatory for every manual action.'); return; }
    setSubmitting(true); setActionError(null); setResult(null);
    try {
      const r = await manualAction(id, { action: act, reason: why.trim() });
      setResult(r);
      setRowFor(null); setRowReason('');
      await load();
    } catch (e) { setActionError(String(e)); }
    finally { setSubmitting(false); }
  }

  return (
    <div style={{ padding: '0.5rem 0.5rem 2rem' }}>
      <PageHeader
        title="Manual actions"
        subtitle="Operator overrides on the reservation state machine. Every action requires a reason and emits an audit event."
        action={<button onClick={load} style={btn()}>Refresh</button>}
      />
      <StaysTabs active="reservations" />

      <DisclosureNote>
        State-machine overrides. <strong>Force-cancel</strong> and <strong>release-hold</strong> are money-affecting (they post reversing/release ledger entries) — a reason is mandatory and the change is audit-logged.
      </DisclosureNote>

      <Card title="Run an action">
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(220px, 1fr))', gap: '0.75rem', marginBottom: '0.75rem' }}>
          <div>
            <label style={label()}>Reservation</label>
            <select style={select()} value={selectedId} onChange={(e) => setSelectedId(e.target.value)}>
              <option value="">Select a reservation…</option>
              {rows.map((r) => (
                <option key={r.id} value={r.id}>{r.id} — {r.property_name} ({r.state})</option>
              ))}
            </select>
          </div>
          <div>
            <label style={label()}>Action</label>
            <select style={select()} value={action} onChange={(e) => setAction(e.target.value as ManualActionType)}>
              {ACTIONS.map((a) => <option key={a.value} value={a.value}>{a.label}</option>)}
            </select>
          </div>
        </div>
        <div style={{ marginBottom: '0.75rem' }}>
          <label style={label()}>Reason (required)</label>
          <textarea
            style={{ ...input(), minHeight: 80, resize: 'vertical', fontFamily: 'inherit' }}
            placeholder="Why is this override needed? This is recorded in the audit log."
            value={reason}
            onChange={(e) => setReason(e.target.value)}
          />
        </div>
        <button
          onClick={() => runAction(selectedId, action, reason)}
          disabled={submitting}
          style={ACTIONS.find((a) => a.value === action)?.danger ? btnDanger() : btnPrimary()}
        >
          {submitting ? 'Working…' : `Run ${ACTIONS.find((a) => a.value === action)?.label}`}
        </button>
        {actionError && <p style={{ color: '#dc2626', fontSize: '0.85rem', marginTop: '0.6rem' }}>{actionError}</p>}
        {result && (
          <div style={{ marginTop: '0.75rem', border: '1px solid #dcfce7', background: '#f0fdf4', borderRadius: '0.5rem', padding: '0.6rem 0.8rem', fontSize: '0.82rem', color: '#15803d' }}>
            <strong>{result.action}</strong> on <code>{result.reservation_id}</code> &rarr; new state <Badge status={result.new_state} />
            {result.ledger_ref ? <> &middot; ledger ref <code>{result.ledger_ref}</code></> : null}
            <span style={{ color: '#6b7280' }}> &middot; {fmtDate(result.performed_at)}</span>
          </div>
        )}
      </Card>

      <Card title={`Recent reservations${rows.length ? ` (${rows.length})` : ''}`}>
        <StateBlock loading={loading} error={error} empty={rows.length === 0} emptyText="No reservations found.">
          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse' }}>
              <thead>
                <tr>
                  <th style={th()}>ID</th>
                  <th style={th()}>Property</th>
                  <th style={th()}>Rail</th>
                  <th style={th()}>State</th>
                  <th style={th()}>Gross</th>
                  <th style={th()}>Quick actions</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.id}>
                    <td style={td()}>
                      <Link href={`/admin/stays/reservations/${r.id}`} style={{ color: '#340075', fontWeight: 600, textDecoration: 'none' }}>{r.id}</Link>
                    </td>
                    <td style={td()}>{r.property_name}<div style={{ fontSize: '0.75rem', color: '#9ca3af' }}>{r.city}</div></td>
                    <td style={td()}><Badge status={r.rail} /></td>
                    <td style={td()}><Badge status={r.state} /></td>
                    <td style={td()}>{formatNaira(r.gross_amount_kobo)}</td>
                    <td style={td()}>
                      <div style={{ display: 'flex', gap: '0.35rem', flexWrap: 'wrap' }}>
                        {ACTIONS.map((a) => (
                          <button
                            key={a.value}
                            onClick={() => { setRowFor({ id: r.id, action: a.value }); setRowReason(''); setActionError(null); }}
                            style={a.danger ? btnDanger() : btn()}
                          >
                            {a.label}
                          </button>
                        ))}
                      </div>
                      {rowFor && rowFor.id === r.id && (
                        <div style={{ marginTop: '0.5rem', display: 'flex', gap: '0.4rem', flexWrap: 'wrap', alignItems: 'center' }}>
                          <input
                            style={{ ...input(), width: 260 }}
                            placeholder={`Reason for ${ACTIONS.find((a) => a.value === rowFor.action)?.label} (required)`}
                            value={rowReason}
                            onChange={(e) => setRowReason(e.target.value)}
                          />
                          <button
                            onClick={() => runAction(rowFor.id, rowFor.action, rowReason)}
                            disabled={submitting}
                            style={btnPrimary()}
                          >
                            {submitting ? 'Working…' : 'Confirm'}
                          </button>
                          <button onClick={() => setRowFor(null)} style={btn()}>Cancel</button>
                        </div>
                      )}
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
