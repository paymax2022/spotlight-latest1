'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import { getRiskDashboard, formatNaira } from '@/services/referralAdminOpsService';
import type { RiskDashboard } from '@/types/referralAdminOps';
import { timeAgo } from '../_ui';
import { Page, PageHeader, Card, Button, Badge, colors, thCell, tdCell } from '@/components/ui/vuexy';

const links = [
  { href: '/admin/referral/risk/rules', label: 'Rules engine' },
  { href: '/admin/referral/risk/review-queue', label: 'Review queue' },
  { href: '/admin/referral/risk/blocklist', label: 'Blocklists' },
  { href: '/admin/referral/risk/clawbacks', label: 'Clawbacks' },
];

function severityColor(severity: string): string {
  if (severity === 'critical') return colors.danger;
  if (severity === 'high') return colors.warning;
  return colors.secondary;
}

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
    <Page>
      <PageHeader
        title="Risk & Fraud dashboard"
        subtitle="Alerts, risk scores & burn anomalies (A-RSK-01). Investigate, hold, blocklist and claw back from the linked tools."
        actions={<Button variant="outline" onClick={load}>Refresh</Button>}
      />
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 20 }}>
        {links.map((l) => <Link key={l.href} href={l.href} className="vx-btn vx-btn--outline" style={{ textDecoration: 'none' }}>{l.label}</Link>)}
      </div>

      {loading ? <p style={{ color: colors.muted }}>Loading…</p>
        : error ? <p style={{ color: colors.danger }}>{error}</p>
        : !data ? <p style={{ color: colors.muted }}>No records found.</p>
        : (
          <>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(180px,1fr))', gap: 12, marginBottom: 20 }}>
              <Kpi label="Fraud rate" value={`${(data.fraud_rate * 100).toFixed(1)}%`} accent={data.fraud_rate > 0.03 ? colors.danger : undefined} />
              <Kpi label="Open cases" value={String(data.open_cases)} accent={colors.warning} />
              <Kpi label="Amount at risk" value={formatNaira(data.amount_at_risk_kobo)} accent={colors.danger} />
              <Kpi label="Blocked (24h)" value={String(data.blocked_24h)} />
              <Kpi label="Clawbacks (30d)" value={formatNaira(data.clawbacks_30d_kobo)} />
            </div>

            <Card title="Active alerts" style={{ marginBottom: 16 }}>
              <div style={{ overflowX: 'auto', marginTop: 14 }}>
                <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                  <thead><tr>
                    <th style={thCell}>Type</th><th style={thCell}>Severity</th><th style={thCell}>Subject</th>
                    <th style={thCell}>Detail</th><th style={thCell}>At risk</th><th style={thCell}>When</th>
                  </tr></thead>
                  <tbody>
                    {data.alerts.map((a) => (
                      <tr key={a.id}>
                        <td style={tdCell}>{a.kind.replace(/_/g, ' ')}</td>
                        <td style={tdCell}><Badge text={a.severity} color={severityColor(a.severity)} /></td>
                        <td style={tdCell}><Link href={`/admin/referral/users/${a.subject_id}`}>{a.subject_id}</Link></td>
                        <td style={tdCell}>{a.detail}</td>
                        <td style={tdCell}>{formatNaira(a.amount_at_risk_kobo)}</td>
                        <td style={tdCell}>{timeAgo(a.created_at)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </Card>

            <Card title="Burn anomaly — expected vs actual (last 14 days)">
              <div style={{ display: 'flex', alignItems: 'flex-end', gap: 6, height: 130, overflowX: 'auto', marginTop: 14 }}>
                {data.burn_anomaly_trend.map((t) => {
                  const anomaly = t.actual_kobo > t.expected_kobo * 1.3;
                  return (
                    <div key={t.date} style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', minWidth: 30 }}>
                      <div style={{ display: 'flex', gap: 2, alignItems: 'flex-end' }}>
                        <div style={{ width: 8, height: (t.expected_kobo / maxBurn) * 100 + 4, background: colors.border, borderRadius: 2 }} title={`Expected ${formatNaira(t.expected_kobo)}`} />
                        <div style={{ width: 8, height: (t.actual_kobo / maxBurn) * 100 + 4, background: anomaly ? colors.danger : colors.primary, borderRadius: 2 }} title={`Actual ${formatNaira(t.actual_kobo)}`} />
                      </div>
                      <span style={{ fontSize: 10, color: colors.muted, marginTop: 2 }}>{t.date.slice(5)}</span>
                    </div>
                  );
                })}
              </div>
              <p style={{ fontSize: 12, color: colors.muted, marginTop: 8 }}>Grey = expected burn, purple/red = actual (red when actual &gt; 1.3× expected).</p>
            </Card>
          </>
        )}
    </Page>
  );
}

function Kpi({ label, value, sub, accent }: { label: string; value: string; sub?: string; accent?: string }) {
  return (
    <div style={{ border: `1px solid ${colors.border}`, borderRadius: 8, padding: '13px 15px', background: colors.card }}>
      <div style={{ fontSize: 11, textTransform: 'uppercase', letterSpacing: 0.3, color: colors.muted, fontWeight: 700 }}>{label}</div>
      <div style={{ fontSize: 21, fontWeight: 700, marginTop: 4, color: accent ?? colors.text }}>{value}</div>
      {sub ? <div style={{ fontSize: 12, color: colors.muted, marginTop: 2 }}>{sub}</div> : null}
    </div>
  );
}
