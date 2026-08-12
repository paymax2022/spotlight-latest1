'use client';

import { useCallback, useEffect, useState } from 'react';
import { getMoverJobs, getMoverJob, setMoverStatus } from '@/services/mobilityModesAdminService';
import type { MoverRow, MoverDetail, MoverStatus } from '@/types/mobilityModes';
import {
  PageHeader, MobilityTabs, Card, Badge, StateNote, AuditedNotice, Kpi,
  btn, btnPrimary, btnDisabled, input, nairaFull,
  useMobilityPermissions, MOBILITY_PERMS,
} from '../_ui';
import { colors, tint, thCell, tdCell } from '@/components/ui/vuexy';

const STATUS_FILTER: Array<MoverStatus | ''> = ['', 'quote_requested', 'bids_received', 'bid_accepted', 'crew_assigned', 'in_progress', 'completion_confirmed', 'disputed', 'cancelled'];
const STATUS_OPTIONS: MoverStatus[] = ['quote_requested', 'bids_received', 'bid_accepted', 'crew_assigned', 'in_progress', 'completion_confirmed', 'disputed', 'cancelled'];
const SENSITIVE: MoverStatus[] = ['disputed', 'cancelled', 'completion_confirmed'];

export default function MobilityMoversPage() {
  const { can } = useMobilityPermissions();
  const canManage = can(MOBILITY_PERMS.moversManage);

  const [filter, setFilter] = useState<MoverStatus | ''>('');
  const [rows, setRows] = useState<MoverRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState('');

  const [detail, setDetail] = useState<MoverDetail | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [form, setForm] = useState<{ status: MoverStatus; reason: string }>({ status: 'quote_requested', reason: '' });
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    setLoading(true); setError(null);
    try { setRows(await getMoverJobs(filter)); }
    catch (e) { setError(String(e)); }
    finally { setLoading(false); }
  }, [filter]);

  useEffect(() => { void load(); }, [load]);

  const openDetail = async (id: string, status: MoverStatus) => {
    setDetailLoading(true); setForm({ status, reason: '' });
    try { setDetail(await getMoverJob(id)); }
    catch (e) { setError(String(e)); }
    finally { setDetailLoading(false); }
  };

  const submit = async () => {
    if (!detail) return;
    if (SENSITIVE.includes(form.status) && !form.reason.trim()) { setError('A reason is required for this status change.'); return; }
    setBusy(true); setError(null); setMessage('');
    try {
      await setMoverStatus(detail.id, { status: form.status, reason: form.reason.trim() || undefined });
      setMessage(`Mover job ${detail.id} → ${form.status} (audited).`);
      setDetail(null); await load();
    } catch (e) { setError(`Update failed: ${String(e)}`); }
    finally { setBusy(false); }
  };

  const inEscrow = rows.filter((m) => m.escrowStatus === 'held').length;
  const awaitingBids = rows.filter((m) => m.status === 'quote_requested' || m.status === 'bids_received').length;

  return (
    <div style={{ padding: '0.5rem 0.5rem 2rem' }}>
      <PageHeader
        title="Movers"
        subtitle="Move jobs, bids and escrow status."
        action={<button onClick={() => void load()} style={btn()} disabled={loading}>{loading ? 'Loading…' : 'Refresh'}</button>}
      />
      <MobilityTabs active="movers" />
      <AuditedNotice text="Mover job status changes (incl. escrow release / dispute) require the mobility.movers.manage role." />

      {message && <StateNote kind="loading">{message}</StateNote>}
      {error && <StateNote kind="error">{error}</StateNote>}

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(180px, 1fr))', gap: '0.75rem', marginBottom: '1.25rem' }}>
        <Kpi label="Total jobs" value={String(rows.length)} />
        <Kpi label="Funds in escrow" value={String(inEscrow)} accent={colors.warning} />
        <Kpi label="Awaiting bids" value={String(awaitingBids)} accent={awaitingBids ? colors.info : colors.success} />
      </div>

      <Card
        title="Move jobs"
        right={
          <select value={filter} onChange={(e) => setFilter(e.target.value as MoverStatus | '')} style={{ ...input(), width: 'auto' }}>
            {STATUS_FILTER.map((s) => <option key={s} value={s}>{s ? s.replace(/_/g, ' ') : 'All statuses'}</option>)}
          </select>
        }
      >
        {!canManage && <StateNote kind="restricted">You have read-only access — status actions are disabled for your role.</StateNote>}
        {loading ? <StateNote kind="loading">Loading move jobs…</StateNote>
          : rows.length === 0 ? <StateNote kind="empty">No move jobs match this filter.</StateNote>
          : (
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.85rem' }}>
              <thead><tr style={{ textAlign: 'left', color: colors.muted, borderBottom: `1px solid ${colors.border}` }}>
                <th style={thCell}>Job</th><th style={thCell}>Route</th><th style={thCell}>Truck / Helpers</th><th style={thCell}>Status</th><th style={thCell}>Bids</th><th style={thCell}>Escrow</th><th style={thCell}>Accepted</th><th style={thCell}></th>
              </tr></thead>
              <tbody>
                {rows.map((m) => (
                  <tr key={m.id} style={{ borderBottom: `1px solid ${colors.border}`, background: m.status === 'disputed' ? tint(colors.danger, 0.08) : undefined }}>
                    <td style={tdCell}><strong>{m.id}</strong><div style={{ fontSize: '0.72rem', color: colors.muted }}>{m.customerName}</div></td>
                    <td style={tdCell}>{m.pickupAddress}<div style={{ fontSize: '0.72rem', color: colors.muted }}>→ {m.dropoffAddress}</div></td>
                    <td style={tdCell}>{m.truckSize} · {m.helpers} helpers</td>
                    <td style={tdCell}><Badge status={m.status} /></td>
                    <td style={tdCell}>{m.bidsCount}</td>
                    <td style={tdCell}><Badge status={m.escrowStatus} /></td>
                    <td style={tdCell}>{m.acceptedAmountKobo != null ? nairaFull(m.acceptedAmountKobo) : '—'}</td>
                    <td style={tdCell}><button style={btn()} onClick={() => void openDetail(m.id, m.status)}>{canManage ? 'Manage' : 'View'}</button></td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
      </Card>

      {(detail || detailLoading) && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.4)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 50 }} onClick={() => !busy && setDetail(null)}>
          <div style={{ background: colors.card, borderRadius: '0.5rem', padding: '1.25rem', width: 'min(620px, 94vw)', maxHeight: '90vh', overflow: 'auto' }} onClick={(e) => e.stopPropagation()}>
            {detailLoading || !detail ? <StateNote kind="loading">Loading job…</StateNote> : (
              <>
                <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginBottom: '0.5rem' }}>
                  <h2 style={{ margin: 0, fontSize: '1.1rem', fontWeight: 700 }}>{detail.id}</h2>
                  <Badge status={detail.status} /><Badge status={detail.escrowStatus} />
                </div>
                <p style={{ fontSize: '0.82rem', color: colors.text, margin: '0 0 0.25rem' }}>{detail.customerName} · {detail.truckSize} truck · {detail.helpers} helpers</p>
                <p style={{ fontSize: '0.8rem', color: colors.muted, margin: '0 0 0.25rem' }}>{detail.pickupAddress} → {detail.dropoffAddress}</p>
                <p style={{ fontSize: '0.8rem', color: colors.muted, margin: '0 0 1rem' }}>Move at {new Date(detail.moveAt).toLocaleString()} · {detail.inventory}</p>

                <div style={{ fontSize: '0.85rem', fontWeight: 700, margin: '0 0 0.5rem' }}>Bids ({detail.bids.length})</div>
                {detail.bids.length === 0 ? <StateNote kind="empty">No bids submitted yet.</StateNote> : (
                  <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.82rem', marginBottom: '1rem' }}>
                    <thead><tr style={{ textAlign: 'left', color: colors.muted, borderBottom: `1px solid ${colors.border}` }}>
                      <th style={thCell}>Mover</th><th style={thCell}>Amount</th><th style={thCell}>Crew</th><th style={thCell}>Accepted</th>
                    </tr></thead>
                    <tbody>
                      {detail.bids.map((b) => (
                        <tr key={b.id} style={{ borderBottom: `1px solid ${colors.border}`, background: b.accepted ? tint(colors.success, 0.12) : undefined }}>
                          <td style={tdCell}>{b.moverName}</td><td style={tdCell}>{nairaFull(b.amountKobo)}</td><td style={tdCell}>{b.crewSize}</td>
                          <td style={tdCell}>{b.accepted ? <Badge status="approved" label="accepted" /> : '—'}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                )}

                {!canManage ? (
                  <StateNote kind="restricted">Read-only — your role cannot update move jobs.</StateNote>
                ) : (
                  <>
                    <label style={{ fontSize: '0.8rem', fontWeight: 600 }}>Update status
                      <select value={form.status} onChange={(e) => setForm((f) => ({ ...f, status: e.target.value as MoverStatus }))} style={{ ...input(), marginTop: 4 }}>
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
                  <button style={btn()} disabled={busy} onClick={() => setDetail(null)}>Close</button>
                  {canManage && <button style={busy ? btnDisabled() : btnPrimary()} disabled={busy} onClick={submit}>{busy ? 'Saving…' : 'Save status (audited)'}</button>}
                </div>
              </>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
