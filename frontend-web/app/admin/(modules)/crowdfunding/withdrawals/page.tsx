'use client';

import { useCallback, useEffect, useState } from 'react';
import { listWithdrawals, decideWithdrawal } from '@/services/crowdfundingAdminService';
import type { CfWithdrawal, CfRiskLevel } from '@/types/crowdfunding';
import { Page, PageHeader, Card, Button, Badge, colors, tint } from '@/components/ui/vuexy';

const STATUS_BADGE: Record<string, string> = {
  PENDING: colors.warning, PROCESSING: colors.info, APPROVED: colors.success, COMPLETED: colors.success, REJECTED: colors.muted,
};
const RISK_COLOR: Record<CfRiskLevel, string> = { LOW: colors.success, MEDIUM: colors.warning, HIGH: colors.danger };
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
    <Page>
      <PageHeader title="Withdrawal Requests" subtitle="Approve or reject creator withdrawals. High-risk requests need enhanced review." />

      <div style={{ display: 'flex', gap: '0.5rem', marginBottom: '1.25rem', flexWrap: 'wrap' }}>
        {FILTERS.map((s) => (
          <Button key={s || 'all'} variant={filter === s ? 'primary' : 'outline'} sm onClick={() => setFilter(s)}>{s || 'All'}</Button>
        ))}
        <Button variant="outline" sm style={{ marginLeft: 'auto' }} onClick={load}>Refresh</Button>
      </div>

      {error && <p style={{ color: colors.danger, marginBottom: '1rem' }}>{error}</p>}

      {loading ? <p style={{ color: colors.muted }}>Loading…</p> : items.length === 0 ? <p style={{ color: colors.muted }}>No withdrawals in this filter.</p> : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
          {items.map((w) => (
            <Card key={w.id} style={{ borderColor: w.riskLevel === 'HIGH' ? tint(colors.danger, 0.4) : colors.border }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: '1rem' }}>
                <div style={{ flex: 1 }}>
                  <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center', marginBottom: 4, flexWrap: 'wrap' }}>
                    <Badge text={w.status} color={STATUS_BADGE[w.status]} />
                    <span style={{ fontSize: '0.68rem', fontWeight: 700, textTransform: 'uppercase', letterSpacing: 0.3, padding: '0.1rem 0.5rem', borderRadius: '9999px', color: RISK_COLOR[w.riskLevel], border: `1px solid ${RISK_COLOR[w.riskLevel]}` }}>RISK {w.riskLevel}</span>
                    <span style={{ fontSize: '0.72rem', color: colors.muted, fontFamily: 'monospace' }}>{w.reference}</span>
                  </div>
                  <div style={{ fontWeight: 600, fontSize: '0.95rem' }}>{w.campaignTitle}</div>
                  <div style={{ fontSize: '0.8rem', color: colors.muted, marginTop: 2 }}>
                    {w.creatorName} ({w.creatorVerification}) · {w.bankLabel} · {new Date(w.requestedAt).toLocaleString()}
                  </div>
                  <div style={{ fontSize: '0.8rem', color: colors.text, marginTop: 4 }}>
                    Requesting <strong>{naira(w.amountKobo)}</strong> of {naira(w.availableKobo)} available
                  </div>
                  {w.note && <p style={{ fontSize: '0.8rem', color: w.riskLevel === 'HIGH' ? colors.danger : colors.muted, margin: '0.4rem 0 0' }}>{w.note}</p>}
                </div>
                <div style={{ textAlign: 'right' }}>
                  <div style={{ fontSize: '1.2rem', fontWeight: 700 }}>{naira(w.amountKobo)}</div>
                  {w.status === 'PENDING' && (
                    <div style={{ display: 'flex', gap: '0.4rem', marginTop: '0.5rem' }}>
                      <Button variant="danger" sm disabled={busy === w.id} onClick={() => { setModal({ id: w.id, approve: false, amount: w.amountKobo, note: '' }); setError(null); }}>Reject</Button>
                      <Button variant="primary" sm disabled={busy === w.id} onClick={() => { setModal({ id: w.id, approve: true, amount: w.amountKobo, note: '' }); setError(null); }}>Approve</Button>
                    </div>
                  )}
                </div>
              </div>
            </Card>
          ))}
        </div>
      )}

      {modal && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.5)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 50 }}>
          <div style={{ background: colors.card, borderRadius: '0.75rem', padding: '1.5rem', width: '100%', maxWidth: '28rem', boxShadow: '0 20px 60px rgba(0,0,0,0.3)' }}>
            <h2 style={{ fontWeight: 700, marginTop: 0 }}>{modal.approve ? 'Approve withdrawal' : 'Reject withdrawal'}</h2>
            <p style={{ fontSize: '0.85rem', color: colors.text }}>{modal.approve ? `Approve disbursement of ${naira(modal.amount)} to the creator's bank.` : 'The creator will be notified with your reason.'}</p>
            <label style={{ display: 'block', fontSize: '0.85rem', fontWeight: 600 }}>
              {modal.approve ? 'Note (optional)' : 'Reason (required)'}
              <textarea value={modal.note} onChange={(e) => setModal({ ...modal, note: e.target.value })} rows={3} style={{ display: 'block', width: '100%', marginTop: '0.35rem', padding: '0.5rem', border: `1px solid ${colors.inputBorder}`, borderRadius: '0.375rem', resize: 'vertical', boxSizing: 'border-box' }} />
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
