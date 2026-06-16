'use client';

import { useEffect, useState, useCallback } from 'react';
import { listAdminDisputes, resolveDispute } from '@/services/fintechService';
import type { Dispute, DisputeResolution } from '@/types/fintech';

const STATUS_BADGE: Record<string, string> = {
  open: '#dc2626',
  investigating: '#d97706',
  resolved: '#16a34a',
  closed: '#6b7280',
};

export default function DisputesAdminPage() {
  const [disputes, setDisputes] = useState<Dispute[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [filterStatus, setFilterStatus] = useState('open');
  const [resolving, setResolving] = useState<{ id: string; note: string; resolution: DisputeResolution } | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      setDisputes(await listAdminDisputes(filterStatus || undefined));
    } catch (e) {
      setError(String(e));
    } finally {
      setLoading(false);
    }
  }, [filterStatus]);

  useEffect(() => { load(); }, [load]);

  async function handleResolve() {
    if (!resolving) return;
    if (!resolving.note.trim()) { setError('Admin note is required'); return; }
    setBusy(resolving.id);
    setError(null);
    try {
      await resolveDispute(resolving.id, resolving.resolution, resolving.note);
      setResolving(null);
      await load();
    } catch (e) {
      setError(String(e));
    } finally {
      setBusy(null);
    }
  }

  return (
    <div style={{ padding: '2rem', fontFamily: 'inherit' }}>
      <h1 style={{ fontSize: '1.5rem', fontWeight: 700, marginBottom: '1rem' }}>Dispute Queue</h1>

      <div style={{ display: 'flex', gap: '0.5rem', marginBottom: '1.25rem' }}>
        {['open', 'investigating', 'resolved', ''].map((s) => (
          <button
            key={s || 'all'}
            onClick={() => setFilterStatus(s)}
            style={{
              padding: '0.3rem 0.75rem',
              borderRadius: '0.375rem',
              border: '1px solid #d1d5db',
              background: filterStatus === s ? '#1d4ed8' : '#fff',
              color: filterStatus === s ? '#fff' : '#374151',
              cursor: 'pointer',
              fontSize: '0.85rem',
            }}
          >
            {s || 'All'}
          </button>
        ))}
        <button onClick={load} style={{ marginLeft: 'auto', padding: '0.3rem 0.75rem', borderRadius: '0.375rem', border: '1px solid #d1d5db', background: '#fff', cursor: 'pointer', fontSize: '0.85rem' }}>
          Refresh
        </button>
      </div>

      {error && <p style={{ color: '#dc2626', marginBottom: '1rem' }}>{error}</p>}

      {loading ? (
        <p style={{ color: '#6b7280' }}>Loading disputes…</p>
      ) : disputes.length === 0 ? (
        <p style={{ color: '#6b7280' }}>No disputes in this filter.</p>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
          {disputes.map((d) => (
            <div key={d.id} style={{ border: '1px solid #e5e7eb', borderRadius: '0.5rem', padding: '1rem', background: '#fff' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '0.5rem' }}>
                <div>
                  <span style={{ fontSize: '0.75rem', color: '#6b7280', fontFamily: 'monospace' }}>{d.id.slice(0, 8)}…</span>
                  <span style={{
                    marginLeft: '0.5rem',
                    background: STATUS_BADGE[d.status] ?? '#6b7280',
                    color: '#fff',
                    padding: '0.1rem 0.5rem',
                    borderRadius: '9999px',
                    fontSize: '0.7rem',
                    fontWeight: 600,
                    textTransform: 'uppercase',
                  }}>{d.status}</span>
                  <span style={{ marginLeft: '0.5rem', fontSize: '0.75rem', color: '#4b5563', background: '#f3f4f6', padding: '0.1rem 0.4rem', borderRadius: '0.25rem' }}>{d.type}</span>
                </div>
                <span style={{ fontSize: '0.75rem', color: '#9ca3af' }}>{new Date(d.created_at).toLocaleDateString()}</span>
              </div>
              <p style={{ fontSize: '0.85rem', color: '#374151', marginBottom: '0.25rem' }}>
                <strong>Ref:</strong> {d.reference} &nbsp;|&nbsp; <strong>Module:</strong> {d.module_type}
              </p>
              <p style={{ fontSize: '0.85rem', color: '#374151', marginBottom: '0.5rem' }}>{d.description}</p>
              {d.resolution && (
                <p style={{ fontSize: '0.8rem', color: '#16a34a' }}>
                  Resolution: <strong>{d.resolution}</strong>{d.admin_note ? ` — ${d.admin_note}` : ''}
                </p>
              )}
              {d.status === 'open' || d.status === 'investigating' ? (
                <button
                  disabled={busy === d.id}
                  onClick={() => setResolving({ id: d.id, note: '', resolution: 'no_action' })}
                  style={{ marginTop: '0.5rem', padding: '0.3rem 0.75rem', borderRadius: '0.375rem', border: '1px solid #d1d5db', background: '#1d4ed8', color: '#fff', cursor: busy === d.id ? 'not-allowed' : 'pointer', fontSize: '0.8rem' }}
                >
                  {busy === d.id ? 'Processing…' : 'Resolve'}
                </button>
              ) : null}
            </div>
          ))}
        </div>
      )}

      {/* Resolve modal */}
      {resolving && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.5)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 50 }}>
          <div style={{ background: '#fff', borderRadius: '0.75rem', padding: '1.5rem', width: '100%', maxWidth: '28rem', boxShadow: '0 20px 60px rgba(0,0,0,0.3)' }}>
            <h2 style={{ fontWeight: 700, marginBottom: '1rem' }}>Resolve Dispute</h2>
            <label style={{ display: 'block', marginBottom: '0.5rem', fontSize: '0.85rem', fontWeight: 600 }}>
              Resolution
              <select
                value={resolving.resolution}
                onChange={(e) => setResolving({ ...resolving, resolution: e.target.value as DisputeResolution })}
                style={{ display: 'block', width: '100%', marginTop: '0.25rem', padding: '0.5rem', border: '1px solid #d1d5db', borderRadius: '0.375rem' }}
              >
                <option value="no_action">No action</option>
                <option value="refund">Full refund</option>
                <option value="partial_refund">Partial refund</option>
              </select>
            </label>
            <label style={{ display: 'block', marginBottom: '1rem', fontSize: '0.85rem', fontWeight: 600 }}>
              Admin note (required)
              <textarea
                value={resolving.note}
                onChange={(e) => setResolving({ ...resolving, note: e.target.value })}
                rows={3}
                placeholder="Explain your resolution decision…"
                style={{ display: 'block', width: '100%', marginTop: '0.25rem', padding: '0.5rem', border: '1px solid #d1d5db', borderRadius: '0.375rem', resize: 'vertical', boxSizing: 'border-box' }}
              />
            </label>
            {error && <p style={{ color: '#dc2626', marginBottom: '0.75rem', fontSize: '0.85rem' }}>{error}</p>}
            <div style={{ display: 'flex', gap: '0.75rem', justifyContent: 'flex-end' }}>
              <button onClick={() => { setResolving(null); setError(null); }} style={{ padding: '0.4rem 0.75rem', borderRadius: '0.375rem', border: '1px solid #d1d5db', background: '#fff', cursor: 'pointer' }}>Cancel</button>
              <button onClick={handleResolve} disabled={!!busy} style={{ padding: '0.4rem 0.75rem', borderRadius: '0.375rem', border: 'none', background: '#1d4ed8', color: '#fff', cursor: busy ? 'not-allowed' : 'pointer', fontWeight: 600 }}>
                {busy ? 'Resolving…' : 'Confirm'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
