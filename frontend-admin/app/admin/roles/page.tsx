'use client';

import { useEffect, useMemo, useState, type CSSProperties } from 'react';
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

// ── Vuexy-style tokens (frontend-admin ships no CSS framework — inline styles are
// the house convention). Mirrors the production admin palette. ──────────────────
const C = {
  primary: '#7367f0',
  secondary: '#82868b',
  red: '#ea5455',
  text: '#2f2b3d',
  muted: '#6f6b7d',
  border: '#ebe9f1',
  inputBorder: '#d8d6de',
  bg: '#f8f7fa',
  headBg: '#fafafc',
  selected: 'rgba(115,103,240,0.08)',
};
function tint(hex: string, a: number): string {
  const n = parseInt(hex.slice(1), 16);
  return `rgba(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}, ${a})`;
}
const card: CSSProperties = {
  background: '#fff', border: `1px solid ${C.border}`, borderRadius: 8,
  padding: 18, boxShadow: '0 4px 18px rgba(47,43,61,0.06)',
};
const cardTitle: CSSProperties = { margin: 0, fontSize: 16, fontWeight: 700, color: C.text };
const inputStyle: CSSProperties = {
  border: `1px solid ${C.inputBorder}`, borderRadius: 6, padding: '9px 11px',
  fontSize: 13, color: C.text, background: '#fff', outline: 'none', width: '100%', boxSizing: 'border-box',
};
function btn(variant: 'primary' | 'outline' | 'danger', opts?: { disabled?: boolean; sm?: boolean }): CSSProperties {
  const base: CSSProperties = {
    borderRadius: 6, fontWeight: 600, cursor: opts?.disabled ? 'not-allowed' : 'pointer',
    border: '1px solid transparent', fontSize: opts?.sm ? 12 : 13,
    padding: opts?.sm ? '5px 10px' : '9px 15px', opacity: opts?.disabled ? 0.5 : 1,
  };
  if (variant === 'primary') return { ...base, background: C.primary, color: '#fff', boxShadow: '0 2px 6px rgba(115,103,240,0.35)' };
  if (variant === 'danger') return { ...base, background: '#fff', color: C.red, borderColor: tint(C.red, 0.5) };
  return { ...base, background: '#fff', color: C.primary, borderColor: tint(C.primary, 0.5) };
}
const thCell: CSSProperties = {
  textAlign: 'left', padding: '11px 14px', fontSize: 11, fontWeight: 700,
  textTransform: 'uppercase', letterSpacing: 0.5, color: C.muted,
  borderBottom: `1px solid ${C.border}`, background: C.headBg,
};
const tdCell: CSSProperties = { padding: '11px 14px', fontSize: 13, borderBottom: `1px solid ${C.border}`, color: C.text };

function Badge({ text, color }: { text: string; color: string }) {
  return (
    <span style={{ display: 'inline-block', padding: '2px 9px', borderRadius: 4, fontSize: 11, fontWeight: 600, background: tint(color, 0.12), color }}>
      {text}
    </span>
  );
}

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
    <div style={{ color: C.text, background: C.bg, margin: -24, padding: 24, minHeight: '100%' }}>
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

      <div style={{ marginBottom: 18 }}>
        <h1 style={{ margin: 0, fontSize: 22, fontWeight: 800 }}>Role Management</h1>
        <p style={{ margin: '4px 0 0', color: C.muted, fontSize: 13 }}>Create, edit, clone, and delete roles. System roles are protected by backend policy.</p>
      </div>

      <section style={{ ...card, marginBottom: 16 }}>
        <h2 style={cardTitle}>Create Role</h2>
        <div style={{ display: 'grid', gap: 10, gridTemplateColumns: 'repeat(4,minmax(0,1fr))', marginTop: 14 }}>
          <input style={inputStyle} placeholder="Name" value={newRole.name} onChange={(e) => setNewRole((v) => ({ ...v, name: e.target.value }))} />
          <input style={inputStyle} placeholder="Slug" value={newRole.slug} onChange={(e) => setNewRole((v) => ({ ...v, slug: e.target.value }))} />
          <input style={inputStyle} placeholder="Role type" value={newRole.roleType} onChange={(e) => setNewRole((v) => ({ ...v, roleType: e.target.value }))} />
          <input style={inputStyle} placeholder="Description" value={newRole.description} onChange={(e) => setNewRole((v) => ({ ...v, description: e.target.value }))} />
        </div>
        <button style={{ ...btn('primary', { disabled: saving }), marginTop: 14 }} onClick={() => void onCreate()} disabled={saving}>{saving ? 'Saving…' : 'Create Role'}</button>
      </section>

      <div style={{ display: 'flex', gap: 10, marginBottom: 10, maxWidth: 460 }}>
        <input style={inputStyle} placeholder="Filter roles" value={search} onChange={(e) => setSearch(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') applySearch(); }} />
        <button style={{ ...btn('outline'), whiteSpace: 'nowrap' }} onClick={applySearch}>Filter</button>
      </div>
      <FilterChips chips={chips} onClear={clearSearch} />

      <div style={{ display: 'grid', gridTemplateColumns: '1.4fr 1fr', gap: 16, marginTop: 16, alignItems: 'start' }}>
        <section style={{ ...card, padding: 0, overflow: 'hidden' }}>
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
                <tr><td style={{ ...tdCell, color: C.muted }} colSpan={4}>Loading…</td></tr>
              ) : errored ? (
                <tr><td style={tdCell} colSpan={4}><button style={btn('outline', { sm: true })} onClick={() => void load()}>Retry</button> <span style={{ color: C.red }}>— failed to load.</span></td></tr>
              ) : slice.length === 0 ? (
                <tr><td style={{ ...tdCell, color: C.muted }} colSpan={4}>No roles to display.</td></tr>
              ) : (
                slice.map((r) => (
                  <tr key={r.id} style={{ background: selected?.id === r.id ? C.selected : 'transparent' }}>
                    <td style={tdCell}><strong>{r.name}</strong></td>
                    <td style={{ ...tdCell, color: C.muted }}>{r.slug}</td>
                    <td style={tdCell}>
                      <span style={{ display: 'inline-flex', gap: 6, alignItems: 'center' }}>
                        {r.roleType ? <Badge text={r.roleType} color={C.primary} /> : <span style={{ color: C.muted }}>—</span>}
                        {r.isSystemRole ? <Badge text="system" color={C.secondary} /> : null}
                      </span>
                    </td>
                    <td style={tdCell}>
                      <div style={{ display: 'flex', gap: 8 }}>
                        <button style={btn('outline', { sm: true })} onClick={() => setSelected(r)}>Edit</button>
                        <button style={btn('danger', { sm: true, disabled: Boolean(r.isSystemRole) || saving })} onClick={() => setPendingDelete(r)} disabled={Boolean(r.isSystemRole) || saving}>Delete</button>
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
        </section>

        <section style={card}>
          <h2 style={cardTitle}>Role Detail</h2>
          {!selected ? <p style={{ color: C.muted, fontSize: 13, marginTop: 12 }}>Select a role to edit or clone.</p> : null}
          {selected ? (
            <div style={{ display: 'grid', gap: 10, marginTop: 14 }}>
              <input style={inputStyle} value={selected.name || ''} onChange={(e) => setSelected((v) => (v ? { ...v, name: e.target.value } : v))} placeholder="Name" />
              <input style={inputStyle} value={selected.description || ''} onChange={(e) => setSelected((v) => (v ? { ...v, description: e.target.value } : v))} placeholder="Description" />
              <input style={inputStyle} value={selected.roleType || ''} onChange={(e) => setSelected((v) => (v ? { ...v, roleType: e.target.value } : v))} placeholder="Role type" />
              <label style={{ display: 'flex', gap: 8, alignItems: 'center', fontSize: 13, color: C.text }}>
                <input type="checkbox" checked={Boolean(selected.isActive)} onChange={(e) => setSelected((v) => (v ? { ...v, isActive: e.target.checked } : v))} />
                Active
              </label>
              <button style={btn('primary', { disabled: saving || Boolean(selected.isSystemRole) })} onClick={() => void onUpdate()} disabled={saving || Boolean(selected.isSystemRole)}>{saving ? 'Saving…' : 'Save Role'}</button>

              <hr style={{ width: '100%', border: 'none', borderTop: `1px solid ${C.border}`, margin: '6px 0' }} />
              <h3 style={{ margin: 0, fontSize: 14, fontWeight: 700, color: C.text }}>Clone Role</h3>
              <input style={inputStyle} placeholder="Clone name" value={cloneInput.name} onChange={(e) => setCloneInput((v) => ({ ...v, name: e.target.value }))} />
              <input style={inputStyle} placeholder="Clone slug" value={cloneInput.slug} onChange={(e) => setCloneInput((v) => ({ ...v, slug: e.target.value }))} />
              <button style={btn('outline', { disabled: saving })} onClick={() => void onClone()} disabled={saving}>{saving ? 'Cloning…' : 'Clone Role'}</button>
            </div>
          ) : null}
        </section>
      </div>
    </div>
  );
}
