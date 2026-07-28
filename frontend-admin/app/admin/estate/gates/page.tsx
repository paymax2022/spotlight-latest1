'use client';

// A-EST-06/07/08 — Gates, guard shifts & incident log.

import { useEffect, useState } from 'react';
import { listGates, listGuardShifts, listIncidents } from '@/services/estateAdminService';
import type { AdminGate, AdminGuardShift, AdminIncident } from '@/types/estateAdmin';
import { PageHeader, EstateTabs, Card, Badge, btn, th, td, timeAgo } from '../_ui';

export default function GatesPage() {
  const [gates, setGates] = useState<AdminGate[]>([]);
  const [shifts, setShifts] = useState<AdminGuardShift[]>([]);
  const [incidents, setIncidents] = useState<AdminIncident[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  async function load() {
    setLoading(true); setError(null);
    try {
      const [g, s, i] = await Promise.all([listGates(), listGuardShifts(), listIncidents()]);
      setGates(g); setShifts(s); setIncidents(i);
    } catch (e) { setError(String(e)); }
    finally { setLoading(false); }
  }
  useEffect(() => { load(); }, []);

  const fmt = (iso: string) => new Date(iso).toLocaleString('en-NG', { hour: '2-digit', minute: '2-digit', day: '2-digit', month: 'short' });

  return (
    <div style={{ padding: '0.5rem 0.5rem 2rem' }}>
      <PageHeader title="Gates & security" subtitle="Gate health, guard shift roster and the estate incident log." action={<button onClick={load} style={btn()}>Refresh</button>} />
      <EstateTabs active="gates" />
      {error && <p style={{ color: '#dc2626' }}>{error}</p>}

      {loading ? <p style={{ color: '#6b7280' }}>Loading security data…</p> : (
        <>
          <Card title="Gates">
            {gates.length === 0 ? <p style={{ color: '#6b7280' }}>No gates configured.</p> : (
              <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                <thead><tr><th style={th()}>Gate</th><th style={th()}>Location</th><th style={th()}>Status</th><th style={th()}>Guards on duty</th><th style={th()}>Last heartbeat</th></tr></thead>
                <tbody>
                  {gates.map((g) => (
                    <tr key={g.id}>
                      <td style={td()}><strong>{g.name}</strong></td>
                      <td style={td()}>{g.location}</td>
                      <td style={td()}><Badge status={g.status} /></td>
                      <td style={td()}>{g.guardsOnDuty}</td>
                      <td style={td()}>{timeAgo(g.lastHeartbeat)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </Card>

          <Card title="Guard shifts">
            {shifts.length === 0 ? <p style={{ color: '#6b7280' }}>No shifts scheduled.</p> : (
              <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                <thead><tr><th style={th()}>Guard</th><th style={th()}>Gate</th><th style={th()}>Shift</th><th style={th()}>Starts</th><th style={th()}>Ends</th><th style={th()}>Status</th></tr></thead>
                <tbody>
                  {shifts.map((s) => (
                    <tr key={s.id}>
                      <td style={td()}><strong>{s.guardName}</strong></td>
                      <td style={td()}>{s.gate}</td>
                      <td style={td()} >{s.shift}</td>
                      <td style={td()}>{fmt(s.startsAt)}</td>
                      <td style={td()}>{fmt(s.endsAt)}</td>
                      <td style={td()}><Badge status={s.status} /></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </Card>

          <Card title="Incident log">
            {incidents.length === 0 ? <p style={{ color: '#6b7280' }}>No incidents logged.</p> : (
              <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                <thead><tr><th style={th()}>Incident</th><th style={th()}>Gate</th><th style={th()}>Severity</th><th style={th()}>Status</th><th style={th()}>Reported by</th><th style={th()}>When</th></tr></thead>
                <tbody>
                  {incidents.map((i) => (
                    <tr key={i.id}>
                      <td style={td()}><strong>{i.title}</strong></td>
                      <td style={td()}>{i.gate}</td>
                      <td style={td()}><Badge status={i.severity} /></td>
                      <td style={td()}><Badge status={i.status} /></td>
                      <td style={td()}>{i.reportedBy}</td>
                      <td style={td()}>{timeAgo(i.reportedAt)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </Card>
        </>
      )}
    </div>
  );
}
