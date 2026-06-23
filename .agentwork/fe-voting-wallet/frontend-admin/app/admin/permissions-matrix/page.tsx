'use client';

import { useEffect, useMemo, useState } from 'react';
import type { Permission, PermissionMatrix } from '@/types/rbac';
import { assignPermissionToRole, getPermissionMatrix, listPermissions, removePermissionFromRole } from '@/services/rbacAdminService';

export default function AdminPermissionsMatrixPage() {
  const [matrix, setMatrix] = useState<PermissionMatrix | null>(null);
  const [permissions, setPermissions] = useState<Permission[]>([]);
  const [loading, setLoading] = useState(true);
  const [busyKey, setBusyKey] = useState('');
  const [query, setQuery] = useState('');

  const permissionIdBySlug = useMemo(() => {
    const m = new Map<string, string>();
    for (const p of permissions) m.set(p.slug, p.id);
    return m;
  }, [permissions]);

  const filteredSlugs = useMemo(() => {
    const all = matrix?.permissionSlugs || [];
    const q = query.trim().toLowerCase();
    if (!q) return all;
    return all.filter((s) => s.toLowerCase().includes(q));
  }, [matrix, query]);

  const load = async () => {
    setLoading(true);
    const [m, perms] = await Promise.all([getPermissionMatrix(), listPermissions()]);
    setMatrix(m);
    setPermissions(perms);
    setLoading(false);
  };

  useEffect(() => {
    void load();
  }, []);

  const toggle = async (roleId: string, slug: string, enabled: boolean) => {
    const permissionId = permissionIdBySlug.get(slug);
    if (!permissionId) return;
    const k = `${roleId}:${slug}`;
    setBusyKey(k);
    if (enabled) {
      await removePermissionFromRole(roleId, permissionId);
    } else {
      await assignPermissionToRole(roleId, permissionId);
    }
    setBusyKey('');
    await load();
  };

  const bulkSetForRole = async (roleId: string, enable: boolean) => {
    if (!matrix) return;
    for (const slug of filteredSlugs) {
      const permissionId = permissionIdBySlug.get(slug);
      if (!permissionId) continue;
      const row = matrix.rows.find((r) => r.roleId === roleId);
      const current = Boolean(row?.permissions?.[slug]);
      if (enable && !current) await assignPermissionToRole(roleId, permissionId);
      if (!enable && current) await removePermissionFromRole(roleId, permissionId);
    }
    await load();
  };

  const bulkSetForPermission = async (slug: string, enable: boolean) => {
    if (!matrix) return;
    const permissionId = permissionIdBySlug.get(slug);
    if (!permissionId) return;
    for (const row of matrix.rows) {
      const current = Boolean(row.permissions?.[slug]);
      if (enable && !current) await assignPermissionToRole(row.roleId, permissionId);
      if (!enable && current) await removePermissionFromRole(row.roleId, permissionId);
    }
    await load();
  };

  return (
    <div>
      <h1>Permission Matrix</h1>
      <p>Assign and remove permissions by role with live matrix controls.</p>
      <div style={{ marginTop: 10 }}>
        <input placeholder="search permission slug" value={query} onChange={(e) => setQuery(e.target.value)} />
      </div>
      {loading ? <p>Loading...</p> : null}
      {!matrix ? null : (
        <div style={{ overflowX: 'auto', marginTop: 12 }}>
          <table style={{ borderCollapse: 'collapse', minWidth: 900 }}>
            <thead>
              <tr>
                <th style={{ textAlign: 'left', borderBottom: '1px solid #2a2a2a', padding: 8 }}>Role</th>
                {filteredSlugs.map((slug) => (
                  <th key={slug} style={{ textAlign: 'left', borderBottom: '1px solid #2a2a2a', padding: 8, fontSize: 12 }}>
                    <div>{slug}</div>
                    <div style={{ display: 'flex', gap: 6, marginTop: 4 }}>
                      <button onClick={() => void bulkSetForPermission(slug, true)}>All+</button>
                      <button onClick={() => void bulkSetForPermission(slug, false)}>All-</button>
                    </div>
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {matrix.rows.map((row) => (
                <tr key={row.roleId}>
                  <td style={{ borderBottom: '1px solid #2a2a2a', padding: 8, fontWeight: 600 }}>
                    <div>{row.roleName}</div>
                    <div style={{ display: 'flex', gap: 6, marginTop: 4 }}>
                      <button onClick={() => void bulkSetForRole(row.roleId, true)}>Row+</button>
                      <button onClick={() => void bulkSetForRole(row.roleId, false)}>Row-</button>
                    </div>
                  </td>
                  {filteredSlugs.map((slug) => {
                    const enabled = Boolean(row.permissions?.[slug]);
                    const key = `${row.roleId}:${slug}`;
                    return (
                      <td key={slug} style={{ borderBottom: '1px solid #2a2a2a', padding: 8 }}>
                        <input
                          type="checkbox"
                          checked={enabled}
                          disabled={busyKey === key}
                          onChange={() => void toggle(row.roleId, slug, enabled)}
                        />
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
