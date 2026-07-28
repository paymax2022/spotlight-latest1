'use client';

import { useEffect, useState } from 'react';
import { listEscalations, resolveEscalation } from '@/services/healthLabAdminService';
import type { Escalation, EscalationResolveAction } from '@/types/healthLabAdmin';
import { PageHeader, LabTabs, Card, Badge, DisclosureNote, AuditNote, StateBlock, FilterBar, btn, btnPrimary, th, td, input, select, label, timeAgo } from '../../_ui';

const STATUSES = ['', 'open', 'acknowledged', 'investigating', 'resolved', 'closed'];
const SEVERITIES = ['', 'high', 'critical'];

export default function EscalationPage() {
  const [rows, setRows] = useState<Escalation[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [status, setStatus] = useState('');
  const [severity, setSeverity] = useState('');
  const [q, setQ] = useState('');
  const [msg, setMsg] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function load() {
    setLoading(true); setError(null);
    try { setRows(await listEscalations({ status: status || undefined, severity: severity || undefined, q: q || undefined })); }
    catch (e) { setError(String(e)); }
    finally { setLoading(false); }
  }
  useEffect(() => { load(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [status, severity]);

  async function act(id: string, action: EscalationResolveAction) {
    setBusy(true); setMsg(null);
    try { const r = await resolveEscalation(id, action); setMsg(r.message); await load(); }
    catch (e) { setMsg(String(e)); }
    finally { setBusy(false); }
  }

  const openCount = rows.filter((r) => r.status === 'open').length;

  return (
    <div style={{ padding: '0.5rem 0.5rem 2rem' }}>
      <PageHeader title="Critical-result escalation" subtitle="Abnormal/critical values trigger a defined human escalation path — acknowledged by a named owner within SLA. A critical result is never released silently (HL-7)." action={<button onClick={load} style={btn()}>Refresh</button>} />
      <LabTabs active="escalation" />

      <DisclosureNote>
        HL-7 — critical-result escalation. Critical values are routed to a named human owner and must be
        acknowledged within the escalation SLA before the result can be released (HL-8). The queue is never
        auto-closed; every acknowledge/resolve/close is written to the immutable audit log (HL-12).
      </DisclosureNote>

      {openCount > 0 && (
        <div style={{ border: '1px solid #fecaca', background: '#fef2f2', color: '#991b1b', borderRadius: '0.5rem', padding: '0.6rem 0.8rem', fontSize: '0.82rem', marginBottom: '1rem', fontWeight: 600 }}>
          {openCount} unacknowledged critical escalation{openCount > 1 ? 's' : ''} — assign a human owner now (HL-7).
        </div>
      )}

      <FilterBar>
        <div>
          <label style={label()}>Status</label>
          <select style={select()} value={status} onChange={(e) => setStatus(e.target.value)}>
            {STATUSES.map((s) => <option key={s} value={s}>{s ? s : 'All statuses'}</option>)}
          </select>
        </div>
        <div>
          <label style={label()}>Severity</label>
          <select style={select()} value={severity} onChange={(e) => setSeverity(e.target.value)}>
            {SEVERITIES.map((s) => <option key={s} value={s}>{s ? s : 'All severities'}</option>)}
          </select>
        </div>
        <div style={{ minWidth: 240 }}>
          <label style={label()}>Search</label>
          <input style={input()} placeholder="Patient, lab, order ref, id…" value={q} onChange={(e) => setQ(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && load()} />
        </div>
        <button style={btnPrimary()} onClick={load}>Apply</button>
      </FilterBar>

      {msg && <AuditNote>{msg}</AuditNote>}

      <Card>
        <StateBlock loading={loading} error={error} empty={rows.length === 0} emptyText="No escalations match.">
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead><tr>
              <th style={th()}>Escalation</th><th style={th()}>Patient / test</th><th style={th()}>Critical value</th>
              <th style={th()}>Severity</th><th style={th()}>Owner</th><th style={th()}>SLA</th>
              <th style={th()}>Status</th><th style={th()}>Actions</th>
            </tr></thead>
            <tbody>
              {rows.map((r) => {
                const breached = r.minutes_elapsed > r.sla_minutes && (r.status === 'open' || r.status === 'acknowledged');
                return (
                  <tr key={r.id} style={r.status === 'open' ? { background: '#fef2f2' } : undefined}>
                    <td style={td()}><code style={{ fontSize: '0.76rem' }}>{r.id}</code><div style={{ fontSize: '0.72rem', color: '#9ca3af' }}>{r.order_ref} · {r.result_ref}</div></td>
                    <td style={td()}>{r.patient_masked}<div style={{ fontSize: '0.72rem', color: '#9ca3af' }}>{r.test_summary} · {r.lab_masked}</div></td>
                    <td style={td()}><strong style={{ color: '#b91c1c' }}>{r.abnormal_value}</strong></td>
                    <td style={td()}><Badge status={r.severity} /></td>
                    <td style={td()}>{r.escalated_to_masked ?? <Badge status="pending" label="unassigned" />}</td>
                    <td style={td()}>{r.minutes_elapsed}m / {r.sla_minutes}m{breached ? <div style={{ fontSize: '0.7rem', color: '#b91c1c', fontWeight: 700 }}>SLA breached</div> : null}</td>
                    <td style={td()}><Badge status={r.status} /></td>
                    <td style={td()}>
                      <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>
                        {r.status === 'open' && <button disabled={busy} style={btnPrimary()} onClick={() => act(r.id, 'acknowledge')}>Acknowledge</button>}
                        {(r.status === 'acknowledged' || r.status === 'investigating') && <button disabled={busy} style={btnPrimary()} onClick={() => act(r.id, 'resolve')}>Resolve</button>}
                        {r.status === 'resolved' && <button disabled={busy} style={btn()} onClick={() => act(r.id, 'close')}>Close</button>}
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </StateBlock>
      </Card>
    </div>
  );
}
