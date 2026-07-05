'use client';

import { useEffect, useState } from 'react';
import { getAcademyDashboard } from '@/services/academyAdminService';
import type { AcademyDashboard } from '@/types/academyAdmin';
import { PageHeader, AcademyTabs, Card, Kpi, Badge, DisclosureNote, StateBlock, Bar, btn, th, td, timeAgo, pct, formatNaira } from './_ui';

export default function AcademyDashboardPage() {
  const [data, setData] = useState<AcademyDashboard | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  async function load() {
    setLoading(true); setError(null);
    try { setData(await getAcademyDashboard()); }
    catch (e) { setError(String(e)); }
    finally { setLoading(false); }
  }
  useEffect(() => { load(); }, []);

  const maxAttempts = data ? Math.max(...data.attempts_trend.map((p) => p.value), 1) : 1;

  return (
    <div style={{ padding: '0.5rem 0.5rem 2rem' }}>
      <PageHeader
        title="Spotlight Academy"
        subtitle="Executive overview across learning, assessment, exam readiness, rewards and commerce. RBAC-scoped (academy.*); all state-changes are audit-logged. Money is in ₦ (kobo internally)."
        action={<button onClick={load} style={btn()}>Refresh</button>}
      />
      <AcademyTabs active="overview" />

      <DisclosureNote>
        Console actions are capability-checked per route (academy.admin / content / curriculum /
        assessment / exam / rewards / commerce / sponsor / moderation / support) and recorded to the
        immutable audit log. No reward may be issued without a funded pool. Mock data shown when
        NEXT_PUBLIC_ACADEMY_USE_MOCK is set.
      </DisclosureNote>

      <StateBlock loading={loading} error={error} empty={!data} emptyText="No dashboard data available.">
        {data && (
          <>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(180px, 1fr))', gap: '0.75rem', marginBottom: '1.25rem' }}>
              <Kpi label="Active learners" value={data.active_learners.toLocaleString('en-NG')} sub={`${data.active_learners_30d.toLocaleString('en-NG')} (30d)`} accent="#340075" />
              <Kpi label="Mock attempts (30d)" value={data.mock_attempts_30d.toLocaleString('en-NG')} sub={`${data.mock_attempts_today.toLocaleString('en-NG')} today`} />
              <Kpi label="Exam readiness avg" value={pct(data.exam_readiness_avg)} accent={data.exam_readiness_avg < 0.5 ? '#b91c1c' : '#15803d'} />
              <Kpi label="Reward spend (30d)" value={formatNaira(data.reward_spend_30d_kobo)} sub={`${formatNaira(data.reward_pool_balance_kobo)} pool balance`} accent="#7c3aed" />
              <Kpi label="Revenue (30d)" value={formatNaira(data.revenue_30d_kobo)} sub={`${formatNaira(data.revenue_today_kobo)} today`} accent="#15803d" />
              <Kpi label="Paying learners" value={data.paying_learners.toLocaleString('en-NG')} />
              <Kpi label="Question items" value={data.question_items_total.toLocaleString('en-NG')} sub={`${data.items_pending_review.toLocaleString('en-NG')} pending review`} accent={data.items_pending_review > 0 ? '#9a3412' : undefined} />
            </div>

            <Card title="Mock attempts (14d)">
              <div style={{ display: 'flex', flexDirection: 'column', gap: '0.4rem' }}>
                {data.attempts_trend.map((p) => (
                  <Bar key={p.date} value={p.value} max={maxAttempts} labelLeft={p.date.slice(5)} labelRight={p.value.toLocaleString('en-NG')} />
                ))}
              </div>
            </Card>

            <Card title="Recent activity">
              <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                <thead><tr><th style={th()}>Event</th><th style={th()}>Type</th><th style={th()}>Ref</th><th style={th()}>When</th></tr></thead>
                <tbody>
                  {data.activity.map((a) => (
                    <tr key={a.id}>
                      <td style={td()}>{a.label}</td>
                      <td style={td()}><Badge status={a.kind} /></td>
                      <td style={td()}><code style={{ fontSize: '0.78rem' }}>{a.ref ?? '—'}</code></td>
                      <td style={td()}>{timeAgo(a.created_at)}</td>
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
