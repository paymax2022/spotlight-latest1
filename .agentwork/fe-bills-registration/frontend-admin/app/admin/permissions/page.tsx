'use client';

import { useEffect, useState } from 'react';
import type { Permission } from '@/types/rbac';
import { createPermission, deletePermission, listPermissions, updatePermission } from '@/services/rbacAdminService';

export default function AdminPermissionsPage() {
  const [permissions, setPermissions] = useState<Permission[]>([]);
  const [selected, setSelected] = useState<Permission | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [draft, setDraft] = useState<Partial<Permission>>({ name: '', slug: '', module: '', resource: '', action: '', description: '' });
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');

  const load = async () => {
    setLoading(true);
    setPermissions(await listPermissions());
    setLoading(false);
  };

  useEffect(() => { void load(); }, []);

  const onCreate = async () => {
    if (!draft.name || !draft.slug || !draft.module || !draft.resource || !draft.action) return;
    setMessage('');
    setError('');
    setSaving(true);
    const created = await createPermission(draft);
    setSaving(false);
    if (!created) {
      setError('Create failed. Check permission slug uniqueness and required fields.');
      return;
    }
    setMessage('Permission created successfully.');
    setDraft({ name: '', slug: '', module: '', resource: '', action: '', description: '' });
    await load();
  };

  const onUpdate = async () => {
    if (!selected) return;
    setMessage('');
    setError('');
    setSaving(true);
    const updated = await updatePermission(selected.id, selected);
    setSaving(false);
    if (!updated) {
      setError('Update failed. System permissions may be protected.');
      return;
    }
    setMessage('Permission updated successfully.');
    await load();
  };

  const onDelete = async (id: string) => {
    setMessage('');
    setError('');
    setSaving(true);
    const ok = await deletePermission(id);
    setSaving(false);
    if (!ok) {
      setError('Delete failed. System permissions cannot be deleted.');
      return;
    }
    setMessage('Permission deleted successfully.');
    if (selected?.id === id) setSelected(null);
    await load();
  };

  return (
    <div>
      <h1>Permissions Management</h1>
      <p>Create, edit, and delete permissions. System permissions are protected by backend policy.</p>
      {message ? <p style={{ color: 'lightgreen' }}>{message}</p> : null}
      {error ? <p style={{ color: 'salmon' }}>{error}</p> : null}

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
        <button style={{ marginTop: 8 }} onClick={() => void onCreate()} disabled={saving}>{saving ? 'Saving...' : 'Create Permission'}</button>
      </section>

      {loading ? <p>Loading...</p> : null}

      <div style={{ display: 'grid', gridTemplateColumns: '1.2fr 1fr', gap: 16, marginTop: 16 }}>
        <section>
          <div style={{ display: 'grid', gap: 8 }}>
            {permissions.map((p) => (
              <article key={p.id} style={{ border: '1px solid #2a2a2a', padding: 10, background: selected?.id === p.id ? '#1f1f1f' : 'transparent' }}>
                <p style={{ margin: 0, fontWeight: 600 }}>{p.name}</p>
                <p style={{ margin: '4px 0 0 0', fontSize: 12 }}>{p.slug} · {p.module}.{p.resource}.{p.action}</p>
                <div style={{ display: 'flex', gap: 8, marginTop: 8 }}>
                  <button onClick={() => setSelected(p)}>Edit</button>
                  <button onClick={() => void onDelete(p.id)} disabled={Boolean(p.isSystemPermission) || saving}>Delete</button>
                </div>
              </article>
            ))}
          </div>
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
