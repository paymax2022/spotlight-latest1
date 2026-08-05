'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import { useParams } from 'next/navigation';
import { getCampaign, setCampaignStatus, formatNaira } from '@/services/referralAdminService';
import type { CampaignDetail } from '@/types/referralAdmin';
import { ReferralTabs, Kpi, timeAgo } from '../../_ui';
import { Page, PageHeader, Card, Button, Badge, colors, thCell, tdCell } from '@/components/ui/vuexy';

function campaignStatusColor(status: string): string {
  if (status === 'active') return colors.success;
  if (status === 'paused' || status === 'throttled') return colors.warning;
  if (status === 'scheduled') return colors.info;
  return colors.secondary;
}

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
    <Page>
      <PageHeader
        title={data ? data.name : 'Campaign'}
        subtitle="Builder summary, budget & cap config (A-CMP-06), throttle / pause (A-CMP-07) and analytics (A-CMP-10)."
        actions={<Link href="/admin/referral/campaigns"><Button variant="outline">← Back</Button></Link>}
      />
      <ReferralTabs active="campaigns" />

      {loading ? (
        <p style={{ color: colors.muted, fontSize: 13 }}>Loading…</p>
      ) : error ? (
        <p style={{ color: colors.danger, fontSize: 13 }}>{error}</p>
      ) : !data ? (
        <p style={{ color: colors.muted, fontSize: 13 }}>Campaign not found.</p>
      ) : (
        <>
          <Card>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12, marginBottom: 12 }}>
              <h2 style={{ margin: 0, fontSize: 16, fontWeight: 700, color: colors.text }}>Throttle & pause controls (A-CMP-07)</h2>
              <Badge text={data.status} color={campaignStatusColor(data.status)} />
            </div>
            <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap', marginBottom: '0.5rem' }}>
              {data.status !== 'active' && <Button variant="outline" sm disabled={busy} onClick={() => changeStatus('active')}>Activate</Button>}
              {data.status === 'active' && <Button variant="outline" sm disabled={busy} onClick={() => changeStatus('paused')}>Pause</Button>}
              {data.status === 'active' && <Button variant="outline" sm disabled={busy} onClick={() => changeStatus('throttled')}>Throttle</Button>}
              {data.status !== 'ended' && <Button variant="danger" sm disabled={busy} onClick={() => changeStatus('ended')}>End campaign</Button>}
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(180px,1fr))', gap: '0.5rem' }}>
              <Kpi label="Throttle / min" value={String(data.throttle_per_min)} />
              <Kpi label="Auto-pause on fraud" value={data.auto_pause_on_fraud ? 'On' : 'Off'} accent={data.auto_pause_on_fraud ? colors.success : colors.warning} />
              <Kpi label="ROI guardrail" value={`${data.roi_guardrail_pct}%`} />
            </div>
          </Card>

          <Card title="Budget & cap config (A-CMP-06)" style={{ marginTop: 16 }}>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(180px,1fr))', gap: '0.5rem', marginBottom: '0.75rem', marginTop: 14 }}>
              <Kpi label="Budget" value={formatNaira(data.budget_kobo)} />
              <Kpi label="Spent" value={formatNaira(data.spent_kobo)} accent={burnPct > 90 ? colors.danger : undefined} sub={`${burnPct}% of budget`} />
              <Kpi label="Per-user cap" value={formatNaira(data.per_user_cap_kobo)} />
              <Kpi label="Daily cap" value={formatNaira(data.daily_cap_kobo)} />
            </div>
            <div style={{ height: 10, background: colors.border, borderRadius: 9999, overflow: 'hidden' }}>
              <div style={{ width: `${burnPct}%`, height: '100%', background: burnPct > 90 ? colors.danger : colors.primary }} />
            </div>
          </Card>

          <Card title="Reward & rules" style={{ marginTop: 16 }}>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(220px,1fr))', gap: '0.75rem', marginTop: 14 }}>
              <Field label="Reward model" value={<Badge text={data.reward_model} color={colors.info} />} />
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

          <Card title="Campaign analytics — funnel (A-CMP-10)" style={{ marginTop: 16 }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', marginTop: 14 }}>
              <thead><tr><th style={thCell}>Stage</th><th style={thCell}>Count</th><th style={thCell} /></tr></thead>
              <tbody>
                {data.funnel.map((f) => (
                  <tr key={f.stage}>
                    <td style={tdCell}>{f.stage}</td>
                    <td style={tdCell}>{f.count.toLocaleString('en-NG')}</td>
                    <td style={{ ...tdCell, width: '55%' }}>
                      <div style={{ height: 12, background: colors.border, borderRadius: 4 }}>
                        <div style={{ width: `${(f.count / maxFunnel) * 100}%`, height: '100%', background: colors.primary, borderRadius: 4 }} />
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            <p style={{ fontSize: '0.75rem', color: colors.muted, marginTop: '0.5rem' }}>Cost per activation: <strong>{data.cost_per_activation_kobo ? formatNaira(data.cost_per_activation_kobo) : '—'}</strong></p>
          </Card>
        </>
      )}
    </Page>
  );
}

function Field({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div>
      <div style={{ fontSize: '0.72rem', textTransform: 'uppercase', letterSpacing: 0.3, color: colors.muted, fontWeight: 600 }}>{label}</div>
      <div style={{ fontSize: '0.9rem', marginTop: '0.2rem', color: colors.text }}>{value}</div>
    </div>
  );
}
