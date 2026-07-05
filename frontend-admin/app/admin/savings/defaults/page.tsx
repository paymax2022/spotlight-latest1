'use client';

import { useEffect, useState } from 'react';
import { listDefaults, handleDefault, formatNaira } from '@/services/savingsAdminService';
import type { DefaultRecord, DefaultAction } from '@/types/savingsAdmin';
import { PageHeader, SavingsTabs, Card, Badge, DisclosureNote, StateBlock, FilterBar, AuditNote, btn, btnDanger, th, td, input, label, select, timeAgo } from '../_ui';

export default function DefaultsPage() {
  const [rows, setRows] = useState<DefaultRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [status, setStatus] = useState('');
  const [q, setQ] = useState('');
  const [busy, setBusy] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);

  async function load() {
    setLoading(true); setError(null);
    try { setRows(await listDefaults({ status: status || undefined, q: q || undefined })); }
    catch (e) { setError(String(e)); }
    finally { setLoading(false); }
  }
  useEffect(() => { load(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [status]);

  async function onAction(d: DefaultRecord, action: DefaultAction) {
    const note = window.prompt(`Apply "${action}" to default ${d.id} (${d.member_masked} in ${d.circle_name})? This is audited. Optional note:`) ?? undefined;
    if (note === undefined && action === 'remove') return;
    setBusy(d.id); setMsg(null);
    try {
      const res = await handleDefault(d.id, action, note);
      setMsg(res.message + ` (audit ${res.audit_id})`);
      await load();
    } catch (e) { setMsg(String(e)); }
    finally { setBusy(null); }
  }

  return (
    <div style={{ padding: '0.5rem 0.5rem 2rem' }}>
      <PageHeader title="Default queue" subtitle="Missed-contribution defaults across all Ajo circles, with policy-driven, audited handling." action={<button onClick={load} style={btn()}>Refresh</button>} />
      <SavingsTabs active="defaults" />
      <DisclosureNote>NL-7 — Paymax never advances credit to cover a default; resolution is per the circle&apos;s configured policy (grace, make-good, or member removal). Every action posts an immutable audit event (NL-12).</DisclosureNote>

      {msg && <AuditNote>{msg}</AuditNote>}

      <FilterBar>
        <div style={{ minWidth: 200 }}>
          <label style={label()}>Search</label>
          <input style={input()} placeholder="Circle, member or default id…" value={q} onChange={(e) => setQ(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && load()} />
        </div>
        <div>
          <label style={label()}>Status</label>
          <select style={select()} value={status} onChange={(e) => setStatus(e.target.value)}>
            <option value="">All</option><option value="open">Open</option><option value="grace">Grace</option><option value="make_good">Make-good</option><option value="defaulted">Defaulted</option><option value="recovered">Recovered</option><option value="dismissed">Dismissed</option>
          </select>
        </div>
        <button style={btn()} onClick={load}>Apply</button>
      </FilterBar>

      <Card>
        <StateBlock loading={loading} error={error} empty={rows.length === 0} emptyText="No defaults match.">
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead><tr>
              <th style={th()}>Default</th><th style={th()}>Circle</th><th style={th()}>Member</th><th style={th()}>Cycle</th>
              <th style={th()}>Amount due</th><th style={th()}>Overdue</th><th style={th()}>Policy</th><th style={th()}>Status</th><th style={th()}>Action</th>
            </tr></thead>
            <tbody>
              {rows.map((d) => (
                <tr key={d.id}>
                  <td style={td()}>{d.id}<div style={{ fontSize: '0.72rem', color: '#9ca3af' }}>{timeAgo(d.created_at)}</div></td>
                  <td style={td()}>{d.circle_name}<div style={{ fontSize: '0.72rem', color: '#9ca3af' }}>{d.circle_id}</div></td>
                  <td style={td()}>{d.member_masked}</td>
                  <td style={td()}>{d.cycle_index}</td>
                  <td style={td()}>{formatNaira(d.amount_due_kobo)}</td>
                  <td style={td()}>{d.days_overdue}d</td>
                  <td style={td()}><Badge status={d.policy} /></td>
                  <td style={td()}><Badge status={d.status} /></td>
                  <td style={td()}>
                    {(d.status === 'open' || d.status === 'grace' || d.status === 'defaulted' || d.status === 'make_good') ? (
                      <div style={{ display: 'flex', gap: '0.35rem', flexWrap: 'wrap' }}>
                        <button style={btn()} disabled={busy === d.id} onClick={() => onAction(d, 'grace')}>Grace</button>
                        <button style={btn()} disabled={busy === d.id} onClick={() => onAction(d, 'make_good')}>Make-good</button>
                        <button style={btn()} disabled={busy === d.id} onClick={() => onAction(d, 'recover')}>Recover</button>
                        <button style={btnDanger()} disabled={busy === d.id} onClick={() => onAction(d, 'remove')}>Remove</button>
                      </div>
                    ) : <span style={{ color: '#9ca3af', fontSize: '0.78rem' }}>—</span>}
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
