'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import { getFunnel } from '@/services/referralAdminOpsService';
import type { FunnelData } from '@/types/referralAdminOps';
import { PageHeader, Card, Kpi, btn, th, td, StateBlock } from '../../_ui';

export default function FunnelPage() {
  const [data, setData] = useState<FunnelData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  async function load() {
    setLoading(true); setError(null);
    try { setData(await getFunnel()); }
    catch (e) { setError(String(e)); }
    finally { setLoading(false); }
  }
  useEffect(() => { load(); }, []);

  const max = data ? Math.max(...data.stages.map((s) => s.count), 1) : 1;

  return (
    <div style={{ padding: '0.5rem 0.5rem 2rem' }}>
      <PageHeader
        title="Analytics — Acquisition funnel"
        subtitle="Invite → click → signup → KYC → activate → retain (A-BI-02)."
        action={<Link href="/admin/referral/analytics" style={{ ...btn(), textDecoration: 'none', color: '#374151' }}>← Growth</Link>}
      />

      <StateBlock loading={loading} error={error} empty={!data}>
        {data && (
          <>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(190px,1fr))', gap: '0.75rem', marginBottom: '1.25rem' }}>
              <Kpi label="Top of funnel" value={data.stages[0]?.count.toLocaleString('en-NG') ?? '0'} />
              <Kpi label="Retained" value={(data.stages[data.stages.length - 1]?.count ?? 0).toLocaleString('en-NG')} />
              <Kpi label="Overall conversion" value={`${(data.conversion_overall * 100).toFixed(1)}%`} accent="#340075" />
            </div>

            <Card title="Funnel stages">
              <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                <thead><tr><th style={th()}>Stage</th><th style={th()}>Count</th><th style={th()}>Step conv.</th><th style={th()} /></tr></thead>
                <tbody>
                  {data.stages.map((s, i) => {
                    const prev = i > 0 ? data.stages[i - 1].count : s.count;
                    const stepConv = prev ? (s.count / prev) * 100 : 100;
                    return (
                      <tr key={s.stage}>
                        <td style={td()}>{s.stage}</td>
                        <td style={td()}>{s.count.toLocaleString('en-NG')}</td>
                        <td style={td()}>{i === 0 ? '—' : `${stepConv.toFixed(1)}%`}</td>
                        <td style={{ ...td(), width: '55%' }}>
                          <div style={{ height: 14, background: '#f3f4f6', borderRadius: 4 }}>
                            <div style={{ width: `${(s.count / max) * 100}%`, height: '100%', background: '#340075', borderRadius: 4 }} />
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </Card>
          </>
        )}
      </StateBlock>
    </div>
  );
}
