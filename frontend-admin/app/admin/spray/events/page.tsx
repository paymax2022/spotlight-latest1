'use client';

import { useEffect, useState } from 'react';
import { listSprayEvents, getSprayLeaderboard, formatNaira, type SprayEvent, type SprayLeaderRow } from '@/services/sprayAdminService';
import { PageHeader, SprayTabs, Card, Badge, DisclosureNote, StateBlock, FilterBar, btn, btnPrimary, th, td, input, label, select, fmtDate } from '../_ui';
import { colors } from '@/components/ui/vuexy';

export default function SprayEventsPage() {
  const [rows, setRows] = useState<SprayEvent[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [status, setStatus] = useState('');
  const [q, setQ] = useState('');
  const [selected, setSelected] = useState<SprayEvent | null>(null);
  const [board, setBoard] = useState<SprayLeaderRow[]>([]);
  const [boardLoading, setBoardLoading] = useState(false);

  async function load() {
    setLoading(true); setError(null);
    try { setRows(await listSprayEvents({ status: status || undefined, q: q || undefined })); }
    catch (e) { setError(String(e)); }
    finally { setLoading(false); }
  }
  useEffect(() => { load(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [status]);

  async function viewBoard(e: SprayEvent) {
    setSelected(e); setBoardLoading(true);
    try { setBoard(await getSprayLeaderboard(e.context_ref)); }
    catch { setBoard([]); }
    finally { setBoardLoading(false); }
  }

  return (
    <div style={{ padding: '0.5rem 0.5rem 2rem' }}>
      <PageHeader title="Spray events" subtitle="Spray contexts (events). Open a leaderboard for AML oversight." action={<button onClick={load} style={btn()}>Refresh</button>} />
      <SprayTabs active="events" />
      <DisclosureNote>The leaderboard is the live admin endpoint (<code>/api/spray/admin/spray/leaderboard/:contextRef</code>, RBAC <code>spray.read</code>). The event list is a mock projection.</DisclosureNote>

      <FilterBar>
        <div style={{ minWidth: 200 }}>
          <label style={label()}>Search</label>
          <input style={input()} placeholder="Name or context ref…" value={q} onChange={(e) => setQ(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && load()} />
        </div>
        <div>
          <label style={label()}>Status</label>
          <select style={select()} value={status} onChange={(e) => setStatus(e.target.value)}>
            <option value="">All</option>
            <option value="live">Live</option>
            <option value="scheduled">Scheduled</option>
            <option value="closed">Closed</option>
          </select>
        </div>
        <button style={btn()} onClick={load}>Apply</button>
      </FilterBar>

      <Card>
        <StateBlock loading={loading} error={error} empty={rows.length === 0} emptyText="No events match.">
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead><tr>
              <th style={th()}>Event</th><th style={th()}>Host</th><th style={th()}>Status</th><th style={th()}>Total sprayed</th>
              <th style={th()}>Sprayers</th><th style={th()}>Started</th><th style={th()}>Action</th>
            </tr></thead>
            <tbody>
              {rows.map((e) => (
                <tr key={e.context_ref}>
                  <td style={td()}>{e.name}<div style={{ fontSize: '0.72rem', color: colors.muted }}>{e.context_ref}</div></td>
                  <td style={td()}>{e.host_masked}</td>
                  <td style={td()}><Badge status={e.status} /></td>
                  <td style={td()}>{formatNaira(e.total_sprayed_kobo)}</td>
                  <td style={td()}>{e.sprayer_count.toLocaleString('en-NG')}</td>
                  <td style={td()}>{fmtDate(e.started_at)}</td>
                  <td style={td()}><button style={btnPrimary()} onClick={() => viewBoard(e)}>Leaderboard</button></td>
                </tr>
              ))}
            </tbody>
          </table>
        </StateBlock>
      </Card>

      {selected && (
        <Card title={`Leaderboard — ${selected.name}`} right={<button style={btn()} onClick={() => setSelected(null)}>Close</button>}>
          {boardLoading ? <p style={{ color: '#6b7280' }}>Loading…</p> : board.length === 0 ? <p style={{ color: '#6b7280' }}>No spray activity.</p> : (
            <table style={{ width: '100%', borderCollapse: 'collapse' }}>
              <thead><tr><th style={th()}>Rank</th><th style={th()}>Sprayer</th><th style={th()}>Total sprayed</th><th style={th()}>Sprays</th></tr></thead>
              <tbody>
                {board.map((r) => (
                  <tr key={r.rank}>
                    <td style={td()}>#{r.rank}</td>
                    <td style={td()}>{r.user_masked}</td>
                    <td style={td()}>{formatNaira(r.total_kobo)}</td>
                    <td style={td()}>{r.spray_count.toLocaleString('en-NG')}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </Card>
      )}
    </div>
  );
}
