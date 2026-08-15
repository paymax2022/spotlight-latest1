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
  Kpi, StateBlock, DisclosureNote, AuditNote, label, select, fmtDate,
} from '../../_ui';
import { FeesTabs, FeesGuard } from '../_ui';
import { Page, PageHeader, Card, Button, Input, Badge, colors, thCell, tdCell } from '@/components/ui/vuexy';

function statusColor(status: string): string {
  const s = status.toLowerCase();
  if (['active', 'approved', 'published', 'funded', 'paid', 'completed', 'allocated', 'live', 'reconciled', 'disbursed', 'collected', 'released', 'core', 'issued', 'routed', 'ready', 'eligible', 'actioned', 'verified', 'resolved', 'plan_published', 'badge_earned', 'pool_funded', 'item_approved'].includes(s)) return colors.success;
  if (['pending', 'in_review', 'under_review', 'needs_info', 'scheduled', 'low_balance', 'review', 'in_translation', 'funding', 'fee_due', 'onboarding', 'frequent', 'packaged', 'matured', 'paused', 'processing', 'triaged', 'investigating', 'hide', 'warn', 'high', 'medium'].includes(s)) return colors.warning;
  if (['draft', 'authoring', 'open', 'upcoming', 'generated', 'partial', 'submitted', 'trial', 'requested', 'applied', 'cards_generated', 'exam_opened', 'campaign_launched'].includes(s)) return colors.info;
  if (['rejected', 'failed', 'suspended', 'blocked', 'unfunded', 'expired', 'duplicate', 'revoked', 'escalated', 'ban', 'critical', 'overdue', 'item_rejected'].includes(s)) return colors.danger;
  if (['refunded', 'reversed', 'redeemed', 'reward_redeemed'].includes(s)) return colors.primary;
  return colors.secondary;
}

function StatusBadge({ status, label: lbl }: { status: string; label?: string }) {
  return <Badge text={lbl ?? status.replace(/_/g, ' ')} color={statusColor(status)} />;
}

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
    <Page>
      <PageHeader title="Staff & Bursar Roles" subtitle="Assign and revoke school-scoped staff roles: owner, bursar, class teacher and head teacher. Grants are scoped to the selected school." actions={<Button onClick={() => loadFor(schoolId)} variant="outline" sm>Refresh</Button>} />
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
            <thead><tr><th style={thCell}>User</th><th style={thCell}>Role</th><th style={thCell}>Granted by</th><th style={thCell}>Granted</th><th style={thCell}>Status</th><th style={thCell}>Action</th></tr></thead>
            <tbody>
              {grants.map((g) => (
                <tr key={g.id}>
                  <td style={tdCell}><strong>{g.user_email}</strong></td>
                  <td style={tdCell}><StatusBadge status="core" label={roleLabel(g.role)} /></td>
                  <td style={tdCell}>{g.granted_by}</td>
                  <td style={tdCell}>{fmtDate(g.granted_at)}</td>
                  <td style={tdCell}><StatusBadge status={g.status === 'active' ? 'active' : 'revoked'} /></td>
                  <td style={tdCell}>{g.status === 'active' ? <Button onClick={() => revoke(g)} disabled={busy === g.id} variant="danger" sm>Revoke</Button> : <span style={{ color: colors.muted, fontSize: '0.8rem' }}>revoked</span>}</td>
                </tr>
              ))}
              {grants.length === 0 && <tr><td style={tdCell} colSpan={6}><span style={{ color: colors.muted }}>No role grants for this school.</span></td></tr>}
            </tbody>
          </table>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))', gap: '0.6rem', alignItems: 'end', marginTop: '0.75rem', borderTop: `1px solid ${colors.border}`, paddingTop: '0.75rem' }}>
            <div><label style={label()}>User email</label><Input value={form.user_email} onChange={(e) => setForm({ ...form, user_email: e.target.value })} placeholder="staff@school.ng" /></div>
            <div><label style={label()}>Role</label><select style={select()} value={form.role} onChange={(e) => setForm({ ...form, role: e.target.value as SchoolRole })}>{SCHOOL_ROLES.map((r) => <option key={r.slug} value={r.slug}>{r.label}</option>)}</select></div>
            <div><Button onClick={assign} disabled={busy === 'assign'} variant="primary" sm>Assign role</Button></div>
          </div>
          {notice && <p style={{ fontSize: '0.8rem', color: colors.text, marginTop: '0.6rem' }}>{notice}</p>}
          <AuditNote>Role grants and revocations are recorded to the immutable audit log (module <code>academy.fees</code>).</AuditNote>
        </Card>
      </StateBlock>
    </Page>
    </FeesGuard>
  );
}
