'use client';

import { useEffect, useState } from 'react';
import { listEventFraud, decideEventFraud, formatNaira } from '@/services/eventsAdminService';
import type { EventFraudSignal, EventFraudAction } from '@/types/eventsAdmin';
import { PageHeader, EventsTabs, Card, Badge, DisclosureNote, StateBlock, FilterBar, AuditNote, btn, btnPrimary, btnDanger, th, td, input, label, select, timeAgo } from '../_ui';
import { colors } from '@/components/ui/vuexy';

export default function EventFraudPage() {
  const [rows, setRows] = useState<EventFraudSignal[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [status, setStatus] = useState('');
  const [kind, setKind] = useState('');
  const [q, setQ] = useState('');
  const [busy, setBusy] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);

  async function load() {
    setLoading(true); setError(null);
    try { setRows(await listEventFraud({ status: status || undefined, kind: kind || undefined, q: q || undefined })); }
    catch (e) { setError(String(e)); }
    finally { setLoading(false); }
  }
  useEffect(() => { load(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [status, kind]);

  async function decide(s: EventFraudSignal, action: EventFraudAction) {
    const note = window.prompt(`${action} fraud signal ${s.id} (${s.kind.replace('_', ' ')})? Audited action. Enter a note:`);
    if (note === null) return;
    setBusy(s.id); setMsg(null);
    try {
      const res = await decideEventFraud(s.id, action, note || undefined);
      setMsg(res.message + ` (audit ${res.audit_id})`);
      await load();
    } catch (e) { setMsg(String(e)); }
    finally { setBusy(null); }
  }

  return (
    <div style={{ padding: '0.5rem 0.5rem 2rem' }}>
      <PageHeader title="Fraud & risk" subtitle="Duplicate-scan detection, abnormal top-up patterns, rapid-refund abuse and vendor self-charge signals across the cashless rail." action={<button onClick={load} style={btn()}>Refresh</button>} />
      <EventsTabs active="fraud" />
      <DisclosureNote>Closed-loop cashless makes laundering harder, but dup-scans, abnormal top-ups and vendor self-charges still need review. Block, clear or investigate — every action posts an immutable audit event (NL-12). Amounts ₦ (kobo).</DisclosureNote>

      {msg && <AuditNote>{msg}</AuditNote>}

      <FilterBar>
        <div style={{ minWidth: 200 }}>
          <label style={label()}>Search</label>
          <input style={input()} placeholder="Subject, event or id…" value={q} onChange={(e) => setQ(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && load()} />
        </div>
        <div>
          <label style={label()}>Kind</label>
          <select style={select()} value={kind} onChange={(e) => setKind(e.target.value)}>
            <option value="">All</option>
            <option value="dup_scan">Dup scan</option>
            <option value="abnormal_topup">Abnormal top-up</option>
            <option value="rapid_refund">Rapid refund</option>
            <option value="vendor_self_charge">Vendor self-charge</option>
          </select>
        </div>
        <div>
          <label style={label()}>Status</label>
          <select style={select()} value={status} onChange={(e) => setStatus(e.target.value)}>
            <option value="">All</option>
            <option value="open">Open</option>
            <option value="investigating">Investigating</option>
            <option value="cleared">Cleared</option>
            <option value="blocked">Blocked</option>
          </select>
        </div>
        <button style={btn()} onClick={load}>Apply</button>
      </FilterBar>

      <Card>
        <StateBlock loading={loading} error={error} empty={rows.length === 0} emptyText="No fraud signals match.">
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead><tr>
              <th style={th()}>Signal</th><th style={th()}>Event</th><th style={th()}>Subject</th><th style={th()}>Detail</th>
              <th style={th()}>Severity</th><th style={th()}>Amount</th><th style={th()}>Status</th><th style={th()}>When</th><th style={th()}>Actions</th>
            </tr></thead>
            <tbody>
              {rows.map((s) => (
                <tr key={s.id}>
                  <td style={td()}><Badge status={s.kind} label={s.kind.replace(/_/g, ' ')} /><div style={{ fontSize: '0.72rem', color: colors.muted }}>{s.id}</div></td>
                  <td style={td()}>{s.event_title}</td>
                  <td style={td()}>{s.subject_masked}</td>
                  <td style={td()}>{s.detail}</td>
                  <td style={td()}><Badge status={s.severity} /></td>
                  <td style={td()}>{formatNaira(s.amount_kobo)}</td>
                  <td style={td()}><Badge status={s.status} /></td>
                  <td style={td()}>{timeAgo(s.created_at)}</td>
                  <td style={td()}>
                    {(s.status === 'open' || s.status === 'investigating') ? (
                      <div style={{ display: 'flex', gap: '0.35rem', flexWrap: 'wrap' }}>
                        {s.status === 'open' && <button style={btn()} disabled={busy === s.id} onClick={() => decide(s, 'investigate')}>Investigate</button>}
                        <button style={btnPrimary()} disabled={busy === s.id} onClick={() => decide(s, 'clear')}>Clear</button>
                        <button style={btnDanger()} disabled={busy === s.id} onClick={() => decide(s, 'block')}>{busy === s.id ? '…' : 'Block'}</button>
                      </div>
                    ) : <span style={{ color: colors.muted, fontSize: '0.78rem' }}>—</span>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </StateBlock>
      </Card>
    </div>
  );
}
