'use client';

import { useCallback, useEffect, useState } from 'react';
import { listKycCases, decideKyc } from '@/services/crowdfundingAdminService';
import type { CfKycCase, CfRiskLevel } from '@/types/crowdfunding';
import { Page, PageHeader, Card, Button, Badge, colors, tint } from '@/components/ui/vuexy';

const RISK_COLOR: Record<CfRiskLevel, string> = { LOW: colors.success, MEDIUM: colors.warning, HIGH: colors.danger };
const STATUS_BADGE: Record<string, string> = { PENDING: colors.warning, APPROVED: colors.success, REJECTED: colors.muted };

export default function KycQueuePage() {
  const [items, setItems] = useState<CfKycCase[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [kind, setKind] = useState<'' | 'KYC' | 'KYB'>('');
  const [busy, setBusy] = useState<string | null>(null);
  const [modal, setModal] = useState<{ id: string; approve: boolean; name: string; note: string } | null>(null);

  const load = useCallback(async () => {
    setLoading(true); setError(null);
    try { setItems(await listKycCases(kind || undefined, 'PENDING')); }
    catch (e) { setError(String(e)); } finally { setLoading(false); }
  }, [kind]);
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
      <PageHeader title="KYC / KYB Verification" subtitle="Verify creators and organisations before they can publish or withdraw." />

      <div style={{ display: 'flex', gap: '0.5rem', marginBottom: '1.25rem' }}>
        {([['', 'All'], ['KYC', 'Individual (KYC)'], ['KYB', 'Business (KYB)']] as const).map(([v, label]) => (
          <Button key={v || 'all'} variant={kind === v ? 'primary' : 'outline'} sm onClick={() => setKind(v)}>{label}</Button>
        ))}
        <Button variant="outline" sm style={{ marginLeft: 'auto' }} onClick={load}>Refresh</Button>
      </div>

      {error && <p style={{ color: colors.danger, marginBottom: '1rem' }}>{error}</p>}

      {loading ? <p style={{ color: colors.muted }}>Loading queue…</p> : items.length === 0 ? <p style={{ color: colors.muted }}>No pending verifications.</p> : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
          {items.map((k) => (
            <Card key={k.id} style={{ borderColor: k.riskLevel === 'HIGH' ? tint(colors.danger, 0.4) : colors.border }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: '1rem' }}>
                <div style={{ flex: 1 }}>
                  <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center', marginBottom: 4, flexWrap: 'wrap' }}>
                    <Badge text={k.kind} color={colors.secondary} />
                    <Badge text={k.status} color={STATUS_BADGE[k.status]} />
                    <span style={{ fontSize: '0.68rem', fontWeight: 700, textTransform: 'uppercase', letterSpacing: 0.3, padding: '0.1rem 0.5rem', borderRadius: '9999px', color: RISK_COLOR[k.riskLevel], border: `1px solid ${RISK_COLOR[k.riskLevel]}` }}>RISK {k.riskLevel}</span>
                    <span style={{ fontSize: '0.72rem', color: colors.muted, background: colors.headBg, padding: '0.1rem 0.4rem', borderRadius: '0.25rem' }}>{k.applicantType}</span>
                  </div>
                  <div style={{ fontWeight: 600, fontSize: '0.95rem' }}>{k.applicantName}</div>
                  <div style={{ fontSize: '0.8rem', color: colors.muted }}>{k.email} · {k.idLabel} · {k.bankLabel} · {new Date(k.submittedAt).toLocaleDateString()}</div>

                  {/* Duplicate flags */}
                  {(k.duplicateIdentity || k.duplicateBank) && (
                    <div style={{ display: 'flex', gap: '0.4rem', marginTop: '0.5rem', flexWrap: 'wrap' }}>
                      {k.duplicateIdentity && <span style={flag()}>⚠ Duplicate identity</span>}
                      {k.duplicateBank && <span style={flag()}>⚠ Bank used by other accounts</span>}
                    </div>
                  )}

                  {/* Documents */}
                  <div style={{ marginTop: '0.6rem', display: 'flex', flexDirection: 'column', gap: '0.2rem' }}>
                    {k.documents.map((d) => (
                      <div key={d.id} style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.8rem', maxWidth: 360 }}>
                        <span style={{ color: colors.text }}>{d.label} <span style={{ color: colors.muted }}>({d.type})</span></span>
                        <span style={{ color: d.verified ? colors.success : colors.warning, fontWeight: 600 }}>{d.verified ? '✓ Verified' : 'Unverified'}</span>
                      </div>
                    ))}
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
const flag = (): React.CSSProperties => ({ fontSize: '0.72rem', color: colors.danger, background: tint(colors.danger, 0.12), padding: '0.15rem 0.5rem', borderRadius: '0.25rem', fontWeight: 600 });
