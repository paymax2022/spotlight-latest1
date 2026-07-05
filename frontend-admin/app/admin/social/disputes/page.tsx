'use client';

import { useEffect, useState } from 'react';
import { listSocialDisputes, formatNaira } from '@/services/socialAdminService';
import type { SocialDispute } from '@/types/socialAdmin';
import { PageHeader, SocialTabs, Card, Badge, DisclosureNote, StateBlock, FilterBar, btn, th, td, input, label, select, timeAgo } from '../../savings/_ui';

export default function SocialDisputesPage() {
  const [rows, setRows] = useState<SocialDispute[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [status, setStatus] = useState('');
  const [kind, setKind] = useState('');
  const [q, setQ] = useState('');

  async function load() {
    setLoading(true); setError(null);
    try { setRows(await listSocialDisputes({ status: status || undefined, kind: kind || undefined, q: q || undefined })); }
    catch (e) { setError(String(e)); }
    finally { setLoading(false); }
  }
  useEffect(() => { load(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [status, kind]);

  return (
    <div style={{ padding: '0.5rem 0.5rem 2rem' }}>
      <PageHeader title="Disputes" subtitle="Payment, request, split and pool disputes raised on the social-payments rail." action={<button onClick={load} style={btn()}>Refresh</button>} />
      <SocialTabs active="disputes" />
      <DisclosureNote>Dispute resolutions that move money are settled via reversing ledger entries (NL-8); every status change is recorded to the immutable audit log (NL-12).</DisclosureNote>

      <FilterBar>
        <div style={{ minWidth: 200 }}>
          <label style={label()}>Search</label>
          <input style={input()} placeholder="Txn ref, party or id…" value={q} onChange={(e) => setQ(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && load()} />
        </div>
        <div>
          <label style={label()}>Kind</label>
          <select style={select()} value={kind} onChange={(e) => setKind(e.target.value)}>
            <option value="">All</option><option value="payment">Payment</option><option value="request">Request</option><option value="split">Split</option><option value="pool">Pool</option>
          </select>
        </div>
        <div>
          <label style={label()}>Status</label>
          <select style={select()} value={status} onChange={(e) => setStatus(e.target.value)}>
            <option value="">All</option><option value="open">Open</option><option value="investigating">Investigating</option><option value="resolved">Resolved</option><option value="rejected">Rejected</option><option value="closed">Closed</option>
          </select>
        </div>
        <button style={btn()} onClick={load}>Apply</button>
      </FilterBar>

      <Card>
        <StateBlock loading={loading} error={error} empty={rows.length === 0} emptyText="No disputes match.">
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead><tr>
              <th style={th()}>Dispute</th><th style={th()}>Kind</th><th style={th()}>Txn</th><th style={th()}>Complainant</th>
              <th style={th()}>Respondent</th><th style={th()}>Amount</th><th style={th()}>Reason</th><th style={th()}>Status</th><th style={th()}>Updated</th>
            </tr></thead>
            <tbody>
              {rows.map((d) => (
                <tr key={d.id}>
                  <td style={td()}>{d.id}<div style={{ fontSize: '0.72rem', color: '#9ca3af' }}>opened {timeAgo(d.opened_at)}</div></td>
                  <td style={td()}><Badge status={d.kind} /></td>
                  <td style={td()}><code style={{ fontSize: '0.78rem' }}>{d.txn_ref}</code></td>
                  <td style={td()}>{d.complainant_masked}</td>
                  <td style={td()}>{d.respondent_masked}</td>
                  <td style={td()}>{formatNaira(d.amount_kobo)}</td>
                  <td style={td()}>{d.reason.replace(/_/g, ' ')}</td>
                  <td style={td()}><Badge status={d.status} /></td>
                  <td style={td()}>{timeAgo(d.updated_at)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </StateBlock>
      </Card>
    </div>
  );
}
