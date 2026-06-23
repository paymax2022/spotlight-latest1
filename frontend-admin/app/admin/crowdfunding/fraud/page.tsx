'use client';

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { listFraudAlerts, setCampaignFreeze } from '@/services/crowdfundingAdminService';
import type { CfFraudAlert, CfRiskLevel } from '@/types/crowdfunding';

const RISK_COLOR: Record<CfRiskLevel, string> = { LOW: '#16a34a', MEDIUM: '#d97706', HIGH: '#dc2626' };
const STATUS_BADGE: Record<string, string> = { OPEN: '#dc2626', INVESTIGATING: '#d97706', RESOLVED: '#16a34a', FROZEN: '#1f2937' };
const naira = (kobo: number) => `₦${(kobo / 100).toLocaleString('en-NG')}`;

export default function FraudAdminPage() {
  const [items, setItems] = useState<CfFraudAlert[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [modal, setModal] = useState<{ campaignId: string; freeze: boolean; title: string; note: string } | null>(null);

  const load = useCallback(async () => {
    setLoading(true); setError(null);
    try { setItems(await listFraudAlerts()); }
    catch (e) { setError(String(e)); }
    finally { setLoading(false); }
  }, []);
  useEffect(() => { load(); }, [load]);

  async function confirm() {
    if (!modal) return;
    if (!modal.note.trim()) { setError('A note is required.'); return; }
    setBusy(modal.campaignId); setError(null);
    try { await setCampaignFreeze(modal.campaignId, modal.freeze, modal.note); setModal(null); await load(); }
    catch (e) { setError(String(e)); }
    finally { setBusy(null); }
  }

  const high = items.filter((i) => i.riskLevel === 'HIGH').length;

  return (
    <div style={{ padding: '0.5rem 0.5rem 2rem' }}>
      <h1 style={{ fontSize: '1.5rem', fontWeight: 700, marginBottom: '0.25rem' }}>Fraud & Risk</h1>
      <p style={{ color: '#6b7280', margin: '0 0 1rem', fontSize: '0.85rem' }}>Investigate flagged campaigns and freeze funds instantly when needed.</p>

      <div style={{ display: 'flex', gap: '0.75rem', marginBottom: '1.25rem' }}>
        <Summary label="Open / investigating" value={String(items.filter((i) => i.status === 'OPEN' || i.status === 'INVESTIGATING').length)} color="#d97706" />
        <Summary label="High risk" value={String(high)} color="#dc2626" />
        <Summary label="Frozen" value={String(items.filter((i) => i.status === 'FROZEN').length)} color="#1f2937" />
        <button onClick={load} style={{ marginLeft: 'auto', alignSelf: 'flex-start', ...btn() }}>Refresh</button>
      </div>

      {error && <p style={{ color: '#dc2626', marginBottom: '1rem' }}>{error}</p>}

      {loading ? <p style={{ color: '#6b7280' }}>Loading alerts…</p> : items.length === 0 ? <p style={{ color: '#6b7280' }}>No fraud alerts.</p> : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
          {items.map((a) => (
            <div key={a.id} style={{ border: `1px solid ${a.riskLevel === 'HIGH' ? '#fecaca' : '#e5e7eb'}`, borderRadius: '0.5rem', padding: '1rem', background: '#fff' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: '1rem' }}>
                <div style={{ flex: 1 }}>
                  <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center', marginBottom: 4, flexWrap: 'wrap' }}>
                    <span style={badge(STATUS_BADGE[a.status])}>{a.status}</span>
                    <span style={{ ...badge('#fff'), color: RISK_COLOR[a.riskLevel], border: `1px solid ${RISK_COLOR[a.riskLevel]}` }}>RISK {a.riskLevel}</span>
                  </div>
                  <div style={{ fontWeight: 600, fontSize: '0.95rem' }}>{a.campaignTitle}</div>
                  <div style={{ fontSize: '0.8rem', color: '#6b7280', marginTop: 2 }}>{a.creatorName} · raised {naira(a.raisedKobo)} · {new Date(a.createdAt).toLocaleString()}</div>
                  <ul style={{ margin: '0.5rem 0 0', paddingLeft: '1.1rem' }}>
                    {a.signals.map((s, i) => <li key={i} style={{ fontSize: '0.8rem', color: '#374151' }}>{s}</li>)}
                  </ul>
                </div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: '0.4rem', alignItems: 'flex-end' }}>
                  <Link href={`/admin/crowdfunding/review/${a.campaignId}`} style={{ ...btn(), textDecoration: 'none', color: '#1d4ed8', textAlign: 'center' }}>Open campaign</Link>
                  {a.status !== 'FROZEN' ? (
                    <button disabled={busy === a.campaignId} onClick={() => { setModal({ campaignId: a.campaignId, freeze: true, title: a.campaignTitle, note: '' }); setError(null); }} style={{ padding: '0.4rem 0.8rem', borderRadius: '0.375rem', border: 'none', background: '#dc2626', color: '#fff', fontWeight: 600, cursor: 'pointer', fontSize: '0.85rem' }}>Freeze funds</button>
                  ) : (
                    <button disabled={busy === a.campaignId} onClick={() => { setModal({ campaignId: a.campaignId, freeze: false, title: a.campaignTitle, note: '' }); setError(null); }} style={{ ...btn(), color: '#16a34a', borderColor: '#86efac' }}>Unfreeze</button>
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
            <h2 style={{ fontWeight: 700, marginTop: 0 }}>{modal.freeze ? 'Freeze campaign funds' : 'Unfreeze campaign'}</h2>
            <p style={{ fontSize: '0.85rem', color: '#374151' }}>
              {modal.freeze ? `Freezing "${modal.title}" immediately blocks contributions and withdrawals while under investigation.` : `Unfreeze "${modal.title}" and return it to investigation status.`}
            </p>
            <label style={{ display: 'block', fontSize: '0.85rem', fontWeight: 600 }}>
              Reason (required)
              <textarea value={modal.note} onChange={(e) => setModal({ ...modal, note: e.target.value })} rows={3} style={{ display: 'block', width: '100%', marginTop: '0.35rem', padding: '0.5rem', border: '1px solid #d1d5db', borderRadius: '0.375rem', resize: 'vertical', boxSizing: 'border-box' }} />
            </label>
            {error && <p style={{ color: '#dc2626', fontSize: '0.85rem' }}>{error}</p>}
            <div style={{ display: 'flex', gap: '0.75rem', justifyContent: 'flex-end', marginTop: '0.75rem' }}>
              <button onClick={() => { setModal(null); setError(null); }} style={btn()}>Cancel</button>
              <button onClick={confirm} disabled={!!busy} style={{ padding: '0.45rem 1rem', borderRadius: '0.375rem', border: 'none', background: modal.freeze ? '#dc2626' : '#16a34a', color: '#fff', fontWeight: 600, cursor: busy ? 'not-allowed' : 'pointer' }}>{busy ? 'Working…' : 'Confirm'}</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function Summary({ label, value, color }: { label: string; value: string; color: string }) {
  return (
    <div style={{ border: '1px solid #e5e7eb', borderLeft: `3px solid ${color}`, borderRadius: '0.5rem', padding: '0.6rem 1rem', background: '#fff', minWidth: 140 }}>
      <div style={{ fontSize: '0.72rem', color: '#6b7280', textTransform: 'uppercase' }}>{label}</div>
      <div style={{ fontSize: '1.25rem', fontWeight: 700, color }}>{value}</div>
    </div>
  );
}

const btn = (): React.CSSProperties => ({ padding: '0.4rem 0.8rem', borderRadius: '0.375rem', border: '1px solid #d1d5db', background: '#fff', cursor: 'pointer', fontSize: '0.85rem' });
function badge(bg: string): React.CSSProperties {
  return { background: bg, color: '#fff', padding: '0.1rem 0.5rem', borderRadius: '9999px', fontSize: '0.68rem', fontWeight: 700, textTransform: 'uppercase', letterSpacing: 0.3 };
}
