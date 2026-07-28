'use client';

import { useEffect, useState } from 'react';
import { getConnectAnalytics, type ConnectAnalytics, type AnalyticsTile } from '@/services/connectAdminOpsService';
import { PageHeader, Card, btn, th, td, timeAgo } from '../_ui';

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
    <div style={{ padding: '0.5rem 0.5rem 2rem' }}>
      <PageHeader title="Analytics & growth" subtitle="Engagement, retention, funnel and revenue. Revenue tiles convert kobo to Naira." action={<button onClick={load} style={btn()}>Refresh</button>} />
      {error && <p style={{ color: '#dc2626' }}>{error}</p>}

      {loading ? (
        <Card><p style={{ color: '#6b7280' }}>Loading analytics…</p></Card>
      ) : !data ? (
        <Card><p style={{ color: '#6b7280' }}>No analytics available.</p></Card>
      ) : (
        <>
          {GROUP_ORDER.map((g) => {
            const tiles = data.tiles.filter((t) => t.group === g);
            if (tiles.length === 0) return null;
            return (
              <Card key={g} title={GROUP_LABEL[g]}>
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: '1rem' }}>
                  {tiles.map((t) => (
                    <div key={t.key} style={{ border: '1px solid #f3f4f6', borderRadius: '0.5rem', padding: '0.85rem' }}>
                      <div style={{ color: '#6b7280', fontSize: '0.78rem', fontWeight: 600 }}>{t.label}</div>
                      <div style={{ fontSize: '1.35rem', fontWeight: 700, margin: '0.25rem 0' }}>{t.value}</div>
                      <div style={{ fontSize: '0.78rem', color: t.trend === 'up' ? '#16a34a' : t.trend === 'down' ? '#dc2626' : '#6b7280' }}>
                        {t.trend === 'up' ? '▲' : t.trend === 'down' ? '▼' : '▬'} {t.delta}
                      </div>
                    </div>
                  ))}
                </div>
              </Card>
            );
          })}

          <Card title="Onboarding → monetization funnel">
            <table style={{ width: '100%', borderCollapse: 'collapse' }}>
              <thead><tr><th style={th()}>Step</th><th style={th()}>Users</th><th style={th()}>Conversion</th></tr></thead>
              <tbody>
                {data.funnel.map((f, i) => {
                  const top = data.funnel[0]?.count || 1;
                  const pct = Math.round((f.count / top) * 100);
                  return (
                    <tr key={f.step}>
                      <td style={td()}>{i + 1}. {f.step}</td>
                      <td style={td()}>{f.count.toLocaleString()}</td>
                      <td style={td()}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                          <div style={{ height: 8, background: '#ede9fe', borderRadius: 4, width: 120 }}>
                            <div style={{ height: 8, background: '#340075', borderRadius: 4, width: `${pct}%` }} />
                          </div>
                          <span style={{ color: '#6b7280', fontSize: '0.8rem' }}>{pct}%</span>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
            <p style={{ color: '#9ca3af', fontSize: '0.75rem', marginTop: '0.75rem' }}>Generated {timeAgo(data.generated_at)}.</p>
          </Card>
        </>
      )}
    </div>
  );
}
