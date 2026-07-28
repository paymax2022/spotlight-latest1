'use client';

import { useEffect, useState } from 'react';
import { listStaff, inviteStaff } from '@/services/staysExtranetService';
import type { StaffMember, StaffRole } from '@/types/staysExtranet';
import { PageHeader, ExtranetTabs, Card, PropertyScopeNote, Badge, StateBlock, btn, btnPrimary, input, label, select, th, td, timeAgo } from '../_ui';

const ROLES: StaffRole[] = ['owner', 'revenue_manager', 'front_desk'];
const ROLE_DESC: Record<StaffRole, string> = {
  owner: 'Full access including finance, staff and settings',
  revenue_manager: 'Rates, availability, promotions and analytics',
  front_desk: 'Reservations, guest messaging and check-in/out',
};

export default function StaffPage() {
  const [rows, setRows] = useState<StaffMember[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [draft, setDraft] = useState({ name: '', email: '', role: 'front_desk' as StaffRole });
  const [busy, setBusy] = useState(false);

  async function load() {
    setLoading(true); setError(null);
    try { setRows(await listStaff()); }
    catch (e) { setError(String(e)); } finally { setLoading(false); }
  }
  useEffect(() => { load(); }, []);

  async function invite() {
    setBusy(true);
    try { const m = await inviteStaff(draft.name, draft.email, draft.role); setRows((r) => [...r, m]); setDraft({ name: '', email: '', role: 'front_desk' }); }
    catch (e) { setError(String(e)); } finally { setBusy(false); }
  }

  return (
    <div style={{ padding: '0.5rem 0.5rem 2rem' }}>
      <PageHeader title="Users & roles" subtitle="Manage who can access this property's extranet. Roles control what each person can see and do." action={<button onClick={load} style={btn()}>Refresh</button>} />
      <ExtranetTabs active="account" />
      <PropertyScopeNote propertyName="Lekki Grand Hotel & Suites" />

      <Card title={`Team members (${rows.length})`}>
        <StateBlock loading={loading} error={error} empty={rows.length === 0} emptyText="No team members yet.">
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead><tr><th style={th()}>Name</th><th style={th()}>Email</th><th style={th()}>Role</th><th style={th()}>Status</th><th style={th()}>Last active</th><th style={th()} /></tr></thead>
            <tbody>
              {rows.map((s) => (
                <tr key={s.id}>
                  <td style={td()}>{s.name}</td>
                  <td style={td()}>{s.email}</td>
                  <td style={td()}><Badge status={s.role} /><div style={{ color: '#9ca3af', fontSize: '0.7rem' }}>{ROLE_DESC[s.role]}</div></td>
                  <td style={td()}><Badge status={s.status} /></td>
                  <td style={td()}>{s.last_active ? timeAgo(s.last_active) : '—'}</td>
                  <td style={td()}><button style={btn()}>Edit</button></td>
                </tr>
              ))}
            </tbody>
          </table>
        </StateBlock>
      </Card>

      <Card title="Invite team member">
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(200px, 1fr))', gap: '0.7rem' }}>
          <div><label style={label()}>Full name</label><input style={input()} value={draft.name} onChange={(e) => setDraft({ ...draft, name: e.target.value })} /></div>
          <div><label style={label()}>Email</label><input style={input()} value={draft.email} onChange={(e) => setDraft({ ...draft, email: e.target.value })} /></div>
          <div><label style={label()}>Role</label><select style={select()} value={draft.role} onChange={(e) => setDraft({ ...draft, role: e.target.value as StaffRole })}>{ROLES.map((r) => <option key={r} value={r}>{r.replace(/_/g, ' ')}</option>)}</select></div>
        </div>
        <button style={{ ...btnPrimary(), marginTop: '0.85rem' }} onClick={invite} disabled={busy || !draft.name || !draft.email}>{busy ? 'Sending…' : 'Send invite'}</button>
      </Card>
    </div>
  );
}
