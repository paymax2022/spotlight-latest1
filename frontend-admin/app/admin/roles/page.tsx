'use client';

import { useEffect, useMemo, useState } from 'react';
import type { Role } from '@/types/rbac';
import { cloneRole, createRole, deleteRole, listRoles, updateRole } from '@/services/rbacAdminService';
import {
  useToasts,
  ToastStack,
  FilterChips,
  Pagination,
  usePagination,
  applySort,
  nextSort,
  SortHeaderButton,
  ConfirmDialog,
  type FilterChip,
  type SortState,
} from '@/components/rbac';
import { Page, PageHeader, Card, Button, Input, Badge, colors, tint, thCell, tdCell } from '@/components/ui/vuexy';

const PAGE_SIZE = 12;

type SortKey = 'name' | 'slug' | 'roleType' | 'isSystemRole';

export default function AdminRolesPage() {
  const [roles, setRoles] = useState<Role[]>([]);
  const [loading, setLoading] = useState(true);
  const [errored, setErrored] = useState(false);
  const [selected, setSelected] = useState<Role | null>(null);
  const [saving, setSaving] = useState(false);

  const [newRole, setNewRole] = useState({ name: '', slug: '', description: '', roleType: 'admin' });
  const [cloneInput, setCloneInput] = useState({ name: '', slug: '' });
  const [search, setSearch] = useState('');
  const [appliedSearch, setAppliedSearch] = useState('');
  const [sort, setSort] = useState<SortState<SortKey>>({ key: 'name', dir: 'asc' });
  const [page, setPage] = useState(1);
  const [pendingDelete, setPendingDelete] = useState<Role | null>(null);
  const { toasts, toast, dismiss } = useToasts();

  const load = async () => {
    setLoading(true);
    setErrored(false);
    try {
      setRoles(await listRoles());
    } catch {
      setErrored(true);
      setRoles([]);
      toast.error('Failed to load roles.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const filtered = useMemo(() => {
    const q = appliedSearch.trim().toLowerCase();
    if (!q) return roles;
    return roles.filter((r) => `${r.name} ${r.slug} ${r.roleType ?? ''}`.toLowerCase().includes(q));
  }, [roles, appliedSearch]);

  const sorted = useMemo(
    () => applySort(filtered, sort, (r, key) => (r as Record<string, unknown>)[key]),
    [filtered, sort],
  );
  const { slice, total, pageCount, safePage } = usePagination(sorted, PAGE_SIZE, page);
  const sortBy = (key: SortKey) => setSort((s) => nextSort(s, key));

  const chips: FilterChip[] = appliedSearch.trim() ? [{ key: 'search', label: 'Search', value: appliedSearch }] : [];
  const applySearch = () => { setAppliedSearch(search); setPage(1); };
  const clearSearch = () => { setSearch(''); setAppliedSearch(''); setPage(1); };

  const onCreate = async () => {
    if (!newRole.name.trim() || !newRole.slug.trim()) {
      toast.warning('Name and slug are required to create a role.');
      return;
    }
    setSaving(true);
    try {
      const created = await createRole(newRole);
      if (!created) {
        toast.error('Create failed. Check permission and unique role slug.');
        return;
      }
      toast.success('Role created successfully.');
      setNewRole({ name: '', slug: '', description: '', roleType: 'admin' });
      await load();
    } catch {
      toast.error('Create failed due to a network or server error.');
    } finally {
      setSaving(false);
    }
  };

  const onUpdate = async () => {
    if (!selected) return;
    setSaving(true);
    try {
      const updated = await updateRole(selected.id, {
        name: selected.name,
        description: selected.description,
        roleType: selected.roleType,
        isActive: selected.isActive,
      });
      if (!updated) {
        toast.error('Update failed. System role updates may be blocked.');
        return;
      }
      toast.success('Role updated successfully.');
      await load();
    } catch {
      toast.error('Update failed due to a network or server error.');
    } finally {
      setSaving(false);
    }
  };

  const onClone = async () => {
    if (!selected || !cloneInput.name.trim() || !cloneInput.slug.trim()) {
      toast.warning('Clone name and slug are required.');
      return;
    }
    setSaving(true);
    try {
      const cloned = await cloneRole(selected.id, cloneInput.name, cloneInput.slug);
      if (!cloned) {
        toast.error('Clone failed. Check clone slug uniqueness.');
        return;
      }
      toast.success('Role cloned successfully.');
      setCloneInput({ name: '', slug: '' });
      await load();
    } catch {
      toast.error('Clone failed due to a network or server error.');
    } finally {
      setSaving(false);
    }
  };

  const confirmDelete = async () => {
    const role = pendingDelete;
    setPendingDelete(null);
    if (!role) return;
    setSaving(true);
    try {
      const ok = await deleteRole(role.id);
      if (!ok) {
        toast.error('Delete failed. System role deletion is blocked.');
        return;
      }
      toast.success('Role deleted successfully.');
      if (selected?.id === role.id) setSelected(null);
      await load();
    } catch {
      toast.error('Delete failed due to a network or server error.');
    } finally {
      setSaving(false);
    }
  };

  return (
    <Page>
      <ToastStack toasts={toasts} onDismiss={dismiss} />
      <ConfirmDialog
        open={Boolean(pendingDelete)}
        level="critical"
        title="Delete role?"
        reasons={pendingDelete ? [`Role "${pendingDelete.name}" will be permanently deleted. Users currently assigned to it will lose its permissions.`] : []}
        confirmLabel="Delete role"
        onConfirm={() => void confirmDelete()}
        onCancel={() => setPendingDelete(null)}
      />

      <PageHeader
        title="Role Management"
        subtitle="Create, edit, clone, and delete roles. System roles are protected by backend policy."
      />

      <Card title="Create Role" style={{ marginBottom: 16 }}>
        <div style={{ display: 'grid', gap: 10, gridTemplateColumns: 'repeat(4,minmax(0,1fr))', marginTop: 14 }}>
          <Input placeholder="Name" value={newRole.name} onChange={(e) => setNewRole((v) => ({ ...v, name: e.target.value }))} />
          <Input placeholder="Slug" value={newRole.slug} onChange={(e) => setNewRole((v) => ({ ...v, slug: e.target.value }))} />
          <Input placeholder="Role type" value={newRole.roleType} onChange={(e) => setNewRole((v) => ({ ...v, roleType: e.target.value }))} />
          <Input placeholder="Description" value={newRole.description} onChange={(e) => setNewRole((v) => ({ ...v, description: e.target.value }))} />
        </div>
        <Button variant="primary" style={{ marginTop: 14 }} onClick={() => void onCreate()} disabled={saving}>{saving ? 'Saving…' : 'Create Role'}</Button>
      </Card>

      <div style={{ display: 'flex', gap: 10, marginBottom: 10, maxWidth: 460 }}>
        <Input placeholder="Filter roles" value={search} onChange={(e) => setSearch(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') applySearch(); }} />
        <Button variant="outline" style={{ whiteSpace: 'nowrap' }} onClick={applySearch}>Filter</Button>
      </div>
      <FilterChips chips={chips} onClear={clearSearch} />

      <div style={{ display: 'grid', gridTemplateColumns: '1.4fr 1fr', gap: 16, marginTop: 16, alignItems: 'start' }}>
        <Card style={{ padding: 0, overflow: 'hidden' }}>
          <table style={{ borderCollapse: 'collapse', width: '100%' }}>
            <thead>
              <tr>
                <th style={thCell}><SortHeaderButton label="Name" active={sort?.key === 'name'} dir={sort?.dir ?? 'asc'} onClick={() => sortBy('name')} /></th>
                <th style={thCell}><SortHeaderButton label="Slug" active={sort?.key === 'slug'} dir={sort?.dir ?? 'asc'} onClick={() => sortBy('slug')} /></th>
                <th style={thCell}><SortHeaderButton label="Type" active={sort?.key === 'roleType'} dir={sort?.dir ?? 'asc'} onClick={() => sortBy('roleType')} /></th>
                <th style={thCell}>Actions</th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr><td style={{ ...tdCell, color: colors.muted }} colSpan={4}>Loading…</td></tr>
              ) : errored ? (
                <tr><td style={tdCell} colSpan={4}><Button variant="outline" sm onClick={() => void load()}>Retry</Button> <span style={{ color: colors.danger }}>— failed to load.</span></td></tr>
              ) : slice.length === 0 ? (
                <tr><td style={{ ...tdCell, color: colors.muted }} colSpan={4}>No roles to display.</td></tr>
              ) : (
                slice.map((r) => (
                  <tr key={r.id} style={{ background: selected?.id === r.id ? tint(colors.primary, 0.08) : 'transparent' }}>
                    <td style={tdCell}><strong>{r.name}</strong></td>
                    <td style={{ ...tdCell, color: colors.muted }}>{r.slug}</td>
                    <td style={tdCell}>
                      <span style={{ display: 'inline-flex', gap: 6, alignItems: 'center' }}>
                        {r.roleType ? <Badge text={r.roleType} color={colors.primary} /> : <span style={{ color: colors.muted }}>—</span>}
                        {r.isSystemRole ? <Badge text="system" color={colors.secondary} /> : null}
                      </span>
                    </td>
                    <td style={tdCell}>
                      <div style={{ display: 'flex', gap: 8 }}>
                        <Button variant="outline" sm onClick={() => setSelected(r)}>Edit</Button>
                        <Button variant="danger" sm onClick={() => setPendingDelete(r)} disabled={Boolean(r.isSystemRole) || saving}>Delete</Button>
                      </div>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
          <div style={{ padding: '10px 14px' }}>
            <Pagination page={safePage} pageCount={pageCount} total={total} pageSize={PAGE_SIZE} onPage={setPage} />
          </div>
        </Card>

        <Card title="Role Detail">
          {!selected ? <p style={{ color: colors.muted, fontSize: 13, marginTop: 12 }}>Select a role to edit or clone.</p> : null}
          {selected ? (
            <div style={{ display: 'grid', gap: 10, marginTop: 14 }}>
              <Input value={selected.name || ''} onChange={(e) => setSelected((v) => (v ? { ...v, name: e.target.value } : v))} placeholder="Name" />
              <Input value={selected.description || ''} onChange={(e) => setSelected((v) => (v ? { ...v, description: e.target.value } : v))} placeholder="Description" />
              <Input value={selected.roleType || ''} onChange={(e) => setSelected((v) => (v ? { ...v, roleType: e.target.value } : v))} placeholder="Role type" />
              <label style={{ display: 'flex', gap: 8, alignItems: 'center', fontSize: 13, color: colors.text }}>
                <input type="checkbox" checked={Boolean(selected.isActive)} onChange={(e) => setSelected((v) => (v ? { ...v, isActive: e.target.checked } : v))} />
                Active
              </label>
              <Button variant="primary" onClick={() => void onUpdate()} disabled={saving || Boolean(selected.isSystemRole)}>{saving ? 'Saving…' : 'Save Role'}</Button>

              <hr />
              <h3 style={{ margin: 0, fontSize: 14, fontWeight: 700, color: colors.text }}>Clone Role</h3>
              <Input placeholder="Clone name" value={cloneInput.name} onChange={(e) => setCloneInput((v) => ({ ...v, name: e.target.value }))} />
              <Input placeholder="Clone slug" value={cloneInput.slug} onChange={(e) => setCloneInput((v) => ({ ...v, slug: e.target.value }))} />
              <Button variant="outline" onClick={() => void onClone()} disabled={saving}>{saving ? 'Cloning…' : 'Clone Role'}</Button>
            </div>
          ) : null}
        </Card>
      </div>
    </Page>
  );
}
