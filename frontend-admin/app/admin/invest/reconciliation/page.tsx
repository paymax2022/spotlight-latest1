'use client';

import { useEffect, useState } from 'react';
import { getReconciliation } from '@/services/investAdminService';
import type { ReconResult } from '@/types/investAdmin';
import { InvestTabs, Kpi, naira } from '../_ui';
import { Page, PageHeader, Card, Button, Badge, colors, thCell, tdCell } from '@/components/ui/vuexy';

function statusColor(status: string): string {
  if (status === 'Settled' || status === 'Filled') return colors.success;
  if (status === 'PendingSettlement') return colors.warning;
  if (status === 'Accepted' || status === 'Submitted') return colors.info;
  if (status === 'Failed' || status === 'Rejected') return colors.danger;
  return colors.secondary;
}

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
    <Page>
      <PageHeader
        title="Reconciliation"
        subtitle="Investment ledger vs order/settlement state. Exceptions are surfaced for Finance & Trading-Ops."
        actions={<Button variant="outline" onClick={load}>Refresh</Button>}
      />
      <InvestTabs />

      {error && <p style={{ color: colors.danger }}>{error}</p>}
      {loading || !s ? (
        <p style={{ color: colors.muted }}>Running reconciliation…</p>
      ) : (
        <>
          <Card>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 }}>
              <h2 style={{ margin: 0, fontSize: 16, fontWeight: 700, color: colors.text }}>Ledger integrity</h2>
              <Badge text={s.balanced ? 'Balanced' : 'OUT OF BALANCE'} color={s.balanced ? colors.success : colors.danger} />
            </div>
            <p style={{ fontSize: '0.85rem', color: colors.text }}>
              Double-entry check: the signed sum of every ledger entry must equal zero.
              {s.balanced ? ' All entries balance.' : ' ⚠️ Investigate immediately — a write path is unbalanced.'}
            </p>
          </Card>

          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(200px, 1fr))', gap: '0.75rem', margin: '1.25rem 0' }}>
            <Kpi label="Broker clearing (net)" value={naira(s.broker_clearing_net_kobo)} sub="≈0 in steady state" accent={Math.abs(s.broker_clearing_net_kobo) > 100 ? colors.warning : colors.success} />
            <Kpi label="Fee income captured" value={naira(s.fee_income_kobo)} accent={colors.primary} />
            <Kpi label="User cash (all)" value={naira(s.user_cash_total_kobo)} />
            <Kpi label="Locked cash" value={naira(s.locked_cash_total_kobo)} sub="Pending buys" />
            <Kpi label="Settlement suspense" value={naira(s.settlement_suspense_kobo)} sub="Owed to users post-sell" />
            <Kpi label="External funding (net)" value={naira(s.external_funding_net_kobo)} sub="Deposited − withdrawn" />
            <Kpi label="Stuck settlements" value={String(s.stuck_settlements)} accent={s.stuck_settlements ? colors.danger : colors.success} />
            <Kpi label="Trapped funds" value={String(s.trapped_funds)} accent={s.trapped_funds ? colors.danger : colors.success} sub="Terminal orders holding locks" />
          </div>

          <Card title="Exceptions — stuck settlements">
            {data!.stuck_settlements.length === 0 ? (
              <p style={{ color: colors.success, fontSize: '0.85rem' }}>None — every due order has settled.</p>
            ) : (
              <ExceptionsTable rows={data!.stuck_settlements} />
            )}
          </Card>

          <div style={{ height: '1rem' }} />

          <Card title="Exceptions — trapped funds">
            {data!.trapped_funds.length === 0 ? (
              <p style={{ color: colors.success, fontSize: '0.85rem' }}>None — all failed/cancelled orders released their locks.</p>
            ) : (
              <ExceptionsTable rows={data!.trapped_funds} />
            )}
          </Card>
        </>
      )}
    </Page>
  );
}

function ExceptionsTable({ rows }: { rows: ReconResult['stuck_settlements'] }) {
  return (
    <div style={{ overflowX: 'auto' }}>
      <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
        <thead>
          <tr>
            <th style={thCell}>Symbol</th>
            <th style={thCell}>User</th>
            <th style={thCell}>Side</th>
            <th style={thCell}>Amount</th>
            <th style={thCell}>Status</th>
            <th style={thCell}>Provider ref</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((o) => (
            <tr key={o.id}>
              <td style={tdCell}><strong>{o.symbol}</strong></td>
              <td style={tdCell} title={o.user_id}>{o.user_id.slice(0, 10)}…</td>
              <td style={tdCell}>{o.side}</td>
              <td style={tdCell}>{naira(o.total_amount_kobo)}</td>
              <td style={tdCell}><Badge text={o.status} color={statusColor(o.status)} /></td>
              <td style={tdCell}>{o.provider_reference || '—'}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
