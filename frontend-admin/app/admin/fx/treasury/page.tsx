'use client';

import { useEffect, useState } from 'react';
import { getFloats, getRebalances, rebalanceNow } from '@/services/fxAdminService';
import type { FloatBucket, RebalanceEvent } from '@/types/fxAdmin';
import { PageHeader, FxTabs, Card, Badge, moneyFull } from '../_ui';
import { Button, colors, thCell, tdCell } from '@/components/ui/vuexy';

export default function FxTreasuryPage() {
  const [floats, setFloats] = useState<FloatBucket[]>([]);
  const [rebalances, setRebalances] = useState<RebalanceEvent[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<string | null>(null);

  async function load() {
    setLoading(true);
    try { const [f, r] = await Promise.all([getFloats(), getRebalances()]); setFloats(f); setRebalances(r); }
    finally { setLoading(false); }
  }
  useEffect(() => { load(); }, []);

  async function rebalance(b: FloatBucket, path: 'fiat' | 'stablecoin') {
    const key = `${b.provider}-${b.currency}`;
    setBusy(key);
    try { await rebalanceNow(b, path); await load(); } finally { setBusy(null); }
  }

  return (
    <div style={{ padding: '0.5rem 0.5rem 2rem' }}>
      <PageHeader title="Treasury & Liquidity" subtitle="Float buckets, thresholds and rebalancing." action={<Button variant="outline" onClick={load}>Refresh</Button>} />
      <FxTabs active="treasury" />

      <Card title="Float buckets">
        {loading ? <p style={{ color: colors.muted }}>Loading…</p> : (
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.85rem' }}>
            <thead>
              <tr style={{ textAlign: 'left', color: colors.muted, borderBottom: `1px solid ${colors.border}` }}>
                <th style={thCell}>Provider</th><th style={thCell}>Currency</th><th style={thCell}>Balance</th><th style={thCell}>Low / High water</th><th style={thCell}>Status</th><th style={thCell}></th>
              </tr>
            </thead>
            <tbody>
              {floats.map((b) => {
                const key = `${b.provider}-${b.currency}`;
                const needsRebalance = b.status === 'low' || b.status === 'critical';
                return (
                  <tr key={key} style={{ borderBottom: `1px solid ${colors.border}` }}>
                    <td style={{ ...tdCell, textTransform: 'capitalize' }}><strong>{b.provider}</strong></td>
                    <td style={tdCell}>{b.currency}</td>
                    <td style={tdCell}>{moneyFull(b.balanceMinor, b.currency)}</td>
                    <td style={{ ...tdCell, color: colors.muted }}>{moneyFull(b.lowWaterMinor, b.currency)} / {moneyFull(b.highWaterMinor, b.currency)}</td>
                    <td style={tdCell}><Badge status={b.status} /></td>
                    <td style={{ ...tdCell, textAlign: 'right' }}>
                      {needsRebalance ? (
                        <div style={{ display: 'inline-flex', gap: '0.4rem' }}>
                          <Button variant="primary" sm onClick={() => rebalance(b, 'stablecoin')} disabled={busy === key}>Rebalance (stablecoin)</Button>
                          <Button variant="outline" sm onClick={() => rebalance(b, 'fiat')} disabled={busy === key}>Fiat</Button>
                        </div>
                      ) : <span style={{ color: colors.muted }}>—</span>}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
        <p style={{ fontSize: '0.78rem', color: colors.muted, marginTop: '0.75rem' }}>Stablecoin rebalancing (USDC/USDT) is usually faster than fiat between providers. All rebalances are audit-logged.</p>
      </Card>

      <Card title="Rebalance history">
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.85rem' }}>
          <thead>
            <tr style={{ textAlign: 'left', color: colors.muted, borderBottom: `1px solid ${colors.border}` }}>
              <th style={thCell}>When</th><th style={thCell}>From → To</th><th style={thCell}>Amount</th><th style={thCell}>Path</th><th style={thCell}>Status</th>
            </tr>
          </thead>
          <tbody>
            {rebalances.map((r) => (
              <tr key={r.id} style={{ borderBottom: `1px solid ${colors.border}` }}>
                <td style={{ ...tdCell, color: colors.muted }}>{new Date(r.createdAt).toLocaleString('en-NG')}</td>
                <td style={{ ...tdCell, textTransform: 'capitalize' }}>{r.from} → {r.to}</td>
                <td style={tdCell}>{moneyFull(r.amountMinor, r.currency)}</td>
                <td style={{ ...tdCell, textTransform: 'capitalize' }}>{r.path}</td>
                <td style={tdCell}><Badge status={r.status} /></td>
              </tr>
            ))}
          </tbody>
        </table>
      </Card>
    </div>
  );
}
