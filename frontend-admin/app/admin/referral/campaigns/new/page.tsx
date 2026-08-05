'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { createCampaign } from '@/services/referralAdminService';
import type { CampaignDraft, RewardModel } from '@/types/referralAdmin';
import { ReferralTabs } from '../../_ui';
import { Page, PageHeader, Card, Button, Input, colors } from '@/components/ui/vuexy';

// Builder: audience / reward / rules / eligibility / dates + budget & caps (A-CMP-02/06).
// Money inputs are entered in Naira and converted to kobo on submit.
export default function CampaignBuilderPage() {
  const router = useRouter();
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [form, setForm] = useState({
    name: '', vertical: 'property', reward_model: 'flat' as RewardModel, funded_by: 'platform' as 'platform' | 'merchant',
    audience: '', eligibility: '', referrer_reward_naira: '2000', referee_reward_naira: '1000',
    vesting: 'KYC 40% / first-txn 30% / retained-30d 30%', budget_naira: '50000',
    per_user_cap_naira: '10000', daily_cap_naira: '200000', starts_at: '', ends_at: '',
  });

  function set<K extends keyof typeof form>(k: K, v: (typeof form)[K]) { setForm((f) => ({ ...f, [k]: v })); }
  const toKobo = (naira: string) => Math.round((Number(naira) || 0) * 100);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!form.name.trim()) { setError('Campaign name is required.'); return; }
    setSubmitting(true); setError(null);
    const draft: CampaignDraft = {
      name: form.name.trim(), vertical: form.vertical, reward_model: form.reward_model, funded_by: form.funded_by,
      audience: form.audience, eligibility: form.eligibility,
      referrer_reward_kobo: toKobo(form.referrer_reward_naira), referee_reward_kobo: toKobo(form.referee_reward_naira),
      vesting: form.vesting, budget_kobo: toKobo(form.budget_naira),
      per_user_cap_kobo: toKobo(form.per_user_cap_naira), daily_cap_kobo: toKobo(form.daily_cap_naira),
      starts_at: form.starts_at || new Date().toISOString(), ends_at: form.ends_at || null,
    };
    try { const { id } = await createCampaign(draft); router.push(`/admin/referral/campaigns/${id}`); }
    catch (err) { setError(String(err)); setSubmitting(false); }
  }

  const labelStyle = { display: 'block', fontSize: '0.75rem', fontWeight: 600, color: colors.text, marginBottom: '0.25rem' } as const;

  return (
    <Page>
      <PageHeader title="New campaign" subtitle="Campaign builder — audience, reward, rules, eligibility, dates, budget & caps (A-CMP-02 / A-CMP-06)." />
      <ReferralTabs active="campaigns" />

      <form onSubmit={submit}>
        <Card title="Basics">
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(220px,1fr))', gap: '0.75rem', marginTop: 14 }}>
            <div><label style={labelStyle}>Campaign name *</label><Input value={form.name} onChange={(e) => set('name', e.target.value)} placeholder="e.g. Lagos Estate Q3" /></div>
            <div><label style={labelStyle}>Vertical</label>
              <select value={form.vertical} onChange={(e) => set('vertical', e.target.value)} style={{ width: '100%' }}>
                {['property', 'bills', 'savings', 'restaurant', 'transport', 'telemedicine'].map((v) => <option key={v}>{v}</option>)}
              </select>
            </div>
            <div><label style={labelStyle}>Reward model</label>
              <select value={form.reward_model} onChange={(e) => set('reward_model', e.target.value as RewardModel)} style={{ width: '100%' }}>
                <option value="flat">flat</option><option value="dynamic">dynamic</option><option value="ltv">ltv</option>
              </select>
            </div>
            <div><label style={labelStyle}>Funded by</label>
              <select value={form.funded_by} onChange={(e) => set('funded_by', e.target.value as 'platform' | 'merchant')} style={{ width: '100%' }}>
                <option value="platform">platform</option><option value="merchant">merchant</option>
              </select>
            </div>
          </div>
        </Card>

        <Card title="Audience, rules & eligibility" style={{ marginTop: 16 }}>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr', gap: '0.75rem', marginTop: 14 }}>
            <div><label style={labelStyle}>Audience</label><Input value={form.audience} onChange={(e) => set('audience', e.target.value)} placeholder="e.g. Lagos KYC-verified users, no active property" /></div>
            <div><label style={labelStyle}>Eligibility / qualifying action</label><Input value={form.eligibility} onChange={(e) => set('eligibility', e.target.value)} placeholder="e.g. KYC + first property enquiry" /></div>
            <div><label style={labelStyle}>Vesting / holdback schedule</label><Input value={form.vesting} onChange={(e) => set('vesting', e.target.value)} /></div>
          </div>
        </Card>

        <Card title="Reward (₦)" style={{ marginTop: 16 }}>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(200px,1fr))', gap: '0.75rem', marginTop: 14 }}>
            <div><label style={labelStyle}>Referrer reward (₦)</label><Input type="number" min={0} value={form.referrer_reward_naira} onChange={(e) => set('referrer_reward_naira', e.target.value)} /></div>
            <div><label style={labelStyle}>Referee reward (₦)</label><Input type="number" min={0} value={form.referee_reward_naira} onChange={(e) => set('referee_reward_naira', e.target.value)} /></div>
          </div>
        </Card>

        <Card title="Budget & caps (A-CMP-06) — ₦" style={{ marginTop: 16 }}>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(200px,1fr))', gap: '0.75rem', marginTop: 14 }}>
            <div><label style={labelStyle}>Total budget (₦)</label><Input type="number" min={0} value={form.budget_naira} onChange={(e) => set('budget_naira', e.target.value)} /></div>
            <div><label style={labelStyle}>Per-user cap (₦)</label><Input type="number" min={0} value={form.per_user_cap_naira} onChange={(e) => set('per_user_cap_naira', e.target.value)} /></div>
            <div><label style={labelStyle}>Daily cap (₦)</label><Input type="number" min={0} value={form.daily_cap_naira} onChange={(e) => set('daily_cap_naira', e.target.value)} /></div>
          </div>
        </Card>

        <Card title="Schedule" style={{ marginTop: 16 }}>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(220px,1fr))', gap: '0.75rem', marginTop: 14 }}>
            <div><label style={labelStyle}>Starts at</label><Input type="datetime-local" value={form.starts_at} onChange={(e) => set('starts_at', e.target.value)} /></div>
            <div><label style={labelStyle}>Ends at (optional)</label><Input type="datetime-local" value={form.ends_at} onChange={(e) => set('ends_at', e.target.value)} /></div>
          </div>
        </Card>

        {error && <p style={{ color: colors.danger }}>{error}</p>}
        <div style={{ display: 'flex', gap: '0.5rem', marginTop: 16 }}>
          <Button type="submit" variant="primary" disabled={submitting}>{submitting ? 'Creating…' : 'Create campaign'}</Button>
          <Button type="button" variant="outline" onClick={() => router.push('/admin/referral/campaigns')}>Cancel</Button>
        </div>
      </form>
    </Page>
  );
}
