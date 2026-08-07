'use client';

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { listFraudAlerts, setCampaignFreeze } from '@/services/crowdfundingAdminService';
import type { CfFraudAlert, CfRiskLevel } from '@/types/crowdfunding';
import { Page, PageHeader, Card, Button, Badge, colors, tint } from '@/components/ui/vuexy';

const RISK_COLOR: Record<CfRiskLevel, string> = { LOW: colors.success, MEDIUM: colors.warning, HIGH: colors.danger };
const STATUS_BADGE: Record<string, string> = { OPEN: colors.danger, INVESTIGATING: colors.warning, RESOLVED: colors.success, FROZEN: colors.secondary };
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
    <Page>
      <PageHeader title="Fraud & Risk" subtitle="Investigate flagged campaigns and freeze funds instantly when needed." />

      <div style={{ display: 'flex', gap: '0.75rem', marginBottom: '1.25rem' }}>
        <Summary label="Open / investigating" value={String(items.filter((i) => i.status === 'OPEN' || i.status === 'INVESTIGATING').length)} color={colors.warning} />
        <Summary label="High risk" value={String(high)} color={colors.danger} />
        <Summary label="Frozen" value={String(items.filter((i) => i.status === 'FROZEN').length)} color={colors.secondary} />
        <Button variant="outline" sm style={{ marginLeft: 'auto', alignSelf: 'flex-start' }} onClick={load}>Refresh</Button>
      </div>

      {error && <p style={{ color: colors.danger, marginBottom: '1rem' }}>{error}</p>}

      {loading ? <p style={{ color: colors.muted }}>Loading alerts…</p> : items.length === 0 ? <p style={{ color: colors.muted }}>No fraud alerts.</p> : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
          {items.map((a) => (
            <Card key={a.id} style={{ borderColor: a.riskLevel === 'HIGH' ? tint(colors.danger, 0.4) : colors.border }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: '1rem' }}>
                <div style={{ flex: 1 }}>
                  <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center', marginBottom: 4, flexWrap: 'wrap' }}>
                    <Badge text={a.status} color={STATUS_BADGE[a.status]} />
                    <span style={{ fontSize: '0.68rem', fontWeight: 700, textTransform: 'uppercase', letterSpacing: 0.3, padding: '0.1rem 0.5rem', borderRadius: '9999px', color: RISK_COLOR[a.riskLevel], border: `1px solid ${RISK_COLOR[a.riskLevel]}` }}>RISK {a.riskLevel}</span>
                  </div>
                  <div style={{ fontWeight: 600, fontSize: '0.95rem' }}>{a.campaignTitle}</div>
                  <div style={{ fontSize: '0.8rem', color: colors.muted, marginTop: 2 }}>{a.creatorName} · raised {naira(a.raisedKobo)} · {new Date(a.createdAt).toLocaleString()}</div>
                  <ul style={{ margin: '0.5rem 0 0', paddingLeft: '1.1rem' }}>
                    {a.signals.map((s, i) => <li key={i} style={{ fontSize: '0.8rem', color: colors.text }}>{s}</li>)}
                  </ul>
                </div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: '0.4rem', alignItems: 'flex-end' }}>
                  <Link href={`/admin/crowdfunding/review/${a.campaignId}`}>
                    <Button variant="outline" sm style={{ textAlign: 'center' }}>Open campaign</Button>
                  </Link>
                  {a.status !== 'FROZEN' ? (
                    <Button variant="danger" sm disabled={busy === a.campaignId} onClick={() => { setModal({ campaignId: a.campaignId, freeze: true, title: a.campaignTitle, note: '' }); setError(null); }}>Freeze funds</Button>
                  ) : (
                    <Button variant="outline" sm disabled={busy === a.campaignId} style={{ color: colors.success, borderColor: tint(colors.success, 0.4) }} onClick={() => { setModal({ campaignId: a.campaignId, freeze: false, title: a.campaignTitle, note: '' }); setError(null); }}>Unfreeze</Button>
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
            <h2 style={{ fontWeight: 700, marginTop: 0 }}>{modal.freeze ? 'Freeze campaign funds' : 'Unfreeze campaign'}</h2>
            <p style={{ fontSize: '0.85rem', color: colors.text }}>
              {modal.freeze ? `Freezing "${modal.title}" immediately blocks contributions and withdrawals while under investigation.` : `Unfreeze "${modal.title}" and return it to investigation status.`}
            </p>
            <label style={{ display: 'block', fontSize: '0.85rem', fontWeight: 600 }}>
              Reason (required)
              <textarea value={modal.note} onChange={(e) => setModal({ ...modal, note: e.target.value })} rows={3} style={{ display: 'block', width: '100%', marginTop: '0.35rem', padding: '0.5rem', border: `1px solid ${colors.inputBorder}`, borderRadius: '0.375rem', resize: 'vertical', boxSizing: 'border-box' }} />
            </label>
            {error && <p style={{ color: colors.danger, fontSize: '0.85rem' }}>{error}</p>}
            <div style={{ display: 'flex', gap: '0.75rem', justifyContent: 'flex-end', marginTop: '0.75rem' }}>
              <Button variant="outline" onClick={() => { setModal(null); setError(null); }}>Cancel</Button>
              <Button variant={modal.freeze ? 'danger' : 'primary'} disabled={!!busy} onClick={confirm}>{busy ? 'Working…' : 'Confirm'}</Button>
            </div>
          </div>
        </div>
      )}
    </Page>
  );
}

function Summary({ label, value, color }: { label: string; value: string; color: string }) {
  return (
    <Card style={{ borderLeft: `3px solid ${color}`, padding: '0.6rem 1rem', minWidth: 140 }}>
      <div style={{ fontSize: '0.72rem', color: colors.muted, textTransform: 'uppercase' }}>{label}</div>
      <div style={{ fontSize: '1.25rem', fontWeight: 700, color }}>{value}</div>
    </Card>
  );
}
