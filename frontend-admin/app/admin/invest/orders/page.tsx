'use client';

import { useEffect, useState } from 'react';
import { listOrders } from '@/services/investAdminService';
import type { AdminOrder } from '@/types/investAdmin';
import { InvestTabs, naira } from '../_ui';
import { Page, PageHeader, Card, Button, Badge, colors, tint, thCell, tdCell } from '@/components/ui/vuexy';

const STATUSES = ['', 'Submitted', 'Accepted', 'PendingSettlement', 'Settled', 'Failed', 'Rejected', 'Cancelled'];

function statusColor(status: string): string {
  if (status === 'Settled' || status === 'Filled') return colors.success;
  if (status === 'PendingSettlement') return colors.warning;
  if (status === 'Accepted' || status === 'Submitted') return colors.info;
  if (status === 'Failed' || status === 'Rejected') return colors.danger;
  return colors.secondary;
}

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
    <Page>
      <PageHeader
        title="Orders"
        subtitle="Monitor buy/sell orders across all users. Each carries a provider reference and is reconcilable."
        actions={<Button variant="outline" onClick={() => load(status)}>Refresh</Button>}
      />
      <InvestTabs />

      <div style={{ display: 'flex', gap: 6, marginBottom: '1rem', flexWrap: 'wrap' }}>
        {STATUSES.map((s) => (
          <Button
            key={s || 'all'}
            variant="outline"
            sm
            onClick={() => setStatus(s)}
            style={status === s ? { background: tint(colors.primary, 0.12), color: colors.primary, borderColor: colors.primary } : undefined}
          >
            {s || 'All'}
          </Button>
        ))}
      </div>

      {error && <p style={{ color: colors.danger }}>{error}</p>}
      <Card style={{ padding: 0, overflow: 'auto' }}>
        {loading ? (
          <p style={{ color: colors.muted, padding: 14 }}>Loading orders…</p>
        ) : orders.length === 0 ? (
          <p style={{ color: colors.muted, padding: 14 }}>No orders for this filter.</p>
        ) : (
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
            <thead>
              <tr>
                <th style={thCell}>Symbol</th>
                <th style={thCell}>User</th>
                <th style={thCell}>Side</th>
                <th style={thCell}>Type</th>
                <th style={thCell}>Qty</th>
                <th style={thCell}>Fees</th>
                <th style={thCell}>Total</th>
                <th style={thCell}>Status</th>
                <th style={thCell}>Provider ref</th>
                <th style={thCell}>Created</th>
              </tr>
            </thead>
            <tbody>
              {orders.map((o) => (
                <tr key={o.id}>
                  <td style={tdCell}><strong>{o.symbol}</strong></td>
                  <td style={tdCell} title={o.user_id}>{o.user_id.slice(0, 10)}…</td>
                  <td style={tdCell}>{o.side}</td>
                  <td style={tdCell}>{o.order_type}</td>
                  <td style={tdCell}>{o.filled_quantity || o.quantity}</td>
                  <td style={tdCell}>{naira(o.fees_kobo)}</td>
                  <td style={tdCell}>{naira(o.total_amount_kobo)}</td>
                  <td style={tdCell}>
                    <Badge text={o.status} color={statusColor(o.status)} />
                    {o.failure_reason && <div style={{ color: colors.danger, fontSize: '0.72rem', marginTop: 2 }}>{o.failure_reason}</div>}
                  </td>
                  <td style={tdCell}>{o.provider_reference || '—'}</td>
                  <td style={tdCell}>{new Date(o.created_at).toLocaleString('en-NG')}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Card>
    </Page>
  );
}
