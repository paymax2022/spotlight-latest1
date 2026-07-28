'use client';

import { useCallback, useEffect, useState } from 'react';
import { listWithdrawals, decideWithdrawal } from '@/services/crowdfundingAdminService';
import type { CfWithdrawal, CfRiskLevel } from '@/types/crowdfunding';

const STATUS_BADGE: Record<string, string> = {
  PENDING: '#d97706', PROCESSING: '#1d4ed8', APPROVED: '#16a34a', COMPLETED: '#16a34a', REJECTED: '#6b7280',
};
const RISK_COLOR: Record<CfRiskLevel, string> = { LOW: '#16a34a', MEDIUM: '#d97706', HIGH: '#dc2626' };
const naira = (kobo: number) => `₦${(kobo / 100).toLocaleString('en-NG')}`;

const FILTERS = ['PENDING', 'PROCESSING', 'APPROVED', 'REJECTED', ''];

export default function WithdrawalsAdminPage() {
  const [items, setItems] = useState<CfWithdrawal[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [filter, setFilter] = useState('PENDING');
  const [busy, setBusy] = useState<string | null>(null);
  const [modal, setModal] = useState<{ id: string; approve: boolean; amount: number; note: string } | null>(null);

  const load = useCallback(async () => {
    setLoading(true); setError(null);
    try { setItems(await listWithdrawals(filter || undefined)); }
    catch (e) { setError(String(e)); }
    finally { setLoading(false); }
  }, [filter]);
  useEffect(() => { load(); }, [load]);

  async function confirm() {
    if (!modal) return;
    if (!modal.approve && !modal.note.trim()) { setError('A reason is required to reject.'); return; }
    setBusy(modal.id); setError(null);
    try { await decideWithdrawal(modal.id, modal.approve, modal.note); setModal(null); await load(); }
    catch (e) { setError(String(e)); }
    finally { setBusy(null); }
  }

  return (
    <div style={{ padding: '0.5rem 0.5rem 2rem' }}>
      <h1 style={{ fontSize: '1.5rem', fontWeight: 700, marginBottom: '0.25rem' }}>Withdrawal Requests</h1>
      <p style={{ color: '#6b7280', margin: '0 0 1.25rem', fontSize: '0.85rem' }}>Approve or reject creator withdrawals. High-risk requests need enhanced review.</p>

      <div style={{ display: 'flex', gap: '0.5rem', marginBottom: '1.25rem', flexWrap: 'wrap' }}>
        {FILTERS.map((s) => (
          <button key={s || 'all'} onClick={() => setFilter(s)} style={{ padding: '0.3rem 0.75rem', borderRadius: '0.375rem', border: '1px solid #d1d5db', background: filter === s ? '#1d4ed8' : '#fff', color: filter === s ? '#fff' : '#374151', cursor: 'pointer', fontSize: '0.8rem' }}>{s || 'All'}</button>
        ))}
        <button onClick={load} style={{ marginLeft: 'auto', ...btn() }}>Refresh</button>
      </div>

      {error && <p style={{ color: '#dc2626', marginBottom: '1rem' }}>{error}</p>}

      {loading ? <p style={{ color: '#6b7280' }}>Loading…</p> : items.length === 0 ? <p style={{ color: '#6b7280' }}>No withdrawals in this filter.</p> : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
          {items.map((w) => (
            <div key={w.id} style={{ border: `1px solid ${w.riskLevel === 'HIGH' ? '#fecaca' : '#e5e7eb'}`, borderRadius: '0.5rem', padding: '1rem', background: '#fff' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: '1rem' }}>
                <div style={{ flex: 1 }}>
                  <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center', marginBottom: 4, flexWrap: 'wrap' }}>
                    <span style={badge(STATUS_BADGE[w.status])}>{w.status}</span>
                    <span style={{ ...badge('#fff'), color: RISK_COLOR[w.riskLevel], border: `1px solid ${RISK_COLOR[w.riskLevel]}` }}>RISK {w.riskLevel}</span>
                    <span style={{ fontSize: '0.72rem', color: '#6b7280', fontFamily: 'monospace' }}>{w.reference}</span>
                  </div>
                  <div style={{ fontWeight: 600, fontSize: '0.95rem' }}>{w.campaignTitle}</div>
                  <div style={{ fontSize: '0.8rem', color: '#6b7280', marginTop: 2 }}>
                    {w.creatorName} ({w.creatorVerification}) · {w.bankLabel} · {new Date(w.requestedAt).toLocaleString()}
                  </div>
                  <div style={{ fontSize: '0.8rem', color: '#374151', marginTop: 4 }}>
                    Requesting <strong>{naira(w.amountKobo)}</strong> of {naira(w.availableKobo)} available
                  </div>
                  {w.note && <p style={{ fontSize: '0.8rem', color: w.riskLevel === 'HIGH' ? '#dc2626' : '#6b7280', margin: '0.4rem 0 0' }}>{w.note}</p>}
                </div>
                <div style={{ textAlign: 'right' }}>
                  <div style={{ fontSize: '1.2rem', fontWeight: 700 }}>{naira(w.amountKobo)}</div>
                  {w.status === 'PENDING' && (
                    <div style={{ display: 'flex', gap: '0.4rem', marginTop: '0.5rem' }}>
                      <button disabled={busy === w.id} onClick={() => { setModal({ id: w.id, approve: false, amount: w.amountKobo, note: '' }); setError(null); }} style={{ ...btn(), color: '#dc2626', borderColor: '#fca5a5' }}>Reject</button>
                      <button disabled={busy === w.id} onClick={() => { setModal({ id: w.id, approve: true, amount: w.amountKobo, note: '' }); setError(null); }} style={{ padding: '0.4rem 0.8rem', borderRadius: '0.375rem', border: 'none', background: '#16a34a', color: '#fff', fontWeight: 600, cursor: 'pointer', fontSize: '0.85rem' }}>Approve</button>
                    </div>
                  )}
                </div>
              </div>
            </div>
          ))}
        </div>
      )}

      {modal && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.5)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 50 }}>
          <div style={{ background: '#fff', borderRadius: '0.75rem', padding: '1.5rem', width: '100%', maxWidth: '28rem', boxShadow: '0 20px 60px rgba(0,0,0,0.3)' }}>
            <h2 style={{ fontWeight: 700, marginTop: 0 }}>{modal.approve ? 'Approve withdrawal' : 'Reject withdrawal'}</h2>
            <p style={{ fontSize: '0.85rem', color: '#374151' }}>{modal.approve ? `Approve disbursement of ${naira(modal.amount)} to the creator's bank.` : 'The creator will be notified with your reason.'}</p>
            <label style={{ display: 'block', fontSize: '0.85rem', fontWeight: 600 }}>
              {modal.approve ? 'Note (optional)' : 'Reason (required)'}
              <textarea value={modal.note} onChange={(e) => setModal({ ...modal, note: e.target.value })} rows={3} style={{ display: 'block', width: '100%', marginTop: '0.35rem', padding: '0.5rem', border: '1px solid #d1d5db', borderRadius: '0.375rem', resize: 'vertical', boxSizing: 'border-box' }} />
            </label>
            {error && <p style={{ color: '#dc2626', fontSize: '0.85rem' }}>{error}</p>}
            <div style={{ display: 'flex', gap: '0.75rem', justifyContent: 'flex-end', marginTop: '0.75rem' }}>
              <button onClick={() => { setModal(null); setError(null); }} style={btn()}>Cancel</button>
              <button onClick={confirm} disabled={!!busy} style={{ padding: '0.45rem 1rem', borderRadius: '0.375rem', border: 'none', background: modal.approve ? '#16a34a' : '#dc2626', color: '#fff', fontWeight: 600, cursor: busy ? 'not-allowed' : 'pointer' }}>{busy ? 'Working…' : 'Confirm'}</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

const btn = (): React.CSSProperties => ({ padding: '0.4rem 0.8rem', borderRadius: '0.375rem', border: '1px solid #d1d5db', background: '#fff', cursor: 'pointer', fontSize: '0.85rem' });
function badge(bg: string): React.CSSProperties {
  return { background: bg, color: '#fff', padding: '0.1rem 0.5rem', borderRadius: '9999px', fontSize: '0.68rem', fontWeight: 700, textTransform: 'uppercase', letterSpacing: 0.3 };
}
