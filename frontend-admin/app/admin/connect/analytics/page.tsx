'use client';

import { useEffect, useState } from 'react';
import { getConnectAnalytics, type ConnectAnalytics, type AnalyticsTile } from '@/services/connectAdminOpsService';
import { timeAgo } from '../_ui';
import { Page, PageHeader, Card, Button, colors, tint, thCell, tdCell } from '@/components/ui/vuexy';

const GROUP_LABEL: Record<AnalyticsTile['group'], string> = {
  engagement: 'Engagement', retention: 'Retention', funnel: 'Funnel', revenue: 'Revenue (kobo → ₦)',
};
const GROUP_ORDER: AnalyticsTile['group'][] = ['engagement', 'retention', 'funnel', 'revenue'];

export default function ConnectAnalyticsPage() {
  const [data, setData] = useState<ConnectAnalytics | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  async function load() {
    setLoading(true); setError(null);
    try { setData(await getConnectAnalytics()); }
    catch (e) { setError(String(e)); }
    finally { setLoading(false); }
  }
  useEffect(() => { load(); }, []);

  return (
    <Page>
      <PageHeader title="Analytics & growth" subtitle="Engagement, retention, funnel and revenue. Revenue tiles convert kobo to Naira." actions={<Button variant="outline" sm onClick={load}>Refresh</Button>} />
      {error && <p style={{ color: colors.danger }}>{error}</p>}

      {loading ? (
        <Card><p style={{ color: colors.muted }}>Loading analytics…</p></Card>
      ) : !data ? (
        <Card><p style={{ color: colors.muted }}>No analytics available.</p></Card>
      ) : (
        <>
          {GROUP_ORDER.map((g) => {
            const tiles = data.tiles.filter((t) => t.group === g);
            if (tiles.length === 0) return null;
            return (
              <Card key={g} title={GROUP_LABEL[g]} style={{ marginBottom: 16 }}>
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: '1rem', marginTop: 14 }}>
                  {tiles.map((t) => (
                    <div key={t.key} style={{ border: `1px solid ${colors.border}`, borderRadius: '0.5rem', padding: '0.85rem' }}>
                      <div style={{ color: colors.muted, fontSize: '0.78rem', fontWeight: 600 }}>{t.label}</div>
                      <div style={{ fontSize: '1.35rem', fontWeight: 700, margin: '0.25rem 0' }}>{t.value}</div>
                      <div style={{ fontSize: '0.78rem', color: t.trend === 'up' ? colors.success : t.trend === 'down' ? colors.danger : colors.muted }}>
                        {t.trend === 'up' ? '▲' : t.trend === 'down' ? '▼' : '▬'} {t.delta}
                      </div>
                    </div>
                  ))}
                </div>
              </Card>
            );
          })}

          <Card title="Onboarding → monetization funnel">
            <table style={{ width: '100%', borderCollapse: 'collapse', marginTop: 8 }}>
              <thead><tr><th style={thCell}>Step</th><th style={thCell}>Users</th><th style={thCell}>Conversion</th></tr></thead>
              <tbody>
                {data.funnel.map((f, i) => {
                  const top = data.funnel[0]?.count || 1;
                  const pct = Math.round((f.count / top) * 100);
                  return (
                    <tr key={f.step}>
                      <td style={tdCell}>{i + 1}. {f.step}</td>
                      <td style={tdCell}>{f.count.toLocaleString()}</td>
                      <td style={tdCell}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                          <div style={{ height: 8, background: tint(colors.primary, 0.15), borderRadius: 4, width: 120 }}>
                            <div style={{ height: 8, background: colors.primary, borderRadius: 4, width: `${pct}%` }} />
                          </div>
                          <span style={{ color: colors.muted, fontSize: '0.8rem' }}>{pct}%</span>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
            <p style={{ color: colors.muted, fontSize: '0.75rem', marginTop: '0.75rem' }}>Generated {timeAgo(data.generated_at)}.</p>
          </Card>
        </>
      )}
    </Page>
  );
}
