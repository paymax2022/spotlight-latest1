'use client';

import { useEffect, useMemo, useState } from 'react';
import type { Permission } from '@/types/rbac';
import { createPermission, deletePermission, listPermissions, updatePermission } from '@/services/rbacAdminService';
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
  isCriticalPermissionSlug,
  type FilterChip,
  type SortState,
} from '@/components/rbac';

const PAGE_SIZE = 15;

type SortKey = 'name' | 'slug' | 'module';

export default function AdminPermissionsPage() {
  const [permissions, setPermissions] = useState<Permission[]>([]);
  const [selected, setSelected] = useState<Permission | null>(null);
  const [loading, setLoading] = useState(true);
  const [errored, setErrored] = useState(false);
  const [saving, setSaving] = useState(false);
  const [draft, setDraft] = useState<Partial<Permission>>({ name: '', slug: '', module: '', resource: '', action: '', description: '' });
  const [search, setSearch] = useState('');
  const [appliedSearch, setAppliedSearch] = useState('');
  const [sort, setSort] = useState<SortState<SortKey>>({ key: 'name', dir: 'asc' });
  const [page, setPage] = useState(1);
  const [pendingDelete, setPendingDelete] = useState<Permission | null>(null);
  const { toasts, toast, dismiss } = useToasts();

  const load = async () => {
    setLoading(true);
    setErrored(false);
    try {
      setPermissions(await listPermissions());
    } catch {
      setErrored(true);
      setPermissions([]);
      toast.error('Failed to load permissions.');
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
    if (!q) return permissions;
    return permissions.filter((p) => `${p.name} ${p.slug} ${p.module ?? ''} ${p.resource ?? ''} ${p.action ?? ''}`.toLowerCase().includes(q));
  }, [permissions, appliedSearch]);

  const sorted = useMemo(
    () => applySort(filtered, sort, (p, key) => (p as Record<string, unknown>)[key]),
    [filtered, sort],
  );
  const { slice, total, pageCount, safePage } = usePagination(sorted, PAGE_SIZE, page);
  const sortBy = (key: SortKey) => setSort((s) => nextSort(s, key));

  const chips: FilterChip[] = appliedSearch.trim() ? [{ key: 'search', label: 'Search', value: appliedSearch }] : [];
  const applySearch = () => { setAppliedSearch(search); setPage(1); };
  const clearSearch = () => { setSearch(''); setAppliedSearch(''); setPage(1); };

  const onCreate = async () => {
    if (!draft.name || !draft.slug || !draft.module || !draft.resource || !draft.action) {
      toast.warning('Name, slug, module, resource, and action are required.');
      return;
    }
    setSaving(true);
    try {
      const created = await createPermission(draft);
      if (!created) {
        toast.error('Create failed. Check permission slug uniqueness and required fields.');
        return;
      }
      toast.success('Permission created successfully.');
      setDraft({ name: '', slug: '', module: '', resource: '', action: '', description: '' });
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
      const updated = await updatePermission(selected.id, selected);
      if (!updated) {
        toast.error('Update failed. System permissions may be protected.');
        return;
      }
      toast.success('Permission updated successfully.');
      await load();
    } catch {
      toast.error('Update failed due to a network or server error.');
    } finally {
      setSaving(false);
    }
  };

  const confirmDelete = async () => {
    const perm = pendingDelete;
    setPendingDelete(null);
    if (!perm) return;
    setSaving(true);
    try {
      const ok = await deletePermission(perm.id);
      if (!ok) {
        toast.error('Delete failed. System permissions cannot be deleted.');
        return;
      }
      toast.success('Permission deleted successfully.');
      if (selected?.id === perm.id) setSelected(null);
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
        level={pendingDelete && isCriticalPermissionSlug(pendingDelete.slug) ? 'critical' : 'warning'}
        title="Delete permission?"
        reasons={pendingDelete ? [
          `Permission "${pendingDelete.slug}" will be permanently deleted.`,
          ...(isCriticalPermissionSlug(pendingDelete.slug) ? ['This is a critical permission — deleting it may revoke access for any role that depends on it.'] : []),
        ] : []}
        confirmLabel="Delete permission"
        onConfirm={() => void confirmDelete()}
        onCancel={() => setPendingDelete(null)}
      />
      <h1>Permissions Management</h1>
      <p>Create, edit, and delete permissions. System permissions are protected by backend policy.</p>

      <section style={{ border: '1px solid #2a2a2a', padding: 12, marginTop: 12 }}>
        <h2 style={{ marginTop: 0 }}>Create Permission</h2>
        <div style={{ display: 'grid', gap: 8, gridTemplateColumns: 'repeat(3,minmax(0,1fr))' }}>
          <input placeholder="name" value={draft.name || ''} onChange={(e) => setDraft((d) => ({ ...d, name: e.target.value }))} />
          <input placeholder="slug" value={draft.slug || ''} onChange={(e) => setDraft((d) => ({ ...d, slug: e.target.value }))} />
          <input placeholder="module" value={draft.module || ''} onChange={(e) => setDraft((d) => ({ ...d, module: e.target.value }))} />
          <input placeholder="resource" value={draft.resource || ''} onChange={(e) => setDraft((d) => ({ ...d, resource: e.target.value }))} />
          <input placeholder="action" value={draft.action || ''} onChange={(e) => setDraft((d) => ({ ...d, action: e.target.value }))} />
          <input placeholder="description" value={draft.description || ''} onChange={(e) => setDraft((d) => ({ ...d, description: e.target.value }))} />
        </div>
        {draft.slug && isCriticalPermissionSlug(draft.slug) ? (
          <p style={{ color: '#f59e0b', fontSize: 12, margin: '8px 0 0' }}>Heads up: this slug pattern is treated as a critical permission.</p>
        ) : null}
        <button style={{ marginTop: 8 }} onClick={() => void onCreate()} disabled={saving}>{saving ? 'Saving...' : 'Create Permission'}</button>
      </section>

      <div style={{ display: 'flex', gap: 8, marginTop: 12 }}>
        <input placeholder="filter permissions" value={search} onChange={(e) => setSearch(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') applySearch(); }} />
        <button onClick={applySearch}>Filter</button>
      </div>
      <FilterChips chips={chips} onClear={clearSearch} />

      <div style={{ display: 'grid', gridTemplateColumns: '1.2fr 1fr', gap: 16, marginTop: 16 }}>
        <section>
          <table style={{ borderCollapse: 'collapse', width: '100%', fontSize: 13 }}>
            <thead>
              <tr>
                <th style={th()}><SortHeaderButton label="Name" active={sort?.key === 'name'} dir={sort?.dir ?? 'asc'} onClick={() => sortBy('name')} /></th>
                <th style={th()}><SortHeaderButton label="Slug" active={sort?.key === 'slug'} dir={sort?.dir ?? 'asc'} onClick={() => sortBy('slug')} /></th>
                <th style={th()}><SortHeaderButton label="Module" active={sort?.key === 'module'} dir={sort?.dir ?? 'asc'} onClick={() => sortBy('module')} /></th>
                <th style={th()}>Actions</th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr><td style={td()} colSpan={4}>Loading…</td></tr>
              ) : errored ? (
                <tr><td style={td()} colSpan={4}><button onClick={() => void load()}>Retry</button> — failed to load.</td></tr>
              ) : slice.length === 0 ? (
                <tr><td style={td()} colSpan={4}>No permissions to display.</td></tr>
              ) : (
                slice.map((p) => (
                  <tr key={p.id} style={{ background: selected?.id === p.id ? '#1f1f1f' : 'transparent' }}>
                    <td style={td()}>
                      <strong>{p.name}</strong>
                      {isCriticalPermissionSlug(p.slug) ? <span title="Critical permission" style={{ marginLeft: 6, color: '#f59e0b', fontSize: 11 }}>● critical</span> : null}
                    </td>
                    <td style={td()}><span style={{ fontSize: 12 }}>{p.slug}</span></td>
                    <td style={td()}><span style={{ fontSize: 12 }}>{p.module}.{p.resource}.{p.action}</span></td>
                    <td style={td()}>
                      <div style={{ display: 'flex', gap: 8 }}>
                        <button onClick={() => setSelected(p)}>Edit</button>
                        <button onClick={() => setPendingDelete(p)} disabled={Boolean(p.isSystemPermission) || saving}>Delete</button>
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
          <h2 style={{ marginTop: 0 }}>Permission Detail</h2>
          {!selected ? <p>Select a permission to edit.</p> : null}
          {selected ? (
            <div style={{ display: 'grid', gap: 8 }}>
              <input value={selected.name || ''} onChange={(e) => setSelected((s) => (s ? { ...s, name: e.target.value } : s))} placeholder="name" />
              <input value={selected.module || ''} onChange={(e) => setSelected((s) => (s ? { ...s, module: e.target.value } : s))} placeholder="module" />
              <input value={selected.resource || ''} onChange={(e) => setSelected((s) => (s ? { ...s, resource: e.target.value } : s))} placeholder="resource" />
              <input value={selected.action || ''} onChange={(e) => setSelected((s) => (s ? { ...s, action: e.target.value } : s))} placeholder="action" />
              <input value={selected.description || ''} onChange={(e) => setSelected((s) => (s ? { ...s, description: e.target.value } : s))} placeholder="description" />
              <button onClick={() => void onUpdate()} disabled={saving || Boolean(selected.isSystemPermission)}>{saving ? 'Saving...' : 'Save Permission'}</button>
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
