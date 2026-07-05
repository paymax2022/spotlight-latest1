'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import { getOverridePolicy, formatNaira } from '@/services/referralAdminOpsService';
import type { OverridePolicy } from '@/types/referralAdminOps';
import { PageHeader, Card, Kpi, Badge, btn, th, td, timeAgo, StateBlock } from '../../_ui';

export default function OverridePolicyPage() {
  const [data, setData] = useState<OverridePolicy | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  async function load() {
    setLoading(true); setError(null);
    try { setData(await getOverridePolicy()); }
    catch (e) { setError(String(e)); }
    finally { setLoading(false); }
  }
  useEffect(() => { load(); }, []);

  return (
    <div style={{ padding: '0.5rem 0.5rem 2rem' }}>
      <PageHeader
        title="Ambassadors — Override policy config"
        subtitle="Enforce activity-based overrides with caps (A-AMB-04). No earning on recruitment alone; house accruals are excluded from override chains (§7A.2)."
        action={<Link href="/admin/referral/ambassadors" style={{ ...btn(), textDecoration: 'none', color: '#374151' }}>← Directory</Link>}
      />

      <StateBlock loading={loading} error={error} empty={!data}>
        {data && (
          <>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(210px,1fr))', gap: '0.75rem', marginBottom: '1.25rem' }}>
              <Kpi label="Activity-based only" value={data.activity_based_only ? 'Yes' : 'No'} accent={data.activity_based_only ? '#15803d' : '#b91c1c'} />
              <Kpi label="Max depth" value={String(data.max_depth)} />
              <Kpi label="Recruitment earnings" value={data.recruitment_earnings_blocked ? 'Blocked' : 'Allowed'} accent={data.recruitment_earnings_blocked ? '#15803d' : '#b91c1c'} />
              <Kpi label="House excluded from overrides" value={data.house_excluded_from_overrides ? 'Yes' : 'No'} accent={data.house_excluded_from_overrides ? '#15803d' : '#b91c1c'} sub="§7A.2 pyramid-line guard" />
            </div>

            <Card title="Override % by tier (with monthly caps)" right={<span style={{ fontSize: '0.72rem', color: '#6b7280' }}>Updated {timeAgo(data.updated_at)}</span>}>
              <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                <thead><tr><th style={th()}>Tier</th><th style={th()}>Override %</th><th style={th()}>Monthly cap</th></tr></thead>
                <tbody>
                  {data.override_pct_by_tier.map((t) => (
                    <tr key={t.tier}>
                      <td style={td()}>{t.tier}</td>
                      <td style={td()}>{t.pct}%</td>
                      <td style={td()}>{t.monthly_cap_kobo === 0 ? <Badge status="closed" label="no override" /> : formatNaira(t.monthly_cap_kobo)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </Card>
          </>
        )}
      </StateBlock>
    </div>
  );
}
