'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { listConnectRoles, type ConnectRole } from '@/services/connectAdminOpsService';
import { PageHeader, Card, btn, th, td } from '../../_ui';

export default function ConnectRolesPage() {
  const [rows, setRows] = useState<ConnectRole[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  async function load() {
    setLoading(true); setError(null);
    try { setRows(await listConnectRoles()); }
    catch (e) { setError(String(e)); }
    finally { setLoading(false); }
  }
  useEffect(() => { load(); }, []);

  return (
    <div style={{ padding: '0.5rem 0.5rem 2rem' }}>
      <Link href="/admin/connect/rbac" style={{ color: '#1d4ed8', textDecoration: 'none', fontSize: '0.85rem' }}>← RBAC</Link>
      <div style={{ height: 8 }} />
      <PageHeader title="Roles & scopes" subtitle="All Connect roles and their scope. Role/permission edits are audited." action={<button onClick={load} style={btn()}>Refresh</button>} />
      {error && <p style={{ color: '#dc2626' }}>{error}</p>}

      <Card>
        {loading ? <p style={{ color: '#6b7280' }}>Loading roles…</p> : rows.length === 0 ? (
          <p style={{ color: '#6b7280' }}>No roles defined.</p>
        ) : (
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead><tr><th style={th()}>Role</th><th style={th()}>Slug</th><th style={th()}>Description</th><th style={th()}>Type</th><th style={th()}>Admins</th></tr></thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.id}>
                  <td style={td()}><strong>{r.name}</strong></td>
                  <td style={td()}><code style={{ fontSize: '0.78rem' }}>{r.slug}</code></td>
                  <td style={td()}>{r.description}</td>
                  <td style={td()}>{r.is_system ? 'System' : 'Custom'}</td>
                  <td style={td()}>{r.admin_count}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Card>
    </div>
  );
}
