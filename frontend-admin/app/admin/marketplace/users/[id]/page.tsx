'use client';

import Link from 'next/link';
import { useParams } from 'next/navigation';
import { useCallback, useEffect, useState } from 'react';
import {
  getUserAdmin, setUserStatus, approveUserActionSecondSign, reviewKyc, blacklistIdentifier, logViewAs,
} from '@/services/marketplaceAdminService';
import type { MktUserAdmin, MktBlacklistType, MktKycTier } from '@/types/marketplaceAdmin';
import {
  PageHeader, MarketplaceTabs, Card, StatusBadge, DisclosureNote, AuditNote, DualApprovalBanner,
  PermissionBanner, btn, btnPrimary, btnDanger, btnDisabled, input, textarea, select, label as lbl, fmtDate,
  MARKETPLACE_PERMS, useMarketplacePermission, useCurrentAdminId,
} from '../../_ui';

const KYC_TIERS: MktKycTier[] = ['tier0_browse', 'tier1_buy', 'tier2_sell', 'tier3_business'];
const BLACKLIST_TYPES: MktBlacklistType[] = ['device', 'phone', 'ip', 'email'];

export default function UserDetailPage() {
  const params = useParams<{ id: string }>();
  const id = params?.id ?? '';
  const { allowed: canAction } = useMarketplacePermission(MARKETPLACE_PERMS.usersAction);
  const currentAdminId = useCurrentAdminId();

  const [u, setU] = useState<MktUserAdmin | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const [statusReason, setStatusReason] = useState('');
  const [kycReason, setKycReason] = useState('');
  const [grantTier, setGrantTier] = useState<MktKycTier>('tier2_sell');
  const [blType, setBlType] = useState<MktBlacklistType>('device');
  const [blValue, setBlValue] = useState('');
  const [blReason, setBlReason] = useState('');
  const [viewReason, setViewReason] = useState('');

  const load = useCallback(async () => {
    setLoading(true); setError(null);
    try { setU(await getUserAdmin(id)); }
    catch (e) { setError(String(e)); }
    finally { setLoading(false); }
  }, [id]);
  useEffect(() => { void load(); }, [load]);

  const banPending = u?.pending_action === 'ban' && u?.requires_dual_approval;
  const sameApproverConflict = !!u?.pending_action_by && !!currentAdminId && u.pending_action_by === currentAdminId;

  async function act<T>(fn: () => Promise<T>, after: (r: T) => void) {
    setBusy(true); setMsg(null); setError(null);
    try { after(await fn()); } catch (e) { setError(String(e)); } finally { setBusy(false); }
  }

  function changeStatus(action: 'suspend' | 'ban' | 'reinstate') {
    if (!statusReason.trim()) { setError('reason_code is required to change status.'); return; }
    void act(() => setUserStatus(id, { action, reason_code: statusReason.trim() }), (r) => {
      setU(r);
      setMsg(r.pending_action === 'ban' ? 'Ban recorded — awaiting a second approver before it takes effect.' : `User ${action}d. Audit entry recorded.`);
      setStatusReason('');
    });
  }

  function secondSignBan() {
    void act(() => approveUserActionSecondSign(id, statusReason.trim() || undefined), (r) => { setU(r); setMsg('Second approval recorded — the ban has taken effect.'); });
  }

  function decideKyc(decision: 'approve' | 'reject') {
    if (!kycReason.trim()) { setError('reason_code is required to review KYC.'); return; }
    void act(() => reviewKyc(id, { decision, reason_code: kycReason.trim(), grant_tier: decision === 'approve' ? grantTier : undefined }), (r) => { setU(r); setMsg(`KYC ${decision}d. Audit entry recorded.`); setKycReason(''); });
  }

  function doBlacklist() {
    void act(() => blacklistIdentifier(id, { type: blType, value: blValue.trim(), reason_code: blReason.trim() }), () => { setMsg(`Blacklisted ${blType}: ${blValue.trim()}. Audit entry recorded.`); setBlValue(''); setBlReason(''); });
  }

  function doViewAs() {
    void act(() => logViewAs(id, viewReason.trim()), () => { setMsg('Audited “view as” access recorded. Open the support view from your session per policy.'); setViewReason(''); });
  }

  if (loading) return <div style={{ padding: '2rem' }}><p style={{ color: '#6b7280' }}>Loading…</p></div>;
  if (error && !u) return <div style={{ padding: '2rem' }}><p style={{ color: '#dc2626' }}>{error}</p></div>;
  if (!u) return null;

  return (
    <div style={{ padding: '0.5rem 0.5rem 2rem' }}>
      <PageHeader
        title={`User — ${u.display_name}`}
        subtitle="Masked profile, KYC review, and account actions. A ban requires a second, different approver."
        action={<Link href="/admin/marketplace/users" style={{ ...btn(), textDecoration: 'none' }}>← Back to users</Link>}
      />
      <MarketplaceTabs active="users" />
      <DisclosureNote>
        PII is masked (USR-001). Suspend/reinstate execute immediately; a ban is maker-checker (USR-007). KYC decisions,
        blacklisting, and “view as” all write audit rows (USR-003/005/008).
      </DisclosureNote>

      {!canAction && <PermissionBanner permission={MARKETPLACE_PERMS.usersAction} />}
      {error && <p style={{ color: '#dc2626' }}>{error}</p>}
      {msg && <AuditNote>{msg}</AuditNote>}

      {banPending && (
        <DualApprovalBanner>
          A ban was initiated by <code>{u.pending_action_by}</code> and is awaiting a second approver.
          {sameApproverConflict && <> You initiated it — a <strong>different</strong> admin must confirm.</>}
        </DualApprovalBanner>
      )}

      <Card title="Profile">
        <Row k="User ID" v={<code>{u.id}</code>} />
        <Row k="Status" v={<><StatusBadge status={u.status === 'banned' ? 'removed_policy' : u.status === 'suspended' ? 'paused' : 'active'} /> {u.status}{u.suspension_reason_code ? <span style={{ color: '#9ca3af' }}> · {u.suspension_reason_code.replace(/_/g, ' ')}</span> : null}</>} />
        <Row k="Email / phone" v={<>{u.email_masked} · {u.phone_masked}</>} />
        <Row k="KYC tier" v={<>{u.kyc_tier.replace(/_/g, ' ')}{u.kyc_pending ? <span style={{ color: '#9a3412' }}> · upgrade pending</span> : null}</>} />
        <Row k="Trust / fraud" v={<>{(u.trust_score * 5).toFixed(1)} trust · <span style={{ color: u.fraud_score >= 0.7 ? '#b91c1c' : '#374151', fontWeight: 600 }}>{Math.round(u.fraud_score * 100)}</span> fraud risk</>} />
        <Row k="Activity" v={<>{u.active_listings} listings · {u.completed_deals} deals · {u.open_flags} open flags</>} />
        <Row k="Member since" v={fmtDate(u.created_at)} />
      </Card>

      {/* Account status actions */}
      {banPending ? (
        <Card title="Confirm ban (second approver)">
          <p style={{ fontSize: '0.85rem', color: '#374151', marginTop: 0 }}>Confirm the ban initiated by <code>{u.pending_action_by}</code>. This is irreversible from the seller’s side and removes all their active listings.</p>
          <label style={lbl()}>reason_code (optional)</label>
          <input value={statusReason} onChange={(e) => setStatusReason(e.target.value)} placeholder="second-approver note" style={{ ...input(), marginBottom: '0.6rem' }} />
          <button style={canAction && !sameApproverConflict && !busy ? btnDanger() : btnDisabled()} disabled={!canAction || sameApproverConflict || busy} onClick={secondSignBan}>{busy ? '…' : 'Approve & execute ban'}</button>
          {sameApproverConflict && <p style={{ color: '#b91c1c', fontSize: '0.8rem', marginTop: '0.5rem' }}>You initiated this ban — a different admin must confirm.</p>}
        </Card>
      ) : (
        <Card title="Account status">
          <label style={lbl()}>reason_code (mandatory)</label>
          <input value={statusReason} onChange={(e) => setStatusReason(e.target.value)} placeholder="e.g. fraud_ring / counterfeit_repeat" style={{ ...input(), marginBottom: '0.7rem' }} />
          <div style={{ display: 'flex', gap: '0.6rem', flexWrap: 'wrap' }}>
            {u.status !== 'suspended' && u.status !== 'banned' && (
              <button style={canAction && statusReason.trim() && !busy ? btnPrimary('#9a3412') : btnDisabled()} disabled={!canAction || !statusReason.trim() || busy} onClick={() => changeStatus('suspend')}>Suspend</button>
            )}
            {(u.status === 'suspended' || u.status === 'banned') && (
              <button style={canAction && statusReason.trim() && !busy ? btnPrimary('#15803d') : btnDisabled()} disabled={!canAction || !statusReason.trim() || busy} onClick={() => changeStatus('reinstate')}>Reinstate</button>
            )}
            {u.status !== 'banned' && (
              <button style={canAction && statusReason.trim() && !busy ? btnDanger() : btnDisabled()} disabled={!canAction || !statusReason.trim() || busy} onClick={() => changeStatus('ban')}>Ban (needs 2nd approval)</button>
            )}
          </div>
          <AuditNote>Suspend/reinstate execute immediately; ban routes to a second approver. All are audited.</AuditNote>
        </Card>
      )}

      {/* KYC review */}
      {u.kyc_pending && (
        <Card title="KYC review">
          <div style={{ display: 'flex', gap: '1rem', alignItems: 'flex-end', flexWrap: 'wrap', marginBottom: '0.6rem' }}>
            <div>
              <label style={lbl()}>Grant tier (on approve)</label>
              <select style={select()} value={grantTier} onChange={(e) => setGrantTier(e.target.value as MktKycTier)}>
                {KYC_TIERS.map((t) => <option key={t} value={t}>{t.replace(/_/g, ' ')}</option>)}
              </select>
            </div>
            <div style={{ flex: 1, minWidth: 200 }}>
              <label style={lbl()}>reason_code</label>
              <input value={kycReason} onChange={(e) => setKycReason(e.target.value)} placeholder="e.g. id_verified / doc_mismatch" style={input()} />
            </div>
          </div>
          <div style={{ display: 'flex', gap: '0.6rem' }}>
            <button style={canAction && kycReason.trim() && !busy ? btnPrimary('#15803d') : btnDisabled()} disabled={!canAction || !kycReason.trim() || busy} onClick={() => decideKyc('approve')}>Approve KYC</button>
            <button style={canAction && kycReason.trim() && !busy ? btnDanger() : btnDisabled()} disabled={!canAction || !kycReason.trim() || busy} onClick={() => decideKyc('reject')}>Reject</button>
          </div>
        </Card>
      )}

      {/* Blacklist identifier */}
      <Card title="Blacklist identifier (USR-005)">
        <div style={{ display: 'flex', gap: '0.8rem', alignItems: 'flex-end', flexWrap: 'wrap' }}>
          <div>
            <label style={lbl()}>Type</label>
            <select style={select()} value={blType} onChange={(e) => setBlType(e.target.value as MktBlacklistType)}>
              {BLACKLIST_TYPES.map((t) => <option key={t} value={t}>{t}</option>)}
            </select>
          </div>
          <div style={{ flex: 1, minWidth: 180 }}>
            <label style={lbl()}>Value</label>
            <input value={blValue} onChange={(e) => setBlValue(e.target.value)} placeholder="device id / phone / ip / email" style={input()} />
          </div>
          <div style={{ flex: 1, minWidth: 160 }}>
            <label style={lbl()}>reason_code</label>
            <input value={blReason} onChange={(e) => setBlReason(e.target.value)} placeholder="fraud_ring" style={input()} />
          </div>
          <button style={canAction && blValue.trim() && blReason.trim() && !busy ? btnPrimary() : btnDisabled()} disabled={!canAction || !blValue.trim() || !blReason.trim() || busy} onClick={doBlacklist}>Blacklist</button>
        </div>
      </Card>

      {/* Audited view-as */}
      <Card title="View as user (audited, USR-008)">
        <p style={{ fontSize: '0.82rem', color: '#6b7280', marginTop: 0 }}>Recording a support “view as” writes an audit row before access is granted. No impersonation happens here.</p>
        <div style={{ display: 'flex', gap: '0.6rem', alignItems: 'flex-end' }}>
          <div style={{ flex: 1 }}>
            <label style={lbl()}>reason_code</label>
            <input value={viewReason} onChange={(e) => setViewReason(e.target.value)} placeholder="support_ticket_1234" style={input()} />
          </div>
          <button style={canAction && viewReason.trim() && !busy ? btn() : btnDisabled()} disabled={!canAction || !viewReason.trim() || busy} onClick={doViewAs}>Record view-as</button>
        </div>
      </Card>
    </div>
  );
}

function Row({ k, v }: { k: string; v: React.ReactNode }) {
  return (
    <div style={{ display: 'flex', gap: '0.75rem', padding: '0.3rem 0', fontSize: '0.85rem' }}>
      <div style={{ width: 140, color: '#6b7280', fontWeight: 600 }}>{k}</div>
      <div style={{ color: '#374151' }}>{v}</div>
    </div>
  );
}
