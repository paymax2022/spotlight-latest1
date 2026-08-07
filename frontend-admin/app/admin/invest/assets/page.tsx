'use client';

import { useEffect, useState } from 'react';
import { listAssets, updateAsset } from '@/services/investAdminService';
import type { AdminStockAsset, AssetUpdate } from '@/types/investAdmin';
import { InvestTabs, naira } from '../_ui';
import { Page, PageHeader, Card, Button, Badge, colors, thCell, tdCell } from '@/components/ui/vuexy';

function statusColor(status: string): string {
  if (status === 'active') return colors.success;
  if (status === 'suspended') return colors.warning;
  if (status === 'delisted') return colors.danger;
  return colors.secondary;
}

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
    <Page>
      <PageHeader
        title="Stock assets"
        subtitle="Enable/disable trading per asset. Disabled assets are immediately non-tradable for users."
        actions={<Button variant="outline" onClick={load}>Refresh</Button>}
      />
      <InvestTabs />

      {error && <p style={{ color: colors.danger }}>{error}</p>}
      <Card style={{ padding: 0, overflow: 'auto' }}>
        {loading ? (
          <p style={{ color: colors.muted, padding: 14 }}>Loading assets…</p>
        ) : (
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
            <thead>
              <tr>
                <th style={thCell}>Symbol</th>
                <th style={thCell}>Name</th>
                <th style={thCell}>Sector</th>
                <th style={thCell}>Status</th>
                <th style={thCell}>Risk</th>
                <th style={thCell}>Min order</th>
                <th style={thCell}>KYC</th>
                <th style={thCell}>Buy</th>
                <th style={thCell}>Sell</th>
                <th style={thCell}>Actions</th>
              </tr>
            </thead>
            <tbody>
              {assets.map((a) => (
                <tr key={a.id}>
                  <td style={tdCell}><strong>{a.symbol}</strong></td>
                  <td style={tdCell}>{a.name}</td>
                  <td style={tdCell}>{a.sector}</td>
                  <td style={tdCell}><Badge text={a.status} color={statusColor(a.status)} /></td>
                  <td style={tdCell}>{a.risk_rating}</td>
                  <td style={tdCell}>{naira(a.minimum_order_amount)}</td>
                  <td style={tdCell}>T{a.kyc_tier_required}</td>
                  <td style={tdCell}>{a.buy_enabled ? '✅' : '—'}</td>
                  <td style={tdCell}>{a.sell_enabled ? '✅' : '—'}</td>
                  <td style={tdCell}>
                    <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>
                      <Button variant="outline" sm disabled={savingId === a.id} onClick={() => toggle(a, 'buy_enabled')}>{a.buy_enabled ? 'Disable buy' : 'Enable buy'}</Button>
                      <Button variant="outline" sm disabled={savingId === a.id} onClick={() => toggle(a, 'sell_enabled')}>{a.sell_enabled ? 'Disable sell' : 'Enable sell'}</Button>
                      <Button variant={a.status === 'active' ? 'danger' : 'primary'} sm disabled={savingId === a.id} onClick={() => toggle(a, 'status')}>
                        {a.status === 'active' ? 'Suspend' : 'Activate'}
                      </Button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Card>
    </Page>
  );
}
