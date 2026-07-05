'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { getConnectRbac, type ConnectRbac } from '@/services/connectAdminOpsService';
import { PageHeader, Card, Badge, btn, th, td, timeAgo } from '../_ui';

export default function ConnectRbacPage() {
  const [data, setData] = useState<ConnectRbac | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  async function load() {
    setLoading(true); setError(null);
    try { setData(await getConnectRbac()); }
    catch (e) { setError(String(e)); }
    finally { setLoading(false); }
  }
  useEffect(() => { load(); }, []);

  return (
    <div style={{ padding: '0.5rem 0.5rem 2rem' }}>
      <PageHeader
        title="RBAC & admin management"
        subtitle="Connect roles, the connect.* permission matrix and admin assignments. Every admin action is audited."
        action={<button onClick={load} style={btn()}>Refresh</button>}
      />
      <div style={{ display: 'flex', gap: '0.4rem', marginBottom: '1.25rem' }}>
        <Link href="/admin/connect/rbac/roles" style={btn()}>Roles & scopes →</Link>
        <Link href="/admin/connect/rbac/permissions" style={btn()}>Permission matrix →</Link>
      </div>
      {error && <p style={{ color: '#dc2626' }}>{error}</p>}

      {loading ? (
        <Card><p style={{ color: '#6b7280' }}>Loading RBAC…</p></Card>
      ) : !data ? (
        <Card><p style={{ color: '#6b7280' }}>No RBAC data.</p></Card>
      ) : (
        <>
          <Card title={`Admin users (${data.admins.length})`}>
            {data.admins.length === 0 ? (
              <p style={{ color: '#6b7280' }}>No admins assigned.</p>
            ) : (
              <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                <thead><tr><th style={th()}>Admin</th><th style={th()}>Roles</th><th style={th()}>MFA</th><th style={th()}>Status</th><th style={th()}>Last active</th></tr></thead>
                <tbody>
                  {data.admins.map((a) => (
                    <tr key={a.id}>
                      <td style={td()}><strong>{a.name}</strong><div style={{ color: '#6b7280', fontSize: '0.78rem' }}>{a.email}</div></td>
                      <td style={td()}>{a.roles.map((r) => r.replace('connect.role.', '')).join(', ')}</td>
                      <td style={td()}>{a.mfa_enabled ? <span style={{ color: '#16a34a' }}>Enabled</span> : <span style={{ color: '#d97706' }}>Off</span>}</td>
                      <td style={td()}><Badge status={a.status === 'active' ? 'resolved' : 'high'} label={a.status} /></td>
                      <td style={td()}>{timeAgo(a.last_active_at)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </Card>
          <Card title={`Roles (${data.roles.length})`}>
            <table style={{ width: '100%', borderCollapse: 'collapse' }}>
              <thead><tr><th style={th()}>Role</th><th style={th()}>Slug</th><th style={th()}>Scope</th><th style={th()}>Admins</th></tr></thead>
              <tbody>
                {data.roles.map((r) => (
                  <tr key={r.id}>
                    <td style={td()}><strong>{r.name}</strong>{r.is_system ? <span style={{ marginLeft: 6, color: '#6b7280', fontSize: '0.72rem' }}>system</span> : null}</td>
                    <td style={td()}><code style={{ fontSize: '0.78rem' }}>{r.slug}</code></td>
                    <td style={td()}>{r.description}</td>
                    <td style={td()}>{r.admin_count}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </Card>
        </>
      )}
    </div>
  );
}
