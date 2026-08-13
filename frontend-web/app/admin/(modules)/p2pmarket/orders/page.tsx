'use client';

import { useEffect, useState } from 'react';
import { listOrders, formatNaira, type OrderRecord } from '@/services/p2pmarketAdminService';
import { P2PMarketTabs, DisclosureNote, StateBlock, FilterBar, fmtDate } from '../_ui';
import { Page, PageHeader, Card, Button, Input, Badge, colors, thCell, tdCell } from '@/components/ui/vuexy';

function statusColor(status: string): string {
  switch (status) {
    case 'completed':
      return colors.success;
    case 'in_escrow':
      return colors.info;
    case 'disputed':
      return colors.warning;
    case 'refunded':
      return colors.secondary;
    default:
      return colors.secondary;
  }
}

export default function OrdersPage() {
  const [rows, setRows] = useState<OrderRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [status, setStatus] = useState('');
  const [q, setQ] = useState('');

  async function load() {
    setLoading(true); setError(null);
    try { setRows(await listOrders({ status: status || undefined, q: q || undefined })); }
    catch (e) { setError(String(e)); }
    finally { setLoading(false); }
  }
  useEffect(() => { load(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [status]);

  return (
    <Page>
      <PageHeader title="Orders" subtitle="Escrow-backed orders. Disputed orders are arbitrated from the Disputes tab." actions={<Button variant="outline" onClick={load}>Refresh</Button>} />
      <P2PMarketTabs active="orders" />
      <DisclosureNote>Read-only — backed by member order projections. Funds in escrow are held, never lent (NL-6).</DisclosureNote>

      <FilterBar>
        <div style={{ minWidth: 200 }}>
          <label style={{ display: 'block', fontSize: '0.75rem', fontWeight: 600, color: colors.text, marginBottom: '0.25rem' }}>Search</label>
          <Input placeholder="Listing or order id…" value={q} onChange={(e) => setQ(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && load()} />
        </div>
        <div>
          <label style={{ display: 'block', fontSize: '0.75rem', fontWeight: 600, color: colors.text, marginBottom: '0.25rem' }}>Status</label>
          <select value={status} onChange={(e) => setStatus(e.target.value)}>
            <option value="">All</option>
            <option value="in_escrow">In escrow</option>
            <option value="completed">Completed</option>
            <option value="disputed">Disputed</option>
            <option value="refunded">Refunded</option>
          </select>
        </div>
        <Button variant="outline" onClick={load}>Apply</Button>
      </FilterBar>

      <Card style={{ padding: 0, overflow: 'auto' }}>
        <StateBlock loading={loading} error={error} empty={rows.length === 0} emptyText="No orders match.">
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead><tr>
              <th style={thCell}>Order</th><th style={thCell}>Listing</th><th style={thCell}>Buyer</th><th style={thCell}>Seller</th>
              <th style={thCell}>Amount</th><th style={thCell}>Status</th><th style={thCell}>Created</th>
            </tr></thead>
            <tbody>
              {rows.map((o) => (
                <tr key={o.id}>
                  <td style={tdCell}><code style={{ fontSize: '0.78rem' }}>{o.id}</code></td>
                  <td style={tdCell}>{o.listing_title}</td>
                  <td style={tdCell}>{o.buyer_masked}</td>
                  <td style={tdCell}>{o.seller_masked}</td>
                  <td style={tdCell}>{formatNaira(o.amount_kobo)}</td>
                  <td style={tdCell}><Badge text={o.status.replace(/_/g, ' ')} color={statusColor(o.status)} /></td>
                  <td style={tdCell}>{fmtDate(o.created_at)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </StateBlock>
      </Card>
    </Page>
  );
}
