'use client';

import { useCallback, useEffect, useState } from 'react';
import {
  getBusOperators, getBusRoutes, getBusSchedules, getBusManifest,
  approveBusRouteFare, approveBusScheduleFare, setBusProviderVerification,
} from '@/services/mobilityModesAdminService';
import type { BusOperator, BusRoute, BusSchedule, BusManifestRow } from '@/types/mobilityModes';
import {
  PageHeader, MobilityTabs, Card, Badge, StateNote, AuditedNotice, Kpi,
  btn, btnPrimary, btnDisabled, th, td, input, nairaFull,
  useMobilityPermissions, MOBILITY_PERMS,
} from '../_ui';

export default function MobilityBusPage() {
  const { can } = useMobilityPermissions();
  const canManage = can(MOBILITY_PERMS.busManage);

  const [operators, setOperators] = useState<BusOperator[]>([]);
  const [routes, setRoutes] = useState<BusRoute[]>([]);
  const [schedules, setSchedules] = useState<BusSchedule[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState('');

  // manifest drill-down
  const [manifestFor, setManifestFor] = useState<BusSchedule | null>(null);
  const [manifest, setManifest] = useState<BusManifestRow[]>([]);
  const [manifestLoading, setManifestLoading] = useState(false);

  // fare approval modal
  const [approve, setApprove] = useState<{ kind: 'route' | 'schedule'; id: string; label: string } | null>(null);
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);

  // operator verification modal
  const [verify, setVerify] = useState<{ id: string; label: string; status: 'verified' | 'suspended' | 'pending' } | null>(null);
  const [verifyReason, setVerifyReason] = useState('');
  const [verifyBusy, setVerifyBusy] = useState(false);

  const load = useCallback(async () => {
    setLoading(true); setError(null);
    try {
      const [o, r, s] = await Promise.all([getBusOperators(), getBusRoutes(), getBusSchedules()]);
      setOperators(o); setRoutes(r); setSchedules(s);
    } catch (e) { setError(String(e)); }
    finally { setLoading(false); }
  }, []);

  useEffect(() => { void load(); }, [load]);

  const openManifest = async (s: BusSchedule) => {
    setManifestFor(s); setManifest([]); setManifestLoading(true);
    try { setManifest(await getBusManifest(s.id)); }
    catch (e) { setError(String(e)); }
    finally { setManifestLoading(false); }
  };

  const submitApprove = async () => {
    if (!approve) return;
    if (!reason.trim()) { setError('A reason is required to approve a fare.'); return; }
    setBusy(true); setError(null); setMessage('');
    try {
      if (approve.kind === 'route') await approveBusRouteFare(approve.id, reason.trim());
      else await approveBusScheduleFare(approve.id, reason.trim());
      setMessage(`${approve.label} fare approved (audited).`);
      setApprove(null); setReason(''); await load();
    } catch (e) { setError(`Approval failed: ${String(e)}`); }
    finally { setBusy(false); }
  };

  const submitVerify = async () => {
    if (!verify) return;
    if (verify.status === 'suspended' && !verifyReason.trim()) { setError('A reason is required to suspend an operator.'); return; }
    setVerifyBusy(true); setError(null); setMessage('');
    try {
      await setBusProviderVerification(verify.id, verify.status, verifyReason.trim());
      setMessage(`${verify.label} set to ${verify.status} (audited).`);
      setVerify(null); setVerifyReason(''); await load();
    } catch (e) { setError(`Verification update failed: ${String(e)}`); }
    finally { setVerifyBusy(false); }
  };

  const pendingFares = routes.filter((r) => !r.fareApproved).length + schedules.filter((s) => !s.fareApproved).length;

  return (
    <div style={{ padding: '0.5rem 0.5rem 2rem' }}>
      <PageHeader
        title="Bus Booking"
        subtitle="Operators, routes, schedules with fare approval and seat manifests."
        action={<button onClick={() => void load()} style={btn()} disabled={loading}>{loading ? 'Loading…' : 'Refresh'}</button>}
      />
      <MobilityTabs active="bus" />
      <AuditedNotice text="Fare approval requires the mobility.bus.manage role." />

      {message && <StateNote kind="loading">{message}</StateNote>}
      {error && <StateNote kind="error">{error}</StateNote>}

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(180px, 1fr))', gap: '0.75rem', marginBottom: '1.25rem' }}>
        <Kpi label="Operators" value={String(operators.length)} />
        <Kpi label="Routes" value={String(routes.length)} />
        <Kpi label="Schedules" value={String(schedules.length)} />
        <Kpi label="Fares pending approval" value={String(pendingFares)} accent={pendingFares ? '#dc2626' : '#16a34a'} />
      </div>

      <Card title="Operators">
        {loading ? <StateNote kind="loading">Loading operators…</StateNote>
          : operators.length === 0 ? <StateNote kind="empty">No operators registered.</StateNote>
          : (
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.85rem' }}>
              <thead><tr style={{ textAlign: 'left', color: '#6b7280', borderBottom: '1px solid #e5e7eb' }}>
                <th style={th()}>Operator</th><th style={th()}>Base state</th><th style={th()}>Verification</th><th style={th()}>Operational</th><th style={th()}>Routes</th><th style={th()}>Rating</th><th style={th()}></th>
              </tr></thead>
              <tbody>
                {operators.map((o) => (
                  <tr key={o.id} style={{ borderBottom: '1px solid #f3f4f6' }}>
                    <td style={td()}><strong>{o.businessName}</strong><div style={{ fontSize: '0.72rem', color: '#9ca3af', fontFamily: 'monospace' }}>{o.id}</div></td>
                    <td style={td()}>{o.baseState ?? '—'}</td>
                    <td style={td()}><Badge status={o.verificationStatus} /></td>
                    <td style={td()}><Badge status={o.status} /></td>
                    <td style={td()}>{o.routeCount}</td>
                    <td style={td()}>{o.ratingAvg.toFixed(1)}⭐ <span style={{ fontSize: '0.72rem', color: '#9ca3af' }}>({o.ratingCount})</span></td>
                    <td style={td()}>
                      <div style={{ display: 'flex', gap: '0.4rem', flexWrap: 'wrap' }}>
                        <button
                          disabled={!canManage || o.verificationStatus === 'verified'}
                          style={canManage && o.verificationStatus !== 'verified' ? btnPrimary('#16a34a') : btnDisabled()}
                          onClick={() => { setVerify({ id: o.id, label: o.businessName, status: 'verified' }); setVerifyReason(''); }}
                        >Verify</button>
                        <button
                          disabled={!canManage || o.verificationStatus === 'suspended'}
                          style={canManage && o.verificationStatus !== 'suspended' ? btnPrimary('#dc2626') : btnDisabled()}
                          onClick={() => { setVerify({ id: o.id, label: o.businessName, status: 'suspended' }); setVerifyReason(''); }}
                        >Suspend</button>
                        {o.verificationStatus !== 'pending' && (
                          <button
                            disabled={!canManage}
                            style={canManage ? btn() : btnDisabled()}
                            onClick={() => { setVerify({ id: o.id, label: o.businessName, status: 'pending' }); setVerifyReason(''); }}
                          >Re-pend</button>
                        )}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
      </Card>

      <Card title="Routes">
        {loading ? <StateNote kind="loading">Loading routes…</StateNote>
          : routes.length === 0 ? <StateNote kind="empty">No routes configured.</StateNote>
          : (
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.85rem' }}>
              <thead><tr style={{ textAlign: 'left', color: '#6b7280', borderBottom: '1px solid #e5e7eb' }}>
                <th style={th()}>Route</th><th style={th()}>Operator</th><th style={th()}>Fare</th><th style={th()}>Fare approved</th><th style={th()}></th>
              </tr></thead>
              <tbody>
                {routes.map((r) => (
                  <tr key={r.id} style={{ borderBottom: '1px solid #f3f4f6' }}>
                    <td style={td()}>{r.origin} → {r.destination}</td>
                    <td style={td()}>{r.operatorName}</td>
                    <td style={td()}>{nairaFull(r.fareKobo)}</td>
                    <td style={td()}>{r.fareApproved ? <Badge status="approved" /> : <Badge status="pending" />}</td>
                    <td style={td()}>
                      {!r.fareApproved && (
                        <button disabled={!canManage} style={canManage ? btnPrimary('#16a34a') : btnDisabled()} onClick={() => { setApprove({ kind: 'route', id: r.id, label: `${r.origin} → ${r.destination}` }); setReason(''); }}>Approve fare</button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
      </Card>

      <Card title="Schedules">
        {loading ? <StateNote kind="loading">Loading schedules…</StateNote>
          : schedules.length === 0 ? <StateNote kind="empty">No schedules.</StateNote>
          : (
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.85rem' }}>
              <thead><tr style={{ textAlign: 'left', color: '#6b7280', borderBottom: '1px solid #e5e7eb' }}>
                <th style={th()}>Schedule</th><th style={th()}>Departs</th><th style={th()}>Fare</th><th style={th()}>Seats</th><th style={th()}>Status</th><th style={th()}>Fare approved</th><th style={th()}></th>
              </tr></thead>
              <tbody>
                {schedules.map((s) => (
                  <tr key={s.id} style={{ borderBottom: '1px solid #f3f4f6' }}>
                    <td style={td()}><strong>{s.routeLabel}</strong><div style={{ fontSize: '0.72rem', color: '#9ca3af' }}>{s.operatorName}</div></td>
                    <td style={td()}>{new Date(s.departAt).toLocaleString()}</td>
                    <td style={td()}>{nairaFull(s.fareKobo)}</td>
                    <td style={td()}>{s.seatsBooked}/{s.seatsTotal}</td>
                    <td style={td()}><Badge status={s.status} /></td>
                    <td style={td()}>{s.fareApproved ? <Badge status="approved" /> : <Badge status="pending" />}</td>
                    <td style={td()}>
                      <div style={{ display: 'flex', gap: '0.4rem', flexWrap: 'wrap' }}>
                        <button style={btn()} onClick={() => void openManifest(s)}>Manifest</button>
                        {!s.fareApproved && (
                          <button disabled={!canManage} style={canManage ? btnPrimary('#16a34a') : btnDisabled()} onClick={() => { setApprove({ kind: 'schedule', id: s.id, label: s.routeLabel }); setReason(''); }}>Approve fare</button>
                        )}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
      </Card>

      {/* Manifest drill-down modal */}
      {manifestFor && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.4)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 50 }} onClick={() => setManifestFor(null)}>
          <div style={{ background: '#fff', borderRadius: '0.5rem', padding: '1.25rem', width: 'min(560px, 94vw)', maxHeight: '90vh', overflow: 'auto' }} onClick={(e) => e.stopPropagation()}>
            <h2 style={{ margin: '0 0 0.25rem', fontSize: '1.1rem', fontWeight: 700 }}>Manifest — {manifestFor.routeLabel}</h2>
            <p style={{ fontSize: '0.8rem', color: '#6b7280', margin: '0 0 1rem' }}>{manifestFor.operatorName} · departs {new Date(manifestFor.departAt).toLocaleString()} · {manifestFor.seatsBooked}/{manifestFor.seatsTotal} seats</p>
            {manifestLoading ? <StateNote kind="loading">Loading manifest…</StateNote>
              : manifest.length === 0 ? <StateNote kind="empty">No passengers booked for this schedule.</StateNote>
              : (
                <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.85rem' }}>
                  <thead><tr style={{ textAlign: 'left', color: '#6b7280', borderBottom: '1px solid #e5e7eb' }}>
                    <th style={th()}>Ticket</th><th style={th()}>Passenger</th><th style={th()}>Seat</th><th style={th()}>Status</th><th style={th()}>Fare</th>
                  </tr></thead>
                  <tbody>
                    {manifest.map((m) => (
                      <tr key={m.ticketId} style={{ borderBottom: '1px solid #f3f4f6' }}>
                        <td style={td()}>{m.ticketId}</td><td style={td()}>{m.passengerName}</td><td style={td()}>{m.seatNumber}</td>
                        <td style={td()}><Badge status={m.status} /></td><td style={td()}>{nairaFull(m.fareKobo)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: '1rem' }}>
              <button style={btn()} onClick={() => setManifestFor(null)}>Close</button>
            </div>
          </div>
        </div>
      )}

      {/* Fare approval modal */}
      {approve && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.4)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 50 }} onClick={() => !busy && setApprove(null)}>
          <div style={{ background: '#fff', borderRadius: '0.5rem', padding: '1.25rem', width: 'min(440px, 92vw)' }} onClick={(e) => e.stopPropagation()}>
            <h2 style={{ margin: '0 0 0.5rem', fontSize: '1.1rem', fontWeight: 700 }}>Approve {approve.kind} fare</h2>
            <p style={{ fontSize: '0.85rem', color: '#6b7280', margin: '0 0 0.75rem' }}>{approve.label}</p>
            <label style={{ fontSize: '0.8rem', fontWeight: 600 }}>Reason (required — written to audit log)</label>
            <textarea value={reason} onChange={(e) => setReason(e.target.value)} rows={3} placeholder="e.g. Fare within approved band for corridor." style={{ ...input(), marginTop: 4, fontFamily: 'inherit' }} />
            <div style={{ display: 'flex', gap: '0.5rem', justifyContent: 'flex-end', marginTop: '1rem' }}>
              <button style={btn()} disabled={busy} onClick={() => setApprove(null)}>Cancel</button>
              <button style={busy || !reason.trim() ? btnDisabled() : btnPrimary('#16a34a')} disabled={busy || !reason.trim()} onClick={submitApprove}>{busy ? 'Approving…' : 'Confirm approval'}</button>
            </div>
          </div>
        </div>
      )}

      {/* Operator verification modal */}
      {verify && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.4)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 50 }} onClick={() => !verifyBusy && setVerify(null)}>
          <div style={{ background: '#fff', borderRadius: '0.5rem', padding: '1.25rem', width: 'min(440px, 92vw)' }} onClick={(e) => e.stopPropagation()}>
            <h2 style={{ margin: '0 0 0.5rem', fontSize: '1.1rem', fontWeight: 700 }}>
              {verify.status === 'verified' ? 'Verify operator' : verify.status === 'suspended' ? 'Suspend operator' : 'Move operator to pending'}
            </h2>
            <p style={{ fontSize: '0.85rem', color: '#6b7280', margin: '0 0 0.75rem' }}>{verify.label}</p>
            <label style={{ fontSize: '0.8rem', fontWeight: 600 }}>
              {verify.status === 'suspended' ? 'Reason (required — written to audit log)' : 'Reason (optional — written to audit log)'}
            </label>
            <textarea value={verifyReason} onChange={(e) => setVerifyReason(e.target.value)} rows={3} placeholder={verify.status === 'suspended' ? 'e.g. Failed compliance review / safety complaint.' : 'e.g. KYB documents verified.'} style={{ ...input(), marginTop: 4, fontFamily: 'inherit' }} />
            <div style={{ display: 'flex', gap: '0.5rem', justifyContent: 'flex-end', marginTop: '1rem' }}>
              <button style={btn()} disabled={verifyBusy} onClick={() => setVerify(null)}>Cancel</button>
              {(() => {
                const blocked = verifyBusy || (verify.status === 'suspended' && !verifyReason.trim());
                const accent = verify.status === 'suspended' ? '#dc2626' : '#16a34a';
                return (
                  <button style={blocked ? btnDisabled() : btnPrimary(accent)} disabled={blocked} onClick={submitVerify}>
                    {verifyBusy ? 'Saving…' : verify.status === 'verified' ? 'Confirm verify' : verify.status === 'suspended' ? 'Confirm suspend' : 'Confirm'}
                  </button>
                );
              })()}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
