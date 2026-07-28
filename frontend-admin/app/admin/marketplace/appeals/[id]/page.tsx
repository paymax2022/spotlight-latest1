'use client';

import Link from 'next/link';
import { useParams } from 'next/navigation';
import { useCallback, useEffect, useState } from 'react';
import { getAppeal, decideAppeal, approveAppealSecondSign } from '@/services/marketplaceAdminService';
import type { MktAppeal } from '@/types/marketplaceAdmin';
import {
  PageHeader, MarketplaceTabs, Card, StatusBadge, DisclosureNote, AuditNote, DualApprovalBanner,
  PermissionBanner, btn, btnPrimary, btnDanger, btnDisabled, textarea, label as lbl, fmtDate,
  MARKETPLACE_PERMS, useMarketplacePermission, useCurrentAdminId,
} from '../../_ui';

export default function AppealWorkbenchPage() {
  const params = useParams<{ id: string }>();
  const id = params?.id ?? '';
  const { allowed: canDecide } = useMarketplacePermission(MARKETPLACE_PERMS.appealsDecide);
  const currentAdminId = useCurrentAdminId();

  const [data, setData] = useState<MktAppeal | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [reasonCode, setReasonCode] = useState('');
  const [notes, setNotes] = useState('');

  const load = useCallback(async () => {
    setLoading(true); setError(null);
    try { setData(await getAppeal(id)); }
    catch (e) { setError(String(e)); }
    finally { setLoading(false); }
  }, [id]);
  useEffect(() => { void load(); }, [load]);

  const awaitingSecondApproval = data?.status === 'decided' && data?.requires_dual_approval && !data?.executed_at;
  const decidable = data?.status === 'opened' || data?.status === 'under_review';
  const sameApproverConflict = !!data?.decided_by && !!currentAdminId && data.decided_by === currentAdminId;

  async function decide(decision: 'uphold' | 'overturn') {
    if (!data) return;
    if (!reasonCode.trim()) { setError('reason_code is required to decide an appeal.'); return; }
    setBusy(true); setMsg(null); setError(null);
    try {
      const result = await decideAppeal(data.id, { decision, reason_code: reasonCode.trim(), notes: notes.trim() || undefined });
      if (result.status === 'decided' && result.requires_dual_approval) {
        setMsg('Overturn recorded — awaiting a second approver. A different admin must approve below before the original action is reversed.');
      } else {
        setMsg(`Appeal ${decision === 'uphold' ? 'upheld (denied)' : 'overturned'} and executed. Audit entry recorded.`);
      }
      setData(result);
    } catch (e) { setError(String(e)); }
    finally { setBusy(false); }
  }

  async function secondSign() {
    if (!data) return;
    setBusy(true); setMsg(null); setError(null);
    try {
      const result = await approveAppealSecondSign(data.id, reasonCode.trim() || undefined);
      setMsg('Second approval recorded — the overturn has executed and the original action is reversed.');
      setData(result);
    } catch (e) { setError(String(e)); }
    finally { setBusy(false); }
  }

  return (
    <div style={{ padding: '0.5rem 0.5rem 2rem' }}>
      <PageHeader
        title="Appeal review"
        subtitle="Uphold to deny the appeal (original action stands). Overturn to reverse it — requires a second, different approver."
        action={<Link href="/admin/marketplace/appeals" style={{ ...btn(), textDecoration: 'none' }}>← Back to appeals</Link>}
      />
      <MarketplaceTabs active="appeals" />
      <DisclosureNote>
        Backed by <code>POST /admin/appeals/:id/decide</code> and <code>/approve</code> (RBAC <code>marketplace.admin.appeals.*</code>).
        Overturns return <code>awaiting_second_approval</code> instead of executing — a <strong>different</strong> admin must then
        second-sign (409 <code>SAME_APPROVER_NOT_ALLOWED</code> otherwise).
      </DisclosureNote>

      {loading ? <p style={{ color: '#6b7280' }}>Loading…</p> : error && !data ? <p style={{ color: '#dc2626' }}>{error}</p> : data ? (
        <>
          {error && <p style={{ color: '#dc2626' }}>{error}</p>}
          {msg && <AuditNote>{msg}</AuditNote>}

          {awaitingSecondApproval && (
            <DualApprovalBanner>
              Overturn was recorded by <code>{data.decided_by}</code> and is awaiting a second, different approver before it executes.
              {sameApproverConflict && <> You are the original decider — a <strong>different</strong> admin must approve.</>}
            </DualApprovalBanner>
          )}

          <Card title="The appeal">
            <Row k="Appeal ID" v={<code>{data.id}</code>} />
            <Row k="Target" v={<>{data.target_type} · <code>{data.target_id}</code></>} />
            <Row k="Original action" v={<>{data.original_action.replace(/_/g, ' ')} <span style={{ color: '#9ca3af' }}>({data.original_reason_code.replace(/_/g, ' ')})</span></>} />
            <Row k="Appellant" v={<code>{data.appellant_id}</code>} />
            <Row k="Status" v={<StatusBadge status={data.status} />} />
            <Row k="Raised" v={fmtDate(data.created_at)} />
            <div style={{ marginTop: '0.75rem' }}>
              <div style={{ ...lbl() }}>Appellant’s statement</div>
              <div style={{ background: '#f9fafb', border: '1px solid #e5e7eb', borderRadius: '0.5rem', padding: '0.7rem 0.85rem', color: '#374151', fontSize: '0.88rem' }}>{data.appellant_note}</div>
            </div>
          </Card>

          {!canDecide && !awaitingSecondApproval && <PermissionBanner permission={MARKETPLACE_PERMS.appealsDecide} />}

          {decidable && (
            <Card title="Decide">
              <label style={lbl()}>reason_code (mandatory)</label>
              <input
                value={reasonCode} onChange={(e) => setReasonCode(e.target.value)} placeholder="e.g. evidence_insufficient / decision_reversed"
                style={{ padding: '0.4rem 0.55rem', border: '1px solid #d1d5db', borderRadius: '0.375rem', fontSize: '0.85rem', width: '100%', boxSizing: 'border-box', marginBottom: '0.6rem' }}
              />
              <label style={lbl()}>Notes (optional)</label>
              <textarea style={textarea()} value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Reasoning for the record…" />
              <div style={{ display: 'flex', gap: '0.6rem', marginTop: '0.8rem' }}>
                <button style={canDecide && reasonCode.trim() && !busy ? btnPrimary('#15803d') : btnDisabled()} disabled={!canDecide || !reasonCode.trim() || busy} onClick={() => void decide('overturn')}>
                  {busy ? '…' : 'Overturn (reverse action)'}
                </button>
                <button style={canDecide && reasonCode.trim() && !busy ? btnDanger() : btnDisabled()} disabled={!canDecide || !reasonCode.trim() || busy} onClick={() => void decide('uphold')}>
                  Uphold (deny appeal)
                </button>
              </div>
              <AuditNote>Overturn requires a second approver; uphold executes immediately. Both are audited.</AuditNote>
            </Card>
          )}

          {awaitingSecondApproval && (
            <Card title="Second approval">
              <p style={{ fontSize: '0.85rem', color: '#374151', marginTop: 0 }}>
                Confirm the overturn recorded by <code>{data.decided_by}</code>. This reverses the original {data.target_type} action.
              </p>
              <label style={lbl()}>reason_code (optional)</label>
              <input
                value={reasonCode} onChange={(e) => setReasonCode(e.target.value)} placeholder="second-approver note"
                style={{ padding: '0.4rem 0.55rem', border: '1px solid #d1d5db', borderRadius: '0.375rem', fontSize: '0.85rem', width: '100%', boxSizing: 'border-box', marginBottom: '0.6rem' }}
              />
              <button
                style={canDecide && !sameApproverConflict && !busy ? btnPrimary() : btnDisabled()}
                disabled={!canDecide || sameApproverConflict || busy}
                onClick={() => void secondSign()}
              >{busy ? '…' : 'Approve & execute overturn'}</button>
              {sameApproverConflict && <p style={{ color: '#b91c1c', fontSize: '0.8rem', marginTop: '0.5rem' }}>You recorded the original decision — a different admin must approve.</p>}
            </Card>
          )}

          {data.status === 'executed' && (
            <Card title="Outcome">
              <p style={{ fontSize: '0.88rem', color: '#374151', margin: 0 }}>
                <strong>{data.decision}</strong> · decided by <code>{data.decided_by}</code>
                {data.second_approver_id && <> · second approver <code>{data.second_approver_id}</code></>} · {fmtDate(data.executed_at)}
              </p>
              {data.decision_notes ? <p style={{ fontSize: '0.82rem', color: '#6b7280' }}>{data.decision_notes}</p> : null}
            </Card>
          )}
        </>
      ) : null}
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
