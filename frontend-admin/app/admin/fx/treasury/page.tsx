'use client';

import { useEffect, useState } from 'react';
import { getFloats, getRebalances, rebalanceNow } from '@/services/fxAdminService';
import type { FloatBucket, RebalanceEvent } from '@/types/fxAdmin';
import { PageHeader, FxTabs, Card, Badge, btn, btnPrimary, th, td, moneyFull } from '../_ui';

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
      <PageHeader title="Treasury & Liquidity" subtitle="Float buckets, thresholds and rebalancing." action={<button onClick={load} style={btn()}>Refresh</button>} />
      <FxTabs active="treasury" />

      <Card title="Float buckets">
        {loading ? <p style={{ color: '#6b7280' }}>Loading…</p> : (
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.85rem' }}>
            <thead>
              <tr style={{ textAlign: 'left', color: '#6b7280', borderBottom: '1px solid #e5e7eb' }}>
                <th style={th()}>Provider</th><th style={th()}>Currency</th><th style={th()}>Balance</th><th style={th()}>Low / High water</th><th style={th()}>Status</th><th style={th()}></th>
              </tr>
            </thead>
            <tbody>
              {floats.map((b) => {
                const key = `${b.provider}-${b.currency}`;
                const needsRebalance = b.status === 'low' || b.status === 'critical';
                return (
                  <tr key={key} style={{ borderBottom: '1px solid #f3f4f6' }}>
                    <td style={{ ...td(), textTransform: 'capitalize' }}><strong>{b.provider}</strong></td>
                    <td style={td()}>{b.currency}</td>
                    <td style={td()}>{moneyFull(b.balanceMinor, b.currency)}</td>
                    <td style={{ ...td(), color: '#6b7280' }}>{moneyFull(b.lowWaterMinor, b.currency)} / {moneyFull(b.highWaterMinor, b.currency)}</td>
                    <td style={td()}><Badge status={b.status} /></td>
                    <td style={{ ...td(), textAlign: 'right' }}>
                      {needsRebalance ? (
                        <div style={{ display: 'inline-flex', gap: '0.4rem' }}>
                          <button disabled={busy === key} onClick={() => rebalance(b, 'stablecoin')} style={btnPrimary('#1d4ed8')}>Rebalance (stablecoin)</button>
                          <button disabled={busy === key} onClick={() => rebalance(b, 'fiat')} style={btn()}>Fiat</button>
                        </div>
                      ) : <span style={{ color: '#9ca3af' }}>—</span>}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
        <p style={{ fontSize: '0.78rem', color: '#6b7280', marginTop: '0.75rem' }}>Stablecoin rebalancing (USDC/USDT) is usually faster than fiat between providers. All rebalances are audit-logged.</p>
      </Card>

      <Card title="Rebalance history">
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.85rem' }}>
          <thead>
            <tr style={{ textAlign: 'left', color: '#6b7280', borderBottom: '1px solid #e5e7eb' }}>
              <th style={th()}>When</th><th style={th()}>From → To</th><th style={th()}>Amount</th><th style={th()}>Path</th><th style={th()}>Status</th>
            </tr>
          </thead>
          <tbody>
            {rebalances.map((r) => (
              <tr key={r.id} style={{ borderBottom: '1px solid #f3f4f6' }}>
                <td style={{ ...td(), color: '#6b7280' }}>{new Date(r.createdAt).toLocaleString('en-NG')}</td>
                <td style={{ ...td(), textTransform: 'capitalize' }}>{r.from} → {r.to}</td>
                <td style={td()}>{moneyFull(r.amountMinor, r.currency)}</td>
                <td style={{ ...td(), textTransform: 'capitalize' }}>{r.path}</td>
                <td style={td()}><Badge status={r.status} /></td>
              </tr>
            ))}
          </tbody>
        </table>
      </Card>
    </div>
  );
}
