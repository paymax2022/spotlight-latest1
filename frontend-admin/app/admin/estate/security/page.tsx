'use client';

// A-EST-OV-01 — Platform security & guard oversight (estate.admin.security).
// Cross-estate guard roster, incident log, and emergency alerts.

import { useCallback, useEffect, useState } from 'react';
import {
  listOversightIncidents, listOversightGuardShifts, listOversightEmergencies,
} from '@/services/estateAdminService';
import type { OversightIncident, OversightGuardShift, OversightEmergency } from '@/types/estateAdmin';
import {
  PageHeader, EstateOversightTabs, Card, Badge, btn, th, td, timeAgo,
  useEstatePermissions, ESTATE_ADMIN_PERMS, Restricted,
} from '../_ui';

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
    <div style={{ padding: '0.5rem 0.5rem 2rem' }}>
      <PageHeader title="Security & Guard oversight" subtitle="Cross-estate guard roster, incident log and emergency alerts." action={<button onClick={() => void load()} style={btn()}>Refresh</button>} />
      <EstateOversightTabs active="security" />
      {!canView ? <Restricted perm="estate.admin.security" /> : (
        <>
          {error && <p style={{ color: '#dc2626' }}>{error}</p>}
          {loading ? <p style={{ color: '#6b7280' }}>Loading security data…</p> : (
            <>
              <Card title="Emergency alerts">
                {emergencies.length === 0 ? <p style={{ color: '#6b7280' }}>No emergency alerts.</p> : (
                  <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                    <thead><tr><th style={th()}>Estate</th><th style={th()}>Kind</th><th style={th()}>Description</th><th style={th()}>Location</th><th style={th()}>Status</th><th style={th()}>When</th></tr></thead>
                    <tbody>
                      {emergencies.map((e) => (
                        <tr key={e.id}>
                          <td style={td()}>{e.estateId}</td>
                          <td style={td()}><Badge status={e.kind} /></td>
                          <td style={td()}>{e.description ?? '—'}</td>
                          <td style={td()}>{e.location ?? '—'}</td>
                          <td style={td()}><Badge status={e.status} /></td>
                          <td style={td()}>{timeAgo(e.createdAt)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                )}
              </Card>

              <Card title="Guard roster">
                {shifts.length === 0 ? <p style={{ color: '#6b7280' }}>No guard shifts.</p> : (
                  <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                    <thead><tr><th style={th()}>Estate</th><th style={th()}>Guard</th><th style={th()}>Gate</th><th style={th()}>Started</th><th style={th()}>Ended</th><th style={th()}>Status</th></tr></thead>
                    <tbody>
                      {shifts.map((s) => (
                        <tr key={s.id}>
                          <td style={td()}>{s.estateId}</td>
                          <td style={td()}><strong>{s.guardId}</strong></td>
                          <td style={td()}>{s.gateId}</td>
                          <td style={td()}>{timeAgo(s.startedAt)}</td>
                          <td style={td()}>{s.endedAt ? timeAgo(s.endedAt) : '—'}</td>
                          <td style={td()}><Badge status={s.onDuty ? 'on_duty' : 'completed'} /></td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                )}
              </Card>

              <Card title="Incident log">
                {incidents.length === 0 ? <p style={{ color: '#6b7280' }}>No incidents logged.</p> : (
                  <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                    <thead><tr><th style={th()}>Estate</th><th style={th()}>Type</th><th style={th()}>Description</th><th style={th()}>Guard</th><th style={th()}>Escalated</th><th style={th()}>When</th></tr></thead>
                    <tbody>
                      {incidents.map((i) => (
                        <tr key={i.id}>
                          <td style={td()}>{i.estateId}</td>
                          <td style={td()}><Badge status={i.incidentType} /></td>
                          <td style={td()}>{i.description}</td>
                          <td style={td()}>{i.guardId}</td>
                          <td style={td()}><Badge status={i.escalated ? 'high' : 'low'} label={i.escalated ? 'Escalated' : 'No'} /></td>
                          <td style={td()}>{timeAgo(i.createdAt)}</td>
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
    </div>
  );
}
