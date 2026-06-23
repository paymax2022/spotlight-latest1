'use client';

import { useEffect, useState } from 'react';
import { listOrders } from '@/services/investAdminService';
import type { AdminOrder } from '@/types/investAdmin';
import { PageHeader, InvestTabs, Card, Badge, btn, th, td, naira } from '../_ui';

const STATUSES = ['', 'Submitted', 'Accepted', 'PendingSettlement', 'Settled', 'Failed', 'Rejected', 'Cancelled'];

export default function InvestOrdersPage() {
  const [orders, setOrders] = useState<AdminOrder[]>([]);
  const [status, setStatus] = useState('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  async function load(s: string) {
    setLoading(true); setError(null);
    try { setOrders(await listOrders(s || undefined)); }
    catch (e) { setError(String(e)); }
    finally { setLoading(false); }
  }
  useEffect(() => { load(status); }, [status]);

  return (
    <div style={{ padding: '0.5rem 0.5rem 2rem' }}>
      <PageHeader
        title="Orders"
        subtitle="Monitor buy/sell orders across all users. Each carries a provider reference and is reconcilable."
        action={<button onClick={() => load(status)} style={btn()}>Refresh</button>}
      />
      <InvestTabs />

      <div style={{ display: 'flex', gap: 6, marginBottom: '1rem', flexWrap: 'wrap' }}>
        {STATUSES.map((s) => (
          <button
            key={s || 'all'}
            onClick={() => setStatus(s)}
            style={{ ...btn(), ...(status === s ? { background: '#340075', color: '#fff', borderColor: '#340075' } : {}) }}
          >
            {s || 'All'}
          </button>
        ))}
      </div>

      {error && <p style={{ color: '#dc2626' }}>{error}</p>}
      <Card>
        {loading ? (
          <p style={{ color: '#6b7280' }}>Loading orders…</p>
        ) : orders.length === 0 ? (
          <p style={{ color: '#6b7280' }}>No orders for this filter.</p>
        ) : (
          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.85rem' }}>
              <thead>
                <tr>
                  <th style={th()}>Symbol</th>
                  <th style={th()}>User</th>
                  <th style={th()}>Side</th>
                  <th style={th()}>Type</th>
                  <th style={th()}>Qty</th>
                  <th style={th()}>Fees</th>
                  <th style={th()}>Total</th>
                  <th style={th()}>Status</th>
                  <th style={th()}>Provider ref</th>
                  <th style={th()}>Created</th>
                </tr>
              </thead>
              <tbody>
                {orders.map((o) => (
                  <tr key={o.id}>
                    <td style={td()}><strong>{o.symbol}</strong></td>
                    <td style={td()} title={o.user_id}>{o.user_id.slice(0, 10)}…</td>
                    <td style={td()}>{o.side}</td>
                    <td style={td()}>{o.order_type}</td>
                    <td style={td()}>{o.filled_quantity || o.quantity}</td>
                    <td style={td()}>{naira(o.fees_kobo)}</td>
                    <td style={td()}>{naira(o.total_amount_kobo)}</td>
                    <td style={td()}>
                      <Badge status={o.status} />
                      {o.failure_reason && <div style={{ color: '#b91c1c', fontSize: '0.72rem', marginTop: 2 }}>{o.failure_reason}</div>}
                    </td>
                    <td style={td()}>{o.provider_reference || '—'}</td>
                    <td style={td()}>{new Date(o.created_at).toLocaleString('en-NG')}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>
    </div>
  );
}
