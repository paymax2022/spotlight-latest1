'use client';

import { useCallback, useEffect, useState } from 'react';
import { getFinanceSummary, listRefunds, decideRefund, listSettlements } from '@/services/crowdfundingAdminService';
import type { CfFinanceSummary, CfRefundRequest, CfSettlementBatch } from '@/types/crowdfunding';

function naira(kobo: number): string {
  const n = kobo / 100;
  if (n >= 1_000_000) return `₦${(n / 1_000_000).toFixed(2)}M`;
  if (n >= 1_000) return `₦${(n / 1_000).toFixed(1)}K`;
  return `₦${n.toLocaleString('en-NG')}`;
}

const REFUND_BADGE: Record<string, string> = { REQUESTED: '#d97706', APPROVED: '#16a34a', REJECTED: '#6b7280', PROCESSED: '#1d4ed8' };
const STL_BADGE: Record<string, string> = { PENDING: '#d97706', PROCESSING: '#1d4ed8', SETTLED: '#16a34a', FAILED: '#dc2626' };

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
    <div style={{ padding: '0.5rem 0.5rem 2rem' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1.25rem' }}>
        <div>
          <h1 style={{ fontSize: '1.5rem', fontWeight: 700, margin: 0 }}>Crowdfunding Finance</h1>
          <p style={{ color: '#6b7280', margin: '0.25rem 0 0', fontSize: '0.85rem' }}>Refunds, settlement and reconciliation.</p>
        </div>
        <button onClick={load} style={btn()}>Refresh</button>
      </div>

      {error && <p style={{ color: '#dc2626', marginBottom: '1rem' }}>{error}</p>}

      {loading || !summary ? <p style={{ color: '#6b7280' }}>Loading finance…</p> : (
        <>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(190px, 1fr))', gap: '0.75rem', marginBottom: '1.5rem' }}>
            <Kpi label="GMV" value={naira(summary.gmvKobo)} />
            <Kpi label="Platform revenue" value={naira(summary.platformRevenueKobo)} accent="#1d4ed8" />
            <Kpi label="Refunds pending" value={`${summary.refundsPendingCount} · ${naira(summary.refundsPendingKobo)}`} accent="#d97706" />
            <Kpi label="Chargebacks" value={`${summary.chargebacksCount} · ${naira(summary.chargebacksKobo)}`} accent="#dc2626" />
            <Kpi label="In escrow" value={naira(summary.escrowKobo)} />
            <Kpi label="Settled (month)" value={naira(summary.settledThisMonthKobo)} accent="#16a34a" />
            <Kpi label="Reconciliation gaps" value={String(summary.reconciliationMismatches)} accent={summary.reconciliationMismatches > 0 ? '#dc2626' : '#16a34a'} />
          </div>

          {/* Refund queue */}
          <h2 style={h2()}>Refund requests</h2>
          {refunds.length === 0 ? <p style={muted()}>No refund requests.</p> : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '0.6rem', marginBottom: '1.5rem' }}>
              {refunds.map((r) => (
                <div key={r.id} style={card()}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: '1rem' }}>
                    <div style={{ flex: 1 }}>
                      <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center', marginBottom: 4 }}>
                        <span style={badge(REFUND_BADGE[r.status])}>{r.status}</span>
                        <span style={{ fontSize: '0.72rem', color: '#6b7280', fontFamily: 'monospace' }}>{r.reference}</span>
                      </div>
                      <div style={{ fontWeight: 600, fontSize: '0.9rem' }}>{r.campaignTitle}</div>
                      <div style={{ fontSize: '0.8rem', color: '#6b7280' }}>{r.contributorName} · {new Date(r.requestedAt).toLocaleString()}</div>
                      <div style={{ fontSize: '0.8rem', color: '#374151', marginTop: 4 }}>“{r.reason}”</div>
                    </div>
                    <div style={{ textAlign: 'right' }}>
                      <div style={{ fontSize: '1.1rem', fontWeight: 700 }}>{naira(r.amountKobo)}</div>
                      {r.status === 'REQUESTED' && (
                        <div style={{ display: 'flex', gap: '0.4rem', marginTop: '0.5rem' }}>
                          <button disabled={busy === r.id} onClick={() => { setModal({ id: r.id, approve: false, amount: r.amountKobo, note: '' }); setError(null); }} style={{ ...btn(), color: '#dc2626', borderColor: '#fca5a5' }}>Reject</button>
                          <button disabled={busy === r.id} onClick={() => { setModal({ id: r.id, approve: true, amount: r.amountKobo, note: '' }); setError(null); }} style={primaryBtn('#16a34a')}>Approve</button>
                        </div>
                      )}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}

          {/* Settlement batches */}
          <h2 style={h2()}>Settlement batches</h2>
          <div style={card()}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.82rem' }}>
              <thead><tr style={{ textAlign: 'left', color: '#6b7280', borderBottom: '1px solid #e5e7eb' }}>
                <th style={th()}>Batch</th><th style={th()}>Payouts</th><th style={th()}>Gross</th><th style={th()}>Fee</th><th style={th()}>Net</th><th style={th()}>Status</th>
              </tr></thead>
              <tbody>
                {settlements.map((b) => (
                  <tr key={b.id} style={{ borderBottom: '1px solid #f3f4f6' }}>
                    <td style={td()}><span style={{ fontFamily: 'monospace', fontSize: '0.75rem' }}>{b.reference}</span></td>
                    <td style={td()}>{b.payoutCount}</td>
                    <td style={td()}>{naira(b.grossKobo)}</td>
                    <td style={td()}>{naira(b.feeKobo)}</td>
                    <td style={td()}><strong>{naira(b.netKobo)}</strong></td>
                    <td style={td()}><span style={badge(STL_BADGE[b.status])}>{b.status}</span></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}

      {modal && (
        <div style={overlay()}>
          <div style={sheet()}>
            <h2 style={{ fontWeight: 700, marginTop: 0 }}>{modal.approve ? 'Approve refund' : 'Reject refund'}</h2>
            <p style={{ fontSize: '0.85rem', color: '#374151' }}>{modal.approve ? `Approve a refund of ${naira(modal.amount)} to the contributor.` : 'The contributor will be notified with your reason.'}</p>
            <label style={{ display: 'block', fontSize: '0.85rem', fontWeight: 600 }}>
              {modal.approve ? 'Note (optional)' : 'Reason (required)'}
              <textarea value={modal.note} onChange={(e) => setModal({ ...modal, note: e.target.value })} rows={3} style={textarea()} />
            </label>
            {error && <p style={{ color: '#dc2626', fontSize: '0.85rem' }}>{error}</p>}
            <div style={{ display: 'flex', gap: '0.75rem', justifyContent: 'flex-end', marginTop: '0.75rem' }}>
              <button onClick={() => { setModal(null); setError(null); }} style={btn()}>Cancel</button>
              <button onClick={confirm} disabled={!!busy} style={primaryBtn(modal.approve ? '#16a34a' : '#dc2626')}>{busy ? 'Working…' : 'Confirm'}</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function Kpi({ label, value, accent }: { label: string; value: string; accent?: string }) {
  return (
    <div style={{ ...card(), padding: '0.9rem 1rem', borderLeft: `3px solid ${accent ?? '#e5e7eb'}` }}>
      <div style={{ fontSize: '0.72rem', color: '#6b7280', textTransform: 'uppercase', letterSpacing: 0.4 }}>{label}</div>
      <div style={{ fontSize: '1.25rem', fontWeight: 700, marginTop: 4, color: '#111827' }}>{value}</div>
    </div>
  );
}

const card = (): React.CSSProperties => ({ border: '1px solid #e5e7eb', borderRadius: '0.5rem', padding: '1rem', background: '#fff' });
const btn = (): React.CSSProperties => ({ padding: '0.4rem 0.8rem', borderRadius: '0.375rem', border: '1px solid #d1d5db', background: '#fff', cursor: 'pointer', fontSize: '0.85rem' });
const primaryBtn = (bg: string): React.CSSProperties => ({ padding: '0.4rem 0.8rem', borderRadius: '0.375rem', border: 'none', background: bg, color: '#fff', fontWeight: 600, cursor: 'pointer', fontSize: '0.85rem' });
const h2 = (): React.CSSProperties => ({ fontSize: '1.05rem', fontWeight: 700, margin: '0 0 0.75rem' });
const th = (): React.CSSProperties => ({ padding: '0.4rem 0.5rem', fontWeight: 600 });
const td = (): React.CSSProperties => ({ padding: '0.5rem 0.5rem', color: '#374151' });
const muted = (): React.CSSProperties => ({ color: '#6b7280', marginBottom: '1.5rem' });
const overlay = (): React.CSSProperties => ({ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.5)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 50 });
const sheet = (): React.CSSProperties => ({ background: '#fff', borderRadius: '0.75rem', padding: '1.5rem', width: '100%', maxWidth: '28rem', boxShadow: '0 20px 60px rgba(0,0,0,0.3)' });
const textarea = (): React.CSSProperties => ({ display: 'block', width: '100%', marginTop: '0.35rem', padding: '0.5rem', border: '1px solid #d1d5db', borderRadius: '0.375rem', resize: 'vertical', boxSizing: 'border-box' });
function badge(bg: string): React.CSSProperties {
  return { background: bg, color: '#fff', padding: '0.1rem 0.5rem', borderRadius: '9999px', fontSize: '0.68rem', fontWeight: 700, textTransform: 'uppercase', letterSpacing: 0.3 };
}
