'use client';

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { listDisputes, resolveDispute } from '@/services/crowdfundingAdminService';
import type { CfDispute, CfDisputeResolution } from '@/types/crowdfunding';
import { Page, PageHeader, Card, Button, Badge, colors } from '@/components/ui/vuexy';

const STATUS_BADGE: Record<string, string> = { OPEN: colors.danger, INVESTIGATING: colors.warning, ESCALATED: colors.primary, RESOLVED: colors.success, CLOSED: colors.muted };
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
    <Page>
      <PageHeader title="Support & Disputes" subtitle="Resolve campaign complaints, refund/reward disputes and fake-campaign reports." />

      <div style={{ display: 'flex', gap: '0.5rem', marginBottom: '1.25rem', flexWrap: 'wrap' }}>
        {FILTERS.map((s) => (
          <Button key={s || 'all'} variant={filter === s ? 'primary' : 'outline'} sm onClick={() => setFilter(s)}>{s || 'All'}</Button>
        ))}
        <Button variant="outline" sm style={{ marginLeft: 'auto' }} onClick={load}>Refresh</Button>
      </div>

      {error && <p style={{ color: colors.danger, marginBottom: '1rem' }}>{error}</p>}

      {loading ? <p style={{ color: colors.muted }}>Loading disputes…</p> : items.length === 0 ? <p style={{ color: colors.muted }}>No disputes in this filter.</p> : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
          {items.map((d) => (
            <Card key={d.id}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: '1rem' }}>
                <div style={{ flex: 1 }}>
                  <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center', marginBottom: 4, flexWrap: 'wrap' }}>
                    <Badge text={d.status} color={STATUS_BADGE[d.status]} />
                    <span style={{ fontSize: '0.7rem', color: colors.muted, background: colors.headBg, padding: '0.1rem 0.4rem', borderRadius: '0.25rem' }}>{d.type.replace('_', ' ')}</span>
                    <span style={{ fontSize: '0.72rem', color: colors.muted, fontFamily: 'monospace' }}>{d.reference}</span>
                    {d.status !== 'RESOLVED' && d.status !== 'CLOSED' && (
                      <span style={{ fontSize: '0.72rem', color: d.slaHoursLeft <= 6 ? colors.danger : colors.muted }}>SLA {d.slaHoursLeft}h</span>
                    )}
                  </div>
                  <Link href={`/admin/crowdfunding/review/${d.campaignId}`} style={{ fontWeight: 600, fontSize: '0.92rem', color: colors.text, textDecoration: 'none' }}>{d.campaignTitle}</Link>
                  <div style={{ fontSize: '0.8rem', color: colors.muted, marginTop: 2 }}>Raised by {d.raisedBy} · {new Date(d.createdAt).toLocaleString()}</div>
                  <p style={{ fontSize: '0.85rem', color: colors.text, margin: '0.4rem 0 0' }}>{d.description}</p>
                  {d.resolution && <p style={{ fontSize: '0.8rem', color: colors.success, margin: '0.4rem 0 0' }}>Resolved: <strong>{d.resolution.replace('_', ' ')}</strong>{d.adminNote ? ` — ${d.adminNote}` : ''}</p>}
                </div>
                {(d.status === 'OPEN' || d.status === 'INVESTIGATING' || d.status === 'ESCALATED') && (
                  <Button variant="primary" sm disabled={busy === d.id} onClick={() => { setModal({ id: d.id, resolution: 'NO_ACTION', note: '' }); setError(null); }}>Resolve</Button>
                )}
              </div>
            </Card>
          ))}
        </div>
      )}

      {modal && (
        <div style={overlay()}>
          <div style={sheet()}>
            <h2 style={{ fontWeight: 700, marginTop: 0 }}>Resolve dispute</h2>
            <label style={{ display: 'block', fontSize: '0.85rem', fontWeight: 600, marginBottom: '0.75rem' }}>
              Resolution
              <select value={modal.resolution} onChange={(e) => setModal({ ...modal, resolution: e.target.value as CfDisputeResolution })} style={{ display: 'block', width: '100%', marginTop: '0.35rem', padding: '0.5rem', border: `1px solid ${colors.inputBorder}`, borderRadius: '0.375rem' }}>
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
            {error && <p style={{ color: colors.danger, fontSize: '0.85rem' }}>{error}</p>}
            <div style={{ display: 'flex', gap: '0.75rem', justifyContent: 'flex-end', marginTop: '0.75rem' }}>
              <Button variant="outline" onClick={() => { setModal(null); setError(null); }}>Cancel</Button>
              <Button variant="primary" disabled={!!busy} onClick={confirm}>{busy ? 'Resolving…' : 'Confirm'}</Button>
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
