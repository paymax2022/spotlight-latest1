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
    <div>
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
      <h1>Role Management</h1>
      <p>Create, edit, clone, and delete roles. System roles are protected by backend policy.</p>

      <section style={{ border: '1px solid #2a2a2a', padding: 12, marginTop: 12 }}>
        <h2 style={{ marginTop: 0 }}>Create Role</h2>
        <div style={{ display: 'grid', gap: 8, gridTemplateColumns: 'repeat(4,minmax(0,1fr))' }}>
          <input placeholder="name" value={newRole.name} onChange={(e) => setNewRole((v) => ({ ...v, name: e.target.value }))} />
          <input placeholder="slug" value={newRole.slug} onChange={(e) => setNewRole((v) => ({ ...v, slug: e.target.value }))} />
          <input placeholder="role type" value={newRole.roleType} onChange={(e) => setNewRole((v) => ({ ...v, roleType: e.target.value }))} />
          <input placeholder="description" value={newRole.description} onChange={(e) => setNewRole((v) => ({ ...v, description: e.target.value }))} />
        </div>
        <button style={{ marginTop: 8 }} onClick={() => void onCreate()} disabled={saving}>{saving ? 'Saving...' : 'Create Role'}</button>
      </section>

      <div style={{ display: 'flex', gap: 8, marginTop: 12 }}>
        <input placeholder="filter roles" value={search} onChange={(e) => setSearch(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') applySearch(); }} />
        <button onClick={applySearch}>Filter</button>
      </div>
      <FilterChips chips={chips} onClear={clearSearch} />

      <div style={{ display: 'grid', gridTemplateColumns: '1.1fr 1fr', gap: 16, marginTop: 16 }}>
        <section>
          <table style={{ borderCollapse: 'collapse', width: '100%', fontSize: 13 }}>
            <thead>
              <tr>
                <th style={th()}><SortHeaderButton label="Name" active={sort?.key === 'name'} dir={sort?.dir ?? 'asc'} onClick={() => sortBy('name')} /></th>
                <th style={th()}><SortHeaderButton label="Slug" active={sort?.key === 'slug'} dir={sort?.dir ?? 'asc'} onClick={() => sortBy('slug')} /></th>
                <th style={th()}><SortHeaderButton label="Type" active={sort?.key === 'roleType'} dir={sort?.dir ?? 'asc'} onClick={() => sortBy('roleType')} /></th>
                <th style={th()}>Actions</th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr><td style={td()} colSpan={4}>Loading…</td></tr>
              ) : errored ? (
                <tr><td style={td()} colSpan={4}><button onClick={() => void load()}>Retry</button> — failed to load.</td></tr>
              ) : slice.length === 0 ? (
                <tr><td style={td()} colSpan={4}>No roles to display.</td></tr>
              ) : (
                slice.map((r) => (
                  <tr key={r.id} style={{ background: selected?.id === r.id ? '#1f1f1f' : 'transparent' }}>
                    <td style={td()}><strong>{r.name}</strong></td>
                    <td style={td()}>{r.slug}</td>
                    <td style={td()}>{r.roleType || '-'} {r.isSystemRole ? '· system' : ''}</td>
                    <td style={td()}>
                      <div style={{ display: 'flex', gap: 8 }}>
                        <button onClick={() => setSelected(r)}>Edit</button>
                        <button onClick={() => setPendingDelete(r)} disabled={Boolean(r.isSystemRole) || saving}>Delete</button>
                      </div>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
          <Pagination page={safePage} pageCount={pageCount} total={total} pageSize={PAGE_SIZE} onPage={setPage} />
        </section>

        <section style={{ border: '1px solid #2a2a2a', padding: 12 }}>
          <h2 style={{ marginTop: 0 }}>Role Detail</h2>
          {!selected ? <p>Select a role to edit or clone.</p> : null}
          {selected ? (
            <div style={{ display: 'grid', gap: 8 }}>
              <input value={selected.name || ''} onChange={(e) => setSelected((v) => (v ? { ...v, name: e.target.value } : v))} placeholder="name" />
              <input value={selected.description || ''} onChange={(e) => setSelected((v) => (v ? { ...v, description: e.target.value } : v))} placeholder="description" />
              <input value={selected.roleType || ''} onChange={(e) => setSelected((v) => (v ? { ...v, roleType: e.target.value } : v))} placeholder="role type" />
              <label style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                <input type="checkbox" checked={Boolean(selected.isActive)} onChange={(e) => setSelected((v) => (v ? { ...v, isActive: e.target.checked } : v))} />
                Active
              </label>
              <button onClick={() => void onUpdate()} disabled={saving || Boolean(selected.isSystemRole)}>{saving ? 'Saving...' : 'Save Role'}</button>

              <hr style={{ width: '100%', borderColor: '#2a2a2a' }} />
              <h3 style={{ margin: 0 }}>Clone Role</h3>
              <input placeholder="clone name" value={cloneInput.name} onChange={(e) => setCloneInput((v) => ({ ...v, name: e.target.value }))} />
              <input placeholder="clone slug" value={cloneInput.slug} onChange={(e) => setCloneInput((v) => ({ ...v, slug: e.target.value }))} />
              <button onClick={() => void onClone()} disabled={saving}>{saving ? 'Cloning...' : 'Clone Role'}</button>
            </div>
          ) : null}
        </section>
      </div>
    </div>
  );
}

function th(): React.CSSProperties {
  return { textAlign: 'left', borderBottom: '1px solid #2a2a2a', padding: 8 };
}
function td(): React.CSSProperties {
  return { borderBottom: '1px solid #1f1f1f', padding: 8 };
}
