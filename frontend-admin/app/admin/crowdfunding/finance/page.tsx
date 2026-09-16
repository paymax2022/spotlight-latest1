'use client';

import { useCallback, useEffect, useState } from 'react';
import { getFinanceSummary, listRefunds, decideRefund, listSettlements } from '@/services/crowdfundingAdminService';
import type { CfFinanceSummary, CfRefundRequest, CfSettlementBatch } from '@/types/crowdfunding';
import { Page, PageHeader, Card, Button, Badge, colors, thCell, tdCell } from '@/components/ui/vuexy';

function naira(kobo: number): string {
  const n = kobo / 100;
  if (n >= 1_000_000) return `₦${(n / 1_000_000).toFixed(2)}M`;
  if (n >= 1_000) return `₦${(n / 1_000).toFixed(1)}K`;
  return `₦${n.toLocaleString('en-NG')}`;
}

const REFUND_BADGE: Record<string, string> = { REQUESTED: colors.warning, APPROVED: colors.success, REJECTED: colors.muted, PROCESSED: colors.info };
const STL_BADGE: Record<string, string> = { PENDING: colors.warning, PROCESSING: colors.info, SETTLED: colors.success, FAILED: colors.danger };

export default function CrowdfundingFinancePage() {
  const [summary, setSummary] = useState<CfFinanceSummary | null>(null);
  const [refunds, setRefunds] = useState<CfRefundRequest[]>([]);
  const [settlements, setSettlements] = useState<CfSettlementBatch[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [modal, setModal] = useState<{ id: string; approve: boolean; amount: number; note: string } | null>(null);

  const load = useCallback(async () => {
    setLoading(true); setError(null);
    try {
      const [s, r, b] = await Promise.all([getFinanceSummary(), listRefunds(), listSettlements()]);
      setSummary(s); setRefunds(r); setSettlements(b);
    } catch (e) { setError(String(e)); } finally { setLoading(false); }
  }, []);
  useEffect(() => { load(); }, [load]);

  async function confirm() {
    if (!modal) return;
    if (!modal.approve && !modal.note.trim()) { setError('A reason is required to reject.'); return; }
    setBusy(modal.id); setError(null);
    try { await decideRefund(modal.id, modal.approve, modal.note); setModal(null); await load(); }
    catch (e) { setError(String(e)); } finally { setBusy(null); }
  }

  return (
    <Page>
      <PageHeader
        title="Crowdfunding Finance"
        subtitle="Refunds, settlement and reconciliation."
        actions={<Button variant="outline" sm onClick={load}>Refresh</Button>}
      />

      {error && <p style={{ color: colors.danger, marginBottom: '1rem' }}>{error}</p>}

      {/* Three states, not two. The summary endpoint now fails loudly when a query
          cannot be answered (it used to swallow the error and return zeros), so a
          failed load leaves `summary` null with `loading` false — which the old
          `loading || !summary` condition rendered as "Loading finance…" forever.
          An outage must not read as a slow page any more than it should read as a
          quiet day. */}
      {loading ? <p style={{ color: colors.muted }}>Loading finance…</p> : !summary ? (
        <Card>
          <p style={{ margin: 0, fontWeight: 600, color: colors.danger }}>Finance figures could not be loaded.</p>
          <p style={{ margin: '0.35rem 0 0.75rem', fontSize: '0.85rem', color: colors.muted }}>
            No figures are shown rather than zeros — a zero here is indistinguishable from a quiet day.
          </p>
          <Button variant="outline" sm onClick={load}>Try again</Button>
        </Card>
      ) : (
        <>
          {/* This page reads two data planes and used to style them identically.
              GMV, escrow, platform revenue and the reconciliation check are
              derived from live contributions and the commission registry. The
              refund queue and settlement table come from cf_refunds /
              cf_settlements, whose only writer in the repository is a seed
              migration — so the two halves cannot be reconciled against each
              other, and an operator had no way to see that. */}
          {summary.demoRefundRows + summary.demoSettlementRows > 0 && (
            <div
              role="status"
              style={{
                border: `1px solid ${colors.danger}`, borderRadius: 10, padding: '0.75rem 1rem',
                marginBottom: '1rem', fontSize: '0.85rem', lineHeight: 1.5, color: colors.danger,
              }}
            >
              <strong>Part of this page is sample data.</strong>{' '}
              {summary.demoRefundRows} refund {summary.demoRefundRows === 1 ? 'request' : 'requests'} and{' '}
              {summary.demoSettlementRows} settlement {summary.demoSettlementRows === 1 ? 'batch' : 'batches'} below are seeded
              fixtures, marked <em>Sample</em>. They feed the refunds-pending, chargebacks and settled-this-month cards, so
              those figures do not reconcile against GMV — no refund or settlement pipeline writes to these tables yet.
              GMV, escrow, platform revenue and reconciliation gaps are live.
            </div>
          )}

          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(190px, 1fr))', gap: '0.75rem', marginBottom: '1.5rem' }}>
            <Kpi label="GMV" value={naira(summary.gmvKobo)} hint="Contributions, live" />
            <Kpi label="Platform revenue" value={naira(summary.platformRevenueKobo)} accent={colors.info} hint="Booked — commission registry" />
            <Kpi label="Refunds pending" value={`${summary.refundsPendingCount} · ${naira(summary.refundsPendingKobo)}`} accent={colors.warning} hint={summary.demoRefundRows > 0 ? 'Includes sample rows' : 'Refund queue'} />
            <Kpi label="Chargebacks" value={`${summary.chargebacksCount} · ${naira(summary.chargebacksKobo)}`} accent={colors.danger} hint={summary.demoRefundRows > 0 ? 'Includes sample rows' : 'Rejected refunds'} />
            <Kpi label="In escrow" value={naira(summary.escrowKobo)} hint="Contributions, live" />
            <Kpi label="Settled (month)" value={naira(summary.settledThisMonthKobo)} accent={colors.success} hint={summary.demoSettlementRows > 0 ? 'Includes sample rows' : 'Settled batches'} />
            <Kpi
              label="Reconciliation gaps"
              value={summary.reconciliationMismatches > 0 ? `${summary.reconciliationMismatches} · ${naira(summary.unbookedGrossKobo)}` : '0'}
              accent={summary.reconciliationMismatches > 0 ? colors.danger : colors.success}
              hint="Released contributions with no revenue booked"
            />
          </div>

          {/* Refund queue */}
          <h2 style={h2()}>Refund requests</h2>
          {refunds.length === 0 ? <p style={{ color: colors.muted, marginBottom: '1.5rem' }}>No refund requests.</p> : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '0.6rem', marginBottom: '1.5rem' }}>
              {refunds.map((r) => (
                <Card key={r.id}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: '1rem' }}>
                    <div style={{ flex: 1 }}>
                      <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center', marginBottom: 4 }}>
                        <Badge text={r.status} color={REFUND_BADGE[r.status]} />
                        {r.isDemo && <SampleTag />}
                        <span style={{ fontSize: '0.72rem', color: colors.muted, fontFamily: 'monospace' }}>{r.reference}</span>
                      </div>
                      <div style={{ fontWeight: 600, fontSize: '0.9rem' }}>{r.campaignTitle}</div>
                      <div style={{ fontSize: '0.8rem', color: colors.muted }}>{r.contributorName} · {new Date(r.requestedAt).toLocaleString()}</div>
                      <div style={{ fontSize: '0.8rem', color: colors.text, marginTop: 4 }}>“{r.reason}”</div>
                    </div>
                    <div style={{ textAlign: 'right' }}>
                      <div style={{ fontSize: '1.1rem', fontWeight: 700 }}>{naira(r.amountKobo)}</div>
                      {r.status === 'REQUESTED' && (
                        <div style={{ display: 'flex', gap: '0.4rem', marginTop: '0.5rem' }}>
                          <Button variant="danger" sm disabled={busy === r.id} onClick={() => { setModal({ id: r.id, approve: false, amount: r.amountKobo, note: '' }); setError(null); }}>Reject</Button>
                          <Button variant="primary" sm disabled={busy === r.id} onClick={() => { setModal({ id: r.id, approve: true, amount: r.amountKobo, note: '' }); setError(null); }}>Approve</Button>
                        </div>
                      )}
                    </div>
                  </div>
                </Card>
              ))}
            </div>
          )}

          {/* Settlement batches */}
          <h2 style={h2()}>Settlement batches</h2>
          <Card style={{ padding: 0, overflow: 'hidden' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.82rem' }}>
              <thead><tr>
                <th style={thCell}>Batch</th><th style={thCell}>Payouts</th><th style={thCell}>Gross</th><th style={thCell}>Fee</th><th style={thCell}>Net</th><th style={thCell}>Status</th>
              </tr></thead>
              <tbody>
                {settlements.map((b) => (
                  <tr key={b.id}>
                    <td style={tdCell}>
                      <span style={{ display: 'inline-flex', alignItems: 'center', gap: '0.4rem' }}>
                        <span style={{ fontFamily: 'monospace', fontSize: '0.75rem' }}>{b.reference}</span>
                        {b.isDemo && <SampleTag />}
                      </span>
                    </td>
                    <td style={tdCell}>{b.payoutCount}</td>
                    <td style={tdCell}>{naira(b.grossKobo)}</td>
                    <td style={tdCell}>{naira(b.feeKobo)}</td>
                    <td style={tdCell}><strong>{naira(b.netKobo)}</strong></td>
                    <td style={tdCell}><Badge text={b.status} color={STL_BADGE[b.status]} /></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </Card>
        </>
      )}

      {modal && (
        <div style={overlay()}>
          <div style={sheet()}>
            <h2 style={{ fontWeight: 700, marginTop: 0 }}>{modal.approve ? 'Approve refund' : 'Reject refund'}</h2>
            <p style={{ fontSize: '0.85rem', color: colors.text }}>{modal.approve ? `Approve a refund of ${naira(modal.amount)} to the contributor.` : 'The contributor will be notified with your reason.'}</p>
            <label style={{ display: 'block', fontSize: '0.85rem', fontWeight: 600 }}>
              {modal.approve ? 'Note (optional)' : 'Reason (required)'}
              <textarea value={modal.note} onChange={(e) => setModal({ ...modal, note: e.target.value })} rows={3} style={textarea()} />
            </label>
            {error && <p style={{ color: colors.danger, fontSize: '0.85rem' }}>{error}</p>}
            <div style={{ display: 'flex', gap: '0.75rem', justifyContent: 'flex-end', marginTop: '0.75rem' }}>
              <Button variant="outline" onClick={() => { setModal(null); setError(null); }}>Cancel</Button>
              <Button variant={modal.approve ? 'primary' : 'danger'} disabled={!!busy} onClick={confirm}>{busy ? 'Working…' : 'Confirm'}</Button>
            </div>
          </div>
        </div>
      )}
    </Page>
  );
}

// `hint` says where the number came from. Two of these cards were previously
// unsourceable by eye — one was a percentage assumed against GMV and one was a
// hardcoded zero — and both read as measurements. A finance card that cannot say
// what produced it should not be on a reconciliation page.
function Kpi({ label, value, accent, hint }: { label: string; value: string; accent?: string; hint?: string }) {
  return (
    <Card style={{ padding: '0.9rem 1rem', borderLeft: `3px solid ${accent ?? colors.border}` }}>
      <div style={{ fontSize: '0.72rem', color: colors.muted, textTransform: 'uppercase', letterSpacing: 0.4 }}>{label}</div>
      <div style={{ fontSize: '1.25rem', fontWeight: 700, marginTop: 4, color: colors.text }}>{value}</div>
      {hint ? <div style={{ fontSize: '0.68rem', color: colors.muted, marginTop: 3, lineHeight: 1.35 }}>{hint}</div> : null}
    </Card>
  );
}

// A row read out of cf_refunds / cf_settlements that the seed migration created.
function SampleTag() {
  return (
    <span
      title="Seed data from migration 20260622050000. No code path creates rows in this table."
      style={{
        fontSize: '0.6rem', fontWeight: 700, letterSpacing: 0.5, textTransform: 'uppercase',
        color: colors.danger, border: `1px solid ${colors.danger}`, borderRadius: 4, padding: '1px 5px',
      }}
    >
      Sample
    </span>
  );
}

const h2 = (): React.CSSProperties => ({ fontSize: '1.05rem', fontWeight: 700, margin: '0 0 0.75rem', color: colors.text });
const overlay = (): React.CSSProperties => ({ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.5)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 50 });
const sheet = (): React.CSSProperties => ({ background: colors.card, borderRadius: '0.75rem', padding: '1.5rem', width: '100%', maxWidth: '28rem', boxShadow: '0 20px 60px rgba(0,0,0,0.3)' });
const textarea = (): React.CSSProperties => ({ display: 'block', width: '100%', marginTop: '0.35rem', padding: '0.5rem', border: `1px solid ${colors.inputBorder}`, borderRadius: '0.375rem', resize: 'vertical', boxSizing: 'border-box' });
