'use client';

import { useEffect, useState } from 'react';
import { listAudit } from '@/services/investAdminService';
import type { AuditEntry } from '@/types/investAdmin';
import { PageHeader, InvestTabs, Card, btn, th, td } from '../_ui';

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
    <div style={{ padding: '0.5rem 0.5rem 2rem' }}>
      <PageHeader
        title="Audit log"
        subtitle="Every sensitive admin action is recorded immutably with actor, entity and reason."
        action={<button onClick={load} style={btn()}>Refresh</button>}
      />
      <InvestTabs />

      {error && <p style={{ color: '#dc2626' }}>{error}</p>}
      <Card>
        {loading ? (
          <p style={{ color: '#6b7280' }}>Loading audit log…</p>
        ) : logs.length === 0 ? (
          <p style={{ color: '#6b7280' }}>No audit entries yet.</p>
        ) : (
          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.85rem' }}>
              <thead>
                <tr>
                  <th style={th()}>When</th>
                  <th style={th()}>Admin</th>
                  <th style={th()}>Action</th>
                  <th style={th()}>Entity</th>
                  <th style={th()}>Reason</th>
                </tr>
              </thead>
              <tbody>
                {logs.map((l) => (
                  <tr key={l.id}>
                    <td style={td()}>{new Date(l.created_at).toLocaleString('en-NG')}</td>
                    <td style={td()} title={l.admin_id}>{l.admin_id.slice(0, 12)}…</td>
                    <td style={td()}><code>{l.action}</code></td>
                    <td style={td()}>{l.entity_type}{l.entity_id ? ` · ${l.entity_id.slice(0, 8)}` : ''}</td>
                    <td style={td()}>{l.reason || '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>
    </div>
  );
}
