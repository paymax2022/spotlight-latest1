'use client';

import Link from 'next/link';
import { use, useCallback, useEffect, useState } from 'react';
import {
  getMember, suspendMember, restoreMember, transferMember, assignMemberRole,
  type MemberDetail,
} from '@/services/associationAdminService';
import {
  DisclosureNote, AuditNote,
  useAssociationPermissions, ASSOCIATION_PERMS, PermissionBanner,
} from '../../_ui';
import { Page, Card, Button, Input, Badge, colors, tdCell } from '@/components/ui/vuexy';

function statusColor(status: string) {
  if (status === 'active' || status === 'current') return colors.success;
  if (status === 'suspended' || status === 'in_default') return colors.danger;
  return colors.warning;
}

type ActionKind = 'suspend' | 'restore' | 'transfer' | 'role';

export default function AssociationMemberDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const { can } = useAssociationPermissions();
  const canManage = can(ASSOCIATION_PERMS.manage);

  const [member, setMember] = useState<MemberDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);

  const [action, setAction] = useState<ActionKind | null>(null);
  const [reason, setReason] = useState('');
  const [chapter, setChapter] = useState('');
  const [role, setRole] = useState('');
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    setLoading(true); setError(null);
    try { setMember(await getMember(id)); }
    catch (e) { setError(String(e)); }
    finally { setLoading(false); }
  }, [id]);

  useEffect(() => { void load(); }, [load]);

  function openAction(kind: ActionKind) {
    setAction(kind); setReason(''); setChapter(''); setRole(''); setMsg(null);
  }

  // Suspend requires a reason (backend accepts optional but we enforce it in
  // the UI since a suspension without a written reason is not auditable in
  // practice). Transfer requires a chapter; role requires a role. Restore
  // needs no input — it's a single confirm.
  function canSubmit(): boolean {
    if (action === 'suspend') return reason.trim().length > 0;
    if (action === 'transfer') return chapter.trim().length > 0;
    if (action === 'role') return role.trim().length > 0;
    if (action === 'restore') return true;
    return false;
  }

  async function submit() {
    if (!action || !canSubmit()) return;
    setBusy(true); setError(null); setMsg(null);
    try {
      if (action === 'suspend') { await suspendMember(id, reason.trim()); setMsg('Member suspended. Recorded to audit log (NL-12).'); }
      else if (action === 'restore') { await restoreMember(id); setMsg('Member restored. Recorded to audit log (NL-12).'); }
      else if (action === 'transfer') { await transferMember(id, chapter.trim()); setMsg(`Member transferred to ${chapter.trim()}. Recorded to audit log (NL-12).`); }
      else if (action === 'role') { await assignMemberRole(id, role.trim()); setMsg(`Role "${role.trim()}" assigned. Recorded to audit log (NL-12).`); }
      setAction(null); setReason(''); setChapter(''); setRole('');
      await load();
    } catch (e) { setError(`Action failed: ${String(e)}`); }
    finally { setBusy(false); }
  }

  if (loading) return <Page><p><Link href="/admin/association/members" style={{ color: colors.primary }}>← Back to members</Link></p><p style={{ color: colors.muted }}>Loading member…</p></Page>;
  if (error && !member) return <Page><p><Link href="/admin/association/members" style={{ color: colors.primary }}>← Back to members</Link></p><p style={{ color: colors.danger }}>{error}</p></Page>;
  if (!member) return <Page><p><Link href="/admin/association/members" style={{ color: colors.primary }}>← Back to members</Link></p><p style={{ color: colors.muted }}>Member not found.</p></Page>;

  return (
    <Page>
      <p><Link href="/admin/association/members" style={{ color: colors.primary }}>← Back to members</Link></p>
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap', marginBottom: '0.25rem' }}>
        <h1 style={{ margin: 0, fontSize: '1.5rem', fontWeight: 700 }}>{member.fullName}</h1>
        <Badge text={member.status.replace(/_/g, ' ')} color={statusColor(member.status)} />
        <Badge text={member.paymentStanding.replace(/_/g, ' ')} color={statusColor(member.paymentStanding)} />
      </div>
      <p style={{ fontSize: '0.85rem', color: colors.muted, margin: '0 0 1rem' }}>
        {member.memberId} · {member.chapterName ?? 'No chapter'} · {member.categoryLabel} · joined {new Date(member.joinedAt).toLocaleDateString()}
      </p>

      <DisclosureNote>
        Suspend, restore, transfer and role-assignment all post to <code>/api/finance/associations/admin/members/:id/*</code> and
        are recorded to the immutable audit log (NL-12).
      </DisclosureNote>
      {msg && <AuditNote>{msg}</AuditNote>}
      {error && <p style={{ color: colors.danger }}>{error}</p>}

      <div style={{ display: 'grid', gridTemplateColumns: '1.3fr 1fr', gap: '1.25rem' }}>
        <Card title="Profile">
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.85rem', marginTop: 12 }}>
            <tbody>
              {[
                ['Email', member.email ?? '—'],
                ['Phone', member.phone ?? '—'],
                ['Location', member.location ?? '—'],
                ['Profession', member.profession ?? '—'],
                ['Payment standing', member.paymentStanding],
                ['Contact restricted', member.contactRestricted ? 'Yes' : 'No'],
              ].map(([k, v]) => (
                <tr key={k}><td style={{ ...tdCell, color: colors.muted, width: '35%' }}>{k}</td><td style={tdCell}>{v}</td></tr>
              ))}
              {member.bio && <tr><td style={{ ...tdCell, color: colors.muted }}>Bio</td><td style={tdCell}>{member.bio}</td></tr>}
            </tbody>
          </table>
        </Card>

        <Card title="Member actions">
          {!canManage ? (
            <PermissionBanner text="You have read-only access — your role cannot suspend, restore, transfer or assign roles for members." />
          ) : !action ? (
            <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap', marginTop: 12 }}>
              {member.status !== 'suspended' && <Button variant="danger" onClick={() => openAction('suspend')}>Suspend</Button>}
              {member.status === 'suspended' && <Button variant="primary" onClick={() => openAction('restore')}>Restore</Button>}
              <Button variant="outline" onClick={() => openAction('transfer')}>Transfer chapter</Button>
              <Button variant="outline" onClick={() => openAction('role')}>Assign role</Button>
            </div>
          ) : (
            <div style={{ display: 'grid', gap: '0.5rem', marginTop: 12 }}>
              <label style={{ display: 'block', fontSize: '0.75rem', fontWeight: 600, color: colors.text, marginBottom: '0.25rem' }}>{action === 'suspend' ? 'Reason (required — written to audit log)' : action === 'restore' ? 'Confirm restore' : action === 'transfer' ? 'Destination chapter (required)' : 'Role (required)'}</label>
              {action === 'suspend' && (
                <textarea value={reason} onChange={(e) => setReason(e.target.value)} rows={3} style={{ fontFamily: 'inherit' }} placeholder="e.g. Dues default beyond grace period" />
              )}
              {action === 'transfer' && (
                <Input value={chapter} onChange={(e) => setChapter(e.target.value)} placeholder="e.g. Abuja Chapter" />
              )}
              {action === 'role' && (
                <Input value={role} onChange={(e) => setRole(e.target.value)} placeholder="e.g. secretary, treasurer, member" />
              )}
              {action === 'restore' && (
                <p style={{ fontSize: '0.8rem', color: colors.muted, margin: 0 }}>Restoring reinstates this member's active status. This action is recorded to the audit log.</p>
              )}
              <div style={{ display: 'flex', gap: '0.5rem', justifyContent: 'flex-end' }}>
                <Button variant="outline" disabled={busy} onClick={() => setAction(null)}>Cancel</Button>
                <Button
                  variant={action === 'suspend' ? 'danger' : 'primary'}
                  disabled={busy || !canSubmit()}
                  onClick={submit}
                >
                  {busy ? 'Submitting…' : `Confirm ${action}`}
                </Button>
              </div>
            </div>
          )}
        </Card>
      </div>
    </Page>
  );
}
