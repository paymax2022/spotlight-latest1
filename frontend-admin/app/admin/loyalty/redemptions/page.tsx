'use client';

import { useEffect, useState } from 'react';
import { listRedemptions, formatNaira, formatPoints } from '@/services/loyaltyAdminService';
import type { RedemptionRecord } from '@/types/loyaltyAdmin';
import { PageHeader, LoyaltyTabs, Card, Badge, DisclosureNote, StateBlock, FilterBar, btn, th, td, input, label, select, timeAgo } from '../../events/_ui';

export default function RedemptionsPage() {
  const [rows, setRows] = useState<RedemptionRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [status, setStatus] = useState('');
  const [kind, setKind] = useState('');
  const [fraudOnly, setFraudOnly] = useState(false);
  const [q, setQ] = useState('');

  async function load() {
    setLoading(true); setError(null);
    try { setRows(await listRedemptions({ status: status || undefined, kind: kind || undefined, fraud: fraudOnly || undefined, q: q || undefined })); }
    catch (e) { setError(String(e)); }
    finally { setLoading(false); }
  }
  useEffect(() => { load(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [status, kind, fraudOnly]);

  return (
    <div style={{ padding: '0.5rem 0.5rem 2rem' }}>
      <PageHeader title="Redemption log" subtitle="All point redemptions with anomaly flags (velocity, self-deal, reversal abuse)." action={<button onClick={load} style={btn()}>Refresh</button>} />
      <LoyaltyTabs active="redemptions" />
      <DisclosureNote>Redemptions deliver non-cash value only (NL-4). Flagged rows show a velocity / abuse anomaly for investigation. Point costs labelled <code>pts</code>; delivered value shown ₦ (kobo).</DisclosureNote>

      <FilterBar>
        <div style={{ minWidth: 200 }}>
          <label style={label()}>Search</label>
          <input style={input()} placeholder="Member, item or id…" value={q} onChange={(e) => setQ(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && load()} />
        </div>
        <div>
          <label style={label()}>Kind</label>
          <select style={select()} value={kind} onChange={(e) => setKind(e.target.value)}>
            <option value="">All</option>
            <option value="airtime">Airtime</option>
            <option value="bill_credit">Bill credit</option>
            <option value="ticket_discount">Ticket discount</option>
            <option value="perk">Perk</option>
          </select>
        </div>
        <div>
          <label style={label()}>Status</label>
          <select style={select()} value={status} onChange={(e) => setStatus(e.target.value)}>
            <option value="">All</option>
            <option value="completed">Completed</option>
            <option value="pending">Pending</option>
            <option value="reversed">Reversed</option>
            <option value="flagged">Flagged</option>
            <option value="failed">Failed</option>
          </select>
        </div>
        <div>
          <label style={label()}>Fraud</label>
          <select style={select()} value={fraudOnly ? '1' : ''} onChange={(e) => setFraudOnly(e.target.value === '1')}>
            <option value="">All</option>
            <option value="1">Flagged only</option>
          </select>
        </div>
        <button style={btn()} onClick={load}>Apply</button>
      </FilterBar>

      <Card>
        <StateBlock loading={loading} error={error} empty={rows.length === 0} emptyText="No redemptions match.">
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead><tr>
              <th style={th()}>Redemption</th><th style={th()}>Member</th><th style={th()}>Item</th><th style={th()}>Kind</th>
              <th style={th()}>Cost</th><th style={th()}>Value</th><th style={th()}>Status</th><th style={th()}>Fraud</th><th style={th()}>When</th>
            </tr></thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.id}>
                  <td style={td()}><code style={{ fontSize: '0.78rem' }}>{r.id}</code></td>
                  <td style={td()}>{r.member_masked}</td>
                  <td style={td()}>{r.item_name}</td>
                  <td style={td()}><Badge status={r.kind} label={r.kind.replace(/_/g, ' ')} /></td>
                  <td style={td()}>{formatPoints(r.cost_points)}</td>
                  <td style={td()}>{r.cash_value_kobo > 0 ? formatNaira(r.cash_value_kobo) : <span style={{ color: '#9ca3af' }}>n/a</span>}</td>
                  <td style={td()}><Badge status={r.status} /></td>
                  <td style={td()}>{r.fraud_flag ? <span title={r.fraud_reason ?? undefined}><Badge status="flagged" label="flagged" /></span> : <span style={{ color: '#9ca3af' }}>—</span>}</td>
                  <td style={td()}>{timeAgo(r.created_at)}</td>
                </tr>
              ))}
            </tbody>
          </table>
          {rows.some((r) => r.fraud_flag) && (
            <p style={{ fontSize: '0.75rem', color: '#9a3412', marginTop: '0.75rem' }}>Hover a flagged row&apos;s badge to see the anomaly reason.</p>
          )}
        </StateBlock>
      </Card>
    </div>
  );
}
