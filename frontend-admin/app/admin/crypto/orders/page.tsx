'use client';

import { useCallback, useEffect, useState } from 'react';
import { adminListOrders, formatKobo } from '@/services/cryptoAdminService';
import type { CryptoOrder } from '@/types/cryptoAdmin';
import {
  PageHeader, CryptoTabs, Card, StatusBadge, DisclosureNote, StateBlock, PermissionBanner,
  btn, th, td, mono, fmtDate, FilterBar, label as lbl, select,
  CRYPTO_PERMS, useCryptoPermission,
} from '../_ui';

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
    <div style={{ padding: '0.5rem 0.5rem 2rem' }}>
      <PageHeader
        title="Crypto — Orders"
        subtitle="All-user buy/sell fill history. Read-only oversight — orders are immutable money-path records; corrections happen via reversing entries in the ledger, never direct edits."
        action={<button onClick={() => void load(offset)} style={btn()}>Refresh</button>}
      />
      <CryptoTabs active="orders" />
      <DisclosureNote>
        Backed by <code>GET /api/v1/admin/crypto/orders</code> (RBAC <code>crypto.admin</code>). Each order carries an
        idempotency key server-side (not shown) and posts a balanced ledger entry pair on fill.
      </DisclosureNote>
      {!canAdmin && <PermissionBanner permission={CRYPTO_PERMS.admin} />}
      {error && <p style={{ color: '#dc2626' }}>{error}</p>}

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
              <th style={th()}>Order</th><th style={th()}>User</th><th style={th()}>Asset</th>
              <th style={th()}>Side</th><th style={th()}>Units</th><th style={th()}>Price (per unit)</th>
              <th style={th()}>Cash</th><th style={th()}>Status</th><th style={th()}>Reference</th><th style={th()}>Created</th>
            </tr></thead>
            <tbody>
              {filtered.map((o) => (
                <tr key={o.id}>
                  <td style={{ ...td(), ...mono() }}>{o.id}</td>
                  <td style={{ ...td(), ...mono() }}>{o.user_id}</td>
                  <td style={td()}>{o.symbol ?? o.asset_id}</td>
                  <td style={td()}><StatusBadge status={o.side} /></td>
                  <td style={td()}>{o.units.toLocaleString('en-NG')}</td>
                  <td style={td()}>{formatKobo(o.price_kobo)}</td>
                  <td style={td()}>{formatKobo(o.cash_kobo)}</td>
                  <td style={td()}><StatusBadge status={o.status} /></td>
                  <td style={{ ...td(), ...mono() }}>{o.reference || '—'}</td>
                  <td style={td()}>{fmtDate(o.created_at)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </StateBlock>

        <div style={{ display: 'flex', gap: '0.5rem', marginTop: '1rem', justifyContent: 'flex-end' }}>
          <button style={btn()} disabled={offset === 0} onClick={() => setOffset(Math.max(0, offset - PAGE_SIZE))}>Previous</button>
          <button style={btn()} disabled={rows.length < PAGE_SIZE} onClick={() => setOffset(offset + PAGE_SIZE)}>Next</button>
        </div>
      </Card>
    </div>
  );
}
