'use client';

// A-EST-OV-02 — Platform visitor logs oversight (estate.admin.security).
// Guard check-in/out and vehicle events synced from gate devices.

import { useCallback, useEffect, useState } from 'react';
import { listOversightVisitorLogs } from '@/services/estateAdminService';
import type { OversightVisitorLog } from '@/types/estateAdmin';
import {
  PageHeader, EstateOversightTabs, Card, Badge, btn, th, td, timeAgo,
  useEstatePermissions, ESTATE_ADMIN_PERMS, Restricted,
} from '../_ui';

export default function VisitorLogsPage() {
  const { can } = useEstatePermissions();
  const canView = can(ESTATE_ADMIN_PERMS.security);

  const [logs, setLogs] = useState<OversightVisitorLog[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!canView) return;
    setLoading(true); setError(null);
    try { setLogs(await listOversightVisitorLogs()); }
    catch (e) { setError(String(e)); }
    finally { setLoading(false); }
  }, [canView]);
  useEffect(() => { void load(); }, [load]);

  return (
    <div style={{ padding: '0.5rem 0.5rem 2rem' }}>
      <PageHeader title="Visitor logs" subtitle="Gate check-in/out and vehicle events synced from guard devices. Gated on estate.admin.security." action={<button onClick={() => void load()} style={btn()}>Refresh</button>} />
      <EstateOversightTabs active="visitor-logs" />
      {!canView ? <Restricted perm="estate.admin.security" /> : (
        <Card title="Gate visitor log">
          {error && <p style={{ color: '#dc2626' }}>{error}</p>}
          {loading ? <p style={{ color: '#6b7280' }}>Loading visitor logs…</p> : logs.length === 0 ? (
            <p style={{ color: '#6b7280' }}>No visitor events synced.</p>
          ) : (
            <table style={{ width: '100%', borderCollapse: 'collapse' }}>
              <thead><tr><th style={th()}>Estate</th><th style={th()}>Event</th><th style={th()}>Details</th><th style={th()}>Guard</th><th style={th()}>Captured</th><th style={th()}>Synced</th></tr></thead>
              <tbody>
                {logs.map((l) => (
                  <tr key={l.id}>
                    <td style={td()}>{l.estateId}</td>
                    <td style={td()}><Badge status={l.eventType === 'checkin' ? 'active' : l.eventType === 'checkout' ? 'low' : 'pending'} label={l.eventType} /></td>
                    <td style={td()}><code style={{ fontSize: '0.78rem' }}>{JSON.stringify(l.payload)}</code></td>
                    <td style={td()}>{l.guardId}</td>
                    <td style={td()}>{timeAgo(l.capturedAt)}</td>
                    <td style={td()}>{timeAgo(l.syncedAt)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </Card>
      )}
    </div>
  );
}
