'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import { getOverridePolicy, formatNaira } from '@/services/referralAdminOpsService';
import type { OverridePolicy } from '@/types/referralAdminOps';
import { Kpi, timeAgo } from '../../_ui';
import { Page, PageHeader, Card, Button, Badge, colors, thCell, tdCell } from '@/components/ui/vuexy';

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
    <Page>
      <PageHeader
        title="Ambassadors — Override policy config"
        subtitle="Enforce activity-based overrides with caps (A-AMB-04). No earning on recruitment alone; house accruals are excluded from override chains (§7A.2)."
        actions={<Link href="/admin/referral/ambassadors"><Button variant="outline">← Directory</Button></Link>}
      />

      {loading ? (
        <p style={{ color: colors.muted, fontSize: 13 }}>Loading…</p>
      ) : error ? (
        <p style={{ color: colors.danger, fontSize: 13 }}>{error}</p>
      ) : !data ? (
        <p style={{ color: colors.muted, fontSize: 13 }}>No records found.</p>
      ) : (
        <>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(210px,1fr))', gap: '0.75rem', marginBottom: '1.25rem' }}>
            <Kpi label="Activity-based only" value={data.activity_based_only ? 'Yes' : 'No'} accent={data.activity_based_only ? colors.success : colors.danger} />
            <Kpi label="Max depth" value={String(data.max_depth)} />
            <Kpi label="Recruitment earnings" value={data.recruitment_earnings_blocked ? 'Blocked' : 'Allowed'} accent={data.recruitment_earnings_blocked ? colors.success : colors.danger} />
            <Kpi label="House excluded from overrides" value={data.house_excluded_from_overrides ? 'Yes' : 'No'} accent={data.house_excluded_from_overrides ? colors.success : colors.danger} sub="§7A.2 pyramid-line guard" />
          </div>

          <Card style={{ padding: 0, overflow: 'hidden' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12, padding: '14px 14px 0' }}>
              <h2 style={{ margin: 0, fontSize: 16, fontWeight: 700, color: colors.text }}>Override % by tier (with monthly caps)</h2>
              <span style={{ fontSize: '0.72rem', color: colors.muted }}>Updated {timeAgo(data.updated_at)}</span>
            </div>
            <table style={{ width: '100%', borderCollapse: 'collapse', marginTop: 14 }}>
              <thead><tr><th style={thCell}>Tier</th><th style={thCell}>Override %</th><th style={thCell}>Monthly cap</th></tr></thead>
              <tbody>
                {data.override_pct_by_tier.map((t) => (
                  <tr key={t.tier}>
                    <td style={tdCell}>{t.tier}</td>
                    <td style={tdCell}>{t.pct}%</td>
                    <td style={tdCell}>{t.monthly_cap_kobo === 0 ? <Badge text="no override" color={colors.secondary} /> : formatNaira(t.monthly_cap_kobo)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </Card>
        </>
      )}
    </Page>
  );
}
