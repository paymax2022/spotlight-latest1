'use client';

import Link from 'next/link';
import { useCallback, useEffect, useState } from 'react';
import { useParams } from 'next/navigation';
import {
  getDispute, decideDispute, approveDisputeSecondSign, formatKobo, DUAL_APPROVAL_THRESHOLD_KOBO,
} from '@/services/marketplaceAdminService';
import type { MktDispute, MktDisputeDecision, MktEvidenceItem } from '@/types/marketplaceAdmin';
import {
  PageHeader, Card, Kpi, StatusBadge, DisclosureNote, StateBlock, AuditNote, PermissionBanner,
  DualApprovalBanner, btn, btnPrimary, btnDanger, btnDisabled, textarea, select, label as lbl,
  th, td, timeAgo, fmtDate, MARKETPLACE_PERMS, useMarketplacePermission, useCurrentAdminId,
} from '../../_ui';

const DECISION_OPTIONS: { value: MktDisputeDecision; label: string }[] = [
  { value: 'refund_buyer', label: 'Refund buyer (escrow → buyer wallet)' },
  { value: 'release_seller', label: 'Release to seller (escrow → seller wallet)' },
  { value: 'split', label: 'Split (partial to each party)' },
];

export default function DisputeWorkbenchPage() {
  const params = useParams<{ id: string }>();
  const id = params?.id ?? '';

  const { allowed: canDecide } = useMarketplacePermission(MARKETPLACE_PERMS.disputeDecide);
  const { allowed: canSecondApprove } = useMarketplacePermission(MARKETPLACE_PERMS.disputeApprove);
  const currentAdminId = useCurrentAdminId();

  const [data, setData] = useState<MktDispute | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  const [decision, setDecision] = useState<MktDisputeDecision>('refund_buyer');
  const [reasonCode, setReasonCode] = useState('');
  const [notes, setNotes] = useState('');

  const load = useCallback(async () => {
    setLoading(true); setError(null);
    try { setData(await getDispute(id)); }
    catch (e) { setError(String(e)); }
    finally { setLoading(false); }
  }, [id]);
  useEffect(() => { if (id) void load(); }, [id, load]);

  const amountKobo = data?.order?.amount_kobo ?? 0;
  const isHighValue = amountKobo > DUAL_APPROVAL_THRESHOLD_KOBO;
  const awaitingSecondApproval = data?.status === 'decided' && data?.requires_dual_approval && !data?.executed_at;
  const decidable = !!data && (data.status === 'opened' || data.status === 'evidence_window' || data.status === 'under_review' || data.status === 'appealed');

  // Separation-of-duties: the second approver must be a different admin than
  // the original decider (backend enforces with 409 SAME_APPROVER_NOT_ALLOWED).
  const sameApproverConflict = !!data?.decided_by && !!currentAdminId && data.decided_by === currentAdminId;

  async function submitDecision() {
    if (!data) return;
    if (!reasonCode.trim()) { setError('reason_code is required to decide a dispute.'); return; }
    setBusy(true); setMsg(null); setError(null);
    try {
      const result = await decideDispute(data.id, { decision, reason_code: reasonCode.trim(), notes: notes.trim() || undefined });
      if (result.status === 'decided' && result.requires_dual_approval) {
        setMsg(`Decision recorded (${decision.replace(/_/g, ' ')}) — awaiting second approver (order ${formatKobo(amountKobo)} > ₦500,000 dual-approval threshold). A different admin must approve via the button below before funds move.`);
      } else {
        setMsg(`Dispute decided and executed: ${decision.replace(/_/g, ' ')}. Ledger transaction posted. Buyer and seller notified identically.`);
      }
      setData(result);
    } catch (e) { setError(String(e)); }
    finally { setBusy(false); }
  }

  async function submitSecondApproval() {
    if (!data) return;
    setBusy(true); setMsg(null); setError(null);
    try {
      const result = await approveDisputeSecondSign(data.id, reasonCode.trim() || undefined);
      setMsg(`Second approval recorded. Ledger transaction executed. Buyer and seller notified identically with the decision + reason_code.`);
      setData(result);
    } catch (e) { setError(String(e)); }
    finally { setBusy(false); }
  }

  return (
    <div style={{ padding: '0.5rem 0.5rem 2rem' }}>
      <PageHeader
        title="Dispute workbench (M4)"
        subtitle={`Dispute ${id}`}
        action={<div style={{ display: 'flex', gap: '0.5rem' }}>
          <Link href="/admin/marketplace/disputes" style={btn()}>Back to queue</Link>
          <button onClick={() => void load()} style={btn()}>Refresh</button>
        </div>}
      />
      <DisclosureNote>
        Decide via <code>POST /admin/disputes/:id/decide</code> (reason_code MANDATORY). If the order amount exceeds <strong>₦500,000</strong>,
        the API returns <code>awaiting_second_approval</code> instead of executing — a <strong>different</strong> admin must then call
        <code> POST /admin/disputes/:id/approve</code>. Both buyer and seller receive an identical notification with the decision + reason_code (never asymmetric).
      </DisclosureNote>

      {error && <p style={{ color: '#dc2626' }}>{error}</p>}
      {msg && <AuditNote>{msg}</AuditNote>}

      <StateBlock loading={loading} error={null} empty={!data} emptyText="Dispute not found.">
        {data && (
          <>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(170px, 1fr))', gap: '0.75rem', marginBottom: '1.25rem' }}>
              <Kpi label="Order amount" value={formatKobo(amountKobo)} accent={isHighValue ? '#1d4ed8' : '#340075'} sub={isHighValue ? 'Dual-approval required' : undefined} />
              <Kpi label="Dispute status" value={data.status.replace(/_/g, ' ')} />
              <Kpi label="Order status" value={data.order?.status?.replace(/_/g, ' ') ?? '—'} />
              <Kpi label="Reason code" value={data.reason_code.replace(/_/g, ' ')} />
              <Kpi label="Evidence deadline" value={timeAgo(data.evidence_deadline)} />
              <Kpi label="Opened" value={fmtDate(data.created_at)} />
            </div>

            {awaitingSecondApproval && (
              <DualApprovalBanner>
                Decision <strong>{data.decision?.replace(/_/g, ' ')}</strong> was recorded by <code>{data.decided_by}</code> and is awaiting a second,
                distinct approver before the ledger transaction executes. {sameApproverConflict && (
                  <span style={{ display: 'block', marginTop: '0.4rem', color: '#b91c1c', fontWeight: 600 }}>
                    You are the original decider — you cannot also be the second approver. A different admin must sign off.
                  </span>
                )}
              </DualApprovalBanner>
            )}

            <Card title="Order context">
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1rem', fontSize: '0.85rem', color: '#374151' }}>
                <div><strong>Listing:</strong> {data.listing_title ?? data.order?.listing_id ?? '—'}</div>
                <div><strong>Order:</strong> <code>{data.order_id}</code></div>
                <div><strong>Buyer:</strong> <code>{data.order?.buyer_id ?? '—'}</code></div>
                <div><strong>Seller:</strong> <code>{data.order?.seller_id ?? '—'}</code></div>
                <div><strong>Escrow fee:</strong> {formatKobo(data.order?.escrow_fee_kobo)}</div>
                <div><strong>Delivery fee:</strong> {formatKobo(data.order?.delivery_fee_kobo)}</div>
              </div>
            </Card>

            <Card title="Evidence — side by side">
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1rem' }}>
                <EvidenceColumn title="Buyer evidence" items={data.buyer_evidence ?? []} />
                <EvidenceColumn title="Seller evidence" items={data.seller_evidence ?? []} />
              </div>
              {data.evidence && data.evidence.length > 0 && (
                <div style={{ marginTop: '1rem' }}>
                  <EvidenceColumn title="Additional evidence" items={data.evidence} />
                </div>
              )}
            </Card>

            <Card title="Decision">
              {!canDecide && !awaitingSecondApproval && <PermissionBanner permission={MARKETPLACE_PERMS.disputeDecide} />}
              {!decidable && !awaitingSecondApproval && (
                <p style={{ color: '#6b7280', fontSize: '0.85rem', marginBottom: '0.75rem' }}>
                  This dispute is <strong>{data.status.replace(/_/g, ' ')}</strong> — no further decision action is available.
                </p>
              )}

              {!awaitingSecondApproval && decidable && (
                <>
                  <div style={{ display: 'grid', gridTemplateColumns: '1fr', gap: '0.6rem', maxWidth: 520 }}>
                    <div>
                      <label style={lbl()}>Decision</label>
                      <select style={select()} value={decision} onChange={(e) => setDecision(e.target.value as MktDisputeDecision)} disabled={!canDecide}>
                        {DECISION_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
                      </select>
                    </div>
                    <div>
                      <label style={lbl()}>reason_code (MANDATORY)</label>
                      <textarea
                        style={textarea()}
                        placeholder="e.g. EVIDENCE_SUPPORTS_BUYER, ITEM_MATCHES_DESCRIPTION, PARTIAL_FAULT_BOTH_PARTIES…"
                        value={reasonCode}
                        onChange={(e) => setReasonCode(e.target.value)}
                        disabled={!canDecide}
                      />
                    </div>
                    <div>
                      <label style={lbl()}>Notes (optional, internal + shown in notification)</label>
                      <textarea style={textarea()} value={notes} onChange={(e) => setNotes(e.target.value)} disabled={!canDecide} />
                    </div>
                  </div>
                  {isHighValue && (
                    <p style={{ fontSize: '0.78rem', color: '#1d4ed8', marginTop: '0.5rem' }}>
                      This order ({formatKobo(amountKobo)}) exceeds the ₦500,000 threshold — this decision will require a second, distinct approver before funds move.
                    </p>
                  )}
                  <div style={{ marginTop: '0.75rem' }}>
                    <button
                      style={canDecide && reasonCode.trim() && !busy ? btnPrimary() : btnDisabled()}
                      disabled={!canDecide || !reasonCode.trim() || busy}
                      onClick={() => void submitDecision()}
                    >
                      {busy ? '…' : 'Submit decision'}
                    </button>
                  </div>
                </>
              )}

              {awaitingSecondApproval && (
                <>
                  {!canSecondApprove && <PermissionBanner permission={MARKETPLACE_PERMS.disputeApprove} />}
                  <label style={lbl()}>reason_code (optional — inherits the original decision's reason if omitted)</label>
                  <textarea style={textarea()} value={reasonCode} onChange={(e) => setReasonCode(e.target.value)} placeholder="Optional second-approver note" disabled={!canSecondApprove} />
                  <div style={{ marginTop: '0.75rem' }}>
                    <button
                      style={canSecondApprove && !sameApproverConflict && !busy ? btnPrimary('#1d4ed8') : btnDisabled()}
                      disabled={!canSecondApprove || sameApproverConflict || busy}
                      onClick={() => void submitSecondApproval()}
                    >
                      {busy ? '…' : 'Second-approver: approve & execute'}
                    </button>
                  </div>
                </>
              )}
            </Card>

            {data.status === 'executed' && (
              <Card title="Outcome">
                <p style={{ fontSize: '0.85rem', color: '#15803d' }}>
                  Executed: <strong>{data.decision?.replace(/_/g, ' ')}</strong> · decided by <code>{data.decided_by}</code>
                  {data.second_approver_id && <> · second approver <code>{data.second_approver_id}</code></>} · {fmtDate(data.executed_at)}
                </p>
                {data.decision_notes && <p style={{ fontSize: '0.82rem', color: '#374151' }}>{data.decision_notes}</p>}
              </Card>
            )}
          </>
        )}
      </StateBlock>
    </div>
  );
}

function EvidenceColumn({ title, items }: { title: string; items: MktEvidenceItem[] }) {
  return (
    <div>
      <h3 style={{ fontSize: '0.85rem', fontWeight: 700, marginBottom: '0.5rem' }}>{title} ({items.length})</h3>
      {items.length === 0 ? (
        <p style={{ color: '#9ca3af', fontSize: '0.8rem' }}>No evidence submitted.</p>
      ) : (
        <table style={{ width: '100%', borderCollapse: 'collapse' }}>
          <thead><tr><th style={th()}>Kind</th><th style={th()}>Content</th><th style={th()}>When</th></tr></thead>
          <tbody>
            {items.map((e, i) => (
              <tr key={i}>
                <td style={td()}>{e.type.replace(/_/g, ' ')}</td>
                <td style={td()}>
                  {e.type === 'photo' ? <img src={e.url_or_text} alt="" style={{ width: 80, height: 80, objectFit: 'cover', borderRadius: 4 }} /> : <span style={{ maxWidth: 300, display: 'inline-block' }}>{e.url_or_text}</span>}
                </td>
                <td style={td()}>{timeAgo(e.created_at)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}
