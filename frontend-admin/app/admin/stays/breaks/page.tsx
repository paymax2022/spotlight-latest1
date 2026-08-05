'use client';

import { useEffect, useState } from 'react';
import { getReconciliation, resolveBreak, formatNaira } from '@/services/staysAdminService';
import type { ReconciliationBreak, BreakStatus } from '@/types/staysAdmin';
import { StaysTabs, Card, Badge, label, select, StateBlock, DisclosureNote } from '../_ui';
import { Page, PageHeader, Button, colors, tint } from '@/components/ui/vuexy';

const STATUSES: BreakStatus[] = ['investigating', 'resolved'];

export default function StaysBreaksPage() {
  const [breaks, setBreaks] = useState<ReconciliationBreak[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [busyId, setBusyId] = useState<string | null>(null);
  const [notes, setNotes] = useState<Record<string, string>>({});
  const [targets, setTargets] = useState<Record<string, BreakStatus>>({});

  async function load() {
    setLoading(true); setError(null);
    try {
      const summary = await getReconciliation({ status: 'open' });
      setBreaks(summary.breaks);
    } catch (e) { setError(String(e)); }
    finally { setLoading(false); }
  }
  useEffect(() => { load(); }, []);

  async function resolve(b: ReconciliationBreak) {
    const newStatus = targets[b.id] ?? 'resolved';
    setBusyId(b.id); setError(null);
    try {
      await resolveBreak(b.id, { resolution: notes[b.id]?.trim() || `Marked ${newStatus} by ops`, status: newStatus, note: notes[b.id]?.trim() || undefined });
      await load();
    } catch (e) { setError(String(e)); }
    finally { setBusyId(null); }
  }

  return (
    <Page>
      <PageHeader
        title="Settlement break resolution"
        subtitle="Hands-on queue of open reconciliation breaks. Compare Paymax vs supplier amounts side-by-side and resolve with a documented note."
        actions={<Button variant="outline" sm onClick={load}>Refresh</Button>}
      />
      <StaysTabs active="money" />

      <DisclosureNote>
        This is the focused resolution view for <strong>open</strong> breaks — the variance between the Paymax ledger and the supplier statement. SLA-breached breaks are flagged; clear those first. The full filterable table lives on the reconciliation workbench.
      </DisclosureNote>

      <StateBlock loading={loading} error={error} empty={breaks.length === 0} emptyText="No open breaks — all settlements reconciled.">
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(360px, 1fr))', gap: '1rem' }}>
          {breaks.map((b) => {
            const target = targets[b.id] ?? 'resolved';
            return (
              <Card
                key={b.id}
                title={b.break_type.replace(/_/g, ' ')}
                right={<div style={{ display: 'flex', gap: '0.35rem', alignItems: 'center', flexWrap: 'wrap' }}>
                  <Badge status={b.supplier_code} />
                  <Badge status={b.rail} />
                  {b.sla_breached ? <Badge status="critical" label="SLA breached" /> : null}
                </div>}
              >
                <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.78rem', color: colors.muted, marginBottom: '0.6rem' }}>
                  <span><code style={{ fontSize: '0.75rem' }}>{b.id}</code></span>
                  <span>{b.reservation_id ? <code style={{ fontSize: '0.75rem' }}>{b.reservation_id}</code> : 'no reservation'}</span>
                  <span>{b.age_hours}h old</span>
                </div>

                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.6rem', marginBottom: '0.75rem' }}>
                  <div style={{ border: `1px solid ${colors.border}`, borderRadius: '0.5rem', padding: '0.6rem 0.75rem' }}>
                    <div style={{ fontSize: '0.7rem', textTransform: 'uppercase', letterSpacing: 0.3, color: colors.muted, fontWeight: 600 }}>Paymax ledger</div>
                    <div style={{ fontSize: '1.15rem', fontWeight: 700, marginTop: '0.2rem' }}>{formatNaira(b.paymax_amount_kobo)}</div>
                  </div>
                  <div style={{ border: `1px solid ${colors.border}`, borderRadius: '0.5rem', padding: '0.6rem 0.75rem' }}>
                    <div style={{ fontSize: '0.7rem', textTransform: 'uppercase', letterSpacing: 0.3, color: colors.muted, fontWeight: 600 }}>Supplier statement</div>
                    <div style={{ fontSize: '1.15rem', fontWeight: 700, marginTop: '0.2rem' }}>{formatNaira(b.supplier_amount_kobo)}</div>
                  </div>
                </div>

                <div style={{ background: b.delta_kobo !== 0 ? tint(colors.danger, 0.08) : tint(colors.success, 0.08), border: `1px solid ${b.delta_kobo !== 0 ? tint(colors.danger, 0.3) : tint(colors.success, 0.3)}`, borderRadius: '0.5rem', padding: '0.6rem 0.75rem', marginBottom: '0.75rem' }}>
                  <div style={{ fontSize: '0.7rem', textTransform: 'uppercase', letterSpacing: 0.3, color: colors.muted, fontWeight: 600 }}>Delta ({b.currency})</div>
                  <div style={{ fontSize: '1.45rem', fontWeight: 800, color: b.delta_kobo !== 0 ? colors.danger : colors.success, marginTop: '0.15rem' }}>{formatNaira(b.delta_kobo)}</div>
                </div>

                <p style={{ fontSize: '0.82rem', color: colors.text, margin: '0 0 0.75rem' }}>{b.detail}</p>

                <div style={{ marginBottom: '0.6rem' }}>
                  <label style={label()}>Resolution note</label>
                  <textarea
                    style={{ minHeight: 64, resize: 'vertical', fontFamily: 'inherit', width: '100%' }}
                    placeholder="Explain the variance and any corrective ledger entry posted…"
                    value={notes[b.id] ?? ''}
                    onChange={(e) => setNotes((m) => ({ ...m, [b.id]: e.target.value }))}
                  />
                </div>

                <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'flex-end' }}>
                  <div style={{ flex: 1 }}>
                    <label style={label()}>Set status</label>
                    <select style={select()} value={target} onChange={(e) => setTargets((m) => ({ ...m, [b.id]: e.target.value as BreakStatus }))}>
                      {STATUSES.map((s) => <option key={s} value={s}>{s}</option>)}
                    </select>
                  </div>
                  <Button variant="primary" disabled={busyId === b.id} onClick={() => resolve(b)}>{busyId === b.id ? 'Saving…' : 'Resolve'}</Button>
                </div>
              </Card>
            );
          })}
        </div>
      </StateBlock>
    </Page>
  );
}
