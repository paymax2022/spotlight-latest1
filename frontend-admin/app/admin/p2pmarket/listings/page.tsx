'use client';

import { useEffect, useState } from 'react';
import { listListings, formatNaira, type ListingRecord } from '@/services/p2pmarketAdminService';
import { P2PMarketTabs, DisclosureNote, StateBlock, FilterBar, fmtDate } from '../_ui';
import { Page, PageHeader, Card, Button, Input, Badge, colors, thCell, tdCell } from '@/components/ui/vuexy';

function statusColor(status: string): string {
  switch (status) {
    case 'open':
      return colors.success;
    case 'closed':
      return colors.secondary;
    default:
      return colors.secondary;
  }
}

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
    <Page>
      <PageHeader title="Listings" subtitle="Marketplace listing oversight — seller identity is masked." actions={<Button variant="outline" onClick={load}>Refresh</Button>} />
      <P2PMarketTabs active="listings" />
      <DisclosureNote>Read-only — backed by member listing projections (<code>/api/finance/p2p/listings</code>). No admin moderation surface exists on the backend yet.</DisclosureNote>

      <FilterBar>
        <div style={{ minWidth: 200 }}>
          <label style={{ display: 'block', fontSize: '0.75rem', fontWeight: 600, color: colors.text, marginBottom: '0.25rem' }}>Search</label>
          <Input placeholder="Title, seller or id…" value={q} onChange={(e) => setQ(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && load()} />
        </div>
        <div>
          <label style={{ display: 'block', fontSize: '0.75rem', fontWeight: 600, color: colors.text, marginBottom: '0.25rem' }}>Status</label>
          <select value={status} onChange={(e) => setStatus(e.target.value)}>
            <option value="">All</option>
            <option value="open">Open</option>
            <option value="closed">Closed</option>
          </select>
        </div>
        <Button variant="outline" onClick={load}>Apply</Button>
      </FilterBar>

      <Card style={{ padding: 0, overflow: 'auto' }}>
        <StateBlock loading={loading} error={error} empty={rows.length === 0} emptyText="No listings match.">
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead><tr>
              <th style={thCell}>Listing</th><th style={thCell}>Seller</th><th style={thCell}>Price</th><th style={thCell}>Status</th>
              <th style={thCell}>Seller rating</th><th style={thCell}>Created</th>
            </tr></thead>
            <tbody>
              {rows.map((l) => (
                <tr key={l.id}>
                  <td style={tdCell}>{l.title}<div style={{ fontSize: '0.72rem', color: colors.muted }}>{l.id}</div></td>
                  <td style={tdCell}>{l.seller_masked}</td>
                  <td style={tdCell}>{formatNaira(l.price_kobo)}</td>
                  <td style={tdCell}><Badge text={l.status} color={statusColor(l.status)} /></td>
                  <td style={tdCell}>{l.seller_rating.toFixed(1)} / 5</td>
                  <td style={tdCell}>{fmtDate(l.created_at)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </StateBlock>
      </Card>
    </Page>
  );
}
