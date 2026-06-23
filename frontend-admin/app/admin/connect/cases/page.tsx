'use client';

import { useEffect, useState } from 'react';
import { getCases } from '@/services/connectAdminService';
import type { ConnectCase } from '@/types/connectAdmin';
import { PageHeader, ConnectTabs, Card, Badge, btn, th, td, timeAgo } from '../_ui';

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
    <div style={{ padding: '0.5rem 0.5rem 2rem' }}>
      <PageHeader title="Safety cases" subtitle="Reports open a case automatically. Read-only in Phase 0; triage actions arrive with the moderation queue." action={<button onClick={load} style={btn()}>Refresh</button>} />
      <ConnectTabs active="cases" />
      {error && <p style={{ color: '#dc2626' }}>{error}</p>}

      <Card>
        {loading ? <p style={{ color: '#6b7280' }}>Loading cases…</p> : rows.length === 0 ? (
          <p style={{ color: '#6b7280' }}>No safety cases.</p>
        ) : (
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead><tr><th style={th()}>Type</th><th style={th()}>Severity</th><th style={th()}>Status</th><th style={th()}>Source</th><th style={th()}>Opened</th><th style={th()}>Notes</th></tr></thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.id}>
                  <td style={td()}><strong style={{ textTransform: 'capitalize' }}>{r.type.replace(/_/g, ' ')}</strong></td>
                  <td style={td()}><Badge status={r.severity} /></td>
                  <td style={td()}><Badge status={r.status} /></td>
                  <td style={td()}>{r.source_ref ?? '—'}</td>
                  <td style={td()}>{timeAgo(r.created_at)}</td>
                  <td style={td()}>{r.notes ?? <span style={{ color: '#9ca3af' }}>—</span>}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Card>
    </div>
  );
}
