'use client';

import { useEffect, useMemo, useState } from 'react';
import type { Permission, PermissionMatrix } from '@/types/rbac';
import { assignPermissionToRole, getPermissionMatrix, listPermissions, removePermissionFromRole } from '@/services/rbacAdminService';
import {
  useToasts,
  ToastStack,
  ConfirmDialog,
  isCriticalPermissionSlug,
  evaluateAssignment,
  detectBulkConflicts,
  readCurrentAdmin,
  isSuperAdmin,
} from '@/components/rbac';
import { Page, PageHeader, Card, Button, Input, colors, thCell, tdCell } from '@/components/ui/vuexy';

type MatrixRow = PermissionMatrix['rows'][number];

type PendingAction =
  | { kind: 'toggle'; roleId: string; roleName: string; roleSlug: string; slug: string; reasons: string[]; level: 'critical' | 'warning' }
  | { kind: 'bulkRole'; roleId: string; roleName: string; roleSlug: string; slugs: string[]; reasons: string[]; level: 'critical' | 'warning' }
  | { kind: 'bulkPermission'; slug: string; reasons: string[]; level: 'critical' | 'warning' };

export default function AdminPermissionsMatrixPage() {
  const [matrix, setMatrix] = useState<PermissionMatrix | null>(null);
  const [permissions, setPermissions] = useState<Permission[]>([]);
  const [loading, setLoading] = useState(true);
  const [errored, setErrored] = useState(false);
  const [busyKey, setBusyKey] = useState('');
  const [query, setQuery] = useState('');
  const [pending, setPending] = useState<PendingAction | null>(null);
  const { toasts, toast, dismiss } = useToasts();

  const superAdmin = useMemo(() => isSuperAdmin(readCurrentAdmin()), []);

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
    setErrored(false);
    try {
      const [m, perms] = await Promise.all([getPermissionMatrix(), listPermissions()]);
      if (!m) {
        setErrored(true);
        toast.error('Failed to load the permission matrix.');
      }
      setMatrix(m);
      setPermissions(perms);
    } catch {
      setErrored(true);
      toast.error('Failed to load the permission matrix.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /* ── Low-level mutators ───────────────────────────────────────────────────── */

  const doAssign = async (roleId: string, permissionId: string): Promise<boolean> => {
    try {
      return await assignPermissionToRole(roleId, permissionId);
    } catch {
      return false;
    }
  };
  const doRemove = async (roleId: string, permissionId: string): Promise<boolean> => {
    try {
      return await removePermissionFromRole(roleId, permissionId);
    } catch {
      return false;
    }
  };

  /* ── Single toggle ────────────────────────────────────────────────────────── */

  const performToggle = async (roleId: string, slug: string, enabled: boolean) => {
    const permissionId = permissionIdBySlug.get(slug);
    if (!permissionId) {
      toast.error(`No permission id found for "${slug}".`);
      return;
    }
    const k = `${roleId}:${slug}`;
    setBusyKey(k);
    const ok = enabled ? await doRemove(roleId, permissionId) : await doAssign(roleId, permissionId);
    setBusyKey('');
    if (!ok) {
      toast.error(`${enabled ? 'Removing' : 'Assigning'} "${slug}" failed. The backend may have denied it.`);
      return;
    }
    toast.success(`${enabled ? 'Removed' : 'Assigned'} "${slug}".`);
    await load();
  };

  const onToggle = (row: MatrixRow, slug: string, enabled: boolean) => {
    // Only guard when ENABLING (granting). Removing never needs a warning.
    if (enabled) {
      void performToggle(row.roleId, slug, enabled);
      return;
    }
    const warning = evaluateAssignment({ permissionSlug: slug, roleSlug: row.roleSlug, roleName: row.roleName });
    if (warning) {
      // Critical grants to a non-super-admin role are blocked unless the operator is a super-admin.
      if (warning.level === 'critical' && !superAdmin) {
        toast.error(`Only a super-admin can grant the critical permission "${slug}".`);
        return;
      }
      setPending({ kind: 'toggle', roleId: row.roleId, roleName: row.roleName, roleSlug: row.roleSlug, slug, reasons: [warning.reason], level: warning.level });
      return;
    }
    void performToggle(row.roleId, slug, false);
  };

  /* ── Bulk per-role ────────────────────────────────────────────────────────── */

  const performBulkRole = async (roleId: string, slugs: string[]) => {
    if (!matrix) return;
    setBusyKey(`role:${roleId}`);
    let failures = 0;
    let applied = 0;
    const row = matrix.rows.find((r) => r.roleId === roleId);
    for (const slug of slugs) {
      const permissionId = permissionIdBySlug.get(slug);
      if (!permissionId) continue;
      const current = Boolean(row?.permissions?.[slug]);
      if (current) continue;
      const ok = await doAssign(roleId, permissionId);
      if (ok) applied += 1; else failures += 1;
    }
    setBusyKey('');
    await load();
    if (failures > 0) toast.error(`${failures} of ${slugs.length} assignments failed (likely backend-denied).`);
    if (applied > 0) toast.success(`Granted ${applied} permission${applied === 1 ? '' : 's'} to the role.`);
  };

  const onBulkRoleGrant = (row: MatrixRow) => {
    const slugs = filteredSlugs.filter((s) => !row.permissions?.[s]);
    if (slugs.length === 0) {
      toast.info('Nothing to grant — all visible permissions are already assigned.');
      return;
    }
    const criticalSlugs = slugs.filter(isCriticalPermissionSlug);
    if (criticalSlugs.length > 0 && !superAdmin) {
      toast.error(`Only a super-admin can bulk-grant critical permissions (${criticalSlugs.join(', ')}).`);
      return;
    }
    const reasons = detectBulkConflicts(slugs);
    if (criticalSlugs.length > 0) reasons.unshift(`Includes ${criticalSlugs.length} critical permission(s): ${criticalSlugs.join(', ')}.`);
    if (reasons.length > 0) {
      setPending({ kind: 'bulkRole', roleId: row.roleId, roleName: row.roleName, roleSlug: row.roleSlug, slugs, reasons, level: criticalSlugs.length > 0 ? 'critical' : 'warning' });
      return;
    }
    void performBulkRole(row.roleId, slugs);
  };

  const performBulkRoleRemove = async (row: MatrixRow) => {
    if (!matrix) return;
    setBusyKey(`role:${row.roleId}`);
    let failures = 0;
    for (const slug of filteredSlugs) {
      const permissionId = permissionIdBySlug.get(slug);
      if (!permissionId) continue;
      if (!row.permissions?.[slug]) continue;
      const ok = await doRemove(row.roleId, permissionId);
      if (!ok) failures += 1;
    }
    setBusyKey('');
    await load();
    if (failures > 0) toast.error(`${failures} removals failed (likely backend-denied).`);
    else toast.success('Removed visible permissions from the role.');
  };

  /* ── Bulk per-permission (column) ─────────────────────────────────────────── */

  const performBulkPermission = async (slug: string, enable: boolean) => {
    if (!matrix) return;
    const permissionId = permissionIdBySlug.get(slug);
    if (!permissionId) return;
    setBusyKey(`perm:${slug}`);
    let failures = 0;
    for (const row of matrix.rows) {
      const current = Boolean(row.permissions?.[slug]);
      if (enable && !current) { if (!(await doAssign(row.roleId, permissionId))) failures += 1; }
      if (!enable && current) { if (!(await doRemove(row.roleId, permissionId))) failures += 1; }
    }
    setBusyKey('');
    await load();
    if (failures > 0) toast.error(`${failures} ${enable ? 'assignments' : 'removals'} failed (likely backend-denied).`);
    else toast.success(`${enable ? 'Granted' : 'Removed'} "${slug}" across all roles.`);
  };

  const onBulkPermissionGrant = (slug: string) => {
    if (isCriticalPermissionSlug(slug)) {
      if (!superAdmin) {
        toast.error(`Only a super-admin can grant the critical permission "${slug}" to every role.`);
        return;
      }
      setPending({
        kind: 'bulkPermission',
        slug,
        level: 'critical',
        reasons: [`You are about to grant the critical permission "${slug}" to EVERY role. This is a high-blast-radius change.`],
      });
      return;
    }
    void performBulkPermission(slug, true);
  };

  const confirmPending = () => {
    const action = pending;
    setPending(null);
    if (!action) return;
    if (action.kind === 'toggle') void performToggle(action.roleId, action.slug, false);
    else if (action.kind === 'bulkRole') void performBulkRole(action.roleId, action.slugs);
    else if (action.kind === 'bulkPermission') void performBulkPermission(action.slug, true);
  };

  return (
    <Page>
      <ToastStack toasts={toasts} onDismiss={dismiss} />
      <ConfirmDialog
        open={Boolean(pending)}
        level={pending?.level ?? 'warning'}
        title="Confirm permission change"
        reasons={pending?.reasons ?? []}
        confirmLabel="Apply anyway"
        onConfirm={confirmPending}
        onCancel={() => setPending(null)}
      />

      <PageHeader
        title="Permission Matrix"
        subtitle="Assign and remove permissions by role with live matrix controls. Critical and conflicting changes prompt for confirmation."
      />

      {!superAdmin ? (
        <p style={{ color: colors.warning, fontSize: 12, margin: '0 0 12px' }}>
          You are not a super-admin. Critical-permission grants are disabled in this view (the backend also enforces this).
        </p>
      ) : null}

      <div style={{ marginBottom: 12, maxWidth: 460 }}>
        <Input placeholder="Search permission slug" value={query} onChange={(e) => setQuery(e.target.value)} />
      </div>

      {loading ? <p style={{ color: colors.muted }}>Loading…</p> : null}
      {errored && !loading ? <p><Button variant="outline" sm onClick={() => void load()}>Retry</Button> <span style={{ color: colors.danger }}>— failed to load matrix.</span></p> : null}
      {!loading && !errored && matrix && matrix.rows.length === 0 ? <p style={{ color: colors.muted }}>No roles to display.</p> : null}

      {!matrix ? null : (
        <Card style={{ padding: 0, overflow: 'auto' }}>
          <table style={{ borderCollapse: 'collapse', minWidth: 900, width: '100%' }}>
            <thead>
              <tr>
                <th style={thCell}>Role</th>
                {filteredSlugs.map((slug) => {
                  const critical = isCriticalPermissionSlug(slug);
                  return (
                    <th key={slug} style={{ ...thCell, fontSize: 12, textTransform: 'none', letterSpacing: 0 }}>
                      <div title={critical ? 'Critical permission' : undefined} style={{ color: critical ? colors.warning : undefined }}>
                        {critical ? '● ' : ''}{slug}
                      </div>
                      <div style={{ display: 'flex', gap: 6, marginTop: 4 }}>
                        <Button variant="outline" sm onClick={() => onBulkPermissionGrant(slug)} disabled={busyKey === `perm:${slug}`}>All+</Button>
                        <Button variant="outline" sm onClick={() => void performBulkPermission(slug, false)} disabled={busyKey === `perm:${slug}`}>All-</Button>
                      </div>
                    </th>
                  );
                })}
              </tr>
            </thead>
            <tbody>
              {matrix.rows.map((row) => (
                <tr key={row.roleId}>
                  <td style={{ ...tdCell, fontWeight: 600 }}>
                    <div>{row.roleName}</div>
                    <div style={{ display: 'flex', gap: 6, marginTop: 4 }}>
                      <Button variant="outline" sm onClick={() => onBulkRoleGrant(row)} disabled={busyKey === `role:${row.roleId}`}>Row+</Button>
                      <Button variant="outline" sm onClick={() => void performBulkRoleRemove(row)} disabled={busyKey === `role:${row.roleId}`}>Row-</Button>
                    </div>
                  </td>
                  {filteredSlugs.map((slug) => {
                    const enabled = Boolean(row.permissions?.[slug]);
                    const key = `${row.roleId}:${slug}`;
                    return (
                      <td key={slug} style={{ ...tdCell, textAlign: 'center' }}>
                        <input
                          type="checkbox"
                          aria-label={`${enabled ? 'Remove' : 'Assign'} ${slug} for ${row.roleName}`}
                          checked={enabled}
                          disabled={busyKey === key || busyKey === `role:${row.roleId}` || busyKey === `perm:${slug}`}
                          onChange={() => onToggle(row, slug, enabled)}
                        />
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </Card>
      )}
    </Page>
  );
}
