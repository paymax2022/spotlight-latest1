'use client';

import { useEffect, useState } from 'react';
import { getAudit } from '@/services/connectAdminService';
import type { ConnectAuditEntry } from '@/types/connectAdmin';
import { PageHeader, ConnectTabs, Card, btn, th, td, timeAgo } from '../_ui';

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
    <div style={{ padding: '0.5rem 0.5rem 2rem' }}>
      <PageHeader title="Audit log" subtitle="Immutable record of Connect admin & sensitive actions." action={<button onClick={load} style={btn()}>Refresh</button>} />
      <ConnectTabs active="audit" />
      {error && <p style={{ color: '#dc2626' }}>{error}</p>}

      <Card>
        {loading ? <p style={{ color: '#6b7280' }}>Loading audit log…</p> : rows.length === 0 ? (
          <p style={{ color: '#6b7280' }}>No audit entries.</p>
        ) : (
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead><tr><th style={th()}>Action</th><th style={th()}>Actor</th><th style={th()}>Entity</th><th style={th()}>When</th></tr></thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.id}>
                  <td style={td()}><code style={{ fontSize: '0.8rem' }}>{r.action}</code></td>
                  <td style={td()}>{r.actor_id ?? 'system'}{r.actor_role ? ` (${r.actor_role})` : ''}</td>
                  <td style={td()}>{r.entity_type ? `${r.entity_type}:${r.entity_id ?? ''}` : '—'}</td>
                  <td style={td()}>{timeAgo(r.created_at)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Card>
    </div>
  );
}
