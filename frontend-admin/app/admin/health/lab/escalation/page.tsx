'use client';

import { useEffect, useState } from 'react';
import { listEscalations, resolveEscalation } from '@/services/healthLabAdminService';
import type { Escalation, EscalationResolveAction } from '@/types/healthLabAdmin';
import { LabTabs, DisclosureNote, AuditNote, StateBlock, FilterBar } from '../../_ui';
import { Page, PageHeader, Card, Button, Input, Badge, colors, tint, thCell, tdCell } from '@/components/ui/vuexy';

const STATUSES = ['', 'open', 'acknowledged', 'investigating', 'resolved', 'closed'];
const SEVERITIES = ['', 'high', 'critical'];

function statusColor(status: string): string {
  const v = status.toLowerCase();
  if (/(critical|high|reject|fail|block)/.test(v)) return colors.danger;
  if (/(pending|open|warn|flag)/.test(v)) return colors.warning;
  if (/(resolve|approve|verified|complete|ok)/.test(v)) return colors.success;
  if (/(investigat|acknowledg)/.test(v)) return colors.info;
  return colors.secondary;
}

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
    <Page>
      <PageHeader title="Critical-result escalation" subtitle="Abnormal/critical values trigger a defined human escalation path — acknowledged by a named owner within SLA. A critical result is never released silently (HL-7)." actions={<Button variant="outline" onClick={load}>Refresh</Button>} />
      <LabTabs active="escalation" />

      <DisclosureNote>
        HL-7 — critical-result escalation. Critical values are routed to a named human owner and must be
        acknowledged within the escalation SLA before the result can be released (HL-8). The queue is never
        auto-closed; every acknowledge/resolve/close is written to the immutable audit log (HL-12).
      </DisclosureNote>

      {openCount > 0 && (
        <div style={{ border: `1px solid ${tint(colors.danger, 0.35)}`, background: tint(colors.danger, 0.08), color: colors.danger, borderRadius: '0.5rem', padding: '0.6rem 0.8rem', fontSize: '0.82rem', marginBottom: '1rem', fontWeight: 600 }}>
          {openCount} unacknowledged critical escalation{openCount > 1 ? 's' : ''} — assign a human owner now (HL-7).
        </div>
      )}

      <FilterBar>
        <div>
          <label>Status</label>
          <select value={status} onChange={(e) => setStatus(e.target.value)}>
            {STATUSES.map((s) => <option key={s} value={s}>{s ? s : 'All statuses'}</option>)}
          </select>
        </div>
        <div>
          <label>Severity</label>
          <select value={severity} onChange={(e) => setSeverity(e.target.value)}>
            {SEVERITIES.map((s) => <option key={s} value={s}>{s ? s : 'All severities'}</option>)}
          </select>
        </div>
        <div style={{ minWidth: 240 }}>
          <label>Search</label>
          <Input placeholder="Patient, lab, order ref, id…" value={q} onChange={(e) => setQ(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && load()} />
        </div>
        <Button variant="primary" onClick={load}>Apply</Button>
      </FilterBar>

      {msg && <AuditNote>{msg}</AuditNote>}

      <Card style={{ padding: 0, overflow: 'auto' }}>
        <div style={{ padding: rows.length === 0 || loading || error ? 14 : 0 }}>
          <StateBlock loading={loading} error={error} empty={rows.length === 0} emptyText="No escalations match.">
            <table style={{ width: '100%', borderCollapse: 'collapse' }}>
              <thead><tr>
                <th style={thCell}>Escalation</th><th style={thCell}>Patient / test</th><th style={thCell}>Critical value</th>
                <th style={thCell}>Severity</th><th style={thCell}>Owner</th><th style={thCell}>SLA</th>
                <th style={thCell}>Status</th><th style={thCell}>Actions</th>
              </tr></thead>
              <tbody>
                {rows.map((r) => {
                  const breached = r.minutes_elapsed > r.sla_minutes && (r.status === 'open' || r.status === 'acknowledged');
                  return (
                    <tr key={r.id} style={r.status === 'open' ? { background: tint(colors.danger, 0.06) } : undefined}>
                      <td style={tdCell}><code style={{ fontSize: '0.76rem' }}>{r.id}</code><div style={{ fontSize: '0.72rem', color: colors.muted }}>{r.order_ref} · {r.result_ref}</div></td>
                      <td style={tdCell}>{r.patient_masked}<div style={{ fontSize: '0.72rem', color: colors.muted }}>{r.test_summary} · {r.lab_masked}</div></td>
                      <td style={tdCell}><strong style={{ color: colors.danger }}>{r.abnormal_value}</strong></td>
                      <td style={tdCell}><Badge text={r.severity} color={statusColor(r.severity)} /></td>
                      <td style={tdCell}>{r.escalated_to_masked ?? <Badge text="unassigned" color={colors.warning} />}</td>
                      <td style={tdCell}>{r.minutes_elapsed}m / {r.sla_minutes}m{breached ? <div style={{ fontSize: '0.7rem', color: colors.danger, fontWeight: 700 }}>SLA breached</div> : null}</td>
                      <td style={tdCell}><Badge text={r.status.replace(/_/g, ' ')} color={statusColor(r.status)} /></td>
                      <td style={tdCell}>
                        <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>
                          {r.status === 'open' && <Button variant="primary" sm disabled={busy} onClick={() => act(r.id, 'acknowledge')}>Acknowledge</Button>}
                          {(r.status === 'acknowledged' || r.status === 'investigating') && <Button variant="primary" sm disabled={busy} onClick={() => act(r.id, 'resolve')}>Resolve</Button>}
                          {r.status === 'resolved' && <Button variant="outline" sm disabled={busy} onClick={() => act(r.id, 'close')}>Close</Button>}
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </StateBlock>
        </div>
      </Card>
    </Page>
  );
}
