'use client';

import { useEffect, useState } from 'react';
import { listAssets, updateAsset } from '@/services/investAdminService';
import type { AdminStockAsset, AssetUpdate } from '@/types/investAdmin';
import { PageHeader, InvestTabs, Card, Badge, btn, btnPrimary, th, td, naira } from '../_ui';

export default function InvestAssetsPage() {
  const [assets, setAssets] = useState<AdminStockAsset[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [savingId, setSavingId] = useState<string | null>(null);

  async function load() {
    setLoading(true); setError(null);
    try { setAssets(await listAssets()); }
    catch (e) { setError(String(e)); }
    finally { setLoading(false); }
  }
  useEffect(() => { load(); }, []);

  async function toggle(a: AdminStockAsset, field: 'buy_enabled' | 'sell_enabled' | 'status') {
    setSavingId(a.id);
    try {
      const patch: AssetUpdate =
        field === 'status'
          ? { status: a.status === 'active' ? 'suspended' : 'active', reason: 'Admin toggle from console' }
          : { [field]: !a[field], reason: 'Admin toggle from console' };
      const updated = await updateAsset(a.id, patch);
      setAssets((prev) => prev.map((x) => (x.id === a.id ? { ...x, ...updated } : x)));
    } catch (e) {
      alert(String(e));
    } finally {
      setSavingId(null);
    }
  }

  return (
    <div style={{ padding: '0.5rem 0.5rem 2rem' }}>
      <PageHeader
        title="Stock assets"
        subtitle="Enable/disable trading per asset. Disabled assets are immediately non-tradable for users."
        action={<button onClick={load} style={btn()}>Refresh</button>}
      />
      <InvestTabs />

      {error && <p style={{ color: '#dc2626' }}>{error}</p>}
      <Card>
        {loading ? (
          <p style={{ color: '#6b7280' }}>Loading assets…</p>
        ) : (
          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.85rem' }}>
              <thead>
                <tr>
                  <th style={th()}>Symbol</th>
                  <th style={th()}>Name</th>
                  <th style={th()}>Sector</th>
                  <th style={th()}>Status</th>
                  <th style={th()}>Risk</th>
                  <th style={th()}>Min order</th>
                  <th style={th()}>KYC</th>
                  <th style={th()}>Buy</th>
                  <th style={th()}>Sell</th>
                  <th style={th()}>Actions</th>
                </tr>
              </thead>
              <tbody>
                {assets.map((a) => (
                  <tr key={a.id}>
                    <td style={td()}><strong>{a.symbol}</strong></td>
                    <td style={td()}>{a.name}</td>
                    <td style={td()}>{a.sector}</td>
                    <td style={td()}><Badge status={a.status} /></td>
                    <td style={td()}>{a.risk_rating}</td>
                    <td style={td()}>{naira(a.minimum_order_amount)}</td>
                    <td style={td()}>T{a.kyc_tier_required}</td>
                    <td style={td()}>{a.buy_enabled ? '✅' : '—'}</td>
                    <td style={td()}>{a.sell_enabled ? '✅' : '—'}</td>
                    <td style={td()}>
                      <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>
                        <button disabled={savingId === a.id} style={btn()} onClick={() => toggle(a, 'buy_enabled')}>{a.buy_enabled ? 'Disable buy' : 'Enable buy'}</button>
                        <button disabled={savingId === a.id} style={btn()} onClick={() => toggle(a, 'sell_enabled')}>{a.sell_enabled ? 'Disable sell' : 'Enable sell'}</button>
                        <button disabled={savingId === a.id} style={btnPrimary(a.status === 'active' ? '#b91c1c' : '#16a34a')} onClick={() => toggle(a, 'status')}>
                          {a.status === 'active' ? 'Suspend' : 'Activate'}
                        </button>
                      </div>
                    </td>
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
