'use client';

import { useCallback, useEffect, useState } from 'react';
import { listKycCases, decideKyc } from '@/services/crowdfundingAdminService';
import type { CfKycCase } from '@/types/crowdfunding';
import { Page, PageHeader, Card, Button, Badge, colors } from '@/components/ui/vuexy';

const STATUS_BADGE: Record<string, string> = { PENDING: colors.warning, APPROVED: colors.success, REJECTED: colors.muted };

export default function KycQueuePage() {
  const [items, setItems] = useState<CfKycCase[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [modal, setModal] = useState<{ id: string; approve: boolean; name: string; note: string } | null>(null);

  const load = useCallback(async () => {
    setLoading(true); setError(null);
    try { setItems(await listKycCases('PENDING')); }
    catch (e) { setError(String(e)); } finally { setLoading(false); }
  }, []);
  useEffect(() => { load(); }, [load]);

  async function confirm() {
    if (!modal) return;
    if (!modal.approve && !modal.note.trim()) { setError('A reason is required to reject.'); return; }
    setBusy(modal.id); setError(null);
    try { await decideKyc(modal.id, modal.approve, modal.note); setModal(null); await load(); }
    catch (e) { setError(String(e)); } finally { setBusy(null); }
  }

  return (
    <Page>
      <PageHeader title="KYC Verification" subtitle="Verify creators before they can publish campaigns or withdraw — the platform's shared identity verification queue." />

      <div style={{ display: 'flex', marginBottom: '1.25rem' }}>
        <Button variant="outline" sm style={{ marginLeft: 'auto' }} onClick={load}>Refresh</Button>
      </div>

      {error && <p style={{ color: colors.danger, marginBottom: '1rem' }}>{error}</p>}

      {loading ? <p style={{ color: colors.muted }}>Loading queue…</p> : items.length === 0 ? <p style={{ color: colors.muted }}>No pending verifications.</p> : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
          {items.map((k) => (
            <Card key={k.id}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: '1rem' }}>
                <div style={{ flex: 1 }}>
                  <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center', marginBottom: 4, flexWrap: 'wrap' }}>
                    <Badge text={k.status} color={STATUS_BADGE[k.status]} />
                    <span style={{ fontSize: '0.72rem', color: colors.muted, background: colors.headBg, padding: '0.1rem 0.4rem', borderRadius: '0.25rem' }}>Tier {k.tier}</span>
                    <span style={{ fontSize: '0.72rem', color: colors.muted, background: colors.headBg, padding: '0.1rem 0.4rem', borderRadius: '0.25rem' }}>{k.applicantType}</span>
                  </div>
                  <div style={{ fontWeight: 600, fontSize: '0.95rem' }}>{k.applicantName}</div>
                  <div style={{ fontSize: '0.8rem', color: colors.muted }}>
                    {k.email} · {k.documentType ?? 'No document type on file'} · submitted {k.submittedAt ? new Date(k.submittedAt).toLocaleDateString() : 'date unknown'}
                  </div>
                </div>
                <div style={{ display: 'flex', gap: '0.4rem' }}>
                  <Button variant="danger" sm disabled={busy === k.id} onClick={() => { setModal({ id: k.id, approve: false, name: k.applicantName, note: '' }); setError(null); }}>Reject</Button>
                  <Button variant="primary" sm disabled={busy === k.id} onClick={() => { setModal({ id: k.id, approve: true, name: k.applicantName, note: '' }); setError(null); }}>Approve</Button>
                </div>
              </div>
            </Card>
          ))}
        </div>
      )}

      {modal && (
        <div style={overlay()}>
          <div style={sheet()}>
            <h2 style={{ fontWeight: 700, marginTop: 0 }}>{modal.approve ? 'Approve verification' : 'Reject verification'}</h2>
            <p style={{ fontSize: '0.85rem', color: colors.text }}>{modal.approve ? `${modal.name} will be able to publish campaigns and withdraw funds.` : `${modal.name} will be notified with your reason.`}</p>
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

const overlay = (): React.CSSProperties => ({ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.5)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 50 });
const sheet = (): React.CSSProperties => ({ background: colors.card, borderRadius: '0.75rem', padding: '1.5rem', width: '100%', maxWidth: '28rem', boxShadow: '0 20px 60px rgba(0,0,0,0.3)' });
const textarea = (): React.CSSProperties => ({ display: 'block', width: '100%', marginTop: '0.35rem', padding: '0.5rem', border: `1px solid ${colors.inputBorder}`, borderRadius: '0.375rem', resize: 'vertical', boxSizing: 'border-box' });
