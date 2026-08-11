'use client';

import { useEffect, useState } from 'react';
import { listPointsLedger, type PointsLedgerEntry } from '@/services/pointsAdminService';
import { PageHeader, PointsTabs, Card, Badge, DisclosureNote, StateBlock, FilterBar, btn, th, td, input, label, select, timeAgo } from '../_ui';

export default function PointsLedgerPage() {
  const [rows, setRows] = useState<PointsLedgerEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [kind, setKind] = useState('');
  const [q, setQ] = useState('');

  async function load() {
    setLoading(true); setError(null);
    try { setRows(await listPointsLedger({ kind: kind || undefined, q: q || undefined })); }
    catch (e) { setError(String(e)); }
    finally { setLoading(false); }
  }
  useEffect(() => { load(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [kind]);

  return (
    <div style={{ padding: '0.5rem 0.5rem 2rem' }}>
      <PageHeader title="Points ledger" subtitle="Append-only points movements — earn / redeem / adjust / expire." action={<button onClick={load} style={btn()}>Refresh</button>} />
      <PointsTabs active="ledger" />
      <DisclosureNote>Mock-only — the backend exposes <strong>no points ledger list route</strong>. The ledger is append-only (NL-4): entries are immutable; corrections are new adjusting entries, never edits.</DisclosureNote>

      <FilterBar>
        <div style={{ minWidth: 200 }}>
          <label style={label()}>Search</label>
          <input style={input()} placeholder="User, reason or entry id…" value={q} onChange={(e) => setQ(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && load()} />
        </div>
        <div>
          <label style={label()}>Kind</label>
          <select style={select()} value={kind} onChange={(e) => setKind(e.target.value)}>
            <option value="">All</option>
            <option value="earn">Earn</option>
            <option value="redeem">Redeem</option>
            <option value="adjust">Adjust</option>
            <option value="expire">Expire</option>
          </select>
        </div>
        <button style={btn()} onClick={load}>Apply</button>
      </FilterBar>

      <Card>
        <StateBlock loading={loading} error={error} empty={rows.length === 0} emptyText="No ledger entries match.">
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead><tr>
              <th style={th()}>Entry</th><th style={th()}>User</th><th style={th()}>Kind</th><th style={th()}>Points</th><th style={th()}>Reason</th><th style={th()}>When</th>
            </tr></thead>
            <tbody>
              {rows.map((e) => (
                <tr key={e.id}>
                  <td style={td()}><code style={{ fontSize: '0.78rem' }}>{e.id}</code></td>
                  <td style={td()}><code style={{ fontSize: '0.78rem' }}>{e.user_masked}</code></td>
                  <td style={td()}><Badge status={e.kind} label={e.kind} /></td>
                  <td style={{ ...td(), color: e.points >= 0 ? '#15803d' : '#b91c1c', fontWeight: 600 }}>{e.points >= 0 ? '+' : ''}{e.points.toLocaleString('en-NG')}</td>
                  <td style={td()}>{e.reason}</td>
                  <td style={td()}>{timeAgo(e.created_at)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </StateBlock>
      </Card>
    </div>
  );
}
