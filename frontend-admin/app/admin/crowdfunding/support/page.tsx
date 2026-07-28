'use client';

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { listDisputes, resolveDispute } from '@/services/crowdfundingAdminService';
import type { CfDispute, CfDisputeResolution } from '@/types/crowdfunding';

const STATUS_BADGE: Record<string, string> = { OPEN: '#dc2626', INVESTIGATING: '#d97706', ESCALATED: '#7c3aed', RESOLVED: '#16a34a', CLOSED: '#6b7280' };
const FILTERS = ['OPEN', 'INVESTIGATING', 'ESCALATED', 'RESOLVED', ''];

export default function CrowdfundingSupportPage() {
  const [items, setItems] = useState<CfDispute[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [filter, setFilter] = useState('OPEN');
  const [busy, setBusy] = useState<string | null>(null);
  const [modal, setModal] = useState<{ id: string; resolution: CfDisputeResolution; note: string } | null>(null);

  const load = useCallback(async () => {
    setLoading(true); setError(null);
    try { setItems(await listDisputes(filter || undefined)); }
    catch (e) { setError(String(e)); } finally { setLoading(false); }
  }, [filter]);
  useEffect(() => { load(); }, [load]);

  async function confirm() {
    if (!modal) return;
    if (!modal.note.trim()) { setError('A resolution note is required.'); return; }
    setBusy(modal.id); setError(null);
    try { await resolveDispute(modal.id, modal.resolution, modal.note); setModal(null); await load(); }
    catch (e) { setError(String(e)); } finally { setBusy(null); }
  }

  return (
    <div style={{ padding: '0.5rem 0.5rem 2rem' }}>
      <h1 style={{ fontSize: '1.5rem', fontWeight: 700, marginBottom: '0.25rem' }}>Support & Disputes</h1>
      <p style={{ color: '#6b7280', margin: '0 0 1.25rem', fontSize: '0.85rem' }}>Resolve campaign complaints, refund/reward disputes and fake-campaign reports.</p>

      <div style={{ display: 'flex', gap: '0.5rem', marginBottom: '1.25rem', flexWrap: 'wrap' }}>
        {FILTERS.map((s) => (
          <button key={s || 'all'} onClick={() => setFilter(s)} style={{ padding: '0.3rem 0.75rem', borderRadius: '0.375rem', border: '1px solid #d1d5db', background: filter === s ? '#1d4ed8' : '#fff', color: filter === s ? '#fff' : '#374151', cursor: 'pointer', fontSize: '0.8rem' }}>{s || 'All'}</button>
        ))}
        <button onClick={load} style={{ marginLeft: 'auto', ...btn() }}>Refresh</button>
      </div>

      {error && <p style={{ color: '#dc2626', marginBottom: '1rem' }}>{error}</p>}

      {loading ? <p style={{ color: '#6b7280' }}>Loading disputes…</p> : items.length === 0 ? <p style={{ color: '#6b7280' }}>No disputes in this filter.</p> : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
          {items.map((d) => (
            <div key={d.id} style={card()}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: '1rem' }}>
                <div style={{ flex: 1 }}>
                  <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center', marginBottom: 4, flexWrap: 'wrap' }}>
                    <span style={badge(STATUS_BADGE[d.status])}>{d.status}</span>
                    <span style={{ fontSize: '0.7rem', color: '#4b5563', background: '#f3f4f6', padding: '0.1rem 0.4rem', borderRadius: '0.25rem' }}>{d.type.replace('_', ' ')}</span>
                    <span style={{ fontSize: '0.72rem', color: '#6b7280', fontFamily: 'monospace' }}>{d.reference}</span>
                    {d.status !== 'RESOLVED' && d.status !== 'CLOSED' && (
                      <span style={{ fontSize: '0.72rem', color: d.slaHoursLeft <= 6 ? '#dc2626' : '#6b7280' }}>SLA {d.slaHoursLeft}h</span>
                    )}
                  </div>
                  <Link href={`/admin/crowdfunding/review/${d.campaignId}`} style={{ fontWeight: 600, fontSize: '0.92rem', color: '#111827', textDecoration: 'none' }}>{d.campaignTitle}</Link>
                  <div style={{ fontSize: '0.8rem', color: '#6b7280', marginTop: 2 }}>Raised by {d.raisedBy} · {new Date(d.createdAt).toLocaleString()}</div>
                  <p style={{ fontSize: '0.85rem', color: '#374151', margin: '0.4rem 0 0' }}>{d.description}</p>
                  {d.resolution && <p style={{ fontSize: '0.8rem', color: '#16a34a', margin: '0.4rem 0 0' }}>Resolved: <strong>{d.resolution.replace('_', ' ')}</strong>{d.adminNote ? ` — ${d.adminNote}` : ''}</p>}
                </div>
                {(d.status === 'OPEN' || d.status === 'INVESTIGATING' || d.status === 'ESCALATED') && (
                  <button disabled={busy === d.id} onClick={() => { setModal({ id: d.id, resolution: 'NO_ACTION', note: '' }); setError(null); }} style={primaryBtn('#1d4ed8')}>Resolve</button>
                )}
              </div>
            </div>
          ))}
        </div>
      )}

      {modal && (
        <div style={overlay()}>
          <div style={sheet()}>
            <h2 style={{ fontWeight: 700, marginTop: 0 }}>Resolve dispute</h2>
            <label style={{ display: 'block', fontSize: '0.85rem', fontWeight: 600, marginBottom: '0.75rem' }}>
              Resolution
              <select value={modal.resolution} onChange={(e) => setModal({ ...modal, resolution: e.target.value as CfDisputeResolution })} style={{ display: 'block', width: '100%', marginTop: '0.35rem', padding: '0.5rem', border: '1px solid #d1d5db', borderRadius: '0.375rem' }}>
                <option value="NO_ACTION">No action</option>
                <option value="REFUND">Full refund</option>
                <option value="PARTIAL_REFUND">Partial refund</option>
                <option value="WARN_CREATOR">Warn creator</option>
                <option value="FREEZE">Freeze campaign</option>
              </select>
            </label>
            <label style={{ display: 'block', fontSize: '0.85rem', fontWeight: 600 }}>
              Resolution note (required)
              <textarea value={modal.note} onChange={(e) => setModal({ ...modal, note: e.target.value })} rows={3} style={textarea()} />
            </label>
            {error && <p style={{ color: '#dc2626', fontSize: '0.85rem' }}>{error}</p>}
            <div style={{ display: 'flex', gap: '0.75rem', justifyContent: 'flex-end', marginTop: '0.75rem' }}>
              <button onClick={() => { setModal(null); setError(null); }} style={btn()}>Cancel</button>
              <button onClick={confirm} disabled={!!busy} style={primaryBtn('#1d4ed8')}>{busy ? 'Resolving…' : 'Confirm'}</button>
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
function badge(bg: string): React.CSSProperties {
  return { background: bg, color: '#fff', padding: '0.1rem 0.5rem', borderRadius: '9999px', fontSize: '0.68rem', fontWeight: 700, textTransform: 'uppercase', letterSpacing: 0.3 };
}
