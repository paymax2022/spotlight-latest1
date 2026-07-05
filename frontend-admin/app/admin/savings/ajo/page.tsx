'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import { listAjoCircles, formatNaira } from '@/services/savingsAdminService';
import type { AjoCircleSummary } from '@/types/savingsAdmin';
import { PageHeader, SavingsTabs, Card, Badge, DisclosureNote, StateBlock, FilterBar, btn, th, td, input, label, select, fmtDate, pct } from '../_ui';

export default function AjoPage() {
  const [rows, setRows] = useState<AjoCircleSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [status, setStatus] = useState('');
  const [health, setHealth] = useState('');
  const [q, setQ] = useState('');

  async function load() {
    setLoading(true); setError(null);
    try { setRows(await listAjoCircles({ status: status || undefined, health: health || undefined, q: q || undefined })); }
    catch (e) { setError(String(e)); }
    finally { setLoading(false); }
  }
  useEffect(() => { load(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [status, health]);

  return (
    <div style={{ padding: '0.5rem 0.5rem 2rem' }}>
      <PageHeader title="Ajo circle monitoring" subtitle="Collections per cycle, payout queue and circle health across all rotating-savings (Ajo/Esusu) circles." action={<button onClick={load} style={btn()}>Refresh</button>} />
      <SavingsTabs active="ajo" />
      <DisclosureNote>NL-7 — Ajo is <strong>peer rotation</strong>: members fund each other. Paymax is ledger + escrow only and never advances credit or guarantees a cycle. NL-2 — no yield on held contributions.</DisclosureNote>

      <FilterBar>
        <div style={{ minWidth: 200 }}>
          <label style={label()}>Search</label>
          <input style={input()} placeholder="Circle name or id…" value={q} onChange={(e) => setQ(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && load()} />
        </div>
        <div>
          <label style={label()}>Status</label>
          <select style={select()} value={status} onChange={(e) => setStatus(e.target.value)}>
            <option value="">All</option><option value="forming">Forming</option><option value="active">Active</option><option value="completed">Completed</option><option value="closed">Closed</option>
          </select>
        </div>
        <div>
          <label style={label()}>Health</label>
          <select style={select()} value={health} onChange={(e) => setHealth(e.target.value)}>
            <option value="">All</option><option value="healthy">Healthy</option><option value="at_risk">At risk</option><option value="defaulted">Defaulted</option>
          </select>
        </div>
        <button style={btn()} onClick={load}>Apply</button>
      </FilterBar>

      <Card>
        <StateBlock loading={loading} error={error} empty={rows.length === 0} emptyText="No circles match.">
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead><tr>
              <th style={th()}>Circle</th><th style={th()}>Status</th><th style={th()}>Health</th><th style={th()}>Members</th>
              <th style={th()}>Cycle</th><th style={th()}>Collected this cycle</th><th style={th()}>Defaults</th><th style={th()}>Next payout</th><th style={th()}></th>
            </tr></thead>
            <tbody>
              {rows.map((c) => (
                <tr key={c.id}>
                  <td style={td()}>{c.name}<div style={{ fontSize: '0.72rem', color: '#9ca3af' }}>{c.id} · {formatNaira(c.contribution_kobo)}/{c.frequency}</div></td>
                  <td style={td()}><Badge status={c.status} /></td>
                  <td style={td()}><Badge status={c.health} /></td>
                  <td style={td()}>{c.members_count}</td>
                  <td style={td()}>{c.cycle_index}/{c.total_cycles}</td>
                  <td style={td()}>{formatNaira(c.collected_this_cycle_kobo)} <span style={{ color: '#9ca3af', fontSize: '0.72rem' }}>/ {formatNaira(c.expected_this_cycle_kobo)} ({c.expected_this_cycle_kobo ? pct(c.collected_this_cycle_kobo / c.expected_this_cycle_kobo) : '0%'})</span></td>
                  <td style={td()}>{c.defaults_count > 0 ? <Badge status="defaulted" label={`${c.defaults_count}`} /> : <span style={{ color: '#15803d' }}>0</span>}</td>
                  <td style={td()}>{c.next_payout_member_masked ? <>{c.next_payout_member_masked}<div style={{ fontSize: '0.72rem', color: '#9ca3af' }}>{formatNaira(c.next_payout_kobo)} · {fmtDate(c.next_payout_date)}</div></> : '—'}</td>
                  <td style={td()}><Link href={`/admin/savings/ajo/${c.id}`} style={{ ...btn(), textDecoration: 'none', display: 'inline-block' }}>View</Link></td>
                </tr>
              ))}
            </tbody>
          </table>
        </StateBlock>
      </Card>
    </div>
  );
}
