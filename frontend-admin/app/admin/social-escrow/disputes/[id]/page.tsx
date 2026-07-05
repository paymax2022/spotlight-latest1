'use client';

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { getDispute, arbitrateDispute, formatNaira } from '@/services/escrowAdminService';
import type { DisputeDetail, ArbitrationDecision } from '@/types/escrowAdmin';
import { PageHeader, Card, Kpi, Badge, DisclosureNote, StateBlock, AuditNote, btn, btnPrimary, btnDanger, th, td, timeAgo, fmtDate } from '../../../creators/_ui';

export default function DisputeDetailPage() {
  const params = useParams<{ id: string }>();
  const id = params?.id ?? '';
  const [data, setData] = useState<DisputeDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true); setError(null);
    try { setData(await getDispute(id)); }
    catch (e) { setError(String(e)); }
    finally { setLoading(false); }
  }, [id]);
  useEffect(() => { if (id) load(); }, [id, load]);

  // Separation-of-duties: arbitrator must differ from the underlying release approver.
  const CURRENT_ARBITRATOR = 'admin:you•••';
  const sodConflict = !!data && data.release_approver_masked === CURRENT_ARBITRATOR;
  const resolvable = !!data && (data.status === 'open' || data.status === 'in_review' || data.status === 'awaiting_evidence');

  async function arbitrate(decision: ArbitrationDecision) {
    const note = window.prompt(`${decision.replace('_', ' ')} dispute ${id}? This is an audited arbitration decision (NL-12). Enter a note:`);
    if (note === null) return;
    setBusy(true); setMsg(null);
    try {
      const res = await arbitrateDispute(id, decision, note || undefined);
      setMsg(res.message + ` (audit ${res.audit_id})`);
      await load();
    } catch (e) { setMsg(String(e)); }
    finally { setBusy(false); }
  }

  return (
    <div style={{ padding: '0.5rem 0.5rem 2rem' }}>
      <PageHeader
        title="Dispute arbitration console"
        subtitle={`Dispute ${id}`}
        action={<div style={{ display: 'flex', gap: '0.5rem' }}><Link href="/admin/social-escrow/disputes" style={btn()}>Back to queue</Link><button onClick={load} style={btn()}>Refresh</button></div>}
      />

      <DisclosureNote>
        Decide <strong>RELEASE</strong> (escrow → seller) or <strong>REFUND</strong> (escrow → buyer). Paymax holds, never lends — funds remain in the buyer&apos;s held sub-balance until you decide (NL-6).
        <strong> Separation-of-duties:</strong> you cannot arbitrate a dispute whose underlying release you approved. Every decision posts an immutable audit event (NL-12).
      </DisclosureNote>

      {msg && <AuditNote>{msg}</AuditNote>}

      <StateBlock loading={loading} error={error} empty={!data} emptyText="Dispute not found.">
        {data && (
          <>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(170px, 1fr))', gap: '0.75rem', marginBottom: '1.25rem' }}>
              <Kpi label="Amount in escrow" value={formatNaira(data.amount_kobo)} accent="#340075" />
              <Kpi label="Escrow state" value={data.escrow_state.replace(/_/g, ' ')} />
              <Kpi label="Dispute status" value={data.status.replace(/_/g, ' ')} />
              <Kpi label="Reason" value={data.reason.replace(/_/g, ' ')} />
              <Kpi label="Seller rating" value={`${data.seller_rating.toFixed(1)} / 5`} />
              <Kpi label="Buyer prior disputes" value={String(data.buyer_prior_disputes)} accent={data.buyer_prior_disputes > 2 ? '#9a3412' : undefined} />
              <Kpi label="Seller prior disputes" value={String(data.seller_prior_disputes)} accent={data.seller_prior_disputes > 2 ? '#9a3412' : undefined} />
              <Kpi label="SLA due" value={timeAgo(data.sla_due_at)} />
            </div>

            <Card title="Parties">
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1rem' }}>
                <div>
                  <div style={{ fontSize: '0.72rem', color: '#6b7280', textTransform: 'uppercase', fontWeight: 600 }}>Buyer</div>
                  <div style={{ fontWeight: 600, marginTop: 4 }}>{data.buyer_masked}</div>
                  <div style={{ marginTop: 4 }}><Badge status={data.buyer_kyc_tier} /></div>
                </div>
                <div>
                  <div style={{ fontSize: '0.72rem', color: '#6b7280', textTransform: 'uppercase', fontWeight: 600 }}>Seller</div>
                  <div style={{ fontWeight: 600, marginTop: 4 }}>{data.seller_masked}</div>
                  <div style={{ marginTop: 4 }}><Badge status={data.seller_kyc_tier} /></div>
                </div>
              </div>
              <p style={{ marginTop: '1rem', color: '#374151', fontSize: '0.88rem' }}><strong>{data.listing_title}</strong> — {data.description}</p>
            </Card>

            {/* Separation-of-duties banner */}
            <Card title="Arbitration decision">
              {sodConflict ? (
                <div style={{ border: '1px solid #fecaca', background: '#fef2f2', color: '#b91c1c', borderRadius: '0.5rem', padding: '0.75rem 1rem', fontSize: '0.85rem', marginBottom: '1rem' }}>
                  <strong>Separation-of-duties block.</strong> You ({CURRENT_ARBITRATOR}) approved the underlying release for this escrow
                  (approver: {data.release_approver_masked}). You cannot also arbitrate it. Reassign to a different arbitrator.
                </div>
              ) : (
                <div style={{ fontSize: '0.8rem', color: '#6b7280', marginBottom: '0.75rem' }}>
                  Underlying release approver: <strong>{data.release_approver_masked ?? '—'}</strong> · current arbitrator: <strong>{data.current_arbitrator_masked ?? 'unassigned'}</strong>
                </div>
              )}
              <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap' }}>
                <button style={btnPrimary()} disabled={busy || !resolvable || sodConflict} onClick={() => arbitrate('release')}>{busy ? '…' : 'Release to seller'}</button>
                <button style={btnDanger()} disabled={busy || !resolvable || sodConflict} onClick={() => arbitrate('refund')}>Refund to buyer</button>
                <button style={btn()} disabled={busy || !resolvable} onClick={() => arbitrate('request_evidence')}>Request evidence</button>
                <button style={btn()} disabled={busy || !resolvable} onClick={() => arbitrate('assign')}>Assign to me</button>
              </div>
              {!resolvable && <p style={{ color: '#9ca3af', fontSize: '0.78rem', marginTop: '0.5rem' }}>This dispute is already resolved — no further action available.</p>}
            </Card>

            <Card title={`Evidence (${data.evidence.length})`}>
              <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                <thead><tr><th style={th()}>From</th><th style={th()}>Submitter</th><th style={th()}>Kind</th><th style={th()}>Note</th><th style={th()}>Attachment</th><th style={th()}>When</th></tr></thead>
                <tbody>
                  {data.evidence.map((e) => (
                    <tr key={e.id}>
                      <td style={td()}><Badge status={e.from === 'buyer' ? 'in_review' : e.from === 'seller' ? 'pending' : 'normal'} label={e.from} /></td>
                      <td style={td()}>{e.submitter_masked}</td>
                      <td style={td()}>{e.kind.replace(/_/g, ' ')}</td>
                      <td style={td()}><span style={{ maxWidth: 360, display: 'inline-block' }}>{e.note}</span></td>
                      <td style={td()}>{e.attachment_masked ? <code style={{ fontSize: '0.76rem' }}>{e.attachment_masked}</code> : <span style={{ color: '#9ca3af' }}>—</span>}</td>
                      <td style={td()}>{timeAgo(e.at)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </Card>

            <Card title="Timeline">
              <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                <thead><tr><th style={th()}>State</th><th style={th()}>Event</th><th style={th()}>Actor</th><th style={th()}>Audit</th><th style={th()}>When</th></tr></thead>
                <tbody>
                  {data.timeline.map((t) => (
                    <tr key={t.id}>
                      <td style={td()}><Badge status={t.status} /></td>
                      <td style={td()}>{t.label}</td>
                      <td style={td()}>{t.actor_masked}</td>
                      <td style={td()}><code style={{ fontSize: '0.76rem' }}>{t.audit_id}</code></td>
                      <td style={td()}>{fmtDate(t.at)} · {timeAgo(t.at)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </Card>
          </>
        )}
      </StateBlock>
    </div>
  );
}
