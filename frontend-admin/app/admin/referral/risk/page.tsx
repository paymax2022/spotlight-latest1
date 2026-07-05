'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import { getRiskDashboard, formatNaira } from '@/services/referralAdminOpsService';
import type { RiskDashboard } from '@/types/referralAdminOps';
import { PageHeader, Card, Kpi, Badge, btn, th, td, timeAgo, StateBlock } from '../_ui';

const links = [
  { href: '/admin/referral/risk/rules', label: 'Rules engine' },
  { href: '/admin/referral/risk/review-queue', label: 'Review queue' },
  { href: '/admin/referral/risk/blocklist', label: 'Blocklists' },
  { href: '/admin/referral/risk/clawbacks', label: 'Clawbacks' },
];

export default function RiskDashboardPage() {
  const [data, setData] = useState<RiskDashboard | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  async function load() {
    setLoading(true); setError(null);
    try { setData(await getRiskDashboard()); }
    catch (e) { setError(String(e)); }
    finally { setLoading(false); }
  }
  useEffect(() => { load(); }, []);

  const maxBurn = data ? Math.max(...data.burn_anomaly_trend.flatMap((t) => [t.expected_kobo, t.actual_kobo]), 1) : 1;

  return (
    <div style={{ padding: '0.5rem 0.5rem 2rem' }}>
      <PageHeader
        title="Risk & Fraud dashboard"
        subtitle="Alerts, risk scores & burn anomalies (A-RSK-01). Investigate, hold, blocklist and claw back from the linked tools."
        action={<button onClick={load} style={btn()}>Refresh</button>}
      />
      <div style={{ display: 'flex', gap: '0.4rem', flexWrap: 'wrap', marginBottom: '1.25rem' }}>
        {links.map((l) => <Link key={l.href} href={l.href} style={{ ...btn(), textDecoration: 'none', color: '#374151' }}>{l.label}</Link>)}
      </div>

      <StateBlock loading={loading} error={error} empty={!data}>
        {data && (
          <>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(180px,1fr))', gap: '0.75rem', marginBottom: '1.25rem' }}>
              <Kpi label="Fraud rate" value={`${(data.fraud_rate * 100).toFixed(1)}%`} accent={data.fraud_rate > 0.03 ? '#b91c1c' : undefined} />
              <Kpi label="Open cases" value={String(data.open_cases)} accent="#9a3412" />
              <Kpi label="Amount at risk" value={formatNaira(data.amount_at_risk_kobo)} accent="#b91c1c" />
              <Kpi label="Blocked (24h)" value={String(data.blocked_24h)} />
              <Kpi label="Clawbacks (30d)" value={formatNaira(data.clawbacks_30d_kobo)} />
            </div>

            <Card title="Active alerts">
              <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                <thead><tr>
                  <th style={th()}>Type</th><th style={th()}>Severity</th><th style={th()}>Subject</th>
                  <th style={th()}>Detail</th><th style={th()}>At risk</th><th style={th()}>When</th>
                </tr></thead>
                <tbody>
                  {data.alerts.map((a) => (
                    <tr key={a.id}>
                      <td style={td()}>{a.kind.replace(/_/g, ' ')}</td>
                      <td style={td()}><Badge status={a.severity} /></td>
                      <td style={td()}><Link href={`/admin/referral/users/${a.subject_id}`} style={{ color: '#340075' }}>{a.subject_id}</Link></td>
                      <td style={td()}>{a.detail}</td>
                      <td style={td()}>{formatNaira(a.amount_at_risk_kobo)}</td>
                      <td style={td()}>{timeAgo(a.created_at)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </Card>

            <Card title="Burn anomaly — expected vs actual (last 14 days)">
              <div style={{ display: 'flex', alignItems: 'flex-end', gap: '0.4rem', height: 130, overflowX: 'auto' }}>
                {data.burn_anomaly_trend.map((t) => {
                  const anomaly = t.actual_kobo > t.expected_kobo * 1.3;
                  return (
                    <div key={t.date} style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', minWidth: 30 }}>
                      <div style={{ display: 'flex', gap: 2, alignItems: 'flex-end' }}>
                        <div style={{ width: 8, height: (t.expected_kobo / maxBurn) * 100 + 4, background: '#cbd5e1', borderRadius: 2 }} title={`Expected ${formatNaira(t.expected_kobo)}`} />
                        <div style={{ width: 8, height: (t.actual_kobo / maxBurn) * 100 + 4, background: anomaly ? '#b91c1c' : '#340075', borderRadius: 2 }} title={`Actual ${formatNaira(t.actual_kobo)}`} />
                      </div>
                      <span style={{ fontSize: '0.6rem', color: '#9ca3af', marginTop: 2 }}>{t.date.slice(5)}</span>
                    </div>
                  );
                })}
              </div>
              <p style={{ fontSize: '0.72rem', color: '#6b7280', marginTop: '0.5rem' }}>Grey = expected burn, purple/red = actual (red when actual &gt; 1.3× expected).</p>
            </Card>
          </>
        )}
      </StateBlock>
    </div>
  );
}
