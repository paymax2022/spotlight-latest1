'use client';

import { useCallback, useEffect, useState } from 'react';
import { getDispatchLive, assignDriver } from '@/services/mobilityAdminService';
import type { DispatchLive, TripRow } from '@/types/mobility';
import {
  PageHeader, MobilityTabs, Card, Badge, StateNote, AuditedNotice, Kpi,
  btn, btnPrimary, btnDisabled, input, naira,
  useMobilityPermissions, MOBILITY_PERMS,
} from '../_ui';
import { colors, tint, thCell, tdCell } from '@/components/ui/vuexy';

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
            <Kpi label="Online drivers" value={String(data.onlineDrivers.length)} accent={colors.success} sub={`${idleDrivers.length} idle`} />
            <Kpi label="Stuck / SOS flags" value={String(flagged.length)} accent={flagged.length ? colors.danger : colors.success} />
          </div>

          {flagged.length > 0 && (
            <Card title={`⚠ Flagged trips (${flagged.length})`}>
              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.85rem' }}>
                <thead>
                  <tr style={{ textAlign: 'left', color: colors.muted, borderBottom: `1px solid ${colors.border}` }}>
                    <th style={thCell}>Trip</th><th style={thCell}>Flag</th><th style={thCell}>Rider</th><th style={thCell}>Driver</th><th style={thCell}>Phase</th><th style={thCell}>Zone</th>
                  </tr>
                </thead>
                <tbody>
                  {flagged.map((t) => (
                    <tr key={t.id} style={{ borderBottom: `1px solid ${colors.border}`, background: t.sos ? tint(colors.danger, 0.08) : undefined }}>
                      <td style={tdCell}><strong>{t.id}</strong></td>
                      <td style={tdCell}>{t.sos ? <Badge status="critical" label="SOS" /> : null} {t.stuck ? <Badge status="high" label="stuck" /> : null}</td>
                      <td style={tdCell}>{t.riderName}</td>
                      <td style={tdCell}>{t.driverName ?? '—'}</td>
                      <td style={tdCell}><Badge status={t.phase} /></td>
                      <td style={tdCell}>{t.zone}</td>
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
                    <tr style={{ textAlign: 'left', color: colors.muted, borderBottom: `1px solid ${colors.border}` }}>
                      <th style={thCell}>Trip</th><th style={thCell}>Phase</th><th style={thCell}>Driver</th><th style={thCell}>Fare</th><th style={thCell}></th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.activeTrips.map((t) => (
                      <tr key={t.id} style={{ borderBottom: `1px solid ${colors.border}` }}>
                        <td style={tdCell}>
                          <strong>{t.id}</strong>
                          <div style={{ fontSize: '0.72rem', color: colors.muted }}>{t.pickupAddress} → {t.destAddress}</div>
                        </td>
                        <td style={tdCell}><Badge status={t.phase} /></td>
                        <td style={tdCell}>{t.driverName ?? <span style={{ color: colors.danger }}>unassigned</span>}</td>
                        <td style={tdCell}>{naira(t.fareKobo)}</td>
                        <td style={tdCell}>
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
                    <tr style={{ textAlign: 'left', color: colors.muted, borderBottom: `1px solid ${colors.border}` }}>
                      <th style={thCell}>Driver</th><th style={thCell}>Zone</th><th style={thCell}>Rating</th><th style={thCell}>Status</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.onlineDrivers.map((d) => (
                      <tr key={d.id} style={{ borderBottom: `1px solid ${colors.border}` }}>
                        <td style={tdCell}><strong>{d.name}</strong></td>
                        <td style={tdCell}>{d.zone}</td>
                        <td style={tdCell}>{d.rating.toFixed(1)}</td>
                        <td style={tdCell}>{d.activeTripId ? <Badge status="in_progress" label="on trip" /> : <Badge status="online" label="idle" />}</td>
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
          <div style={{ background: colors.card, borderRadius: '0.5rem', padding: '1.25rem', width: 'min(440px, 92vw)' }} onClick={(e) => e.stopPropagation()}>
            <h2 style={{ margin: '0 0 0.5rem', fontSize: '1.1rem', fontWeight: 700 }}>Manually assign {assignTarget.id}</h2>
            <p style={{ fontSize: '0.8rem', color: colors.muted, margin: '0 0 0.75rem' }}>{assignTarget.pickupAddress} → {assignTarget.destAddress} · {assignTarget.zone}</p>
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
