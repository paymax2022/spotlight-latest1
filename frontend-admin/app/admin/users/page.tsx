'use client';

import { useEffect, useMemo, useState, type CSSProperties } from 'react';
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
import { Page, PageHeader, Card, Button, Input, Badge, colors, tint, thCell, tdCell } from '@/components/ui/vuexy';

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

const fieldLabel: CSSProperties = { display: 'grid', gap: 4, fontSize: 12, fontWeight: 600, color: colors.muted };

type SortKey = 'name' | 'email' | 'userType' | 'status' | 'state';

/** Status → badge tint. */
function statusColor(status?: string): string {
  const s = (status || '').toLowerCase();
  if (s === 'suspended' || s === 'locked') return colors.danger;
  if (s === 'active') return colors.success;
  return colors.secondary;
}

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
    <Page>
      <ToastStack toasts={toasts} onDismiss={dismiss} />

      <PageHeader
        title="Users Management"
        subtitle="Search, filter, inspect, and update users with RBAC and scope restrictions enforced by backend."
      />

      <Card title="Filters" style={{ marginBottom: 12 }}>
        <div style={{ display: 'grid', gap: 10, gridTemplateColumns: 'repeat(4, minmax(0,1fr))', marginTop: 14 }}>
          <Input placeholder="Search" value={draft.search ?? ''} onChange={(e) => setInput('search', e.target.value)} />
          <Input placeholder="Status" value={draft.status ?? ''} onChange={(e) => setInput('status', e.target.value)} />
          <Input placeholder="User type" value={draft.userType ?? ''} onChange={(e) => setInput('userType', e.target.value)} />
          <Input placeholder="State" value={draft.state ?? ''} onChange={(e) => setInput('state', e.target.value)} />
        </div>
        <Button variant="primary" style={{ marginTop: 14 }} onClick={apply}>Apply Filters</Button>
      </Card>

      <FilterChips chips={chips} onClear={clearChip} onClearAll={clearAll} />

      <div style={{ marginTop: 12, marginBottom: 4, fontSize: 13, color: colors.muted }}>
        Total: {stats.total} · Suspended: {stats.suspended} · Locked: {stats.locked}
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '1.3fr 1fr', gap: 16, marginTop: 12, alignItems: 'start' }}>
        <Card style={{ padding: 0, overflow: 'hidden' }}>
          <table style={{ borderCollapse: 'collapse', width: '100%' }}>
            <thead>
              <tr>
                <th style={thCell}><SortHeaderButton label="Name" active={sort?.key === 'name'} dir={sort?.dir ?? 'asc'} onClick={() => sortBy('name')} /></th>
                <th style={thCell}><SortHeaderButton label="Email" active={sort?.key === 'email'} dir={sort?.dir ?? 'asc'} onClick={() => sortBy('email')} /></th>
                <th style={thCell}><SortHeaderButton label="Type" active={sort?.key === 'userType'} dir={sort?.dir ?? 'asc'} onClick={() => sortBy('userType')} /></th>
                <th style={thCell}><SortHeaderButton label="Status" active={sort?.key === 'status'} dir={sort?.dir ?? 'asc'} onClick={() => sortBy('status')} /></th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr><td style={{ ...tdCell, color: colors.muted }} colSpan={4}>Loading…</td></tr>
              ) : errored ? (
                <tr><td style={tdCell} colSpan={4}><Button variant="outline" sm onClick={() => void load(applied)}>Retry</Button> <span style={{ color: colors.danger }}>— failed to load.</span></td></tr>
              ) : slice.length === 0 ? (
                <tr><td style={{ ...tdCell, color: colors.muted }} colSpan={4}>No users match the current filters.</td></tr>
              ) : (
                slice.map((u) => (
                  <tr
                    key={u.id}
                    onClick={() => setSelectedId(u.id)}
                    style={{ cursor: 'pointer', background: selectedId === u.id ? tint(colors.primary, 0.08) : 'transparent' }}
                  >
                    <td style={tdCell}><strong>{u.firstName} {u.lastName}</strong></td>
                    <td style={{ ...tdCell, color: colors.muted }}>{u.email}</td>
                    <td style={tdCell}>{u.userType || '—'}</td>
                    <td style={tdCell}>{u.status ? <Badge text={u.status} color={statusColor(u.status)} /> : '—'}</td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
          <div style={{ padding: '10px 14px' }}>
            <Pagination page={safePage} pageCount={pageCount} total={total} pageSize={PAGE_SIZE} onPage={setPage} />
          </div>
        </Card>

        <Card title="Selected User">
          {!selected ? <p style={{ color: colors.muted, fontSize: 13, marginTop: 12 }}>Select a user to inspect/update.</p> : null}
          {selected ? (
            <div style={{ display: 'grid', gap: 12, marginTop: 14 }}>
              <label style={fieldLabel}>First Name<Input value={selected.firstName || ''} onChange={(e) => setSelected((s) => (s ? { ...s, firstName: e.target.value } : s))} /></label>
              <label style={fieldLabel}>Last Name<Input value={selected.lastName || ''} onChange={(e) => setSelected((s) => (s ? { ...s, lastName: e.target.value } : s))} /></label>
              <label style={fieldLabel}>Phone<Input value={selected.phone || ''} onChange={(e) => setSelected((s) => (s ? { ...s, phone: e.target.value } : s))} /></label>
              <label style={fieldLabel}>User Type<Input value={selected.userType || ''} onChange={(e) => setSelected((s) => (s ? { ...s, userType: e.target.value } : s))} /></label>
              <label style={fieldLabel}>Status<Input value={selected.status || ''} onChange={(e) => setSelected((s) => (s ? { ...s, status: e.target.value } : s))} /></label>
              <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13, color: colors.text }}>
                <input
                  type="checkbox"
                  checked={Boolean(selected.profileCompleted)}
                  onChange={(e) => setSelected((s) => (s ? { ...s, profileCompleted: e.target.checked } : s))}
                />
                Profile Completed
              </label>

              <div style={{ fontSize: 12, color: colors.muted }}>
                Scope: program={selected.programId || '—'} · contest={selected.contestId || '—'} · school={selected.schoolId || '—'}
              </div>

              <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                <Button variant="danger" sm onClick={() => void runStatus('Suspend', suspendAdminUser)} disabled={saving}>Suspend</Button>
                <Button variant="secondary" sm onClick={() => void runStatus('Unsuspend', unsuspendAdminUser)} disabled={saving}>Unsuspend</Button>
                <Button variant="danger" sm onClick={() => void runStatus('Lock', lockAdminUser)} disabled={saving}>Lock</Button>
                <Button variant="secondary" sm onClick={() => void runStatus('Unlock', unlockAdminUser)} disabled={saving}>Unlock</Button>
              </div>

              <Button variant="primary" onClick={() => void onSave()} disabled={saving}>{saving ? 'Saving…' : 'Save Changes'}</Button>
            </div>
          ) : null}
        </Card>
      </div>
    </Page>
  );
}
