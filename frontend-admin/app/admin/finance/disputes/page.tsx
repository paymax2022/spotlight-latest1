'use client';

import { useEffect, useState, useCallback } from 'react';
import { listAdminDisputes, resolveDispute } from '@/services/fintechService';
import type { Dispute, DisputeResolution } from '@/types/fintech';
import { Page, PageHeader, Card, Button, colors, tint } from '@/components/ui/vuexy';

const STATUS_COLOR: Record<string, string> = {
  open: colors.danger,
  investigating: colors.warning,
  resolved: colors.success,
  closed: colors.secondary,
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
    <Page>
      <PageHeader
        title="Dispute Queue"
        actions={<Button variant="outline" onClick={load}>Refresh</Button>}
      />

      <div style={{ display: 'flex', gap: '0.5rem', marginBottom: '1.25rem' }}>
        {['open', 'investigating', 'resolved', ''].map((s) => (
          <Button
            key={s || 'all'}
            variant={filterStatus === s ? 'primary' : 'outline'}
            sm
            onClick={() => setFilterStatus(s)}
          >
            {s || 'All'}
          </Button>
        ))}
      </div>

      {error && <p style={{ color: colors.danger, marginBottom: '1rem' }}>{error}</p>}

      {loading ? (
        <p style={{ color: colors.muted }}>Loading disputes…</p>
      ) : disputes.length === 0 ? (
        <p style={{ color: colors.muted }}>No disputes in this filter.</p>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
          {disputes.map((d) => (
            <Card key={d.id}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '0.5rem' }}>
                <div>
                  <span style={{ fontSize: '0.75rem', color: colors.muted, fontFamily: 'monospace' }}>{d.id.slice(0, 8)}…</span>
                  <span style={{
                    marginLeft: '0.5rem',
                    background: STATUS_COLOR[d.status] ?? colors.secondary,
                    color: '#fff',
                    padding: '0.1rem 0.5rem',
                    borderRadius: '9999px',
                    fontSize: '0.7rem',
                    fontWeight: 600,
                    textTransform: 'uppercase',
                  }}>{d.status}</span>
                  <span style={{ marginLeft: '0.5rem', fontSize: '0.75rem', color: colors.text, background: tint(colors.secondary, 0.12), padding: '0.1rem 0.4rem', borderRadius: '0.25rem' }}>{d.type}</span>
                </div>
                <span style={{ fontSize: '0.75rem', color: colors.muted }}>{new Date(d.created_at).toLocaleDateString()}</span>
              </div>
              <p style={{ fontSize: '0.85rem', color: colors.text, marginBottom: '0.25rem' }}>
                <strong>Ref:</strong> {d.reference} &nbsp;|&nbsp; <strong>Module:</strong> {d.module_type}
              </p>
              <p style={{ fontSize: '0.85rem', color: colors.text, marginBottom: '0.5rem' }}>{d.description}</p>
              {d.resolution && (
                <p style={{ fontSize: '0.8rem', color: colors.success }}>
                  Resolution: <strong>{d.resolution}</strong>{d.admin_note ? ` — ${d.admin_note}` : ''}
                </p>
              )}
              {d.status === 'open' || d.status === 'investigating' ? (
                <Button
                  variant="primary"
                  sm
                  disabled={busy === d.id}
                  onClick={() => setResolving({ id: d.id, note: '', resolution: 'no_action' })}
                  style={{ marginTop: '0.5rem' }}
                >
                  {busy === d.id ? 'Processing…' : 'Resolve'}
                </Button>
              ) : null}
            </Card>
          ))}
        </div>
      )}

      {/* Resolve modal */}
      {resolving && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.5)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 50 }}>
          <div style={{ background: colors.card, borderRadius: '0.75rem', padding: '1.5rem', width: '100%', maxWidth: '28rem', boxShadow: '0 20px 60px rgba(0,0,0,0.3)' }}>
            <h2 style={{ fontWeight: 700, marginBottom: '1rem' }}>Resolve Dispute</h2>
            <label style={{ display: 'block', marginBottom: '0.5rem', fontSize: '0.85rem', fontWeight: 600 }}>
              Resolution
              <select
                value={resolving.resolution}
                onChange={(e) => setResolving({ ...resolving, resolution: e.target.value as DisputeResolution })}
                style={{ display: 'block', width: '100%', marginTop: '0.25rem', padding: '0.5rem', border: `1px solid ${colors.inputBorder}`, borderRadius: '0.375rem' }}
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
                style={{ display: 'block', width: '100%', marginTop: '0.25rem', padding: '0.5rem', border: `1px solid ${colors.inputBorder}`, borderRadius: '0.375rem', resize: 'vertical', boxSizing: 'border-box' }}
              />
            </label>
            {error && <p style={{ color: colors.danger, marginBottom: '0.75rem', fontSize: '0.85rem' }}>{error}</p>}
            <div style={{ display: 'flex', gap: '0.75rem', justifyContent: 'flex-end' }}>
              <Button variant="outline" onClick={() => { setResolving(null); setError(null); }}>Cancel</Button>
              <Button variant="primary" onClick={handleResolve} disabled={!!busy}>
                {busy ? 'Resolving…' : 'Confirm'}
              </Button>
            </div>
          </div>
        </div>
      )}
    </Page>
  );
}
