'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import { useParams } from 'next/navigation';
import { getCampaign, setCampaignStatus, formatNaira } from '@/services/referralAdminService';
import type { CampaignDetail } from '@/types/referralAdmin';
import { PageHeader, ReferralTabs, Card, Kpi, Badge, btn, btnDanger, th, td, timeAgo, StateBlock } from '../../_ui';

export default function CampaignDetailPage() {
  const params = useParams();
  const id = String(params?.id ?? '');
  const [data, setData] = useState<CampaignDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function load() {
    setLoading(true); setError(null);
    try { setData(await getCampaign(id)); }
    catch (e) { setError(String(e)); }
    finally { setLoading(false); }
  }
  useEffect(() => { if (id) load(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [id]);

  async function changeStatus(next: CampaignDetail['status']) {
    if (!data) return;
    setBusy(true);
    try { await setCampaignStatus(data.id, next); setData({ ...data, status: next }); }
    catch (e) { setError(String(e)); }
    finally { setBusy(false); }
  }

  const maxFunnel = data ? Math.max(...data.funnel.map((f) => f.count), 1) : 1;
  const burnPct = data ? Math.min(100, Math.round((data.spent_kobo / Math.max(data.budget_kobo, 1)) * 100)) : 0;

  return (
    <div style={{ padding: '0.5rem 0.5rem 2rem' }}>
      <PageHeader
        title={data ? data.name : 'Campaign'}
        subtitle="Builder summary, budget & cap config (A-CMP-06), throttle / pause (A-CMP-07) and analytics (A-CMP-10)."
        action={<Link href="/admin/referral/campaigns" style={{ ...btn(), textDecoration: 'none', color: '#374151' }}>← Back</Link>}
      />
      <ReferralTabs active="campaigns" />

      <StateBlock loading={loading} error={error} empty={!data} emptyText="Campaign not found.">
        {data && (
          <>
            <Card title="Throttle & pause controls (A-CMP-07)" right={<Badge status={data.status} />}>
              <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap', marginBottom: '0.5rem' }}>
                {data.status !== 'active' && <button disabled={busy} onClick={() => changeStatus('active')} style={btn()}>Activate</button>}
                {data.status === 'active' && <button disabled={busy} onClick={() => changeStatus('paused')} style={btn()}>Pause</button>}
                {data.status === 'active' && <button disabled={busy} onClick={() => changeStatus('throttled')} style={btn()}>Throttle</button>}
                {data.status !== 'ended' && <button disabled={busy} onClick={() => changeStatus('ended')} style={btnDanger()}>End campaign</button>}
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(180px,1fr))', gap: '0.5rem' }}>
                <Kpi label="Throttle / min" value={String(data.throttle_per_min)} />
                <Kpi label="Auto-pause on fraud" value={data.auto_pause_on_fraud ? 'On' : 'Off'} accent={data.auto_pause_on_fraud ? '#15803d' : '#9a3412'} />
                <Kpi label="ROI guardrail" value={`${data.roi_guardrail_pct}%`} />
              </div>
            </Card>

            <Card title="Budget & cap config (A-CMP-06)">
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(180px,1fr))', gap: '0.5rem', marginBottom: '0.75rem' }}>
                <Kpi label="Budget" value={formatNaira(data.budget_kobo)} />
                <Kpi label="Spent" value={formatNaira(data.spent_kobo)} accent={burnPct > 90 ? '#b91c1c' : undefined} sub={`${burnPct}% of budget`} />
                <Kpi label="Per-user cap" value={formatNaira(data.per_user_cap_kobo)} />
                <Kpi label="Daily cap" value={formatNaira(data.daily_cap_kobo)} />
              </div>
              <div style={{ height: 10, background: '#f3f4f6', borderRadius: 9999, overflow: 'hidden' }}>
                <div style={{ width: `${burnPct}%`, height: '100%', background: burnPct > 90 ? '#b91c1c' : '#340075' }} />
              </div>
            </Card>

            <Card title="Reward & rules">
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(220px,1fr))', gap: '0.75rem' }}>
                <Field label="Reward model" value={<Badge status="normal" label={data.reward_model} />} />
                <Field label="Funded by" value={data.funded_by} />
                <Field label="Referrer reward" value={formatNaira(data.referrer_reward_kobo)} />
                <Field label="Referee reward" value={formatNaira(data.referee_reward_kobo)} />
                <Field label="Vesting / holdback" value={data.vesting} />
                <Field label="Eligibility" value={data.eligibility} />
                <Field label="Audience" value={data.audience} />
                <Field label="Geography" value={data.geography.join(', ')} />
                <Field label="Starts" value={timeAgo(data.starts_at)} />
                <Field label="Ends" value={data.ends_at ? timeAgo(data.ends_at) : 'No end date'} />
              </div>
            </Card>

            <Card title="Campaign analytics — funnel (A-CMP-10)">
              <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                <thead><tr><th style={th()}>Stage</th><th style={th()}>Count</th><th style={th()} /></tr></thead>
                <tbody>
                  {data.funnel.map((f) => (
                    <tr key={f.stage}>
                      <td style={td()}>{f.stage}</td>
                      <td style={td()}>{f.count.toLocaleString('en-NG')}</td>
                      <td style={{ ...td(), width: '55%' }}>
                        <div style={{ height: 12, background: '#f3f4f6', borderRadius: 4 }}>
                          <div style={{ width: `${(f.count / maxFunnel) * 100}%`, height: '100%', background: '#340075', borderRadius: 4 }} />
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
              <p style={{ fontSize: '0.75rem', color: '#6b7280', marginTop: '0.5rem' }}>Cost per activation: <strong>{data.cost_per_activation_kobo ? formatNaira(data.cost_per_activation_kobo) : '—'}</strong></p>
            </Card>
          </>
        )}
      </StateBlock>
    </div>
  );
}

function Field({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div>
      <div style={{ fontSize: '0.72rem', textTransform: 'uppercase', letterSpacing: 0.3, color: '#6b7280', fontWeight: 600 }}>{label}</div>
      <div style={{ fontSize: '0.9rem', marginTop: '0.2rem', color: '#111827' }}>{value}</div>
    </div>
  );
}
