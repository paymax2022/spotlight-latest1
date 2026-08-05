'use client';

import { useEffect, useState } from 'react';
import { getAcademyDashboard } from '@/services/academyAdminService';
import type { AcademyDashboard } from '@/types/academyAdmin';
import { AcademyTabs, Kpi, DisclosureNote, StateBlock, Bar, timeAgo, pct, formatNaira } from './_ui';
import { Page, PageHeader, Card, Button, Badge, colors, thCell, tdCell } from '@/components/ui/vuexy';

function statusColor(status: string): string {
  const s = status.toLowerCase();
  if (['active', 'approved', 'published', 'funded', 'paid', 'completed', 'allocated', 'live', 'reconciled', 'disbursed', 'collected', 'released', 'core', 'issued', 'routed', 'ready', 'eligible', 'actioned', 'verified', 'resolved', 'plan_published', 'badge_earned', 'pool_funded', 'item_approved'].includes(s)) return colors.success;
  if (['pending', 'in_review', 'under_review', 'needs_info', 'scheduled', 'low_balance', 'review', 'in_translation', 'funding', 'fee_due', 'onboarding', 'frequent', 'packaged', 'matured', 'paused', 'processing', 'triaged', 'investigating', 'hide', 'warn', 'high', 'medium'].includes(s)) return colors.warning;
  if (['draft', 'authoring', 'open', 'upcoming', 'generated', 'partial', 'submitted', 'trial', 'requested', 'applied', 'cards_generated', 'exam_opened', 'campaign_launched'].includes(s)) return colors.info;
  if (['rejected', 'failed', 'suspended', 'blocked', 'unfunded', 'expired', 'duplicate', 'revoked', 'escalated', 'ban', 'critical', 'overdue', 'item_rejected'].includes(s)) return colors.danger;
  if (['refunded', 'reversed', 'redeemed', 'reward_redeemed'].includes(s)) return colors.primary;
  return colors.secondary;
}

function StatusBadge({ status, label: lbl }: { status: string; label?: string }) {
  return <Badge text={lbl ?? status.replace(/_/g, ' ')} color={statusColor(status)} />;
}

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
    <Page>
      <PageHeader
        title="Spotlight Academy"
        subtitle="Executive overview across learning, assessment, exam readiness, rewards and commerce. RBAC-scoped (academy.*); all state-changes are audit-logged. Money is in ₦ (kobo internally)."
        actions={<Button onClick={load} variant="outline" sm>Refresh</Button>}
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
              <Kpi label="Active learners" value={data.active_learners.toLocaleString('en-NG')} sub={`${data.active_learners_30d.toLocaleString('en-NG')} (30d)`} accent={colors.primary} />
              <Kpi label="Mock attempts (30d)" value={data.mock_attempts_30d.toLocaleString('en-NG')} sub={`${data.mock_attempts_today.toLocaleString('en-NG')} today`} />
              <Kpi label="Exam readiness avg" value={pct(data.exam_readiness_avg)} accent={data.exam_readiness_avg < 0.5 ? colors.danger : colors.success} />
              <Kpi label="Reward spend (30d)" value={formatNaira(data.reward_spend_30d_kobo)} sub={`${formatNaira(data.reward_pool_balance_kobo)} pool balance`} accent={colors.primary} />
              <Kpi label="Revenue (30d)" value={formatNaira(data.revenue_30d_kobo)} sub={`${formatNaira(data.revenue_today_kobo)} today`} accent={colors.success} />
              <Kpi label="Paying learners" value={data.paying_learners.toLocaleString('en-NG')} />
              <Kpi label="Question items" value={data.question_items_total.toLocaleString('en-NG')} sub={`${data.items_pending_review.toLocaleString('en-NG')} pending review`} accent={data.items_pending_review > 0 ? colors.warning : undefined} />
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
                <thead><tr><th style={thCell}>Event</th><th style={thCell}>Type</th><th style={thCell}>Ref</th><th style={thCell}>When</th></tr></thead>
                <tbody>
                  {data.activity.map((a) => (
                    <tr key={a.id}>
                      <td style={tdCell}>{a.label}</td>
                      <td style={tdCell}><StatusBadge status={a.kind} /></td>
                      <td style={tdCell}><code style={{ fontSize: '0.78rem' }}>{a.ref ?? '—'}</code></td>
                      <td style={tdCell}>{timeAgo(a.created_at)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </Card>
          </>
        )}
      </StateBlock>
    </Page>
  );
}
