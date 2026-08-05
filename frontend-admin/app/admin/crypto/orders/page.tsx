'use client';

import { useCallback, useEffect, useState } from 'react';
import { adminListOrders, formatKobo } from '@/services/cryptoAdminService';
import type { CryptoOrder } from '@/types/cryptoAdmin';
import {
  CryptoTabs, StatusBadge, DisclosureNote, StateBlock, PermissionBanner,
  mono, fmtDate, FilterBar, label as lbl, select,
  CRYPTO_PERMS, useCryptoPermission,
} from '../_ui';
import { Page, PageHeader, Card, Button, colors, thCell, tdCell } from '@/components/ui/vuexy';

const PAGE_SIZE = 50;

export default function CryptoOrdersPage() {
  const { allowed: canAdmin } = useCryptoPermission(CRYPTO_PERMS.admin);

  const [rows, setRows] = useState<CryptoOrder[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [offset, setOffset] = useState(0);
  const [statusFilter, setStatusFilter] = useState('');
  const [sideFilter, setSideFilter] = useState('');

  const load = useCallback(async (off: number) => {
    setLoading(true); setError(null);
    try { setRows(await adminListOrders(PAGE_SIZE, off)); }
    catch (e) { setError(String(e)); }
    finally { setLoading(false); }
  }, []);

  useEffect(() => { void load(offset); }, [offset, load]);

  const filtered = rows.filter((o) => (!statusFilter || o.status === statusFilter) && (!sideFilter || o.side === sideFilter));

  return (
    <Page>
      <PageHeader
        title="Crypto — Orders"
        subtitle="All-user buy/sell fill history. Read-only oversight — orders are immutable money-path records; corrections happen via reversing entries in the ledger, never direct edits."
        actions={<Button variant="outline" onClick={() => void load(offset)}>Refresh</Button>}
      />
      <CryptoTabs active="orders" />
      <DisclosureNote>
        Backed by <code>GET /api/v1/admin/crypto/orders</code> (RBAC <code>crypto.admin</code>). Each order carries an
        idempotency key server-side (not shown) and posts a balanced ledger entry pair on fill.
      </DisclosureNote>
      {!canAdmin && <PermissionBanner permission={CRYPTO_PERMS.admin} />}
      {error && <p style={{ color: colors.danger }}>{error}</p>}

      <Card>
        <FilterBar>
          <div>
            <label style={lbl()}>Status</label>
            <select style={select()} value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)}>
              <option value="">All</option>
              <option value="pending">Pending</option>
              <option value="filled">Filled</option>
              <option value="failed">Failed</option>
              <option value="reversed">Reversed</option>
            </select>
          </div>
          <div>
            <label style={lbl()}>Side</label>
            <select style={select()} value={sideFilter} onChange={(e) => setSideFilter(e.target.value)}>
              <option value="">All</option>
              <option value="buy">Buy</option>
              <option value="sell">Sell</option>
            </select>
          </div>
        </FilterBar>

        <StateBlock loading={loading} error={null} empty={filtered.length === 0} emptyText="No orders match this filter.">
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead><tr>
              <th style={thCell}>Order</th><th style={thCell}>User</th><th style={thCell}>Asset</th>
              <th style={thCell}>Side</th><th style={thCell}>Units</th><th style={thCell}>Price (per unit)</th>
              <th style={thCell}>Cash</th><th style={thCell}>Status</th><th style={thCell}>Reference</th><th style={thCell}>Created</th>
            </tr></thead>
            <tbody>
              {filtered.map((o) => (
                <tr key={o.id}>
                  <td style={{ ...tdCell, ...mono() }}>{o.id}</td>
                  <td style={{ ...tdCell, ...mono() }}>{o.user_id}</td>
                  <td style={tdCell}>{o.symbol ?? o.asset_id}</td>
                  <td style={tdCell}><StatusBadge status={o.side} /></td>
                  <td style={tdCell}>{o.units.toLocaleString('en-NG')}</td>
                  <td style={tdCell}>{formatKobo(o.price_kobo)}</td>
                  <td style={tdCell}>{formatKobo(o.cash_kobo)}</td>
                  <td style={tdCell}><StatusBadge status={o.status} /></td>
                  <td style={{ ...tdCell, ...mono() }}>{o.reference || '—'}</td>
                  <td style={tdCell}>{fmtDate(o.created_at)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </StateBlock>

        <div style={{ display: 'flex', gap: '0.5rem', marginTop: '1rem', justifyContent: 'flex-end' }}>
          <Button variant="outline" sm disabled={offset === 0} onClick={() => setOffset(Math.max(0, offset - PAGE_SIZE))}>Previous</Button>
          <Button variant="outline" sm disabled={rows.length < PAGE_SIZE} onClick={() => setOffset(offset + PAGE_SIZE)}>Next</Button>
        </div>
      </Card>
    </Page>
  );
}
