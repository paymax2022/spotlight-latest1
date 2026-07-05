'use client';

import { useEffect, useState } from 'react';
import { listCreatorBilling, formatNaira } from '@/services/creatorsAdminService';
import type { CreatorBillingItem } from '@/types/creatorsAdmin';
import { PageHeader, CreatorsTabs, Card, Badge, DisclosureNote, StateBlock, FilterBar, btn, th, td, input, label, select, fmtDate, timeAgo } from '../_ui';

export default function CreatorBillingPage() {
  const [rows, setRows] = useState<CreatorBillingItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [status, setStatus] = useState('failed');
  const [q, setQ] = useState('');

  async function load() {
    setLoading(true); setError(null);
    try { setRows(await listCreatorBilling({ status: status || undefined, q: q || undefined })); }
    catch (e) { setError(String(e)); }
    finally { setLoading(false); }
  }
  useEffect(() => { load(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [status]);

  return (
    <div style={{ padding: '0.5rem 0.5rem 2rem' }}>
      <PageHeader title="Subscription billing & failed renewals" subtitle="Recurring subscription billing driven by the scheduler with automatic retry on failure. Track past-due and failed renewals before they cancel." action={<button onClick={load} style={btn()}>Refresh</button>} />
      <CreatorsTabs active="billing" />
      <DisclosureNote>Subscriptions renew via the scheduler (recurring, retry-on-fail). After exhausting retries a subscription cancels. Every charge attempt is idempotent and ledger-posted (NL-8/NL-9). Money shown ₦ (stored as kobo).</DisclosureNote>

      <FilterBar>
        <div style={{ minWidth: 220 }}>
          <label style={label()}>Search</label>
          <input style={input()} placeholder="Subscriber, creator or sub id…" value={q} onChange={(e) => setQ(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && load()} />
        </div>
        <div>
          <label style={label()}>Status</label>
          <select style={select()} value={status} onChange={(e) => setStatus(e.target.value)}>
            <option value="">All</option>
            <option value="active">Active</option>
            <option value="past_due">Past due</option>
            <option value="failed">Failed</option>
            <option value="cancelled">Cancelled</option>
            <option value="paused">Paused</option>
          </select>
        </div>
        <button style={btn()} onClick={load}>Apply</button>
      </FilterBar>

      <Card>
        <StateBlock loading={loading} error={error} empty={rows.length === 0} emptyText="No subscriptions in this state.">
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead><tr>
              <th style={th()}>Subscription</th><th style={th()}>Subscriber</th><th style={th()}>Creator</th><th style={th()}>Tier</th>
              <th style={th()}>Amount</th><th style={th()}>Cycle</th><th style={th()}>Retries</th><th style={th()}>Next attempt</th><th style={th()}>Last failure</th><th style={th()}>Status</th>
            </tr></thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.id}>
                  <td style={td()}><code style={{ fontSize: '0.78rem' }}>{r.id}</code><div style={{ fontSize: '0.72rem', color: '#9ca3af' }}>since {fmtDate(r.started_at)}</div></td>
                  <td style={td()}>{r.subscriber_masked}</td>
                  <td style={td()}>{r.creator_handle_masked}</td>
                  <td style={td()}>{r.tier_name}</td>
                  <td style={td()}>{formatNaira(r.amount_kobo)}</td>
                  <td style={td()}><Badge status={r.cycle} /></td>
                  <td style={td()}><span style={{ color: r.retries >= r.max_retries ? '#b91c1c' : r.retries > 0 ? '#9a3412' : '#9ca3af', fontWeight: r.retries > 0 ? 700 : 400 }}>{r.retries}/{r.max_retries}</span></td>
                  <td style={td()}>{r.next_attempt_at ? timeAgo(r.next_attempt_at) : <span style={{ color: '#9ca3af' }}>—</span>}</td>
                  <td style={td()}>{r.last_failure_reason ? <span style={{ color: '#b91c1c', fontSize: '0.78rem' }}>{r.last_failure_reason}</span> : <span style={{ color: '#9ca3af' }}>—</span>}</td>
                  <td style={td()}><Badge status={r.status} /></td>
                </tr>
              ))}
            </tbody>
          </table>
        </StateBlock>
      </Card>
    </div>
  );
}
