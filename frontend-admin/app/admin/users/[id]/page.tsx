'use client';

import { use, useCallback, useEffect, useState, type CSSProperties } from 'react';
import Link from 'next/link';
import type { AdminUser } from '@/types/users';
import {
  getAdminUser,
  lockAdminUser,
  suspendAdminUser,
  unlockAdminUser,
  unsuspendAdminUser,
  updateAdminUser,
} from '@/services/usersService';
import RolesPanel from './RolesPanel';
import { useToasts, ToastStack } from '@/components/rbac';
import { Page, PageHeader, Card, Button, Input, Badge, colors } from '@/components/ui/vuexy';

const fieldLabel: CSSProperties = { display: 'grid', gap: 4, fontSize: 12, fontWeight: 600, color: colors.muted };

function statusColor(status?: string): string {
  const s = (status || '').toLowerCase();
  if (s === 'suspended' || s === 'locked') return colors.danger;
  if (s === 'active') return colors.success;
  return colors.secondary;
}

function Row({ k, v }: { k: string; v: string }) {
  return (
    <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, padding: '6px 0', fontSize: 13 }}>
      <span style={{ color: colors.muted }}>{k}</span>
      <span style={{ textAlign: 'right', wordBreak: 'break-word' }}>{v || '—'}</span>
    </div>
  );
}

function formatDate(iso?: string): string {
  if (!iso) return '';
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? iso : d.toLocaleString('en-NG');
}

/**
 * Full profile for one platform user: GET /api/admin/users/:id (users.view),
 * edits via PATCH (users.update) and the suspend/lock actions - the same
 * endpoints and permissions the list page's side panel already uses.
 */
export default function AdminUserProfilePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const [user, setUser] = useState<AdminUser | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const { toasts, toast, dismiss } = useToasts();

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      setUser(await getAdminUser(id));
    } catch (err) {
      setUser(null);
      setError(err instanceof Error ? err.message : 'Loading user failed.');
    } finally {
      setLoading(false);
    }
  }, [id]);

  useEffect(() => {
    void load();
  }, [load]);

  const onSave = async () => {
    if (!user) return;
    setSaving(true);
    try {
      const updated = await updateAdminUser(user.id, {
        first_name: user.firstName,
        last_name: user.lastName,
        phone: user.phone,
        user_type: user.userType,
        status: user.status,
        profile_completed: user.profileCompleted,
      });
      if (!updated) {
        toast.error('Update failed. Scope or permission restrictions may apply.');
        return;
      }
      setUser(updated);
      toast.success('User updated successfully.');
    } catch {
      toast.error('Update failed due to a network or server error.');
    } finally {
      setSaving(false);
    }
  };

  const runStatus = async (label: string, fn: (userId: string) => Promise<boolean>) => {
    if (!user) return;
    setSaving(true);
    try {
      if (!(await fn(user.id))) {
        toast.error(`${label} failed. Check access scope and permissions.`);
        return;
      }
      toast.success(`User ${label.toLowerCase()} succeeded.`);
      try {
        setUser(await getAdminUser(user.id));
      } catch {
        toast.error('The change was applied but the profile could not be reloaded.');
      }
    } catch {
      toast.error(`${label} failed due to a network or server error.`);
    } finally {
      setSaving(false);
    }
  };

  const back = (
    <Link href="/admin/users" style={{ color: colors.info, textDecoration: 'none', fontSize: 13 }}>
      ← Users
    </Link>
  );

  if (loading) {
    return <Page>{back}<p style={{ color: colors.muted, marginTop: 12 }}>Loading…</p></Page>;
  }
  if (error) {
    return (
      <Page>
        {back}
        <p style={{ color: colors.danger, marginTop: 12 }}>{error}</p>
        <Button variant="outline" sm onClick={() => void load()}>Retry</Button>
      </Page>
    );
  }
  if (!user) {
    return <Page>{back}<p style={{ color: colors.muted, marginTop: 12 }}>User not found.</p></Page>;
  }

  const set = (patch: Partial<AdminUser>) => setUser((u) => (u ? { ...u, ...patch } : u));
  const name = `${user.firstName ?? ''} ${user.lastName ?? ''}`.trim() || user.email || user.id;

  return (
    <Page>
      <ToastStack toasts={toasts} onDismiss={dismiss} />
      {back}
      <div style={{ height: 8 }} />
      <PageHeader title={name} subtitle={user.email || undefined} />

      <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginBottom: 16, flexWrap: 'wrap' }}>
        {user.status ? <Badge text={user.status} color={statusColor(user.status)} /> : null}
        {user.userType ? <Badge text={user.userType} color={colors.info} /> : null}
        <Badge
          text={user.profileCompleted ? 'Profile complete' : 'Profile incomplete'}
          color={user.profileCompleted ? colors.success : colors.secondary}
        />
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(320px, 1fr))', gap: 16, alignItems: 'start' }}>
        <Card title="Account">
          <div style={{ marginTop: 8 }}>
            <Row k="User ID" v={user.id} />
            <Row k="Email" v={user.email} />
            <Row k="Phone" v={user.phone} />
            <Row k="State" v={user.state} />
            <Row k="Country" v={user.country} />
            <Row k="Joined" v={formatDate(user.createdAt)} />
            <Row k="Program" v={user.programId ?? ''} />
            <Row k="Contest" v={user.contestId ?? ''} />
            <Row k="School" v={user.schoolId ?? ''} />
          </div>
        </Card>

        <Card title="Edit & manage">
          <div style={{ display: 'grid', gap: 12, marginTop: 14 }}>
            <label style={fieldLabel}>First Name<Input value={user.firstName || ''} onChange={(e) => set({ firstName: e.target.value })} /></label>
            <label style={fieldLabel}>Last Name<Input value={user.lastName || ''} onChange={(e) => set({ lastName: e.target.value })} /></label>
            <label style={fieldLabel}>Phone<Input value={user.phone || ''} onChange={(e) => set({ phone: e.target.value })} /></label>
            <label style={fieldLabel}>User Type<Input value={user.userType || ''} onChange={(e) => set({ userType: e.target.value })} /></label>
            <label style={fieldLabel}>Status<Input value={user.status || ''} onChange={(e) => set({ status: e.target.value })} /></label>
            <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13, color: colors.text }}>
              <input type="checkbox" checked={Boolean(user.profileCompleted)} onChange={(e) => set({ profileCompleted: e.target.checked })} />
              Profile Completed
            </label>
            <Button variant="primary" onClick={() => void onSave()} disabled={saving}>{saving ? 'Saving…' : 'Save Changes'}</Button>

            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
              <Button variant="danger" sm onClick={() => void runStatus('Suspend', suspendAdminUser)} disabled={saving}>Suspend</Button>
              <Button variant="secondary" sm onClick={() => void runStatus('Unsuspend', unsuspendAdminUser)} disabled={saving}>Unsuspend</Button>
              <Button variant="danger" sm onClick={() => void runStatus('Lock', lockAdminUser)} disabled={saving}>Lock</Button>
              <Button variant="secondary" sm onClick={() => void runStatus('Unlock', unlockAdminUser)} disabled={saving}>Unlock</Button>
            </div>
          </div>
        </Card>
      </div>

      <div style={{ display: 'grid', gap: 16, marginTop: 16 }}>
        <RolesPanel userId={id} />
      </div>
    </Page>
  );
}
