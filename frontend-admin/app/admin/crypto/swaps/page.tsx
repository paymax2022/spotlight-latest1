'use client';

import { useCallback, useEffect, useState } from 'react';
import { adminListSwaps, formatKobo } from '@/services/cryptoAdminService';
import type { CryptoSwapOrder } from '@/types/cryptoAdmin';
import {
  PageHeader, CryptoTabs, Card, Kpi, StatusBadge, DisclosureNote, StateBlock, PermissionBanner,
  btn, th, td, mono, fmtDate, fmtUnits, FilterBar, label as lbl, select,
  CRYPTO_PERMS, useCryptoPermission,
} from '../_ui';

const PAGE_SIZE = 50;
const SCALE: Record<string, number> = { BTC: 100_000_000, ETH: 1_000_000_000, USDT: 1_000_000 };

export default function CryptoSwapsPage() {
  const { allowed: canAdmin } = useCryptoPermission(CRYPTO_PERMS.admin);

  const [rows, setRows] = useState<CryptoSwapOrder[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [offset, setOffset] = useState(0);
  const [onlyAnomalies, setOnlyAnomalies] = useState('');

  const load = useCallback(async (off: number) => {
    setLoading(true); setError(null);
    try { setRows(await adminListSwaps(PAGE_SIZE, off)); }
    catch (e) { setError(String(e)); }
    finally { setLoading(false); }
  }, []);

  useEffect(() => { void load(offset); }, [offset, load]);

  const filtered = rows.filter((s) => onlyAnomalies !== 'anomalies' || !!s.anomaly);

  const filledVolume = rows.filter((s) => s.status === 'filled').reduce((a, s) => a + s.cash_kobo, 0);
  const spreadRevenue = rows.filter((s) => s.status === 'filled').reduce((a, s) => a + s.spread_kobo, 0);
  const anomalyCount = rows.filter((s) => !!s.anomaly).length;
  const avgSpreadBps = (() => {
    const filled = rows.filter((s) => s.status === 'filled' && s.spread_bps > 0);
    if (!filled.length) return 0;
    return Math.round(filled.reduce((a, s) => a + s.spread_bps, 0) / filled.length);
  })();

  return (
    <div style={{ padding: '0.5rem 0.5rem 2rem' }}>
      <PageHeader
        title="Crypto — Swap Monitoring"
        subtitle="Recent asset→asset swaps across all users, with realised rates, spread (Paymax revenue), volume and anomaly detection. Read-only oversight — swaps are immutable ledger records."
        action={<button onClick={() => void load(offset)} style={btn()}>Refresh</button>}
      />
      <CryptoTabs active="swaps" />
      <DisclosureNote>
        Backed by <code>GET /api/v1/admin/crypto/swaps</code> (RBAC <code>crypto.admin</code>). Each swap is a single
        atomic order: the from-leg debit and to-leg credit post as one balanced ledger transaction, with the
        <code> spread_kobo</code> retained to <code>paymax_revenue</code>. Anomalies (out-of-band spread, orphaned legs)
        are surfaced here, never silently absorbed.
      </DisclosureNote>

      {!canAdmin && <PermissionBanner permission={CRYPTO_PERMS.admin} />}
      {error && <p style={{ color: '#dc2626' }}>{error}</p>}

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(200px, 1fr))', gap: '0.75rem', marginBottom: '1.25rem' }}>
        <Kpi label="Swaps (recent page)" value={String(rows.length)} />
        <Kpi label="Filled volume (cash)" value={formatKobo(filledVolume)} accent="#340075" />
        <Kpi label="Spread revenue" value={formatKobo(spreadRevenue)} accent="#15803d" />
        <Kpi label="Avg spread" value={`${avgSpreadBps} bps`} />
        <Kpi label="Anomalies" value={String(anomalyCount)} accent={anomalyCount ? '#b91c1c' : undefined} />
      </div>

      <Card>
        <FilterBar>
          <div>
            <label style={lbl()}>Show</label>
            <select style={select()} value={onlyAnomalies} onChange={(e) => setOnlyAnomalies(e.target.value)}>
              <option value="">All swaps</option>
              <option value="anomalies">Anomalies only</option>
            </select>
          </div>
        </FilterBar>

        <StateBlock loading={loading} error={null} empty={filtered.length === 0} emptyText="No swaps match this filter.">
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead><tr>
              <th style={th()}>Swap</th><th style={th()}>User</th><th style={th()}>Pair</th>
              <th style={th()}>From</th><th style={th()}>To</th><th style={th()}>Cash</th>
              <th style={th()}>Spread</th><th style={th()}>Status</th><th style={th()}>Anomaly</th><th style={th()}>Created</th>
            </tr></thead>
            <tbody>
              {filtered.map((s) => (
                <tr key={s.id} style={s.anomaly ? { background: '#fef2f2' } : undefined}>
                  <td style={{ ...td(), ...mono() }}>{s.id}</td>
                  <td style={{ ...td(), ...mono() }}>{s.user_id}</td>
                  <td style={td()}><strong>{s.from_symbol ?? s.from_asset_id}</strong> → <strong>{s.to_symbol ?? s.to_asset_id}</strong></td>
                  <td style={td()}>{fmtUnits(s.from_units, SCALE[s.from_symbol ?? ''] ?? 0, s.from_symbol)}</td>
                  <td style={td()}>{fmtUnits(s.to_units, SCALE[s.to_symbol ?? ''] ?? 0, s.to_symbol)}</td>
                  <td style={td()}>{formatKobo(s.cash_kobo)}</td>
                  <td style={td()}>{formatKobo(s.spread_kobo)} <span style={{ color: '#9ca3af' }}>({s.spread_bps}bps)</span></td>
                  <td style={td()}><StatusBadge status={s.status} /></td>
                  <td style={{ ...td(), color: '#b91c1c', maxWidth: 240 }}>{s.anomaly || <span style={{ color: '#9ca3af' }}>—</span>}</td>
                  <td style={td()}>{fmtDate(s.created_at)}</td>
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
