'use client';

import { useEffect, useState } from 'react';
import { getAudit } from '@/services/connectAdminService';
import type { ConnectAuditEntry } from '@/types/connectAdmin';
import { ConnectTabs, timeAgo } from '../_ui';
import { Page, PageHeader, Card, Button, colors, thCell, tdCell } from '@/components/ui/vuexy';

export default function ConnectAuditPage() {
  const [rows, setRows] = useState<ConnectAuditEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  async function load() {
    setLoading(true); setError(null);
    try { setRows(await getAudit()); }
    catch (e) { setError(String(e)); }
    finally { setLoading(false); }
  }
  useEffect(() => { load(); }, []);

  return (
    <Page>
      <PageHeader title="Audit log" subtitle="Immutable record of Connect admin & sensitive actions." actions={<Button variant="outline" sm onClick={load}>Refresh</Button>} />
      <ConnectTabs active="audit" />
      {error && <p style={{ color: colors.danger }}>{error}</p>}

      <Card style={{ padding: 0, overflow: 'auto' }}>
        {loading ? <p style={{ color: colors.muted, padding: 14 }}>Loading audit log…</p> : rows.length === 0 ? (
          <p style={{ color: colors.muted, padding: 14 }}>No audit entries.</p>
        ) : (
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead><tr><th style={thCell}>Action</th><th style={thCell}>Actor</th><th style={thCell}>Entity</th><th style={thCell}>When</th></tr></thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.id}>
                  <td style={tdCell}><code style={{ fontSize: '0.8rem' }}>{r.action}</code></td>
                  <td style={tdCell}>{r.actor_id ?? 'system'}{r.actor_role ? ` (${r.actor_role})` : ''}</td>
                  <td style={tdCell}>{r.entity_type ? `${r.entity_type}:${r.entity_id ?? ''}` : '—'}</td>
                  <td style={tdCell}>{timeAgo(r.created_at)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Card>
    </Page>
  );
}
