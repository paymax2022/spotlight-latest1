'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import { getFunnel } from '@/services/referralAdminOpsService';
import type { FunnelData } from '@/types/referralAdminOps';
import { Kpi } from '../../_ui';
import { Page, PageHeader, Card, Button, colors, thCell, tdCell } from '@/components/ui/vuexy';

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
    <Page>
      <PageHeader
        title="Analytics — Acquisition funnel"
        subtitle="Invite → click → signup → KYC → activate → retain (A-BI-02)."
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
            <Kpi label="Top of funnel" value={data.stages[0]?.count.toLocaleString('en-NG') ?? '0'} />
            <Kpi label="Retained" value={(data.stages[data.stages.length - 1]?.count ?? 0).toLocaleString('en-NG')} />
            <Kpi label="Overall conversion" value={`${(data.conversion_overall * 100).toFixed(1)}%`} accent={colors.primary} />
          </div>

          <Card title="Funnel stages">
            <table style={{ width: '100%', borderCollapse: 'collapse', marginTop: 14 }}>
              <thead><tr><th style={thCell}>Stage</th><th style={thCell}>Count</th><th style={thCell}>Step conv.</th><th style={thCell} /></tr></thead>
              <tbody>
                {data.stages.map((s, i) => {
                  const prev = i > 0 ? data.stages[i - 1].count : s.count;
                  const stepConv = prev ? (s.count / prev) * 100 : 100;
                  return (
                    <tr key={s.stage}>
                      <td style={tdCell}>{s.stage}</td>
                      <td style={tdCell}>{s.count.toLocaleString('en-NG')}</td>
                      <td style={tdCell}>{i === 0 ? '—' : `${stepConv.toFixed(1)}%`}</td>
                      <td style={{ ...tdCell, width: '55%' }}>
                        <div style={{ height: 14, background: colors.border, borderRadius: 4 }}>
                          <div style={{ width: `${(s.count / max) * 100}%`, height: '100%', background: colors.primary, borderRadius: 4 }} />
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
    </Page>
  );
}
