'use client';

import { useEffect, useState } from 'react';
import type { Role } from '@/types/rbac';
import { cloneRole, createRole, deleteRole, listRoles, updateRole } from '@/services/rbacAdminService';

export default function AdminRolesPage() {
  const [roles, setRoles] = useState<Role[]>([]);
  const [loading, setLoading] = useState(true);
  const [selected, setSelected] = useState<Role | null>(null);
  const [saving, setSaving] = useState(false);

  const [newRole, setNewRole] = useState({ name: '', slug: '', description: '', roleType: 'admin' });
  const [cloneInput, setCloneInput] = useState({ name: '', slug: '' });
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');

  const load = async () => {
    setLoading(true);
    const rows = await listRoles();
    setRoles(rows);
    setLoading(false);
  };

  useEffect(() => {
    void load();
  }, []);

  const onCreate = async () => {
    if (!newRole.name.trim() || !newRole.slug.trim()) return;
    setMessage('');
    setError('');
    setSaving(true);
    const created = await createRole(newRole);
    setSaving(false);
    if (!created) {
      setError('Create failed. Check permission and unique role slug.');
      return;
    }
    setMessage('Role created successfully.');
    setNewRole({ name: '', slug: '', description: '', roleType: 'admin' });
    await load();
  };

  const onUpdate = async () => {
    if (!selected) return;
    setMessage('');
    setError('');
    setSaving(true);
    const updated = await updateRole(selected.id, {
      name: selected.name,
      description: selected.description,
      roleType: selected.roleType,
      isActive: selected.isActive,
    });
    setSaving(false);
    if (!updated) {
      setError('Update failed. System role updates may be blocked.');
      return;
    }
    setMessage('Role updated successfully.');
    await load();
  };

  const onClone = async () => {
    if (!selected || !cloneInput.name.trim() || !cloneInput.slug.trim()) return;
    setMessage('');
    setError('');
    setSaving(true);
    const cloned = await cloneRole(selected.id, cloneInput.name, cloneInput.slug);
    setSaving(false);
    if (!cloned) {
      setError('Clone failed. Check clone slug uniqueness.');
      return;
    }
    setMessage('Role cloned successfully.');
    setCloneInput({ name: '', slug: '' });
    await load();
  };

  const onDelete = async (id: string) => {
    setMessage('');
    setError('');
    setSaving(true);
    const ok = await deleteRole(id);
    setSaving(false);
    if (!ok) {
      setError('Delete failed. System role deletion is blocked.');
      return;
    }
    setMessage('Role deleted successfully.');
    if (selected?.id === id) setSelected(null);
    await load();
  };

  return (
    <div>
      <h1>Role Management</h1>
      <p>Create, edit, clone, and delete roles. System roles are protected by backend policy.</p>
      {message ? <p style={{ color: 'lightgreen' }}>{message}</p> : null}
      {error ? <p style={{ color: 'salmon' }}>{error}</p> : null}

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

      {loading ? <p>Loading...</p> : null}

      <div style={{ display: 'grid', gridTemplateColumns: '1.1fr 1fr', gap: 16, marginTop: 16 }}>
        <section>
          <div style={{ display: 'grid', gap: 8 }}>
            {roles.map((r) => (
              <article key={r.id} style={{ border: '1px solid #2a2a2a', padding: 10, background: selected?.id === r.id ? '#1f1f1f' : 'transparent' }}>
                <p style={{ margin: 0, fontWeight: 600 }}>{r.name}</p>
                <p style={{ margin: '4px 0 0 0', fontSize: 12 }}>{r.slug} · {r.roleType || '-'} · {r.isSystemRole ? 'system' : 'custom'}</p>
                <div style={{ display: 'flex', gap: 8, marginTop: 8 }}>
                  <button onClick={() => setSelected(r)}>Edit</button>
                  <button onClick={() => void onDelete(r.id)} disabled={Boolean(r.isSystemRole) || saving}>Delete</button>
                </div>
              </article>
            ))}
          </div>
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
