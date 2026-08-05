'use client';

import { useEffect, useState } from 'react';
import { listProductionCards, advanceProductionCard, blockProductionCard, PRODUCTION_STAGES } from '@/services/academyAdminService';
import type { ProductionCard, ProductionStage } from '@/types/academyAdmin';
import { PageHeader, AcademyTabs, Card, Badge, StateBlock, AuditNote, DisclosureNote, btn, btnPrimary, btnDanger, fmtDate } from '../_ui';
import { colors } from '@/components/ui/vuexy';

const STAGE_LABELS: Record<ProductionStage, string> = {
  script: 'Script', storyboard: 'Storyboard', shoot: 'Shoot', edit: 'Edit', qa: 'QA', publish: 'Publish',
};

function slaColor(due: string, blocked: boolean): string {
  if (blocked) return '#b91c1c';
  const days = (new Date(due).getTime() - Date.now()) / 86_400_000;
  if (days < 0) return '#b91c1c';
  if (days < 1) return '#9a3412';
  return '#6b7280';
}

export default function ContentProductionPage() {
  const [cards, setCards] = useState<ProductionCard[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  async function load() {
    setLoading(true); setError(null);
    try { setCards(await listProductionCards()); }
    catch (e) { setError(String(e)); }
    finally { setLoading(false); }
  }
  useEffect(() => { load(); }, []);

  async function advance(c: ProductionCard) {
    setBusy(c.id); setNotice(null);
    try { const u = await advanceProductionCard({ id: c.id }); setNotice(`"${u.title}" advanced to ${STAGE_LABELS[u.stage]}.`); await load(); }
    catch (e) { setNotice(String(e)); }
    finally { setBusy(null); }
  }
  async function toggleBlock(c: ProductionCard) {
    setBusy(c.id); setNotice(null);
    try {
      const reason = c.blocked ? undefined : (typeof window !== 'undefined' ? window.prompt('Block reason?') || 'Blocked' : 'Blocked');
      const u = await blockProductionCard({ id: c.id, blocked: !c.blocked, reason });
      setNotice(`"${u.title}" ${u.blocked ? 'blocked' : 'unblocked'}.`);
      await load();
    } catch (e) { setNotice(String(e)); }
    finally { setBusy(null); }
  }

  return (
    <div style={{ padding: '0.5rem 0.5rem 2rem' }}>
      <PageHeader title="Content production tracker" subtitle="Spotlight production pipeline as a board. Cards flow script → storyboard → shoot → edit → QA → publish, each with an owner and SLA due date." action={<button onClick={load} style={btn()}>Refresh</button>} />
      <AcademyTabs active="content-production" />
      <DisclosureNote>Requires <code>academy.content</code>. Cards advance one stage at a time. Overdue SLAs and blocked cards are flagged red.</DisclosureNote>

      <StateBlock loading={loading} error={error} empty={cards.length === 0}>
        <div style={{ display: 'grid', gridTemplateColumns: `repeat(${PRODUCTION_STAGES.length}, minmax(180px, 1fr))`, gap: '0.75rem', overflowX: 'auto' }}>
          {PRODUCTION_STAGES.map((stage) => {
            const stageCards = cards.filter((c) => c.stage === stage);
            return (
              <div key={stage} style={{ background: colors.bg, border: `1px solid ${colors.border}`, borderRadius: '0.5rem', padding: '0.6rem' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.6rem' }}>
                  <strong style={{ fontSize: '0.85rem' }}>{STAGE_LABELS[stage]}</strong>
                  <span style={{ fontSize: '0.72rem', color: colors.muted }}>{stageCards.length}</span>
                </div>
                <div style={{ display: 'grid', gap: '0.5rem' }}>
                  {stageCards.length === 0 ? <p style={{ color: colors.muted, fontSize: '0.75rem', margin: 0 }}>—</p> : stageCards.map((c) => (
                    <div key={c.id} style={{ background: '#fff', border: `1px solid ${c.blocked ? '#fecaca' : colors.border}`, borderRadius: '0.4rem', padding: '0.55rem' }}>
                      <div style={{ display: 'flex', justifyContent: 'space-between', gap: '0.4rem', marginBottom: '0.3rem' }}>
                        <span style={{ fontSize: '0.82rem', fontWeight: 600 }}>{c.title}</span>
                        <Badge status={c.priority === 'high' ? 'rejected' : c.priority === 'normal' ? 'open' : 'archived'} label={c.priority} />
                      </div>
                      <div style={{ fontSize: '0.72rem', color: '#6b7280' }}>{c.subject} · {c.owner}</div>
                      <div style={{ fontSize: '0.72rem', color: slaColor(c.sla_due, c.blocked), fontWeight: 600, marginTop: '0.2rem' }}>SLA: {fmtDate(c.sla_due)}{new Date(c.sla_due).getTime() < Date.now() && !c.blocked ? ' (overdue)' : ''}</div>
                      {c.blocked && c.blocked_reason ? <div style={{ fontSize: '0.72rem', color: '#b91c1c', marginTop: '0.2rem' }}>⛔ {c.blocked_reason}</div> : null}
                      <div style={{ display: 'flex', gap: '0.3rem', marginTop: '0.5rem', flexWrap: 'wrap' }}>
                        {stage !== 'publish' && !c.blocked ? <button onClick={() => advance(c)} disabled={busy === c.id} style={{ ...btnPrimary(), padding: '0.2rem 0.5rem', fontSize: '0.75rem' }}>Advance</button> : null}
                        <button onClick={() => toggleBlock(c)} disabled={busy === c.id} style={{ ...(c.blocked ? btn() : btnDanger()), padding: '0.2rem 0.5rem', fontSize: '0.75rem' }}>{c.blocked ? 'Unblock' : 'Block'}</button>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            );
          })}
        </div>
        <Card title="">
          {notice && <p style={{ fontSize: '0.8rem', color: colors.muted, margin: 0 }}>{notice}</p>}
          <AuditNote>Stage advances and block/unblock actions are recorded to the immutable audit log.</AuditNote>
        </Card>
      </StateBlock>
    </div>
  );
}
