'use client';

// SC-40 · Staff & Bursar Role Management.
// Assign school-scoped roles (school-owner / bursar / class-teacher /
// head-teacher). Grants are scoped to a school (RBAC scope_type='school').

import { useEffect, useState } from 'react';
import {
  listFeesSchools, listRoleGrants, assignRole, revokeRole, SCHOOL_ROLES,
} from '@/services/academyFeesService';
import type { FeesSchool, SchoolRoleGrant, SchoolRole } from '@/types/academyFees';
import {
  PageHeader, Card, Badge, Kpi, StateBlock, DisclosureNote, AuditNote,
  btn, btnPrimary, btnDanger, th, td, input, label, select, fmtDate,
} from '../../_ui';
import { FeesTabs, FeesGuard } from '../_ui';

function roleLabel(slug: SchoolRole) { return SCHOOL_ROLES.find((r) => r.slug === slug)?.label ?? slug; }

export default function FeesRolesPage() {
  const [schools, setSchools] = useState<FeesSchool[]>([]);
  const [schoolId, setSchoolId] = useState('');
  const [grants, setGrants] = useState<SchoolRoleGrant[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [form, setForm] = useState<{ user_email: string; role: SchoolRole }>({ user_email: '', role: 'bursar' });

  async function loadSchools() {
    const s = await listFeesSchools(); setSchools(s);
    if (s[0]) setSchoolId((cur) => cur || s[0].id);
  }
  async function loadFor(id: string) {
    if (!id) return;
    setLoading(true); setError(null);
    try { setGrants(await listRoleGrants(id)); }
    catch (e) { setError(String(e)); }
    finally { setLoading(false); }
  }
  useEffect(() => { loadSchools().catch((e) => setError(String(e))); }, []);
  useEffect(() => { if (schoolId) loadFor(schoolId); }, [schoolId]);

  async function assign() {
    if (!form.user_email) { setNotice('User email is required.'); return; }
    setBusy('assign'); setNotice(null);
    try { const g = await assignRole({ school_id: schoolId, user_email: form.user_email, role: form.role }); setNotice(`Granted "${roleLabel(g.role)}" to ${g.user_email}.`); setForm({ ...form, user_email: '' }); await loadFor(schoolId); }
    catch (e) { setNotice(String(e)); } finally { setBusy(null); }
  }
  async function revoke(g: SchoolRoleGrant) {
    const ok = typeof window === 'undefined' ? true : window.confirm(`Revoke ${roleLabel(g.role)} from ${g.user_email}?`);
    if (!ok) return;
    setBusy(g.id); setNotice(null);
    try { await revokeRole({ grant_id: g.id }); setNotice(`Revoked ${roleLabel(g.role)} from ${g.user_email}.`); await loadFor(schoolId); }
    catch (e) { setNotice(String(e)); } finally { setBusy(null); }
  }

  const active = grants.filter((g) => g.status === 'active');

  return (
    <FeesGuard permission="academy.fees.roles.assign">
    <div style={{ padding: '0.5rem 0.5rem 2rem' }}>
      <PageHeader title="Staff & Bursar Roles" subtitle="Assign and revoke school-scoped staff roles: owner, bursar, class teacher and head teacher. Grants are scoped to the selected school." action={<button onClick={() => loadFor(schoolId)} style={btn()}>Refresh</button>} />
      <FeesTabs active="roles" />
      <DisclosureNote>Requires <code>academy.fees.roles.assign</code>. Role grants are <strong>school-scoped</strong> (RBAC <code>scope_type=&apos;school&apos;</code>). The class-teacher and head-teacher roles feed the two-approval promotion gate (SF-3).</DisclosureNote>

      <StateBlock loading={loading} error={error} empty={false}>
        <Card title="School">
          <select style={{ ...select(), maxWidth: 340 }} value={schoolId} onChange={(e) => setSchoolId(e.target.value)}>{schools.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}</select>
        </Card>

        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(190px, 1fr))', gap: '0.75rem', marginBottom: '1.25rem' }}>
          {SCHOOL_ROLES.map((r) => <Kpi key={r.slug} label={r.label} value={active.filter((g) => g.role === r.slug).length.toString()} />)}
        </div>

        <Card title="Role grants">
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead><tr><th style={th()}>User</th><th style={th()}>Role</th><th style={th()}>Granted by</th><th style={th()}>Granted</th><th style={th()}>Status</th><th style={th()}>Action</th></tr></thead>
            <tbody>
              {grants.map((g) => (
                <tr key={g.id}>
                  <td style={td()}><strong>{g.user_email}</strong></td>
                  <td style={td()}><Badge status="core" label={roleLabel(g.role)} /></td>
                  <td style={td()}>{g.granted_by}</td>
                  <td style={td()}>{fmtDate(g.granted_at)}</td>
                  <td style={td()}><Badge status={g.status === 'active' ? 'active' : 'revoked'} /></td>
                  <td style={td()}>{g.status === 'active' ? <button onClick={() => revoke(g)} disabled={busy === g.id} style={btnDanger()}>Revoke</button> : <span style={{ color: '#9ca3af', fontSize: '0.8rem' }}>revoked</span>}</td>
                </tr>
              ))}
              {grants.length === 0 && <tr><td style={td()} colSpan={6}><span style={{ color: '#6b7280' }}>No role grants for this school.</span></td></tr>}
            </tbody>
          </table>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))', gap: '0.6rem', alignItems: 'end', marginTop: '0.75rem', borderTop: '1px solid #f3f4f6', paddingTop: '0.75rem' }}>
            <div><label style={label()}>User email</label><input style={input()} value={form.user_email} onChange={(e) => setForm({ ...form, user_email: e.target.value })} placeholder="staff@school.ng" /></div>
            <div><label style={label()}>Role</label><select style={select()} value={form.role} onChange={(e) => setForm({ ...form, role: e.target.value as SchoolRole })}>{SCHOOL_ROLES.map((r) => <option key={r.slug} value={r.slug}>{r.label}</option>)}</select></div>
            <div><button onClick={assign} disabled={busy === 'assign'} style={btnPrimary()}>Assign role</button></div>
          </div>
          {notice && <p style={{ fontSize: '0.8rem', color: '#374151', marginTop: '0.6rem' }}>{notice}</p>}
          <AuditNote>Role grants and revocations are recorded to the immutable audit log (module <code>academy.fees</code>).</AuditNote>
        </Card>
      </StateBlock>
    </div>
    </FeesGuard>
  );
}
