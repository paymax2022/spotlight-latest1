'use client';

import { useEffect, useState } from 'react';
import { listListings, formatNaira, type ListingRecord } from '@/services/p2pmarketAdminService';
import { PageHeader, P2PMarketTabs, Card, Badge, DisclosureNote, StateBlock, FilterBar, btn, th, td, input, label, select, fmtDate } from '../_ui';

export default function ListingsPage() {
  const [rows, setRows] = useState<ListingRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [status, setStatus] = useState('');
  const [q, setQ] = useState('');

  async function load() {
    setLoading(true); setError(null);
    try { setRows(await listListings({ status: status || undefined, q: q || undefined })); }
    catch (e) { setError(String(e)); }
    finally { setLoading(false); }
  }
  useEffect(() => { load(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [status]);

  return (
    <div style={{ padding: '0.5rem 0.5rem 2rem' }}>
      <PageHeader title="Listings" subtitle="Marketplace listing oversight — seller identity is masked." action={<button onClick={load} style={btn()}>Refresh</button>} />
      <P2PMarketTabs active="listings" />
      <DisclosureNote>Read-only — backed by member listing projections (<code>/api/finance/p2p/listings</code>). No admin moderation surface exists on the backend yet.</DisclosureNote>

      <FilterBar>
        <div style={{ minWidth: 200 }}>
          <label style={label()}>Search</label>
          <input style={input()} placeholder="Title, seller or id…" value={q} onChange={(e) => setQ(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && load()} />
        </div>
        <div>
          <label style={label()}>Status</label>
          <select style={select()} value={status} onChange={(e) => setStatus(e.target.value)}>
            <option value="">All</option>
            <option value="open">Open</option>
            <option value="closed">Closed</option>
          </select>
        </div>
        <button style={btn()} onClick={load}>Apply</button>
      </FilterBar>

      <Card>
        <StateBlock loading={loading} error={error} empty={rows.length === 0} emptyText="No listings match.">
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead><tr>
              <th style={th()}>Listing</th><th style={th()}>Seller</th><th style={th()}>Price</th><th style={th()}>Status</th>
              <th style={th()}>Seller rating</th><th style={th()}>Created</th>
            </tr></thead>
            <tbody>
              {rows.map((l) => (
                <tr key={l.id}>
                  <td style={td()}>{l.title}<div style={{ fontSize: '0.72rem', color: '#9ca3af' }}>{l.id}</div></td>
                  <td style={td()}>{l.seller_masked}</td>
                  <td style={td()}>{formatNaira(l.price_kobo)}</td>
                  <td style={td()}><Badge status={l.status} /></td>
                  <td style={td()}>{l.seller_rating.toFixed(1)} / 5</td>
                  <td style={td()}>{fmtDate(l.created_at)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </StateBlock>
      </Card>
    </div>
  );
}
