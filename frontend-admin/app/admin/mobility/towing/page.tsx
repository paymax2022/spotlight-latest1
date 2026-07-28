'use client';

import { useCallback, useEffect, useState } from 'react';
import { getTowingJobs, setTowingStatus } from '@/services/mobilityModesAdminService';
import type { TowingRow, TowingStatus } from '@/types/mobilityModes';
import {
  PageHeader, MobilityTabs, Card, Badge, StateNote, AuditedNotice, Kpi,
  btn, btnPrimary, btnDisabled, th, td, input, nairaFull,
  useMobilityPermissions, MOBILITY_PERMS,
} from '../_ui';

const STATUS_FILTER: Array<TowingStatus | ''> = ['', 'requested', 'operator_accepted', 'operator_en_route', 'pin_verified', 'in_progress', 'completed', 'cancelled'];
const STATUS_OPTIONS: TowingStatus[] = ['requested', 'operator_accepted', 'operator_en_route', 'pin_verified', 'in_progress', 'completed', 'cancelled'];
const SENSITIVE: TowingStatus[] = ['cancelled', 'completed'];

export default function MobilityTowingPage() {
  const { can } = useMobilityPermissions();
  const canManage = can(MOBILITY_PERMS.towingManage);

  const [filter, setFilter] = useState<TowingStatus | ''>('');
  const [rows, setRows] = useState<TowingRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState('');

  const [selected, setSelected] = useState<TowingRow | null>(null);
  const [form, setForm] = useState<{ status: TowingStatus; reason: string }>({ status: 'requested', reason: '' });
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    setLoading(true); setError(null);
    try { setRows(await getTowingJobs(filter)); }
    catch (e) { setError(String(e)); }
    finally { setLoading(false); }
  }, [filter]);

  useEffect(() => { void load(); }, [load]);

  const openDetail = (t: TowingRow) => { setSelected(t); setForm({ status: t.status, reason: '' }); };

  const submit = async () => {
    if (!selected) return;
    if (SENSITIVE.includes(form.status) && !form.reason.trim()) { setError('A reason is required for this status change.'); return; }
    setBusy(true); setError(null); setMessage('');
    try {
      await setTowingStatus(selected.id, { status: form.status, reason: form.reason.trim() || undefined });
      setMessage(`Towing job ${selected.id} → ${form.status} (audited).`);
      setSelected(null); await load();
    } catch (e) { setError(`Update failed: ${String(e)}`); }
    finally { setBusy(false); }
  };

  const active = rows.filter((t) => !['completed', 'cancelled'].includes(t.status)).length;
  const unassigned = rows.filter((t) => t.status === 'requested').length;

  return (
    <div style={{ padding: '0.5rem 0.5rem 2rem' }}>
      <PageHeader
        title="Towing"
        subtitle="Towing jobs, operator assignment and job status."
        action={<button onClick={() => void load()} style={btn()} disabled={loading}>{loading ? 'Loading…' : 'Refresh'}</button>}
      />
      <MobilityTabs active="towing" />
      <AuditedNotice text="Towing job status changes require the mobility.towing.manage role." />

      {message && <StateNote kind="loading">{message}</StateNote>}
      {error && <StateNote kind="error">{error}</StateNote>}

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(180px, 1fr))', gap: '0.75rem', marginBottom: '1.25rem' }}>
        <Kpi label="Total jobs" value={String(rows.length)} />
        <Kpi label="Active" value={String(active)} accent="#1d4ed8" />
        <Kpi label="Awaiting operator" value={String(unassigned)} accent={unassigned ? '#dc2626' : '#16a34a'} />
      </div>

      <Card
        title="Towing jobs"
        right={
          <select value={filter} onChange={(e) => setFilter(e.target.value as TowingStatus | '')} style={{ ...input(), width: 'auto' }}>
            {STATUS_FILTER.map((s) => <option key={s} value={s}>{s ? s.replace(/_/g, ' ') : 'All statuses'}</option>)}
          </select>
        }
      >
        {!canManage && <StateNote kind="restricted">You have read-only access — status actions are disabled for your role.</StateNote>}
        {loading ? <StateNote kind="loading">Loading towing jobs…</StateNote>
          : rows.length === 0 ? <StateNote kind="empty">No towing jobs match this filter.</StateNote>
          : (
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.85rem' }}>
              <thead><tr style={{ textAlign: 'left', color: '#6b7280', borderBottom: '1px solid #e5e7eb' }}>
                <th style={th()}>Job</th><th style={th()}>Route</th><th style={th()}>Operator</th><th style={th()}>Type</th><th style={th()}>Status</th><th style={th()}>Escrow</th><th style={th()}>Fare</th><th style={th()}></th>
              </tr></thead>
              <tbody>
                {rows.map((t) => (
                  <tr key={t.id} style={{ borderBottom: '1px solid #f3f4f6' }}>
                    <td style={td()}><strong>{t.id}</strong><div style={{ fontSize: '0.72rem', color: '#9ca3af' }}>{t.customerName}</div></td>
                    <td style={td()}>{t.pickupAddress}<div style={{ fontSize: '0.72rem', color: '#9ca3af' }}>→ {t.destAddress}</div></td>
                    <td style={td()}>{t.operatorName ?? <span style={{ color: '#9ca3af' }}>unassigned</span>}</td>
                    <td style={td()}>{t.serviceType.replace(/_/g, ' ')}</td>
                    <td style={td()}><Badge status={t.status} /></td>
                    <td style={td()}><Badge status={t.escrowStatus} /></td>
                    <td style={td()}>{nairaFull(t.fareKobo)}</td>
                    <td style={td()}><button style={btn()} onClick={() => openDetail(t)}>{canManage ? 'Manage' : 'View'}</button></td>
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
            <p style={{ fontSize: '0.82rem', color: '#374151', margin: '0 0 0.25rem' }}>{selected.customerName} · {selected.serviceType.replace(/_/g, ' ')}</p>
            <p style={{ fontSize: '0.8rem', color: '#6b7280', margin: '0 0 0.5rem' }}>{selected.pickupAddress} → {selected.destAddress} · {selected.zone}</p>
            <p style={{ fontSize: '0.8rem', color: '#6b7280', margin: '0 0 1rem' }}>Callout {nairaFull(selected.calloutKobo)} · Fare {nairaFull(selected.fareKobo)} · Operator {selected.operatorName ?? '—'}</p>

            {!canManage ? (
              <StateNote kind="restricted">Read-only — your role cannot update towing jobs.</StateNote>
            ) : (
              <>
                <label style={{ fontSize: '0.8rem', fontWeight: 600 }}>Update status
                  <select value={form.status} onChange={(e) => setForm((f) => ({ ...f, status: e.target.value as TowingStatus }))} style={{ ...input(), marginTop: 4 }}>
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
