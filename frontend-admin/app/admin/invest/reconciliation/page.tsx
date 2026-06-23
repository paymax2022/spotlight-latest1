'use client';

import { useEffect, useState } from 'react';
import { getReconciliation } from '@/services/investAdminService';
import type { ReconResult } from '@/types/investAdmin';
import { PageHeader, InvestTabs, Card, Kpi, Badge, btn, th, td, naira } from '../_ui';

export default function InvestReconciliationPage() {
  const [data, setData] = useState<ReconResult | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  async function load() {
    setLoading(true); setError(null);
    try { setData(await getReconciliation()); }
    catch (e) { setError(String(e)); }
    finally { setLoading(false); }
  }
  useEffect(() => { load(); }, []);

  const s = data?.summary;

  return (
    <div style={{ padding: '0.5rem 0.5rem 2rem' }}>
      <PageHeader
        title="Reconciliation"
        subtitle="Investment ledger vs order/settlement state. Exceptions are surfaced for Finance & Trading-Ops."
        action={<button onClick={load} style={btn()}>Refresh</button>}
      />
      <InvestTabs />

      {error && <p style={{ color: '#dc2626' }}>{error}</p>}
      {loading || !s ? (
        <p style={{ color: '#6b7280' }}>Running reconciliation…</p>
      ) : (
        <>
          <Card title="Ledger integrity" right={<Badge status={s.balanced ? 'Settled' : 'Failed'} label={s.balanced ? 'Balanced' : 'OUT OF BALANCE'} />}>
            <p style={{ fontSize: '0.85rem', color: '#374151' }}>
              Double-entry check: the signed sum of every ledger entry must equal zero.
              {s.balanced ? ' All entries balance.' : ' ⚠️ Investigate immediately — a write path is unbalanced.'}
            </p>
          </Card>

          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(200px, 1fr))', gap: '0.75rem', margin: '1.25rem 0' }}>
            <Kpi label="Broker clearing (net)" value={naira(s.broker_clearing_net_kobo)} sub="≈0 in steady state" accent={Math.abs(s.broker_clearing_net_kobo) > 100 ? '#d97706' : '#16a34a'} />
            <Kpi label="Fee income captured" value={naira(s.fee_income_kobo)} accent="#340075" />
            <Kpi label="User cash (all)" value={naira(s.user_cash_total_kobo)} />
            <Kpi label="Locked cash" value={naira(s.locked_cash_total_kobo)} sub="Pending buys" />
            <Kpi label="Settlement suspense" value={naira(s.settlement_suspense_kobo)} sub="Owed to users post-sell" />
            <Kpi label="External funding (net)" value={naira(s.external_funding_net_kobo)} sub="Deposited − withdrawn" />
            <Kpi label="Stuck settlements" value={String(s.stuck_settlements)} accent={s.stuck_settlements ? '#dc2626' : '#16a34a'} />
            <Kpi label="Trapped funds" value={String(s.trapped_funds)} accent={s.trapped_funds ? '#dc2626' : '#16a34a'} sub="Terminal orders holding locks" />
          </div>

          <Card title="Exceptions — stuck settlements">
            {data!.stuck_settlements.length === 0 ? (
              <p style={{ color: '#16a34a', fontSize: '0.85rem' }}>None — every due order has settled.</p>
            ) : (
              <ExceptionsTable rows={data!.stuck_settlements} />
            )}
          </Card>

          <div style={{ height: '1rem' }} />

          <Card title="Exceptions — trapped funds">
            {data!.trapped_funds.length === 0 ? (
              <p style={{ color: '#16a34a', fontSize: '0.85rem' }}>None — all failed/cancelled orders released their locks.</p>
            ) : (
              <ExceptionsTable rows={data!.trapped_funds} />
            )}
          </Card>
        </>
      )}
    </div>
  );
}

function ExceptionsTable({ rows }: { rows: ReconResult['stuck_settlements'] }) {
  return (
    <div style={{ overflowX: 'auto' }}>
      <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.85rem' }}>
        <thead>
          <tr>
            <th style={th()}>Symbol</th>
            <th style={th()}>User</th>
            <th style={th()}>Side</th>
            <th style={th()}>Amount</th>
            <th style={th()}>Status</th>
            <th style={th()}>Provider ref</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((o) => (
            <tr key={o.id}>
              <td style={td()}><strong>{o.symbol}</strong></td>
              <td style={td()} title={o.user_id}>{o.user_id.slice(0, 10)}…</td>
              <td style={td()}>{o.side}</td>
              <td style={td()}>{naira(o.total_amount_kobo)}</td>
              <td style={td()}><Badge status={o.status} /></td>
              <td style={td()}>{o.provider_reference || '—'}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
