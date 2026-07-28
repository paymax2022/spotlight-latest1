'use client';

import { useCallback, useEffect, useState } from 'react';
import { getDispatchLive, assignDriver } from '@/services/mobilityAdminService';
import type { DispatchLive, TripRow } from '@/types/mobility';
import {
  PageHeader, MobilityTabs, Card, Badge, StateNote, AuditedNotice, Kpi,
  btn, btnPrimary, btnDisabled, th, td, input, naira,
  useMobilityPermissions, MOBILITY_PERMS,
} from '../_ui';

export default function MobilityDispatchPage() {
  const { can } = useMobilityPermissions();
  const canManage = can(MOBILITY_PERMS.dispatchManage);

  const [data, setData] = useState<DispatchLive | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState('');

  const [assignTarget, setAssignTarget] = useState<TripRow | null>(null);
  const [driverId, setDriverId] = useState('');
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    setLoading(true); setError(null);
    try { setData(await getDispatchLive()); }
    catch (e) { setError(String(e)); }
    finally { setLoading(false); }
  }, []);

  useEffect(() => {
    void load();
    const t = setInterval(() => void load(), 15_000); // live refresh
    return () => clearInterval(t);
  }, [load]);

  const submitAssign = async () => {
    if (!assignTarget || !driverId) return;
    setBusy(true); setError(null); setMessage('');
    try {
      await assignDriver(assignTarget.id, driverId);
      setMessage(`Trip ${assignTarget.id} assigned to ${driverId} (audited).`);
      setAssignTarget(null); setDriverId('');
      await load();
    } catch (e) { setError(`Assignment failed: ${String(e)}`); }
    finally { setBusy(false); }
  };

  const flagged = data?.activeTrips.filter((t) => t.sos || t.stuck) ?? [];
  const idleDrivers = data?.onlineDrivers.filter((d) => !d.activeTripId) ?? [];

  return (
    <div style={{ padding: '0.5rem 0.5rem 2rem' }}>
      <PageHeader
        title="Live Dispatch"
        subtitle="Active trips, online drivers and stuck / SOS flags. Auto-refreshes every 15s."
        action={<button onClick={() => void load()} style={btn()} disabled={loading}>{loading ? 'Loading…' : 'Refresh now'}</button>}
      />
      <MobilityTabs active="dispatch" />
      <AuditedNotice text="Manual driver assignment requires the mobility.dispatch.manage role." />

      {message && <StateNote kind="loading">{message}</StateNote>}
      {error && <StateNote kind="error">{error}</StateNote>}

      {loading && !data ? <StateNote kind="loading">Loading live feed…</StateNote> : !data ? <StateNote kind="empty">No live data.</StateNote> : (
        <>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(180px, 1fr))', gap: '0.75rem', marginBottom: '1.25rem' }}>
            <Kpi label="Active trips" value={String(data.activeTrips.length)} />
            <Kpi label="Online drivers" value={String(data.onlineDrivers.length)} accent="#16a34a" sub={`${idleDrivers.length} idle`} />
            <Kpi label="Stuck / SOS flags" value={String(flagged.length)} accent={flagged.length ? '#dc2626' : '#16a34a'} />
          </div>

          {flagged.length > 0 && (
            <Card title={`⚠ Flagged trips (${flagged.length})`}>
              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.85rem' }}>
                <thead>
                  <tr style={{ textAlign: 'left', color: '#6b7280', borderBottom: '1px solid #e5e7eb' }}>
                    <th style={th()}>Trip</th><th style={th()}>Flag</th><th style={th()}>Rider</th><th style={th()}>Driver</th><th style={th()}>Phase</th><th style={th()}>Zone</th>
                  </tr>
                </thead>
                <tbody>
                  {flagged.map((t) => (
                    <tr key={t.id} style={{ borderBottom: '1px solid #f3f4f6', background: t.sos ? '#fef2f2' : undefined }}>
                      <td style={td()}><strong>{t.id}</strong></td>
                      <td style={td()}>{t.sos ? <Badge status="critical" label="SOS" /> : null} {t.stuck ? <Badge status="high" label="stuck" /> : null}</td>
                      <td style={td()}>{t.riderName}</td>
                      <td style={td()}>{t.driverName ?? '—'}</td>
                      <td style={td()}><Badge status={t.phase} /></td>
                      <td style={td()}>{t.zone}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </Card>
          )}

          <div style={{ display: 'grid', gridTemplateColumns: '1.3fr 1fr', gap: '1.25rem' }}>
            <Card title={`Active trips (${data.activeTrips.length})`}>
              {data.activeTrips.length === 0 ? <StateNote kind="empty">No active trips.</StateNote> : (
                <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.85rem' }}>
                  <thead>
                    <tr style={{ textAlign: 'left', color: '#6b7280', borderBottom: '1px solid #e5e7eb' }}>
                      <th style={th()}>Trip</th><th style={th()}>Phase</th><th style={th()}>Driver</th><th style={th()}>Fare</th><th style={th()}></th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.activeTrips.map((t) => (
                      <tr key={t.id} style={{ borderBottom: '1px solid #f3f4f6' }}>
                        <td style={td()}>
                          <strong>{t.id}</strong>
                          <div style={{ fontSize: '0.72rem', color: '#9ca3af' }}>{t.pickupAddress} → {t.destAddress}</div>
                        </td>
                        <td style={td()}><Badge status={t.phase} /></td>
                        <td style={td()}>{t.driverName ?? <span style={{ color: '#dc2626' }}>unassigned</span>}</td>
                        <td style={td()}>{naira(t.fareKobo)}</td>
                        <td style={td()}>
                          {!t.driverId && (
                            <button disabled={!canManage} style={canManage ? btnPrimary() : btnDisabled()} onClick={() => { setAssignTarget(t); setDriverId(''); }}>Assign</button>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </Card>

            <Card title={`Online drivers (${data.onlineDrivers.length})`}>
              {data.onlineDrivers.length === 0 ? <StateNote kind="empty">No drivers online.</StateNote> : (
                <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.85rem' }}>
                  <thead>
                    <tr style={{ textAlign: 'left', color: '#6b7280', borderBottom: '1px solid #e5e7eb' }}>
                      <th style={th()}>Driver</th><th style={th()}>Zone</th><th style={th()}>Rating</th><th style={th()}>Status</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.onlineDrivers.map((d) => (
                      <tr key={d.id} style={{ borderBottom: '1px solid #f3f4f6' }}>
                        <td style={td()}><strong>{d.name}</strong></td>
                        <td style={td()}>{d.zone}</td>
                        <td style={td()}>{d.rating.toFixed(1)}</td>
                        <td style={td()}>{d.activeTripId ? <Badge status="in_progress" label="on trip" /> : <Badge status="online" label="idle" />}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </Card>
          </div>
        </>
      )}

      {assignTarget && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.4)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 50 }} onClick={() => !busy && setAssignTarget(null)}>
          <div style={{ background: '#fff', borderRadius: '0.5rem', padding: '1.25rem', width: 'min(440px, 92vw)' }} onClick={(e) => e.stopPropagation()}>
            <h2 style={{ margin: '0 0 0.5rem', fontSize: '1.1rem', fontWeight: 700 }}>Manually assign {assignTarget.id}</h2>
            <p style={{ fontSize: '0.8rem', color: '#6b7280', margin: '0 0 0.75rem' }}>{assignTarget.pickupAddress} → {assignTarget.destAddress} · {assignTarget.zone}</p>
            <label style={{ fontSize: '0.8rem', fontWeight: 600 }}>Driver (idle, online)</label>
            <select value={driverId} onChange={(e) => setDriverId(e.target.value)} style={{ ...input(), marginTop: 4 }}>
              <option value="">Select a driver…</option>
              {idleDrivers.map((d) => <option key={d.id} value={d.id}>{d.name} · {d.zone} · ★{d.rating.toFixed(1)}</option>)}
            </select>
            {idleDrivers.length === 0 && <StateNote kind="empty">No idle drivers available right now.</StateNote>}
            <div style={{ display: 'flex', gap: '0.5rem', justifyContent: 'flex-end', marginTop: '1rem' }}>
              <button style={btn()} disabled={busy} onClick={() => setAssignTarget(null)}>Cancel</button>
              <button style={busy || !driverId ? btnDisabled() : btnPrimary()} disabled={busy || !driverId} onClick={submitAssign}>{busy ? 'Assigning…' : 'Assign (audited)'}</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
