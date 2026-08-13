'use client';

import { useEffect, useState } from 'react';
import { listUsers } from '@/services/staysAdminService';
import type { AdminUserRole } from '@/types/staysAdmin';
import {
  StaysTabs,
  Badge,
  DisclosureNote,
  StateBlock,
  FilterBar,
  label,
  select,
  timeAgo,
} from '../_ui';
import { Page, PageHeader, Card, Button, thCell, tdCell } from '@/components/ui/vuexy';

export default function StaysRbacPage() {
  const [rows, setRows] = useState<AdminUserRole[]>([]);
  const [status, setStatus] = useState('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  async function load() {
    setLoading(true); setError(null);
    try { setRows(await listUsers(status ? { status } : undefined)); }
    catch (e) { setError(String(e)); }
    finally { setLoading(false); }
  }
  useEffect(() => { load(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [status]);

  return (
    <Page>
      <PageHeader
        title="Users & roles"
        subtitle="Read-only view of admin users holding stays.admin.* grants — roles, permissions and last activity across the Paymax Stays ops console."
        actions={<Button variant="outline" onClick={load}>Refresh</Button>}
      />
      <StaysTabs active="platform" />

      <DisclosureNote>
        Role and permission assignment is governed by the central RBAC service — this page is a
        read-only view into the <code>stays.admin.*</code> grants. Changes must be made in the
        central RBAC console; they are audited and require approval.
      </DisclosureNote>

      <FilterBar>
        <div>
          <label style={label()}>Status</label>
          <select style={select()} value={status} onChange={(e) => setStatus(e.target.value)}>
            <option value="">All</option>
            <option value="active">Active</option>
            <option value="disabled">Disabled</option>
          </select>
        </div>
      </FilterBar>

      <Card>
        <StateBlock loading={loading} error={error} empty={rows.length === 0} emptyText="No admin users found.">
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead>
              <tr>
                <th style={thCell}>User</th>
                <th style={thCell}>Email</th>
                <th style={thCell}>Roles</th>
                <th style={thCell}>Permissions</th>
                <th style={thCell}>Last active</th>
                <th style={thCell}>Status</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((u) => (
                <tr key={u.id}>
                  <td style={tdCell}>{u.user_masked}</td>
                  <td style={tdCell}><code style={{ fontSize: '0.78rem' }}>{u.email_masked}</code></td>
                  <td style={tdCell}>
                    <div style={{ display: 'flex', gap: '0.3rem', flexWrap: 'wrap' }}>
                      {u.roles.length === 0 ? '—' : u.roles.map((r) => <Badge key={r} status={r} label={r} />)}
                    </div>
                  </td>
                  <td style={tdCell}>
                    <div style={{ display: 'flex', gap: '0.3rem', flexWrap: 'wrap', maxWidth: 360 }}>
                      {u.permissions.length === 0 ? '—' : u.permissions.map((p) => <Badge key={p} status={p} label={p} />)}
                    </div>
                  </td>
                  <td style={tdCell}>{timeAgo(u.last_active)}</td>
                  <td style={tdCell}><Badge status={u.status} /></td>
                </tr>
              ))}
            </tbody>
          </table>
        </StateBlock>
      </Card>
    </Page>
  );
}
