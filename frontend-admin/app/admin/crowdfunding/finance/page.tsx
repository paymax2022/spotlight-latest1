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

      {loading || !summary ? <p style={{ color: colors.muted }}>Loading finance…</p> : (
        <>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(190px, 1fr))', gap: '0.75rem', marginBottom: '1.5rem' }}>
            <Kpi label="GMV" value={naira(summary.gmvKobo)} />
            <Kpi label="Platform revenue" value={naira(summary.platformRevenueKobo)} accent={colors.info} />
            <Kpi label="Refunds pending" value={`${summary.refundsPendingCount} · ${naira(summary.refundsPendingKobo)}`} accent={colors.warning} />
            <Kpi label="Chargebacks" value={`${summary.chargebacksCount} · ${naira(summary.chargebacksKobo)}`} accent={colors.danger} />
            <Kpi label="In escrow" value={naira(summary.escrowKobo)} />
            <Kpi label="Settled (month)" value={naira(summary.settledThisMonthKobo)} accent={colors.success} />
            <Kpi label="Reconciliation gaps" value={String(summary.reconciliationMismatches)} accent={summary.reconciliationMismatches > 0 ? colors.danger : colors.success} />
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
                    <td style={tdCell}><span style={{ fontFamily: 'monospace', fontSize: '0.75rem' }}>{b.reference}</span></td>
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

function Kpi({ label, value, accent }: { label: string; value: string; accent?: string }) {
  return (
    <Card style={{ padding: '0.9rem 1rem', borderLeft: `3px solid ${accent ?? colors.border}` }}>
      <div style={{ fontSize: '0.72rem', color: colors.muted, textTransform: 'uppercase', letterSpacing: 0.4 }}>{label}</div>
      <div style={{ fontSize: '1.25rem', fontWeight: 700, marginTop: 4, color: colors.text }}>{value}</div>
    </Card>
  );
}

const h2 = (): React.CSSProperties => ({ fontSize: '1.05rem', fontWeight: 700, margin: '0 0 0.75rem', color: colors.text });
const overlay = (): React.CSSProperties => ({ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.5)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 50 });
const sheet = (): React.CSSProperties => ({ background: colors.card, borderRadius: '0.75rem', padding: '1.5rem', width: '100%', maxWidth: '28rem', boxShadow: '0 20px 60px rgba(0,0,0,0.3)' });
const textarea = (): React.CSSProperties => ({ display: 'block', width: '100%', marginTop: '0.35rem', padding: '0.5rem', border: `1px solid ${colors.inputBorder}`, borderRadius: '0.375rem', resize: 'vertical', boxSizing: 'border-box' });
