'use client';

import { useCallback, useEffect, useState } from 'react';
import {
  listBusOperatorOptions, listBusRouteOptions, createBusRoute, createBusSchedule,
  nairaInputToKobo, localDateTimeToRfc3339,
  type BusOperatorOption, type BusRouteOption,
} from '@/services/busReportsAdminService';
import {
  PageHeader, MobilityTabs, Card, StateNote, AuditedNotice,
  btnPrimary, btnDisabled, input, nairaFull, useMobilityPermissions, MOBILITY_PERMS,
} from '../../_ui';
import { colors } from '@/components/ui/vuexy';

const label = { display: 'block', fontSize: '0.8rem', marginBottom: '0.6rem' } as const;

export default function BusCreatePage() {
  const { can } = useMobilityPermissions();
  const canManage = can(MOBILITY_PERMS.busManage);

  const [operators, setOperators] = useState<BusOperatorOption[]>([]);
  const [routes, setRoutes] = useState<BusRouteOption[]>([]);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState(false);

  const [rt, setRt] = useState({ operatorUserId: '', origin: '', dest: '', category: 'standard', reason: '' });
  const [sc, setSc] = useState({ routeId: '', departure: '', arrival: '', seats: '', fare: '', cutoff: '', reason: '' });

  const load = useCallback(async () => {
    setLoadError(null);
    const [o, r] = await Promise.allSettled([listBusOperatorOptions(), listBusRouteOptions()]);
    if (o.status === 'fulfilled') setOperators(o.value);
    if (r.status === 'fulfilled') setRoutes(r.value);
    const failed = [o, r].filter((x) => x.status === 'rejected') as PromiseRejectedResult[];
    if (failed.length) setLoadError(failed.map((f) => String(f.reason)).join('; '));
  }, []);
  useEffect(() => { void load(); }, [load]);

  const submitRoute = async () => {
    setError(null); setMessage('');
    if (!rt.operatorUserId || !rt.origin.trim() || !rt.dest.trim()) { setError('Operator, origin and destination are required.'); return; }
    if (!rt.reason.trim()) { setError('A reason is required (audited).'); return; }
    setBusy(true);
    try {
      const res = await createBusRoute({
        operator_id: rt.operatorUserId, origin_terminal: rt.origin.trim(), dest_terminal: rt.dest.trim(),
        category: rt.category.trim() || 'standard', reason: rt.reason.trim(),
      });
      setMessage(`Route ${rt.origin} → ${rt.dest} created (${res.id}).`);
      setRt({ operatorUserId: '', origin: '', dest: '', category: 'standard', reason: '' });
      await load();
      setSc((s) => ({ ...s, routeId: res.id }));
    } catch (e) { setError(`Create route failed: ${String(e)}`); }
    finally { setBusy(false); }
  };

  const fareKobo = nairaInputToKobo(sc.fare);
  const submitSchedule = async () => {
    setError(null); setMessage('');
    const departure = localDateTimeToRfc3339(sc.departure);
    const arrival = sc.arrival ? localDateTimeToRfc3339(sc.arrival) : undefined;
    const seats = Number(sc.seats);
    const cutoff = sc.cutoff ? Number(sc.cutoff) : undefined;
    if (!sc.routeId) { setError('Pick a route.'); return; }
    if (!departure) { setError('Departure time is required.'); return; }
    if (arrival === null) { setError('Arrival estimate is not a valid date/time.'); return; }
    if (!Number.isInteger(seats) || seats < 1 || seats > 80) { setError('Seats must be a whole number from 1 to 80.'); return; }
    if (fareKobo === null) { setError('Fare must be a naira amount with at most 2 decimals.'); return; }
    if (cutoff !== undefined && (!Number.isInteger(cutoff) || cutoff < 60 || cutoff > 1440)) { setError('Cancel cutoff must be 60–1440 minutes.'); return; }
    if (!sc.reason.trim()) { setError('A reason is required (audited).'); return; }
    setBusy(true);
    try {
      const res = await createBusSchedule({
        route_id: sc.routeId, departure_time: departure, arrival_estimate: arrival,
        total_seats: seats, fare_kobo: fareKobo, cancel_cutoff_minutes: cutoff, reason: sc.reason.trim(),
      });
      setMessage(`Schedule ${res.id} created at ${nairaFull(fareKobo)}. Its fare must be approved on the Bus page before it can be booked.`);
      setSc({ routeId: sc.routeId, departure: '', arrival: '', seats: '', fare: '', cutoff: '', reason: '' });
    } catch (e) { setError(`Create schedule failed: ${String(e)}`); }
    finally { setBusy(false); }
  };

  const disabled = !canManage || busy;
  return (
    <div style={{ padding: '0.5rem 0.5rem 2rem' }}>
      <PageHeader title="New Bus Route / Schedule" subtitle="Create admin-managed routes and departures. New schedule fares start unapproved." />
      <MobilityTabs active="bus" />
      <AuditedNotice text="Creating routes and schedules requires mobility.bus.manage and is audited." />
      {!canManage && <StateNote kind="restricted">You need the mobility.bus.manage permission to create routes or schedules.</StateNote>}
      {loadError && <StateNote kind="error">Could not load options: {loadError}</StateNote>}
      {message && <StateNote kind="loading">{message}</StateNote>}
      {error && <StateNote kind="error">{error}</StateNote>}

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(320px, 1fr))', gap: '1rem' }}>
        <Card title="Create route">
          <label style={label}>Operator
            <select value={rt.operatorUserId} onChange={(e) => setRt({ ...rt, operatorUserId: e.target.value })} style={input()}>
              <option value="">Select operator…</option>
              {operators.filter((o) => o.ownerUserId).map((o) => (
                <option key={o.id} value={o.ownerUserId!}>{o.businessName} ({o.verificationStatus})</option>
              ))}
            </select>
          </label>
          <label style={label}>Origin terminal<input value={rt.origin} onChange={(e) => setRt({ ...rt, origin: e.target.value })} style={input()} /></label>
          <label style={label}>Destination terminal<input value={rt.dest} onChange={(e) => setRt({ ...rt, dest: e.target.value })} style={input()} /></label>
          <label style={label}>Category<input value={rt.category} onChange={(e) => setRt({ ...rt, category: e.target.value })} style={input()} /></label>
          <label style={label}>Reason (audited)<input value={rt.reason} onChange={(e) => setRt({ ...rt, reason: e.target.value })} style={input()} /></label>
          <button onClick={() => void submitRoute()} disabled={disabled} style={disabled ? btnDisabled() : btnPrimary()}>{busy ? 'Saving…' : 'Create route'}</button>
        </Card>

        <Card title="Create schedule">
          <label style={label}>Route
            <select value={sc.routeId} onChange={(e) => setSc({ ...sc, routeId: e.target.value })} style={input()}>
              <option value="">Select route…</option>
              {routes.map((r) => <option key={r.id} value={r.id}>{r.label}{r.status !== 'active' ? ` (${r.status})` : ''}</option>)}
            </select>
          </label>
          <label style={label}>Departure (your local time)<input type="datetime-local" value={sc.departure} onChange={(e) => setSc({ ...sc, departure: e.target.value })} style={input()} /></label>
          <label style={label}>Arrival estimate (optional)<input type="datetime-local" value={sc.arrival} onChange={(e) => setSc({ ...sc, arrival: e.target.value })} style={input()} /></label>
          <label style={label}>Total seats (1–80)<input inputMode="numeric" value={sc.seats} onChange={(e) => setSc({ ...sc, seats: e.target.value })} style={input()} /></label>
          <label style={label}>Fare (₦)
            <input inputMode="decimal" value={sc.fare} onChange={(e) => setSc({ ...sc, fare: e.target.value })} style={input()} />
            {sc.fare && <span style={{ fontSize: '0.72rem', color: fareKobo === null ? colors.danger : colors.muted }}>
              {fareKobo === null ? 'Invalid amount' : `${nairaFull(fareKobo)} = ${fareKobo} kobo`}
            </span>}
          </label>
          <label style={label}>Cancel cutoff minutes (optional, 60–1440)<input inputMode="numeric" value={sc.cutoff} onChange={(e) => setSc({ ...sc, cutoff: e.target.value })} style={input()} /></label>
          <label style={label}>Reason (audited)<input value={sc.reason} onChange={(e) => setSc({ ...sc, reason: e.target.value })} style={input()} /></label>
          <button onClick={() => void submitSchedule()} disabled={disabled} style={disabled ? btnDisabled() : btnPrimary()}>{busy ? 'Saving…' : 'Create schedule'}</button>
        </Card>
      </div>
    </div>
  );
}
