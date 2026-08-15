'use client';

// A-EST-OV-01 — Platform security & guard oversight (estate.admin.security).
// Cross-estate guard roster, incident log, and emergency alerts.

import { useCallback, useEffect, useState } from 'react';
import {
  listOversightIncidents, listOversightGuardShifts, listOversightEmergencies,
} from '@/services/estateAdminService';
import type { OversightIncident, OversightGuardShift, OversightEmergency } from '@/types/estateAdmin';
import { EstateOversightTabs, Restricted, useEstatePermissions, ESTATE_ADMIN_PERMS, timeAgo } from '../_ui';
import { Page, PageHeader, Card, Button, Badge, colors, thCell, tdCell } from '@/components/ui/vuexy';

const cap = (s: string) => s.replace(/(^|\s)\S/g, (c) => c.toUpperCase());
function statusColor(status: string): string {
  if (['active', 'paid', 'verified', 'online', 'on_duty', 'resolved', 'completed'].includes(status)) return colors.success;
  if (['pending', 'scheduled', 'investigating', 'maintenance', 'medium'].includes(status)) return colors.warning;
  if (['overdue', 'banned', 'restricted', 'rejected', 'suspended', 'offline', 'open', 'missed', 'high', 'critical'].includes(status)) return colors.danger;
  if (status === 'low') return colors.info;
  return colors.secondary;
}

export default function SecurityOversightPage() {
  const { can } = useEstatePermissions();
  const canView = can(ESTATE_ADMIN_PERMS.security);

  const [incidents, setIncidents] = useState<OversightIncident[]>([]);
  const [shifts, setShifts] = useState<OversightGuardShift[]>([]);
  const [emergencies, setEmergencies] = useState<OversightEmergency[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!canView) return;
    setLoading(true); setError(null);
    try {
      const [i, s, e] = await Promise.all([
        listOversightIncidents(), listOversightGuardShifts(), listOversightEmergencies(),
      ]);
      setIncidents(i); setShifts(s); setEmergencies(e);
    } catch (e) { setError(String(e)); }
    finally { setLoading(false); }
  }, [canView]);
  useEffect(() => { void load(); }, [load]);

  return (
    <Page>
      <PageHeader title="Security & Guard oversight" subtitle="Cross-estate guard roster, incident log and emergency alerts." actions={<Button variant="outline" sm onClick={() => void load()}>Refresh</Button>} />
      <EstateOversightTabs active="security" />
      {!canView ? <Restricted perm="estate.admin.security" /> : (
        <>
          {error && <p style={{ color: colors.danger }}>{error}</p>}
          {loading ? <p style={{ color: colors.muted }}>Loading security data…</p> : (
            <>
              <Card title="Emergency alerts" style={{ marginBottom: '1.25rem' }}>
                {emergencies.length === 0 ? <p style={{ color: colors.muted }}>No emergency alerts.</p> : (
                  <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                    <thead><tr><th style={thCell}>Estate</th><th style={thCell}>Kind</th><th style={thCell}>Description</th><th style={thCell}>Location</th><th style={thCell}>Status</th><th style={thCell}>When</th></tr></thead>
                    <tbody>
                      {emergencies.map((e) => (
                        <tr key={e.id}>
                          <td style={tdCell}>{e.estateId}</td>
                          <td style={tdCell}><Badge text={cap(e.kind)} color={statusColor(e.kind)} /></td>
                          <td style={tdCell}>{e.description ?? '—'}</td>
                          <td style={tdCell}>{e.location ?? '—'}</td>
                          <td style={tdCell}><Badge text={cap(e.status)} color={statusColor(e.status)} /></td>
                          <td style={tdCell}>{timeAgo(e.createdAt)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                )}
              </Card>

              <Card title="Guard roster" style={{ marginBottom: '1.25rem' }}>
                {shifts.length === 0 ? <p style={{ color: colors.muted }}>No guard shifts.</p> : (
                  <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                    <thead><tr><th style={thCell}>Estate</th><th style={thCell}>Guard</th><th style={thCell}>Gate</th><th style={thCell}>Started</th><th style={thCell}>Ended</th><th style={thCell}>Status</th></tr></thead>
                    <tbody>
                      {shifts.map((s) => (
                        <tr key={s.id}>
                          <td style={tdCell}>{s.estateId}</td>
                          <td style={tdCell}><strong>{s.guardId}</strong></td>
                          <td style={tdCell}>{s.gateId}</td>
                          <td style={tdCell}>{timeAgo(s.startedAt)}</td>
                          <td style={tdCell}>{s.endedAt ? timeAgo(s.endedAt) : '—'}</td>
                          <td style={tdCell}><Badge text={s.onDuty ? 'On duty' : 'Completed'} color={s.onDuty ? colors.success : colors.secondary} /></td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                )}
              </Card>

              <Card title="Incident log">
                {incidents.length === 0 ? <p style={{ color: colors.muted }}>No incidents logged.</p> : (
                  <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                    <thead><tr><th style={thCell}>Estate</th><th style={thCell}>Type</th><th style={thCell}>Description</th><th style={thCell}>Guard</th><th style={thCell}>Escalated</th><th style={thCell}>When</th></tr></thead>
                    <tbody>
                      {incidents.map((i) => (
                        <tr key={i.id}>
                          <td style={tdCell}>{i.estateId}</td>
                          <td style={tdCell}><Badge text={cap(i.incidentType)} color={statusColor(i.incidentType)} /></td>
                          <td style={tdCell}>{i.description}</td>
                          <td style={tdCell}>{i.guardId}</td>
                          <td style={tdCell}><Badge text={i.escalated ? 'Escalated' : 'No'} color={i.escalated ? colors.danger : colors.info} /></td>
                          <td style={tdCell}>{timeAgo(i.createdAt)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                )}
              </Card>
            </>
          )}
        </>
      )}
    </Page>
  );
}
