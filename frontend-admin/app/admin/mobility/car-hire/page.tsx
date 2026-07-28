'use client';

import { useCallback, useEffect, useState } from 'react';
import { getCarHireBookings, setCarHireStatus } from '@/services/mobilityModesAdminService';
import type { CarHireRow, CarHireStatus } from '@/types/mobilityModes';
import {
  PageHeader, MobilityTabs, Card, Badge, StateNote, AuditedNotice, Kpi,
  btn, btnPrimary, btnDisabled, th, td, input, nairaFull,
  useMobilityPermissions, MOBILITY_PERMS,
} from '../_ui';

const STATUS_FILTER: Array<CarHireStatus | ''> = ['', 'requested', 'quoted', 'confirmed', 'active', 'extended', 'completed', 'cancelled'];
const STATUS_OPTIONS: CarHireStatus[] = ['requested', 'quoted', 'confirmed', 'active', 'extended', 'completed', 'cancelled'];
const SENSITIVE: CarHireStatus[] = ['cancelled', 'completed'];

export default function MobilityCarHirePage() {
  const { can } = useMobilityPermissions();
  const canManage = can(MOBILITY_PERMS.carHireManage);

  const [filter, setFilter] = useState<CarHireStatus | ''>('');
  const [rows, setRows] = useState<CarHireRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState('');

  const [selected, setSelected] = useState<CarHireRow | null>(null);
  const [form, setForm] = useState<{ status: CarHireStatus; reason: string }>({ status: 'requested', reason: '' });
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    setLoading(true); setError(null);
    try { setRows(await getCarHireBookings(filter)); }
    catch (e) { setError(String(e)); }
    finally { setLoading(false); }
  }, [filter]);

  useEffect(() => { void load(); }, [load]);

  const openDetail = (c: CarHireRow) => { setSelected(c); setForm({ status: c.status, reason: '' }); };

  const submit = async () => {
    if (!selected) return;
    if (SENSITIVE.includes(form.status) && !form.reason.trim()) { setError('A reason is required for this status change.'); return; }
    setBusy(true); setError(null); setMessage('');
    try {
      await setCarHireStatus(selected.id, { status: form.status, reason: form.reason.trim() || undefined });
      setMessage(`Booking ${selected.id} → ${form.status} (audited).`);
      setSelected(null); await load();
    } catch (e) { setError(`Update failed: ${String(e)}`); }
    finally { setBusy(false); }
  };

  const active = rows.filter((c) => c.status === 'active' || c.status === 'extended').length;
  const depositsHeld = rows.filter((c) => c.escrowStatus === 'held').length;

  return (
    <div style={{ padding: '0.5rem 0.5rem 2rem' }}>
      <PageHeader
        title="Car Hire"
        subtitle="Hire bookings, deposit/escrow status and booking lifecycle."
        action={<button onClick={() => void load()} style={btn()} disabled={loading}>{loading ? 'Loading…' : 'Refresh'}</button>}
      />
      <MobilityTabs active="car-hire" />
      <AuditedNotice text="Car-hire booking status changes require the mobility.car_hire.manage role." />

      {message && <StateNote kind="loading">{message}</StateNote>}
      {error && <StateNote kind="error">{error}</StateNote>}

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(180px, 1fr))', gap: '0.75rem', marginBottom: '1.25rem' }}>
        <Kpi label="Total bookings" value={String(rows.length)} />
        <Kpi label="Active hires" value={String(active)} accent="#1d4ed8" />
        <Kpi label="Deposits in escrow" value={String(depositsHeld)} accent="#9a3412" />
      </div>

      <Card
        title="Bookings"
        right={
          <select value={filter} onChange={(e) => setFilter(e.target.value as CarHireStatus | '')} style={{ ...input(), width: 'auto' }}>
            {STATUS_FILTER.map((s) => <option key={s} value={s}>{s ? s.replace(/_/g, ' ') : 'All statuses'}</option>)}
          </select>
        }
      >
        {!canManage && <StateNote kind="restricted">You have read-only access — status actions are disabled for your role.</StateNote>}
        {loading ? <StateNote kind="loading">Loading bookings…</StateNote>
          : rows.length === 0 ? <StateNote kind="empty">No bookings match this filter.</StateNote>
          : (
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.85rem' }}>
              <thead><tr style={{ textAlign: 'left', color: '#6b7280', borderBottom: '1px solid #e5e7eb' }}>
                <th style={th()}>Booking</th><th style={th()}>Vehicle</th><th style={th()}>Driver</th><th style={th()}>Start / Duration</th><th style={th()}>Status</th><th style={th()}>Escrow</th><th style={th()}>Fare</th><th style={th()}></th>
              </tr></thead>
              <tbody>
                {rows.map((c) => (
                  <tr key={c.id} style={{ borderBottom: '1px solid #f3f4f6' }}>
                    <td style={td()}><strong>{c.id}</strong><div style={{ fontSize: '0.72rem', color: '#9ca3af' }}>{c.customerName} · {c.zone}</div></td>
                    <td style={td()}>{c.vehicleClass} · {c.hireType.replace(/_/g, ' ')}<div style={{ fontSize: '0.72rem', color: '#9ca3af' }}>{c.chauffeur ? 'chauffeured' : 'self-drive'}</div></td>
                    <td style={td()}>{c.driverName ?? <span style={{ color: '#9ca3af' }}>—</span>}</td>
                    <td style={td()}>{new Date(c.startAt).toLocaleString()}<div style={{ fontSize: '0.72rem', color: '#9ca3af' }}>{c.durationHours}h</div></td>
                    <td style={td()}><Badge status={c.status} /></td>
                    <td style={td()}><Badge status={c.escrowStatus} /></td>
                    <td style={td()}>{nairaFull(c.fareKobo)}</td>
                    <td style={td()}><button style={btn()} onClick={() => openDetail(c)}>{canManage ? 'Manage' : 'View'}</button></td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
      </Card>

      {selected && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.4)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 50 }} onClick={() => !busy && setSelected(null)}>
          <div style={{ background: '#fff', borderRadius: '0.5rem', padding: '1.25rem', width: 'min(520px, 94vw)', maxHeight: '90vh', overflow: 'auto' }} onClick={(e) => e.stopPropagation()}>
            <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginBottom: '0.5rem' }}>
              <h2 style={{ margin: 0, fontSize: '1.1rem', fontWeight: 700 }}>{selected.id}</h2>
              <Badge status={selected.status} /><Badge status={selected.escrowStatus} />
            </div>
            <p style={{ fontSize: '0.82rem', color: '#374151', margin: '0 0 0.25rem' }}>{selected.customerName} · {selected.vehicleClass} · {selected.hireType.replace(/_/g, ' ')} · {selected.chauffeur ? 'chauffeured' : 'self-drive'}</p>
            <p style={{ fontSize: '0.8rem', color: '#6b7280', margin: '0 0 0.5rem' }}>Start {new Date(selected.startAt).toLocaleString()} · {selected.durationHours}h · {selected.zone}</p>
            <p style={{ fontSize: '0.8rem', color: '#6b7280', margin: '0 0 1rem' }}>Fare {nairaFull(selected.fareKobo)} · Deposit {nairaFull(selected.depositKobo)} · Driver {selected.driverName ?? '—'}</p>

            {!canManage ? (
              <StateNote kind="restricted">Read-only — your role cannot update bookings.</StateNote>
            ) : (
              <>
                <label style={{ fontSize: '0.8rem', fontWeight: 600 }}>Update status
                  <select value={form.status} onChange={(e) => setForm((f) => ({ ...f, status: e.target.value as CarHireStatus }))} style={{ ...input(), marginTop: 4 }}>
                    {STATUS_OPTIONS.map((s) => <option key={s} value={s}>{s.replace(/_/g, ' ')}</option>)}
                  </select>
                </label>
                <label style={{ fontSize: '0.8rem', fontWeight: 600, display: 'block', marginTop: '0.75rem' }}>
                  Reason {SENSITIVE.includes(form.status) ? '(required)' : '(optional)'}
                  <textarea value={form.reason} onChange={(e) => setForm((f) => ({ ...f, reason: e.target.value }))} rows={2} style={{ ...input(), marginTop: 4, fontFamily: 'inherit' }} />
                </label>
              </>
            )}
            <div style={{ display: 'flex', gap: '0.5rem', justifyContent: 'flex-end', marginTop: '1rem' }}>
              <button style={btn()} disabled={busy} onClick={() => setSelected(null)}>Close</button>
              {canManage && <button style={busy ? btnDisabled() : btnPrimary()} disabled={busy} onClick={submit}>{busy ? 'Saving…' : 'Save status (audited)'}</button>}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
