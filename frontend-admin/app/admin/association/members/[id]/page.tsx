'use client';

import Link from 'next/link';
import { use, useCallback, useEffect, useState } from 'react';
import {
  getMember, suspendMember, restoreMember, transferMember, assignMemberRole,
  type MemberDetail,
} from '@/services/associationAdminService';
import {
  Card, Badge, DisclosureNote, AuditNote,
  btn, btnPrimary, btnDanger, td, input, label as lbl, card,
  useAssociationPermissions, ASSOCIATION_PERMS, PermissionBanner,
} from '../../_ui';

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

  if (loading) return <div style={{ padding: '0.5rem 0.5rem 2rem' }}><p><Link href="/admin/association/members">← Back to members</Link></p><p style={{ color: '#6b7280' }}>Loading member…</p></div>;
  if (error && !member) return <div style={{ padding: '0.5rem 0.5rem 2rem' }}><p><Link href="/admin/association/members">← Back to members</Link></p><p style={{ color: '#dc2626' }}>{error}</p></div>;
  if (!member) return <div style={{ padding: '0.5rem 0.5rem 2rem' }}><p><Link href="/admin/association/members">← Back to members</Link></p><p style={{ color: '#6b7280' }}>Member not found.</p></div>;

  return (
    <div style={{ padding: '0.5rem 0.5rem 2rem' }}>
      <p><Link href="/admin/association/members">← Back to members</Link></p>
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap', marginBottom: '0.25rem' }}>
        <h1 style={{ margin: 0, fontSize: '1.5rem', fontWeight: 700 }}>{member.fullName}</h1>
        <Badge status={member.status} />
        <Badge status={member.paymentStanding} />
      </div>
      <p style={{ fontSize: '0.85rem', color: '#6b7280', margin: '0 0 1rem' }}>
        {member.memberId} · {member.chapterName ?? 'No chapter'} · {member.categoryLabel} · joined {new Date(member.joinedAt).toLocaleDateString()}
      </p>

      <DisclosureNote>
        Suspend, restore, transfer and role-assignment all post to <code>/api/finance/associations/admin/members/:id/*</code> and
        are recorded to the immutable audit log (NL-12).
      </DisclosureNote>
      {msg && <AuditNote>{msg}</AuditNote>}
      {error && <p style={{ color: '#dc2626' }}>{error}</p>}

      <div style={{ display: 'grid', gridTemplateColumns: '1.3fr 1fr', gap: '1.25rem' }}>
        <Card title="Profile">
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.85rem' }}>
            <tbody>
              {[
                ['Email', member.email ?? '—'],
                ['Phone', member.phone ?? '—'],
                ['Location', member.location ?? '—'],
                ['Profession', member.profession ?? '—'],
                ['Payment standing', member.paymentStanding],
                ['Contact restricted', member.contactRestricted ? 'Yes' : 'No'],
              ].map(([k, v]) => (
                <tr key={k}><td style={{ ...td(), color: '#6b7280', width: '35%' }}>{k}</td><td style={td()}>{v}</td></tr>
              ))}
              {member.bio && <tr><td style={{ ...td(), color: '#6b7280' }}>Bio</td><td style={td()}>{member.bio}</td></tr>}
            </tbody>
          </table>
        </Card>

        <div style={{ ...card() }}>
          <h2 style={{ fontSize: '1.05rem', fontWeight: 700, margin: '0 0 0.75rem' }}>Member actions</h2>
          {!canManage ? (
            <PermissionBanner text="You have read-only access — your role cannot suspend, restore, transfer or assign roles for members." />
          ) : !action ? (
            <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap' }}>
              {member.status !== 'suspended' && <button style={btnDanger()} onClick={() => openAction('suspend')}>Suspend</button>}
              {member.status === 'suspended' && <button style={btnPrimary()} onClick={() => openAction('restore')}>Restore</button>}
              <button style={btn()} onClick={() => openAction('transfer')}>Transfer chapter</button>
              <button style={btn()} onClick={() => openAction('role')}>Assign role</button>
            </div>
          ) : (
            <div style={{ display: 'grid', gap: '0.5rem' }}>
              <label style={lbl()} >{action === 'suspend' ? 'Reason (required — written to audit log)' : action === 'restore' ? 'Confirm restore' : action === 'transfer' ? 'Destination chapter (required)' : 'Role (required)'}</label>
              {action === 'suspend' && (
                <textarea value={reason} onChange={(e) => setReason(e.target.value)} rows={3} style={{ ...input(), fontFamily: 'inherit' }} placeholder="e.g. Dues default beyond grace period" />
              )}
              {action === 'transfer' && (
                <input style={input()} value={chapter} onChange={(e) => setChapter(e.target.value)} placeholder="e.g. Abuja Chapter" />
              )}
              {action === 'role' && (
                <input style={input()} value={role} onChange={(e) => setRole(e.target.value)} placeholder="e.g. secretary, treasurer, member" />
              )}
              {action === 'restore' && (
                <p style={{ fontSize: '0.8rem', color: '#6b7280', margin: 0 }}>Restoring reinstates this member's active status. This action is recorded to the audit log.</p>
              )}
              <div style={{ display: 'flex', gap: '0.5rem', justifyContent: 'flex-end' }}>
                <button style={btn()} disabled={busy} onClick={() => setAction(null)}>Cancel</button>
                <button
                  style={busy || !canSubmit() ? { ...btn(), opacity: 0.5, cursor: 'not-allowed' } : (action === 'suspend' ? btnDanger() : btnPrimary())}
                  disabled={busy || !canSubmit()}
                  onClick={submit}
                >
                  {busy ? 'Submitting…' : `Confirm ${action}`}
                </button>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
