'use client';

import { useEffect, useState } from 'react';
import {
  listEscalations, acknowledgeEscalation, resolveEscalation, DISPOSITION_LABELS, LANGUAGE_LABELS,
} from '@/services/healthTriageAdminService';
import type { EscalationCase } from '@/types/healthTriageAdmin';
import {
  PageHeader, TriageTabs, Card, Badge, DisclosureNote, StateBlock, AuditNote, FilterBar,
  btn, btnPrimary, th, td, select, input, label, timeAgo,
} from '../../_ui';

export default function TriageEscalationsPage() {
  const [rows, setRows] = useState<EscalationCase[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [state, setState] = useState('');
  const [q, setQ] = useState('');
  const [busy, setBusy] = useState<string | null>(null);
  const [note, setNote] = useState<Record<string, string>>({});
  const [result, setResult] = useState<string | null>(null);

  async function load() {
    setLoading(true); setError(null);
    try { setRows(await listEscalations({ state: state || undefined, q: q || undefined })); }
    catch (e) { setError(String(e)); }
    finally { setLoading(false); }
  }
  useEffect(() => { load(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [state]);

  async function act(id: string, kind: 'ack' | 'resolve') {
    setBusy(id); setResult(null);
    try {
      const r = kind === 'ack'
        ? await acknowledgeEscalation(id, note[id])
        : await resolveEscalation(id, note[id]);
      setResult(r.message);
      await load();
    } catch (e) { setResult(String(e)); }
    finally { setBusy(null); }
  }

  const open = rows.filter((r) => r.state !== 'resolved').length;

  return (
    <div style={{ padding: '0.5rem 0.5rem 2rem' }}>
      <PageHeader
        title="Escalation queue"
        subtitle="Human-in-the-loop hand-off for high-risk dispositions (SC-5). Each case is RAISED by a deterministic red-flag rule (SC-2), the patient + a clinician are NOTIFIED, a clinician ACKNOWLEDGES, then RESOLVES after hand-off to in-person / urgent care."
        action={<button onClick={load} style={btn()}>Refresh</button>}
      />
      <TriageTabs active="escalations" />

      <DisclosureNote>
        Escalations are the safety net: emergency detection is rules-based (SC-2) and high-risk cases always
        hand off to a licensed human (SC-5). Emergencies route to in-person care + ambulance + first-aid — the
        AI never resolves an emergency on its own. Patient handles are de-identified (SC-7); every acknowledge
        / resolve writes to the immutable audit (SC-12).
      </DisclosureNote>

      {result ? <div style={{ border: '1px solid #ddd6fe', background: '#f5f3ff', color: '#5b21b6', borderRadius: '0.5rem', padding: '0.6rem 0.8rem', fontSize: '0.82rem', marginBottom: '1rem' }}>{result}</div> : null}

      <Card title={`Cases · ${open} open`}>
        <FilterBar>
          <div>
            <label style={label()}>State</label>
            <select style={select()} value={state} onChange={(e) => setState(e.target.value)}>
              <option value="">All</option>
              {['raised', 'notified', 'acknowledged', 'resolved'].map((s) => <option key={s} value={s}>{s}</option>)}
            </select>
          </div>
          <div style={{ flex: 1, minWidth: 180 }}>
            <label style={label()}>Search</label>
            <input style={input()} value={q} onChange={(e) => setQ(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') load(); }} placeholder="case / session id / reason" />
          </div>
          <button onClick={load} style={btn()}>Apply</button>
        </FilterBar>

        <StateBlock loading={loading} error={error} empty={!rows.length} emptyText="No escalation cases.">
          <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
            {rows.map((r) => {
              const canAck = r.state === 'raised' || r.state === 'notified';
              const canResolve = r.state === 'acknowledged' || r.state === 'notified';
              return (
                <div key={r.id} style={{ border: '1px solid #e5e7eb', borderRadius: '0.5rem', padding: '0.85rem 1rem', background: r.state === 'resolved' ? '#fafafa' : '#fff' }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', gap: '0.5rem', flexWrap: 'wrap', alignItems: 'center' }}>
                    <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center', flexWrap: 'wrap' }}>
                      <code style={{ fontSize: '0.8rem' }}>{r.id}</code>
                      <Badge status={r.state} />
                      <Badge status={r.disposition_level} label={DISPOSITION_LABELS[r.disposition_level]} />
                      {r.profile_kind === 'child' ? <Badge status="high" label="Paediatric (SC-9)" /> : null}
                    </div>
                    <span style={{ fontSize: '0.72rem', color: '#9ca3af' }}>raised {timeAgo(r.raised_at)}</span>
                  </div>

                  <p style={{ margin: '0.6rem 0 0.4rem', fontSize: '0.85rem', color: '#374151' }}>{r.red_flag_summary}</p>
                  <div style={{ fontSize: '0.74rem', color: '#6b7280', display: 'flex', gap: '1rem', flexWrap: 'wrap' }}>
                    <span>Session <code>{r.session_id}</code></span>
                    <span>Rule {r.red_flag_rule_id ? <code>{r.red_flag_rule_id}</code> : '—'}</span>
                    <span>Patient {r.patient_masked}</span>
                    <span style={{ textTransform: 'capitalize' }}>{r.channel} · {LANGUAGE_LABELS[r.language] ?? r.language}</span>
                  </div>

                  {r.handoff_note ? (
                    <div style={{ marginTop: '0.6rem', fontSize: '0.78rem', color: '#374151', background: '#f9fafb', border: '1px solid #f3f4f6', borderRadius: '0.375rem', padding: '0.5rem 0.6rem' }}>
                      <strong>Clinician hand-off note{r.acknowledged_by ? ` · ${r.acknowledged_by}` : ''}:</strong> {r.handoff_note}
                    </div>
                  ) : null}

                  {r.state !== 'resolved' ? (
                    <div style={{ marginTop: '0.7rem' }}>
                      <label style={label()}>Clinician hand-off note</label>
                      <textarea
                        style={{ ...input(), minHeight: 54, fontFamily: 'inherit' }}
                        value={note[r.id] ?? ''}
                        onChange={(e) => setNote((n) => ({ ...n, [r.id]: e.target.value }))}
                        placeholder="What was done — who was contacted, where the patient was routed (in-person / ambulance / urgent care)…"
                      />
                      <div style={{ display: 'flex', gap: '0.5rem', marginTop: '0.5rem', flexWrap: 'wrap' }}>
                        <button disabled={!canAck || busy === r.id} onClick={() => act(r.id, 'ack')} style={{ ...btn(), opacity: !canAck || busy === r.id ? 0.5 : 1 }}>Acknowledge</button>
                        <button disabled={!canResolve || busy === r.id} onClick={() => act(r.id, 'resolve')} style={{ ...btnPrimary(), opacity: !canResolve || busy === r.id ? 0.5 : 1 }}>Resolve (after hand-off)</button>
                      </div>
                      <AuditNote>Acknowledge / resolve is a clinician action recorded to the immutable audit (SC-12).</AuditNote>
                    </div>
                  ) : null}
                </div>
              );
            })}
          </div>
        </StateBlock>
      </Card>
    </div>
  );
}
