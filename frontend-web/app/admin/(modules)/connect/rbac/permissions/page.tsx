'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { listConnectPermissions, listConnectRoles, type ConnectPermission, type ConnectRole } from '@/services/connectAdminOpsService';
import { PageHeader, Card, btn, th, td } from '../../_ui';
import { Page, colors } from '@/components/ui/vuexy';

export default function ConnectPermissionsPage() {
  const [perms, setPerms] = useState<ConnectPermission[]>([]);
  const [roles, setRoles] = useState<ConnectRole[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  async function load() {
    setLoading(true); setError(null);
    try { const [p, r] = await Promise.all([listConnectPermissions(), listConnectRoles()]); setPerms(p); setRoles(r); }
    catch (e) { setError(String(e)); }
    finally { setLoading(false); }
  }
  useEffect(() => { load(); }, []);

  return (
    <Page>
      <Link href="/admin/connect/rbac" style={{ color: colors.info, textDecoration: 'none', fontSize: '0.85rem' }}>← RBAC</Link>
      <div style={{ height: 8 }} />
      <PageHeader title="Permission matrix" subtitle="Read-only display of the connect.* permission slugs mapped to roles." action={<button onClick={load} style={btn()}>Refresh</button>} />
      {error && <p style={{ color: colors.danger }}>{error}</p>}

      <Card>
        {loading ? <p style={{ color: colors.muted }}>Loading matrix…</p> : perms.length === 0 ? (
          <p style={{ color: colors.muted }}>No permissions defined.</p>
        ) : (
          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: 720 }}>
              <thead>
                <tr>
                  <th style={th()}>Permission</th>
                  {roles.map((r) => <th key={r.id} style={{ ...th(), textAlign: 'center' }}>{r.name}</th>)}
                </tr>
              </thead>
              <tbody>
                {perms.map((p) => (
                  <tr key={p.slug}>
                    <td style={td()}><code style={{ fontSize: '0.78rem' }}>{p.slug}</code><div style={{ color: colors.muted, fontSize: '0.72rem' }}>{p.description}</div></td>
                    {roles.map((r) => (
                      <td key={r.id} style={{ ...td(), textAlign: 'center' }}>
                        {p.roles.includes(r.slug) ? <span style={{ color: colors.success, fontWeight: 700 }}>✓</span> : <span style={{ color: colors.inputBorder }}>—</span>}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>
    </Page>
  );
}
