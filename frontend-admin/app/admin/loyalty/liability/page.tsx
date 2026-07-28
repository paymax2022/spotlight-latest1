'use client';

import { useEffect, useState } from 'react';
import { getPointsLiability, formatNaira, formatPoints } from '@/services/loyaltyAdminService';
import type { PointsLiability } from '@/types/loyaltyAdmin';
import { PageHeader, LoyaltyTabs, Card, Kpi, Badge, DisclosureNote, StateBlock, btn, th, td, fmtDate, pct } from '../../events/_ui';

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
      <PageHeader title="Points liability & expiry" subtitle="Outstanding points, valuation by age bucket, expiry exposure and ledger reconciliation (NL-4)." action={<button onClick={load} style={btn()}>Refresh</button>} />
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
              <Kpi label="Points outstanding" value={formatPoints(data.points_outstanding)} accent="#340075" />
              <Kpi label="Total valuation" value={formatNaira(data.total_valuation_kobo)} sub="NL-4 — non-cash valuation" accent="#9a3412" />
              <Kpi label="Redemption value" value={`${formatNaira(data.redemption_value_kobo)} / pt`} />
              <Kpi label="Breakage rate" value={pct(data.breakage_rate)} sub="Expected unredeemed" />
              <Kpi label="Ledger points" value={formatPoints(data.ledger_points)} sub="Append-only (NL-8)" />
              <Kpi label="Projection delta" value={formatPoints(data.delta_points)} sub="ledger − projection" accent={data.delta_points !== 0 ? '#b91c1c' : '#15803d'} />
            </div>

            <Card title={`Liability by age bucket (as of ${fmtDate(data.generated_at)})`}>
              <StateBlock loading={false} error={null} empty={data.buckets.length === 0} emptyText="No buckets.">
                <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                  <thead><tr><th style={th()}>Bucket</th><th style={th()}>Points</th><th style={th()}>Valuation</th><th style={th()}>Distribution</th><th style={th()}>Expiring</th></tr></thead>
                  <tbody>
                    {data.buckets.map((b) => (
                      <tr key={b.bucket}>
                        <td style={td()}>{b.bucket}</td>
                        <td style={td()}>{formatPoints(b.points)}</td>
                        <td style={td()}>{formatNaira(b.valuation_kobo)}</td>
                        <td style={td()}>
                          <div style={{ display: 'flex', alignItems: 'center', gap: '0.4rem' }}>
                            <div style={{ height: 10, width: `${(b.points / maxPts) * 100}%`, minWidth: 2, background: b.expiring ? '#b91c1c' : '#340075', borderRadius: 2 }} />
                          </div>
                        </td>
                        <td style={td()}>{b.expiring ? <Badge status="flagged" label="expiring ≤30d" /> : <span style={{ color: '#9ca3af' }}>—</span>}</td>
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
