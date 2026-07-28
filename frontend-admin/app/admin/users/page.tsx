'use client';

import { useEffect, useMemo, useState } from 'react';
import type { AdminUser, AdminUserFilters } from '@/types/users';
import {
  getAdminUser,
  listAdminUsers,
  lockAdminUser,
  suspendAdminUser,
  unlockAdminUser,
  unsuspendAdminUser,
  updateAdminUser,
} from '@/services/usersService';
import {
  useToasts,
  ToastStack,
  FilterChips,
  Pagination,
  usePagination,
  applySort,
  nextSort,
  SortHeaderButton,
  type FilterChip,
  type SortState,
} from '@/components/rbac';

const PAGE_SIZE = 15;

const defaultFilters: AdminUserFilters = {
  limit: 500,
  role: '',
  userType: '',
  status: '',
  state: '',
  program: '',
  search: '',
};

const FILTER_LABELS: Record<string, string> = {
  search: 'Search',
  status: 'Status',
  userType: 'Type',
  state: 'State',
  role: 'Role',
  program: 'Program',
};

type SortKey = 'name' | 'email' | 'userType' | 'status' | 'state';

export default function AdminUsersPage() {
  const [draft, setDraft] = useState<AdminUserFilters>(defaultFilters);
  const [applied, setApplied] = useState<AdminUserFilters>(defaultFilters);
  const [users, setUsers] = useState<AdminUser[]>([]);
  const [loading, setLoading] = useState(true);
  const [errored, setErrored] = useState(false);
  const [selectedId, setSelectedId] = useState('');
  const [selected, setSelected] = useState<AdminUser | null>(null);
  const [saving, setSaving] = useState(false);
  const [sort, setSort] = useState<SortState<SortKey>>({ key: 'name', dir: 'asc' });
  const [page, setPage] = useState(1);
  const { toasts, toast, dismiss } = useToasts();

  const load = async (filters: AdminUserFilters) => {
    setLoading(true);
    setErrored(false);
    try {
      const rows = await listAdminUsers(filters);
      setUsers(rows);
      setPage(1);
    } catch {
      setErrored(true);
      setUsers([]);
      toast.error('Failed to load users. Check your permissions and try again.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void load(applied);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    const run = async () => {
      if (!selectedId) {
        setSelected(null);
        return;
      }
      const row = await getAdminUser(selectedId);
      setSelected(row);
    };
    void run();
  }, [selectedId]);

  const apply = () => {
    setApplied(draft);
    void load(draft);
    toast.success('Filters applied.');
  };

  const chips: FilterChip[] = useMemo(() => {
    const out: FilterChip[] = [];
    for (const [k, label] of Object.entries(FILTER_LABELS)) {
      const v = (applied as Record<string, unknown>)[k];
      if (v && String(v).trim()) out.push({ key: k, label, value: String(v) });
    }
    return out;
  }, [applied]);

  const clearChip = (key: string) => {
    const next = { ...applied, [key]: '' };
    setApplied(next);
    setDraft(next);
    void load(next);
  };

  const clearAll = () => {
    setApplied(defaultFilters);
    setDraft(defaultFilters);
    void load(defaultFilters);
  };

  const stats = useMemo(() => {
    const total = users.length;
    const suspended = users.filter((u) => (u.status || '').toLowerCase() === 'suspended').length;
    const locked = users.filter((u) => (u.status || '').toLowerCase() === 'locked').length;
    return { total, suspended, locked };
  }, [users]);

  const sorted = useMemo(
    () => applySort(users, sort, (u, key) => {
      if (key === 'name') return `${u.firstName ?? ''} ${u.lastName ?? ''}`.trim();
      return (u as Record<string, unknown>)[key];
    }),
    [users, sort],
  );
  const { slice, total, pageCount, safePage } = usePagination(sorted, PAGE_SIZE, page);
  const sortBy = (key: SortKey) => setSort((s) => nextSort(s, key));

  const onSave = async () => {
    if (!selected) return;
    setSaving(true);
    try {
      const updated = await updateAdminUser(selected.id, {
        first_name: selected.firstName,
        last_name: selected.lastName,
        phone: selected.phone,
        user_type: selected.userType,
        status: selected.status,
        profile_completed: selected.profileCompleted,
      });
      if (!updated) {
        toast.error('Update failed. Scope or permission restrictions may apply.');
        return;
      }
      toast.success('User updated successfully.');
      setSelected(updated);
      await load(applied);
    } catch {
      toast.error('Update failed due to a network or server error.');
    } finally {
      setSaving(false);
    }
  };

  const runStatus = async (label: string, fn: (id: string) => Promise<boolean>) => {
    if (!selected) return;
    setSaving(true);
    try {
      const ok = await fn(selected.id);
      if (!ok) {
        toast.error(`${label} failed. Check access scope and permissions.`);
        return;
      }
      toast.success(`User ${label.toLowerCase()} succeeded.`);
      const refreshed = await getAdminUser(selected.id);
      setSelected(refreshed);
      await load(applied);
    } catch {
      toast.error(`${label} failed due to a network or server error.`);
    } finally {
      setSaving(false);
    }
  };

  const setInput = (key: keyof AdminUserFilters, value: string) => setDraft((f) => ({ ...f, [key]: value }));

  return (
    <div>
      <ToastStack toasts={toasts} onDismiss={dismiss} />
      <h1>Users Management</h1>
      <p>Search, filter, inspect, and update users with RBAC and scope restrictions enforced by backend.</p>

      <div style={{ display: 'grid', gap: 8, gridTemplateColumns: 'repeat(4, minmax(0,1fr))', marginTop: 12 }}>
        <input placeholder="search" value={draft.search ?? ''} onChange={(e) => setInput('search', e.target.value)} />
        <input placeholder="status" value={draft.status ?? ''} onChange={(e) => setInput('status', e.target.value)} />
        <input placeholder="user type" value={draft.userType ?? ''} onChange={(e) => setInput('userType', e.target.value)} />
        <input placeholder="state" value={draft.state ?? ''} onChange={(e) => setInput('state', e.target.value)} />
        <button onClick={apply}>Apply Filters</button>
      </div>

      <FilterChips chips={chips} onClear={clearChip} onClearAll={clearAll} />

      <div style={{ marginTop: 10, fontSize: 12 }}>
        Total: {stats.total} · Suspended: {stats.suspended} · Locked: {stats.locked}
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '1.2fr 1fr', gap: 16, marginTop: 16 }}>
        <section>
          <table style={{ borderCollapse: 'collapse', width: '100%', fontSize: 13 }}>
            <thead>
              <tr>
                <th style={th()}><SortHeaderButton label="Name" active={sort?.key === 'name'} dir={sort?.dir ?? 'asc'} onClick={() => sortBy('name')} /></th>
                <th style={th()}><SortHeaderButton label="Email" active={sort?.key === 'email'} dir={sort?.dir ?? 'asc'} onClick={() => sortBy('email')} /></th>
                <th style={th()}><SortHeaderButton label="Type" active={sort?.key === 'userType'} dir={sort?.dir ?? 'asc'} onClick={() => sortBy('userType')} /></th>
                <th style={th()}><SortHeaderButton label="Status" active={sort?.key === 'status'} dir={sort?.dir ?? 'asc'} onClick={() => sortBy('status')} /></th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr><td style={td()} colSpan={4}>Loading…</td></tr>
              ) : errored ? (
                <tr><td style={td()} colSpan={4}><button onClick={() => void load(applied)}>Retry</button> — failed to load.</td></tr>
              ) : slice.length === 0 ? (
                <tr><td style={td()} colSpan={4}>No users match the current filters.</td></tr>
              ) : (
                slice.map((u) => (
                  <tr
                    key={u.id}
                    onClick={() => setSelectedId(u.id)}
                    style={{ cursor: 'pointer', background: selectedId === u.id ? '#1f1f1f' : 'transparent' }}
                  >
                    <td style={td()}><strong>{u.firstName} {u.lastName}</strong></td>
                    <td style={td()}>{u.email}</td>
                    <td style={td()}>{u.userType || '-'}</td>
                    <td style={td()}>{u.status || '-'}</td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
          <Pagination page={safePage} pageCount={pageCount} total={total} pageSize={PAGE_SIZE} onPage={setPage} />
        </section>

        <section style={{ border: '1px solid #2a2a2a', padding: 12 }}>
          <h2 style={{ marginTop: 0 }}>Selected User</h2>
          {!selected ? <p>Select a user to inspect/update.</p> : null}
          {selected ? (
            <div style={{ display: 'grid', gap: 8 }}>
              <label>
                First Name
                <input value={selected.firstName || ''} onChange={(e) => setSelected((s) => (s ? { ...s, firstName: e.target.value } : s))} />
              </label>
              <label>
                Last Name
                <input value={selected.lastName || ''} onChange={(e) => setSelected((s) => (s ? { ...s, lastName: e.target.value } : s))} />
              </label>
              <label>
                Phone
                <input value={selected.phone || ''} onChange={(e) => setSelected((s) => (s ? { ...s, phone: e.target.value } : s))} />
              </label>
              <label>
                User Type
                <input value={selected.userType || ''} onChange={(e) => setSelected((s) => (s ? { ...s, userType: e.target.value } : s))} />
              </label>
              <label>
                Status
                <input value={selected.status || ''} onChange={(e) => setSelected((s) => (s ? { ...s, status: e.target.value } : s))} />
              </label>
              <label style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <input
                  type="checkbox"
                  checked={Boolean(selected.profileCompleted)}
                  onChange={(e) => setSelected((s) => (s ? { ...s, profileCompleted: e.target.checked } : s))}
                />
                Profile Completed
              </label>

              <div style={{ marginTop: 8, fontSize: 12 }}>
                Scope data: program={selected.programId || '-'} · contest={selected.contestId || '-'} · school={selected.schoolId || '-'}
              </div>

              <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                <button onClick={() => void runStatus('Suspend', suspendAdminUser)} disabled={saving}>Suspend</button>
                <button onClick={() => void runStatus('Unsuspend', unsuspendAdminUser)} disabled={saving}>Unsuspend</button>
                <button onClick={() => void runStatus('Lock', lockAdminUser)} disabled={saving}>Lock</button>
                <button onClick={() => void runStatus('Unlock', unlockAdminUser)} disabled={saving}>Unlock</button>
              </div>

              <button onClick={() => void onSave()} disabled={saving}>{saving ? 'Saving...' : 'Save Changes'}</button>
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
