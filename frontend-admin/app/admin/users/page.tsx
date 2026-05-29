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

const defaultFilters: AdminUserFilters = {
  limit: 100,
  role: '',
  userType: '',
  status: '',
  state: '',
  program: '',
  search: '',
};

export default function AdminUsersPage() {
  const [filters, setFilters] = useState<AdminUserFilters>(defaultFilters);
  const [users, setUsers] = useState<AdminUser[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedId, setSelectedId] = useState('');
  const [selected, setSelected] = useState<AdminUser | null>(null);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');

  const load = async () => {
    setLoading(true);
    const rows = await listAdminUsers(filters);
    setUsers(rows);
    setLoading(false);
  };

  useEffect(() => {
    void load();
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

  const stats = useMemo(() => {
    const total = users.length;
    const suspended = users.filter((u) => (u.status || '').toLowerCase() === 'suspended').length;
    const locked = users.filter((u) => (u.status || '').toLowerCase() === 'locked').length;
    return { total, suspended, locked };
  }, [users]);

  const onSave = async () => {
    if (!selected) return;
    setMessage('');
    setError('');
    setSaving(true);
    const updated = await updateAdminUser(selected.id, {
      first_name: selected.firstName,
      last_name: selected.lastName,
      phone: selected.phone,
      user_type: selected.userType,
      status: selected.status,
      profile_completed: selected.profileCompleted,
    });
    setSaving(false);
    if (!updated) {
      setError('Update failed. Scope or permission restrictions may apply.');
      return;
    }
    setMessage('User updated successfully.');
    setSelected(updated);
    await load();
  };

  const runStatus = async (fn: (id: string) => Promise<boolean>) => {
    if (!selected) return;
    setMessage('');
    setError('');
    setSaving(true);
    const ok = await fn(selected.id);
    setSaving(false);
    if (!ok) {
      setError('Status action failed. Check access scope and permissions.');
      return;
    }
    setMessage('User status updated successfully.');
    const refreshed = await getAdminUser(selected.id);
    setSelected(refreshed);
    await load();
  };

  return (
    <div>
      <h1>Users Management</h1>
      <p>Search, filter, inspect, and update users with RBAC and scope restrictions enforced by backend.</p>
      {message ? <p style={{ color: 'lightgreen' }}>{message}</p> : null}
      {error ? <p style={{ color: 'salmon' }}>{error}</p> : null}

      <div style={{ display: 'grid', gap: 8, gridTemplateColumns: 'repeat(4, minmax(0,1fr))', marginTop: 12 }}>
        <input placeholder="search" onChange={(e) => setFilters((f) => ({ ...f, search: e.target.value }))} />
        <input placeholder="status" onChange={(e) => setFilters((f) => ({ ...f, status: e.target.value }))} />
        <input placeholder="user type" onChange={(e) => setFilters((f) => ({ ...f, userType: e.target.value }))} />
        <input placeholder="state" onChange={(e) => setFilters((f) => ({ ...f, state: e.target.value }))} />
        <button onClick={() => void load()}>Apply Filters</button>
      </div>

      <div style={{ marginTop: 10, fontSize: 12 }}>
        Total: {stats.total} · Suspended: {stats.suspended} · Locked: {stats.locked}
      </div>

      {loading ? <p>Loading...</p> : null}

      <div style={{ display: 'grid', gridTemplateColumns: '1.2fr 1fr', gap: 16, marginTop: 16 }}>
        <section>
          <div style={{ display: 'grid', gap: 8 }}>
            {users.map((u) => (
              <article
                key={u.id}
                style={{ border: '1px solid #2a2a2a', padding: 10, cursor: 'pointer', background: selectedId === u.id ? '#1f1f1f' : 'transparent' }}
                onClick={() => setSelectedId(u.id)}
              >
                <p style={{ margin: 0 }}>
                  <strong>{u.firstName} {u.lastName}</strong>
                </p>
                <p style={{ margin: '4px 0 0 0', fontSize: 12 }}>{u.email} · {u.userType} · {u.status}</p>
                <p style={{ margin: '4px 0 0 0', fontSize: 12 }}>{u.state || '-'} · {u.country || '-'}</p>
              </article>
            ))}
          </div>
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
                <button onClick={() => void runStatus(suspendAdminUser)} disabled={saving}>Suspend</button>
                <button onClick={() => void runStatus(unsuspendAdminUser)} disabled={saving}>Unsuspend</button>
                <button onClick={() => void runStatus(lockAdminUser)} disabled={saving}>Lock</button>
                <button onClick={() => void runStatus(unlockAdminUser)} disabled={saving}>Unlock</button>
              </div>

              <button onClick={() => void onSave()} disabled={saving}>{saving ? 'Saving...' : 'Save Changes'}</button>
            </div>
          ) : null}
        </section>
      </div>
    </div>
  );
}
