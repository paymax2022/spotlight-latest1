'use client';

import { useEffect, useState } from 'react';
import { getReconciliation, resolveBreak, formatNaira } from '@/services/staysAdminService';
import type { ReconciliationBreak, BreakStatus } from '@/types/staysAdmin';
import { PageHeader, StaysTabs, Card, Badge, btn, btnPrimary, label, select, input, StateBlock, DisclosureNote } from '../_ui';

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
    <div style={{ padding: '0.5rem 0.5rem 2rem' }}>
      <PageHeader
        title="Settlement break resolution"
        subtitle="Hands-on queue of open reconciliation breaks. Compare Paymax vs supplier amounts side-by-side and resolve with a documented note."
        action={<button onClick={load} style={btn()}>Refresh</button>}
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
                <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.78rem', color: '#6b7280', marginBottom: '0.6rem' }}>
                  <span><code style={{ fontSize: '0.75rem' }}>{b.id}</code></span>
                  <span>{b.reservation_id ? <code style={{ fontSize: '0.75rem' }}>{b.reservation_id}</code> : 'no reservation'}</span>
                  <span>{b.age_hours}h old</span>
                </div>

                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.6rem', marginBottom: '0.75rem' }}>
                  <div style={{ border: '1px solid #e5e7eb', borderRadius: '0.5rem', padding: '0.6rem 0.75rem' }}>
                    <div style={{ fontSize: '0.7rem', textTransform: 'uppercase', letterSpacing: 0.3, color: '#6b7280', fontWeight: 600 }}>Paymax ledger</div>
                    <div style={{ fontSize: '1.15rem', fontWeight: 700, marginTop: '0.2rem' }}>{formatNaira(b.paymax_amount_kobo)}</div>
                  </div>
                  <div style={{ border: '1px solid #e5e7eb', borderRadius: '0.5rem', padding: '0.6rem 0.75rem' }}>
                    <div style={{ fontSize: '0.7rem', textTransform: 'uppercase', letterSpacing: 0.3, color: '#6b7280', fontWeight: 600 }}>Supplier statement</div>
                    <div style={{ fontSize: '1.15rem', fontWeight: 700, marginTop: '0.2rem' }}>{formatNaira(b.supplier_amount_kobo)}</div>
                  </div>
                </div>

                <div style={{ background: b.delta_kobo !== 0 ? '#fef2f2' : '#f0fdf4', border: `1px solid ${b.delta_kobo !== 0 ? '#fecaca' : '#bbf7d0'}`, borderRadius: '0.5rem', padding: '0.6rem 0.75rem', marginBottom: '0.75rem' }}>
                  <div style={{ fontSize: '0.7rem', textTransform: 'uppercase', letterSpacing: 0.3, color: '#6b7280', fontWeight: 600 }}>Delta ({b.currency})</div>
                  <div style={{ fontSize: '1.45rem', fontWeight: 800, color: b.delta_kobo !== 0 ? '#b91c1c' : '#15803d', marginTop: '0.15rem' }}>{formatNaira(b.delta_kobo)}</div>
                </div>

                <p style={{ fontSize: '0.82rem', color: '#374151', margin: '0 0 0.75rem' }}>{b.detail}</p>

                <div style={{ marginBottom: '0.6rem' }}>
                  <label style={label()}>Resolution note</label>
                  <textarea
                    style={{ ...input(), minHeight: 64, resize: 'vertical', fontFamily: 'inherit' }}
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
                  <button disabled={busyId === b.id} onClick={() => resolve(b)} style={btnPrimary()}>{busyId === b.id ? 'Saving…' : 'Resolve'}</button>
                </div>
              </Card>
            );
          })}
        </div>
      </StateBlock>
    </div>
  );
}
