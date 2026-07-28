'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import { getSegmentation, formatNaira } from '@/services/referralAdminOpsService';
import type { SegmentationData } from '@/types/referralAdminOps';
import { PageHeader, Card, Kpi, Badge, btn, th, td, StateBlock } from '../../_ui';

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
    <div style={{ padding: '0.5rem 0.5rem 2rem' }}>
      <PageHeader
        title="Analytics — Organic vs referred segmentation (A-BI-08)"
        subtitle="Separates house-default (organic) from genuine viral referrals. The true K-factor EXCLUDES house captures (§7A.6) — otherwise the program looks more viral than it is."
        action={<Link href="/admin/referral/analytics" style={{ ...btn(), textDecoration: 'none', color: '#374151' }}>← Growth</Link>}
      />

      <StateBlock loading={loading} error={error} empty={!data}>
        {data && (
          <>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(190px,1fr))', gap: '0.75rem', marginBottom: '1.25rem' }}>
              <Kpi label="K-factor (true)" value={data.k_factor_true.toFixed(2)} sub="Excludes house captures" accent="#340075" />
              <Kpi label="K-factor (naive, incl. house)" value={data.k_factor_naive_incl_house.toFixed(2)} sub="Misleading — do not report" accent="#9a3412" />
              <Kpi label="Referred signups" value={data.referred_signups.toLocaleString('en-NG')} accent="#22c55e" />
              <Kpi label="House_default signups" value={data.house_default_signups.toLocaleString('en-NG')} sub="Organic — excluded from K-factor" accent="#7c3aed" />
            </div>

            <Card title="Acquisition segments">
              <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                <thead><tr>
                  <th style={th()}>Segment</th><th style={th()}>Signups</th><th style={th()}>Activated</th>
                  <th style={th()}>CAC</th><th style={th()}>K-factor?</th><th style={th()} />
                </tr></thead>
                <tbody>
                  {data.segments.map((s) => (
                    <tr key={s.segment}>
                      <td style={td()}>{s.label}</td>
                      <td style={td()}>{s.signups.toLocaleString('en-NG')}</td>
                      <td style={td()}>{s.activated.toLocaleString('en-NG')} <span style={{ color: '#9ca3af', fontSize: '0.75rem' }}>({((s.activated / Math.max(s.signups, 1)) * 100).toFixed(0)}%)</span></td>
                      <td style={td()}>{s.cac_kobo === 0 ? '₦0 (organic)' : formatNaira(s.cac_kobo)}</td>
                      <td style={td()}><Badge status={s.counts_toward_kfactor ? 'active' : 'house'} label={s.counts_toward_kfactor ? 'counts' : 'excluded'} /></td>
                      <td style={{ ...td(), width: '40%' }}>
                        <div style={{ height: 14, background: '#f3f4f6', borderRadius: 4 }}>
                          <div style={{ width: `${(s.signups / max) * 100}%`, height: '100%', background: s.segment === 'house_default' ? '#a855f7' : s.segment === 'referred' ? '#22c55e' : '#cbd5e1', borderRadius: 4 }} />
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
              <p style={{ fontSize: '0.72rem', color: '#6b7280', marginTop: '0.5rem' }}>House_default signups are tagged <code>attribution=house_default</code> and excluded from K-factor / viral-coefficient / referral-CAC.</p>
            </Card>
          </>
        )}
      </StateBlock>
    </div>
  );
}
