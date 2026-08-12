'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import { getSegmentation, formatNaira } from '@/services/referralAdminOpsService';
import type { SegmentationData } from '@/types/referralAdminOps';
import { Kpi } from '../../_ui';
import { Page, PageHeader, Card, Button, Badge, colors, thCell, tdCell } from '@/components/ui/vuexy';

export default function SegmentationPage() {
  const [data, setData] = useState<SegmentationData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  async function load() {
    setLoading(true); setError(null);
    try { setData(await getSegmentation()); }
    catch (e) { setError(String(e)); }
    finally { setLoading(false); }
  }
  useEffect(() => { load(); }, []);

  const max = data ? Math.max(...data.segments.map((s) => s.signups), 1) : 1;

  return (
    <Page>
      <PageHeader
        title="Analytics — Organic vs referred segmentation (A-BI-08)"
        subtitle="Separates house-default (organic) from genuine viral referrals. The true K-factor EXCLUDES house captures (§7A.6) — otherwise the program looks more viral than it is."
        actions={<Link href="/admin/referral/analytics"><Button variant="outline">← Growth</Button></Link>}
      />

      {loading ? (
        <p style={{ color: colors.muted, fontSize: 13 }}>Loading…</p>
      ) : error ? (
        <p style={{ color: colors.danger, fontSize: 13 }}>{error}</p>
      ) : !data ? (
        <p style={{ color: colors.muted, fontSize: 13 }}>No records found.</p>
      ) : (
        <>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(190px,1fr))', gap: '0.75rem', marginBottom: '1.25rem' }}>
            <Kpi label="K-factor (true)" value={data.k_factor_true.toFixed(2)} sub="Excludes house captures" accent={colors.primary} />
            <Kpi label="K-factor (naive, incl. house)" value={data.k_factor_naive_incl_house.toFixed(2)} sub="Misleading — do not report" accent={colors.warning} />
            <Kpi label="Referred signups" value={data.referred_signups.toLocaleString('en-NG')} accent={colors.success} />
            <Kpi label="House_default signups" value={data.house_default_signups.toLocaleString('en-NG')} sub="Organic — excluded from K-factor" accent={colors.primary} />
          </div>

          <Card title="Acquisition segments">
            <table style={{ width: '100%', borderCollapse: 'collapse', marginTop: 14 }}>
              <thead><tr>
                <th style={thCell}>Segment</th><th style={thCell}>Signups</th><th style={thCell}>Activated</th>
                <th style={thCell}>CAC</th><th style={thCell}>K-factor?</th><th style={thCell} />
              </tr></thead>
              <tbody>
                {data.segments.map((s) => (
                  <tr key={s.segment}>
                    <td style={tdCell}>{s.label}</td>
                    <td style={tdCell}>{s.signups.toLocaleString('en-NG')}</td>
                    <td style={tdCell}>{s.activated.toLocaleString('en-NG')} <span style={{ color: colors.muted, fontSize: '0.75rem' }}>({((s.activated / Math.max(s.signups, 1)) * 100).toFixed(0)}%)</span></td>
                    <td style={tdCell}>{s.cac_kobo === 0 ? '₦0 (organic)' : formatNaira(s.cac_kobo)}</td>
                    <td style={tdCell}><Badge text={s.counts_toward_kfactor ? 'counts' : 'excluded'} color={s.counts_toward_kfactor ? colors.success : colors.primary} /></td>
                    <td style={{ ...tdCell, width: '40%' }}>
                      <div style={{ height: 14, background: colors.border, borderRadius: 4 }}>
                        <div style={{ width: `${(s.signups / max) * 100}%`, height: '100%', background: s.segment === 'house_default' ? colors.primary : s.segment === 'referred' ? colors.success : colors.secondary, borderRadius: 4 }} />
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            <p style={{ fontSize: '0.72rem', color: colors.muted, marginTop: '0.5rem' }}>House_default signups are tagged <code>attribution=house_default</code> and excluded from K-factor / viral-coefficient / referral-CAC.</p>
          </Card>
        </>
      )}
    </Page>
  );
}
