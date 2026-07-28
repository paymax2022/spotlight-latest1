'use client';

import { useEffect, useState } from 'react';
import { listOrders, formatNaira, type OrderRecord } from '@/services/p2pmarketAdminService';
import { PageHeader, P2PMarketTabs, Card, Badge, DisclosureNote, StateBlock, FilterBar, btn, th, td, input, label, select, fmtDate } from '../_ui';

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
    <div style={{ padding: '0.5rem 0.5rem 2rem' }}>
      <PageHeader title="Orders" subtitle="Escrow-backed orders. Disputed orders are arbitrated from the Disputes tab." action={<button onClick={load} style={btn()}>Refresh</button>} />
      <P2PMarketTabs active="orders" />
      <DisclosureNote>Read-only — backed by member order projections. Funds in escrow are held, never lent (NL-6).</DisclosureNote>

      <FilterBar>
        <div style={{ minWidth: 200 }}>
          <label style={label()}>Search</label>
          <input style={input()} placeholder="Listing or order id…" value={q} onChange={(e) => setQ(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && load()} />
        </div>
        <div>
          <label style={label()}>Status</label>
          <select style={select()} value={status} onChange={(e) => setStatus(e.target.value)}>
            <option value="">All</option>
            <option value="in_escrow">In escrow</option>
            <option value="completed">Completed</option>
            <option value="disputed">Disputed</option>
            <option value="refunded">Refunded</option>
          </select>
        </div>
        <button style={btn()} onClick={load}>Apply</button>
      </FilterBar>

      <Card>
        <StateBlock loading={loading} error={error} empty={rows.length === 0} emptyText="No orders match.">
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead><tr>
              <th style={th()}>Order</th><th style={th()}>Listing</th><th style={th()}>Buyer</th><th style={th()}>Seller</th>
              <th style={th()}>Amount</th><th style={th()}>Status</th><th style={th()}>Created</th>
            </tr></thead>
            <tbody>
              {rows.map((o) => (
                <tr key={o.id}>
                  <td style={td()}><code style={{ fontSize: '0.78rem' }}>{o.id}</code></td>
                  <td style={td()}>{o.listing_title}</td>
                  <td style={td()}>{o.buyer_masked}</td>
                  <td style={td()}>{o.seller_masked}</td>
                  <td style={td()}>{formatNaira(o.amount_kobo)}</td>
                  <td style={td()}><Badge status={o.status} /></td>
                  <td style={td()}>{fmtDate(o.created_at)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </StateBlock>
      </Card>
    </div>
  );
}
