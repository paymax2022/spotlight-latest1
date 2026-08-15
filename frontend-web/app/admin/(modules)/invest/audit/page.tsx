'use client';

import { useEffect, useState } from 'react';
import { listAudit } from '@/services/investAdminService';
import type { AuditEntry } from '@/types/investAdmin';
import { InvestTabs } from '../_ui';
import { Page, PageHeader, Card, Button, colors, thCell, tdCell } from '@/components/ui/vuexy';

export default function InvestAuditPage() {
  const [logs, setLogs] = useState<AuditEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  async function load() {
    setLoading(true); setError(null);
    try { setLogs(await listAudit()); }
    catch (e) { setError(String(e)); }
    finally { setLoading(false); }
  }
  useEffect(() => { load(); }, []);

  return (
    <Page>
      <PageHeader
        title="Audit log"
        subtitle="Every sensitive admin action is recorded immutably with actor, entity and reason."
        actions={<Button variant="outline" onClick={load}>Refresh</Button>}
      />
      <InvestTabs />

      {error && <p style={{ color: colors.danger }}>{error}</p>}
      <Card style={{ padding: 0, overflow: 'auto' }}>
        {loading ? (
          <p style={{ color: colors.muted, padding: 14 }}>Loading audit log…</p>
        ) : logs.length === 0 ? (
          <p style={{ color: colors.muted, padding: 14 }}>No audit entries yet.</p>
        ) : (
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
            <thead>
              <tr>
                <th style={thCell}>When</th>
                <th style={thCell}>Admin</th>
                <th style={thCell}>Action</th>
                <th style={thCell}>Entity</th>
                <th style={thCell}>Reason</th>
              </tr>
            </thead>
            <tbody>
              {logs.map((l) => (
                <tr key={l.id}>
                  <td style={tdCell}>{new Date(l.created_at).toLocaleString('en-NG')}</td>
                  <td style={tdCell} title={l.admin_id}>{l.admin_id.slice(0, 12)}…</td>
                  <td style={tdCell}><code>{l.action}</code></td>
                  <td style={tdCell}>{l.entity_type}{l.entity_id ? ` · ${l.entity_id.slice(0, 8)}` : ''}</td>
                  <td style={tdCell}>{l.reason || '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Card>
    </Page>
  );
}
