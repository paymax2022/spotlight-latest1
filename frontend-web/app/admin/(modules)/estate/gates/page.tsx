'use client';

// A-EST-06/07/08 — Gates, guard shifts & incident log.

import { useEffect, useState } from 'react';
import { listGates, listGuardShifts, listIncidents } from '@/services/estateAdminService';
import type { AdminGate, AdminGuardShift, AdminIncident } from '@/types/estateAdmin';
import { EstateTabs, timeAgo } from '../_ui';
import { Page, PageHeader, Card, Button, Badge, colors, thCell, tdCell } from '@/components/ui/vuexy';

const cap = (s: string) => s.replace(/(^|\s)\S/g, (c) => c.toUpperCase());
function statusColor(status: string): string {
  if (['online', 'on_duty', 'resolved', 'completed', 'active'].includes(status)) return colors.success;
  if (['pending', 'scheduled', 'investigating', 'maintenance', 'medium'].includes(status)) return colors.warning;
  if (['overdue', 'offline', 'missed', 'high', 'critical', 'open'].includes(status)) return colors.danger;
  if (status === 'low') return colors.info;
  return colors.secondary;
}

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
    <Page>
      <PageHeader title="Gates & security" subtitle="Gate health, guard shift roster and the estate incident log." actions={<Button variant="outline" sm onClick={load}>Refresh</Button>} />
      <EstateTabs active="gates" />
      {error && <p style={{ color: colors.danger }}>{error}</p>}

      {loading ? <p style={{ color: colors.muted }}>Loading security data…</p> : (
        <>
          <Card title="Gates" style={{ marginBottom: '1.25rem' }}>
            {gates.length === 0 ? <p style={{ color: colors.muted }}>No gates configured.</p> : (
              <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                <thead><tr><th style={thCell}>Gate</th><th style={thCell}>Location</th><th style={thCell}>Status</th><th style={thCell}>Guards on duty</th><th style={thCell}>Last heartbeat</th></tr></thead>
                <tbody>
                  {gates.map((g) => (
                    <tr key={g.id}>
                      <td style={tdCell}><strong>{g.name}</strong></td>
                      <td style={tdCell}>{g.location}</td>
                      <td style={tdCell}><Badge text={cap(g.status)} color={statusColor(g.status)} /></td>
                      <td style={tdCell}>{g.guardsOnDuty}</td>
                      <td style={tdCell}>{timeAgo(g.lastHeartbeat)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </Card>

          <Card title="Guard shifts" style={{ marginBottom: '1.25rem' }}>
            {shifts.length === 0 ? <p style={{ color: colors.muted }}>No shifts scheduled.</p> : (
              <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                <thead><tr><th style={thCell}>Guard</th><th style={thCell}>Gate</th><th style={thCell}>Shift</th><th style={thCell}>Starts</th><th style={thCell}>Ends</th><th style={thCell}>Status</th></tr></thead>
                <tbody>
                  {shifts.map((s) => (
                    <tr key={s.id}>
                      <td style={tdCell}><strong>{s.guardName}</strong></td>
                      <td style={tdCell}>{s.gate}</td>
                      <td style={tdCell}>{s.shift}</td>
                      <td style={tdCell}>{fmt(s.startsAt)}</td>
                      <td style={tdCell}>{fmt(s.endsAt)}</td>
                      <td style={tdCell}><Badge text={cap(s.status)} color={statusColor(s.status)} /></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </Card>

          <Card title="Incident log">
            {incidents.length === 0 ? <p style={{ color: colors.muted }}>No incidents logged.</p> : (
              <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                <thead><tr><th style={thCell}>Incident</th><th style={thCell}>Gate</th><th style={thCell}>Severity</th><th style={thCell}>Status</th><th style={thCell}>Reported by</th><th style={thCell}>When</th></tr></thead>
                <tbody>
                  {incidents.map((i) => (
                    <tr key={i.id}>
                      <td style={tdCell}><strong>{i.title}</strong></td>
                      <td style={tdCell}>{i.gate}</td>
                      <td style={tdCell}><Badge text={cap(i.severity)} color={statusColor(i.severity)} /></td>
                      <td style={tdCell}><Badge text={cap(i.status)} color={statusColor(i.status)} /></td>
                      <td style={tdCell}>{i.reportedBy}</td>
                      <td style={tdCell}>{timeAgo(i.reportedAt)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </Card>
        </>
      )}
    </Page>
  );
}
