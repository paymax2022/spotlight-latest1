'use client';

// A-EST-OV-02 — Platform visitor logs oversight (estate.admin.security).
// Guard check-in/out and vehicle events synced from gate devices.

import { useCallback, useEffect, useState } from 'react';
import { listOversightVisitorLogs } from '@/services/estateAdminService';
import type { OversightVisitorLog } from '@/types/estateAdmin';
import { EstateOversightTabs, Restricted, useEstatePermissions, ESTATE_ADMIN_PERMS, timeAgo } from '../_ui';
import { Page, PageHeader, Card, Button, Badge, colors, thCell, tdCell } from '@/components/ui/vuexy';

const cap = (s: string) => s.replace(/(^|\s)\S/g, (c) => c.toUpperCase());

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
    <Page>
      <PageHeader title="Visitor logs" subtitle="Gate check-in/out and vehicle events synced from guard devices. Gated on estate.admin.security." actions={<Button variant="outline" sm onClick={() => void load()}>Refresh</Button>} />
      <EstateOversightTabs active="visitor-logs" />
      {!canView ? <Restricted perm="estate.admin.security" /> : (
        <Card title="Gate visitor log">
          {error && <p style={{ color: colors.danger }}>{error}</p>}
          {loading ? <p style={{ color: colors.muted }}>Loading visitor logs…</p> : logs.length === 0 ? (
            <p style={{ color: colors.muted }}>No visitor events synced.</p>
          ) : (
            <table style={{ width: '100%', borderCollapse: 'collapse' }}>
              <thead><tr><th style={thCell}>Estate</th><th style={thCell}>Event</th><th style={thCell}>Details</th><th style={thCell}>Guard</th><th style={thCell}>Captured</th><th style={thCell}>Synced</th></tr></thead>
              <tbody>
                {logs.map((l) => (
                  <tr key={l.id}>
                    <td style={tdCell}>{l.estateId}</td>
                    <td style={tdCell}><Badge text={cap(l.eventType)} color={l.eventType === 'checkin' ? colors.success : l.eventType === 'checkout' ? colors.info : colors.warning} /></td>
                    <td style={tdCell}><code style={{ fontSize: '0.78rem' }}>{JSON.stringify(l.payload)}</code></td>
                    <td style={tdCell}>{l.guardId}</td>
                    <td style={tdCell}>{timeAgo(l.capturedAt)}</td>
                    <td style={tdCell}>{timeAgo(l.syncedAt)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </Card>
      )}
    </Page>
  );
}
