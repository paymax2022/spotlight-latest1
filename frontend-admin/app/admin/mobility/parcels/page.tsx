'use client';

import { useCallback, useEffect, useState } from 'react';
import { getParcels, setParcelStatus, reviewParcelPod } from '@/services/mobilityModesAdminService';
import type { ParcelRow, ParcelStatus, PodStatus } from '@/types/mobilityModes';
import {
  PageHeader, MobilityTabs, Card, Badge, StateNote, AuditedNotice, Kpi,
  btn, btnPrimary, btnDisabled, th, td, input, nairaFull,
  useMobilityPermissions, MOBILITY_PERMS,
} from '../_ui';

const STATUS_FILTER: Array<ParcelStatus | ''> = ['', 'created', 'courier_assigned', 'pickup_pin_verified', 'picked_up', 'in_transit', 'dropoff_verified', 'delivered', 'failed', 'disputed', 'cancelled'];
// Sensitive transitions that always require an audited reason.
const SENSITIVE: ParcelStatus[] = ['failed', 'disputed', 'cancelled'];
const STATUS_OPTIONS: ParcelStatus[] = ['created', 'courier_assigned', 'pickup_pin_verified', 'picked_up', 'in_transit', 'dropoff_verified', 'delivered', 'failed', 'disputed', 'cancelled'];

export default function MobilityParcelsPage() {
  const { can } = useMobilityPermissions();
  const canManage = can(MOBILITY_PERMS.parcelsManage);

  const [filter, setFilter] = useState<ParcelStatus | ''>('');
  const [rows, setRows] = useState<ParcelRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState('');

  const [selected, setSelected] = useState<ParcelRow | null>(null);
  const [form, setForm] = useState<{ status: ParcelStatus; reason: string }>({ status: 'created', reason: '' });
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    setLoading(true); setError(null);
    try { setRows(await getParcels(filter)); }
    catch (e) { setError(String(e)); }
    finally { setLoading(false); }
  }, [filter]);

  useEffect(() => { void load(); }, [load]);

  const openDetail = (p: ParcelRow) => { setSelected(p); setForm({ status: p.status, reason: '' }); };

  const submitStatus = async () => {
    if (!selected) return;
    if (SENSITIVE.includes(form.status) && !form.reason.trim()) { setError('A reason is required for this status change.'); return; }
    setBusy(true); setError(null); setMessage('');
    try {
      await setParcelStatus(selected.id, { status: form.status, reason: form.reason.trim() || undefined });
      setMessage(`Parcel ${selected.id} → ${form.status} (audited).`);
      setSelected(null); await load();
    } catch (e) { setError(`Update failed: ${String(e)}`); }
    finally { setBusy(false); }
  };

  const submitPod = async (decision: PodStatus) => {
    if (!selected) return;
    if (decision === 'rejected' && !form.reason.trim()) { setError('A reason is required to reject proof of delivery.'); return; }
    setBusy(true); setError(null); setMessage('');
    try {
      await reviewParcelPod(selected.id, decision, form.reason.trim());
      setMessage(`Parcel ${selected.id} POD ${decision} (audited).`);
      setSelected(null); await load();
    } catch (e) { setError(`POD review failed: ${String(e)}`); }
    finally { setBusy(false); }
  };

  const inFlight = rows.filter((p) => !['delivered', 'failed', 'cancelled'].includes(p.status)).length;
  const podReview = rows.filter((p) => p.podStatus === 'submitted').length;

  return (
    <div style={{ padding: '0.5rem 0.5rem 2rem' }}>
      <PageHeader
        title="Parcel Delivery"
        subtitle="Parcel jobs, courier assignment status and proof-of-delivery review."
        action={<button onClick={() => void load()} style={btn()} disabled={loading}>{loading ? 'Loading…' : 'Refresh'}</button>}
      />
      <MobilityTabs active="parcels" />
      <AuditedNotice text="Status changes and POD review require the mobility.parcels.manage role." />

      {message && <StateNote kind="loading">{message}</StateNote>}
      {error && <StateNote kind="error">{error}</StateNote>}

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(180px, 1fr))', gap: '0.75rem', marginBottom: '1.25rem' }}>
        <Kpi label="Total parcels" value={String(rows.length)} />
        <Kpi label="In flight" value={String(inFlight)} accent="#1d4ed8" />
        <Kpi label="Awaiting POD review" value={String(podReview)} accent={podReview ? '#dc2626' : '#16a34a'} />
      </div>

      <Card
        title="Parcels"
        right={
          <select value={filter} onChange={(e) => setFilter(e.target.value as ParcelStatus | '')} style={{ ...input(), width: 'auto' }}>
            {STATUS_FILTER.map((s) => <option key={s} value={s}>{s ? s.replace(/_/g, ' ') : 'All statuses'}</option>)}
          </select>
        }
      >
        {!canManage && <StateNote kind="restricted">You have read-only access — status and POD actions are disabled for your role.</StateNote>}
        {loading ? <StateNote kind="loading">Loading parcels…</StateNote>
          : rows.length === 0 ? <StateNote kind="empty">No parcels match this filter.</StateNote>
          : (
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.85rem' }}>
              <thead>
                <tr style={{ textAlign: 'left', color: '#6b7280', borderBottom: '1px solid #e5e7eb' }}>
                  <th style={th()}>Parcel</th><th style={th()}>Route</th><th style={th()}>Courier</th><th style={th()}>Status</th><th style={th()}>POD</th><th style={th()}>Escrow</th><th style={th()}>Fare</th><th style={th()}></th>
                </tr>
              </thead>
              <tbody>
                {rows.map((p) => (
                  <tr key={p.id} style={{ borderBottom: '1px solid #f3f4f6', background: p.status === 'disputed' ? '#fef2f2' : undefined }}>
                    <td style={td()}><strong>{p.id}</strong><div style={{ fontSize: '0.72rem', color: '#9ca3af' }}>{p.senderName} · {p.size}/{p.speed}</div></td>
                    <td style={td()}>{p.pickupAddress}<div style={{ fontSize: '0.72rem', color: '#9ca3af' }}>→ {p.dropoffAddress}</div></td>
                    <td style={td()}>{p.courierName ?? <span style={{ color: '#9ca3af' }}>unassigned</span>}</td>
                    <td style={td()}><Badge status={p.status} /></td>
                    <td style={td()}><Badge status={p.podStatus} /></td>
                    <td style={td()}><Badge status={p.escrowStatus} /></td>
                    <td style={td()}>{nairaFull(p.fareKobo)}</td>
                    <td style={td()}><button style={btn()} onClick={() => openDetail(p)}>{canManage ? 'Manage' : 'View'}</button></td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
      </Card>

      {selected && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.4)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 50 }} onClick={() => !busy && setSelected(null)}>
          <div style={{ background: '#fff', borderRadius: '0.5rem', padding: '1.25rem', width: 'min(560px, 94vw)', maxHeight: '90vh', overflow: 'auto' }} onClick={(e) => e.stopPropagation()}>
            <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginBottom: '0.5rem' }}>
              <h2 style={{ margin: 0, fontSize: '1.1rem', fontWeight: 700 }}>{selected.id}</h2>
              <Badge status={selected.status} /><Badge status={selected.escrowStatus} />
            </div>
            <p style={{ fontSize: '0.82rem', color: '#374151', margin: '0 0 0.25rem' }}>{selected.senderName} · {selected.category} · {selected.size}/{selected.speed}</p>
            <p style={{ fontSize: '0.8rem', color: '#6b7280', margin: '0 0 0.5rem' }}>{selected.pickupAddress} → {selected.dropoffAddress} · {selected.zone}</p>
            <p style={{ fontSize: '0.8rem', color: '#6b7280', margin: '0 0 1rem' }}>Fare {nairaFull(selected.fareKobo)} · Declared value {nairaFull(selected.declaredValueKobo)} · Courier {selected.courierName ?? '—'}</p>

            {!canManage ? (
              <StateNote kind="restricted">Read-only — your role cannot update parcels.</StateNote>
            ) : (
              <>
                <div style={{ ...input(), border: 'none', padding: 0, marginBottom: '0.75rem', fontSize: '0.85rem', fontWeight: 700 }}>Proof of delivery: <Badge status={selected.podStatus} /></div>
                {selected.podProofUrl
                  ? <p style={{ fontSize: '0.8rem', margin: '0 0 0.75rem' }}><a href={selected.podProofUrl} target="_blank" rel="noreferrer">View POD proof →</a></p>
                  : <p style={{ fontSize: '0.8rem', color: '#9ca3af', margin: '0 0 0.75rem' }}>No proof submitted yet.</p>}

                <label style={{ fontSize: '0.8rem', fontWeight: 600 }}>Update status
                  <select value={form.status} onChange={(e) => setForm((f) => ({ ...f, status: e.target.value as ParcelStatus }))} style={{ ...input(), marginTop: 4 }}>
                    {STATUS_OPTIONS.map((s) => <option key={s} value={s}>{s.replace(/_/g, ' ')}</option>)}
                  </select>
                </label>
                <label style={{ fontSize: '0.8rem', fontWeight: 600, display: 'block', marginTop: '0.75rem' }}>
                  Reason {SENSITIVE.includes(form.status) ? '(required)' : '(optional — required to reject POD)'}
                  <textarea value={form.reason} onChange={(e) => setForm((f) => ({ ...f, reason: e.target.value }))} rows={2} style={{ ...input(), marginTop: 4, fontFamily: 'inherit' }} />
                </label>

                <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap', marginTop: '0.75rem' }}>
                  <button style={busy ? btnDisabled() : btnPrimary('#16a34a')} disabled={busy} onClick={() => void submitPod('approved')}>Approve POD</button>
                  <button style={busy ? btnDisabled() : btnPrimary('#dc2626')} disabled={busy} onClick={() => void submitPod('rejected')}>Reject POD</button>
                </div>
              </>
            )}

            <div style={{ display: 'flex', gap: '0.5rem', justifyContent: 'flex-end', marginTop: '1rem' }}>
              <button style={btn()} disabled={busy} onClick={() => setSelected(null)}>Close</button>
              {canManage && <button style={busy ? btnDisabled() : btnPrimary()} disabled={busy} onClick={submitStatus}>{busy ? 'Saving…' : 'Save status (audited)'}</button>}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
