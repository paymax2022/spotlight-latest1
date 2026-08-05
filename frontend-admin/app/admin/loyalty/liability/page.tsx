'use client';

import { useEffect, useState } from 'react';
import { getPointsLiability, formatNaira, formatPoints } from '@/services/loyaltyAdminService';
import type { PointsLiability } from '@/types/loyaltyAdmin';
import { PageHeader, LoyaltyTabs, Card, Kpi, Badge, DisclosureNote, StateBlock, fmtDate, pct } from '../../events/_ui';
import { Button, colors, thCell, tdCell } from '@/components/ui/vuexy';

export default function LiabilityPage() {
  const [data, setData] = useState<PointsLiability | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  async function load() {
    setLoading(true); setError(null);
    try { setData(await getPointsLiability()); }
    catch (e) { setError(String(e)); }
    finally { setLoading(false); }
  }
  useEffect(() => { load(); }, []);

  const maxPts = data ? Math.max(...data.buckets.map((b) => b.points), 1) : 1;

  return (
    <div style={{ padding: '0.5rem 0.5rem 2rem' }}>
      <PageHeader title="Points liability & expiry" subtitle="Outstanding points, valuation by age bucket, expiry exposure and ledger reconciliation (NL-4)." action={<Button variant="outline" sm onClick={load}>Refresh</Button>} />
      <LoyaltyTabs active="liability" />
      <DisclosureNote>
        <strong>NL-4 — valuation, not cash owed.</strong> The liability is outstanding points × the
        redemption-value basis. Points are an append-only ledger (NL-8); the projection must tie to the
        ledger (delta 0). Expiring buckets drive breakage. Point balances labelled <code>pts</code>;
        valuations shown ₦ (kobo).
      </DisclosureNote>

      <StateBlock loading={loading} error={error} empty={!data} emptyText="No liability data available.">
        {data && (
          <>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(190px, 1fr))', gap: '0.75rem', marginBottom: '1.25rem' }}>
              <Kpi label="Points outstanding" value={formatPoints(data.points_outstanding)} accent={colors.primary} />
              <Kpi label="Total valuation" value={formatNaira(data.total_valuation_kobo)} sub="NL-4 — non-cash valuation" accent={colors.warning} />
              <Kpi label="Redemption value" value={`${formatNaira(data.redemption_value_kobo)} / pt`} />
              <Kpi label="Breakage rate" value={pct(data.breakage_rate)} sub="Expected unredeemed" />
              <Kpi label="Ledger points" value={formatPoints(data.ledger_points)} sub="Append-only (NL-8)" />
              <Kpi label="Projection delta" value={formatPoints(data.delta_points)} sub="ledger − projection" accent={data.delta_points !== 0 ? colors.danger : colors.success} />
            </div>

            <Card title={`Liability by age bucket (as of ${fmtDate(data.generated_at)})`}>
              <StateBlock loading={false} error={null} empty={data.buckets.length === 0} emptyText="No buckets.">
                <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                  <thead><tr><th style={thCell}>Bucket</th><th style={thCell}>Points</th><th style={thCell}>Valuation</th><th style={thCell}>Distribution</th><th style={thCell}>Expiring</th></tr></thead>
                  <tbody>
                    {data.buckets.map((b) => (
                      <tr key={b.bucket}>
                        <td style={tdCell}>{b.bucket}</td>
                        <td style={tdCell}>{formatPoints(b.points)}</td>
                        <td style={tdCell}>{formatNaira(b.valuation_kobo)}</td>
                        <td style={tdCell}>
                          <div style={{ display: 'flex', alignItems: 'center', gap: '0.4rem' }}>
                            <div style={{ height: 10, width: `${(b.points / maxPts) * 100}%`, minWidth: 2, background: b.expiring ? colors.danger : colors.primary, borderRadius: 2 }} />
                          </div>
                        </td>
                        <td style={tdCell}>{b.expiring ? <Badge status="flagged" label="expiring ≤30d" /> : <span style={{ color: colors.muted }}>—</span>}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </StateBlock>
            </Card>
          </>
        )}
      </StateBlock>
    </div>
  );
}
