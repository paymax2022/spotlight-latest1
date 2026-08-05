'use client';

import { useEffect, useState } from 'react';
import { getCases } from '@/services/connectAdminService';
import type { ConnectCase } from '@/types/connectAdmin';
import { ConnectTabs, timeAgo } from '../_ui';
import { Page, PageHeader, Card, Button, Badge, colors, thCell, tdCell } from '@/components/ui/vuexy';

function severityColor(sev: string): string {
  if (sev === 'critical') return colors.danger;
  if (sev === 'high') return colors.warning;
  return colors.info;
}

function statusColor(status: string): string {
  if (status === 'resolved') return colors.success;
  if (status === 'closed') return colors.secondary;
  if (status === 'investigating') return colors.info;
  return colors.warning;
}

export default function ConnectCasesPage() {
  const [rows, setRows] = useState<ConnectCase[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  async function load() {
    setLoading(true); setError(null);
    try { setRows(await getCases()); }
    catch (e) { setError(String(e)); }
    finally { setLoading(false); }
  }
  useEffect(() => { load(); }, []);

  return (
    <Page>
      <PageHeader title="Safety cases" subtitle="Reports open a case automatically. Read-only in Phase 0; triage actions arrive with the moderation queue." actions={<Button variant="outline" sm onClick={load}>Refresh</Button>} />
      <ConnectTabs active="cases" />
      {error && <p style={{ color: colors.danger }}>{error}</p>}

      <Card style={{ padding: 0, overflow: 'auto' }}>
        {loading ? <p style={{ color: colors.muted, padding: 14 }}>Loading cases…</p> : rows.length === 0 ? (
          <p style={{ color: colors.muted, padding: 14 }}>No safety cases.</p>
        ) : (
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead><tr><th style={thCell}>Type</th><th style={thCell}>Severity</th><th style={thCell}>Status</th><th style={thCell}>Source</th><th style={thCell}>Opened</th><th style={thCell}>Notes</th></tr></thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.id}>
                  <td style={tdCell}><strong style={{ textTransform: 'capitalize' }}>{r.type.replace(/_/g, ' ')}</strong></td>
                  <td style={tdCell}><Badge text={r.severity} color={severityColor(r.severity)} /></td>
                  <td style={tdCell}><Badge text={r.status} color={statusColor(r.status)} /></td>
                  <td style={tdCell}>{r.source_ref ?? '—'}</td>
                  <td style={tdCell}>{timeAgo(r.created_at)}</td>
                  <td style={tdCell}>{r.notes ?? <span style={{ color: colors.muted }}>—</span>}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Card>
    </Page>
  );
}
