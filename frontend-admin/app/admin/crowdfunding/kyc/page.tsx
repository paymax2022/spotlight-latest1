'use client';

import { useCallback, useEffect, useState } from 'react';
import { listKycCases, decideKyc } from '@/services/crowdfundingAdminService';
import type { CfKycCase, CfRiskLevel } from '@/types/crowdfunding';

const RISK_COLOR: Record<CfRiskLevel, string> = { LOW: '#16a34a', MEDIUM: '#d97706', HIGH: '#dc2626' };
const STATUS_BADGE: Record<string, string> = { PENDING: '#d97706', APPROVED: '#16a34a', REJECTED: '#6b7280' };

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
    <div style={{ padding: '0.5rem 0.5rem 2rem' }}>
      <h1 style={{ fontSize: '1.5rem', fontWeight: 700, marginBottom: '0.25rem' }}>KYC / KYB Verification</h1>
      <p style={{ color: '#6b7280', margin: '0 0 1.25rem', fontSize: '0.85rem' }}>Verify creators and organisations before they can publish or withdraw.</p>

      <div style={{ display: 'flex', gap: '0.5rem', marginBottom: '1.25rem' }}>
        {([['', 'All'], ['KYC', 'Individual (KYC)'], ['KYB', 'Business (KYB)']] as const).map(([v, label]) => (
          <button key={v || 'all'} onClick={() => setKind(v)} style={{ padding: '0.3rem 0.75rem', borderRadius: '0.375rem', border: '1px solid #d1d5db', background: kind === v ? '#1d4ed8' : '#fff', color: kind === v ? '#fff' : '#374151', cursor: 'pointer', fontSize: '0.8rem' }}>{label}</button>
        ))}
        <button onClick={load} style={{ marginLeft: 'auto', ...btn() }}>Refresh</button>
      </div>

      {error && <p style={{ color: '#dc2626', marginBottom: '1rem' }}>{error}</p>}

      {loading ? <p style={{ color: '#6b7280' }}>Loading queue…</p> : items.length === 0 ? <p style={{ color: '#6b7280' }}>No pending verifications.</p> : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
          {items.map((k) => (
            <div key={k.id} style={{ ...card(), borderColor: k.riskLevel === 'HIGH' ? '#fecaca' : '#e5e7eb' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: '1rem' }}>
                <div style={{ flex: 1 }}>
                  <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center', marginBottom: 4, flexWrap: 'wrap' }}>
                    <span style={badge('#111827')}>{k.kind}</span>
                    <span style={badge(STATUS_BADGE[k.status])}>{k.status}</span>
                    <span style={{ ...badge('#fff'), color: RISK_COLOR[k.riskLevel], border: `1px solid ${RISK_COLOR[k.riskLevel]}` }}>RISK {k.riskLevel}</span>
                    <span style={{ fontSize: '0.72rem', color: '#6b7280', background: '#f3f4f6', padding: '0.1rem 0.4rem', borderRadius: '0.25rem' }}>{k.applicantType}</span>
                  </div>
                  <div style={{ fontWeight: 600, fontSize: '0.95rem' }}>{k.applicantName}</div>
                  <div style={{ fontSize: '0.8rem', color: '#6b7280' }}>{k.email} · {k.idLabel} · {k.bankLabel} · {new Date(k.submittedAt).toLocaleDateString()}</div>

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
                        <span style={{ color: '#374151' }}>{d.label} <span style={{ color: '#9ca3af' }}>({d.type})</span></span>
                        <span style={{ color: d.verified ? '#16a34a' : '#d97706', fontWeight: 600 }}>{d.verified ? '✓ Verified' : 'Unverified'}</span>
                      </div>
                    ))}
                  </div>
                </div>
                <div style={{ display: 'flex', gap: '0.4rem' }}>
                  <button disabled={busy === k.id} onClick={() => { setModal({ id: k.id, approve: false, name: k.applicantName, note: '' }); setError(null); }} style={{ ...btn(), color: '#dc2626', borderColor: '#fca5a5' }}>Reject</button>
                  <button disabled={busy === k.id} onClick={() => { setModal({ id: k.id, approve: true, name: k.applicantName, note: '' }); setError(null); }} style={primaryBtn('#16a34a')}>Approve</button>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}

      {modal && (
        <div style={overlay()}>
          <div style={sheet()}>
            <h2 style={{ fontWeight: 700, marginTop: 0 }}>{modal.approve ? 'Approve verification' : 'Reject verification'}</h2>
            <p style={{ fontSize: '0.85rem', color: '#374151' }}>{modal.approve ? `${modal.name} will be able to publish campaigns and withdraw funds.` : `${modal.name} will be notified with your reason.`}</p>
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

const card = (): React.CSSProperties => ({ border: '1px solid #e5e7eb', borderRadius: '0.5rem', padding: '1rem', background: '#fff' });
const btn = (): React.CSSProperties => ({ padding: '0.4rem 0.8rem', borderRadius: '0.375rem', border: '1px solid #d1d5db', background: '#fff', cursor: 'pointer', fontSize: '0.85rem' });
const primaryBtn = (bg: string): React.CSSProperties => ({ padding: '0.4rem 0.8rem', borderRadius: '0.375rem', border: 'none', background: bg, color: '#fff', fontWeight: 600, cursor: 'pointer', fontSize: '0.85rem' });
const overlay = (): React.CSSProperties => ({ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.5)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 50 });
const sheet = (): React.CSSProperties => ({ background: '#fff', borderRadius: '0.75rem', padding: '1.5rem', width: '100%', maxWidth: '28rem', boxShadow: '0 20px 60px rgba(0,0,0,0.3)' });
const textarea = (): React.CSSProperties => ({ display: 'block', width: '100%', marginTop: '0.35rem', padding: '0.5rem', border: '1px solid #d1d5db', borderRadius: '0.375rem', resize: 'vertical', boxSizing: 'border-box' });
const flag = (): React.CSSProperties => ({ fontSize: '0.72rem', color: '#b91c1c', background: '#fee2e2', padding: '0.15rem 0.5rem', borderRadius: '0.25rem', fontWeight: 600 });
function badge(bg: string): React.CSSProperties {
  return { background: bg, color: '#fff', padding: '0.1rem 0.5rem', borderRadius: '9999px', fontSize: '0.68rem', fontWeight: 700, textTransform: 'uppercase', letterSpacing: 0.3 };
}
