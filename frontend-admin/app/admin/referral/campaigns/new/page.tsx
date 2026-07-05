'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { createCampaign } from '@/services/referralAdminService';
import type { CampaignDraft, RewardModel } from '@/types/referralAdmin';
import { PageHeader, ReferralTabs, Card, btn, btnPrimary, input, label } from '../../_ui';

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

  return (
    <div style={{ padding: '0.5rem 0.5rem 2rem' }}>
      <PageHeader title="New campaign" subtitle="Campaign builder — audience, reward, rules, eligibility, dates, budget & caps (A-CMP-02 / A-CMP-06)." />
      <ReferralTabs active="campaigns" />

      <form onSubmit={submit}>
        <Card title="Basics">
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(220px,1fr))', gap: '0.75rem' }}>
            <div><label style={label()}>Campaign name *</label><input value={form.name} onChange={(e) => set('name', e.target.value)} style={input()} placeholder="e.g. Lagos Estate Q3" /></div>
            <div><label style={label()}>Vertical</label>
              <select value={form.vertical} onChange={(e) => set('vertical', e.target.value)} style={input()}>
                {['property', 'bills', 'savings', 'restaurant', 'transport', 'telemedicine'].map((v) => <option key={v}>{v}</option>)}
              </select>
            </div>
            <div><label style={label()}>Reward model</label>
              <select value={form.reward_model} onChange={(e) => set('reward_model', e.target.value as RewardModel)} style={input()}>
                <option value="flat">flat</option><option value="dynamic">dynamic</option><option value="ltv">ltv</option>
              </select>
            </div>
            <div><label style={label()}>Funded by</label>
              <select value={form.funded_by} onChange={(e) => set('funded_by', e.target.value as 'platform' | 'merchant')} style={input()}>
                <option value="platform">platform</option><option value="merchant">merchant</option>
              </select>
            </div>
          </div>
        </Card>

        <Card title="Audience, rules & eligibility">
          <div style={{ display: 'grid', gridTemplateColumns: '1fr', gap: '0.75rem' }}>
            <div><label style={label()}>Audience</label><input value={form.audience} onChange={(e) => set('audience', e.target.value)} style={input()} placeholder="e.g. Lagos KYC-verified users, no active property" /></div>
            <div><label style={label()}>Eligibility / qualifying action</label><input value={form.eligibility} onChange={(e) => set('eligibility', e.target.value)} style={input()} placeholder="e.g. KYC + first property enquiry" /></div>
            <div><label style={label()}>Vesting / holdback schedule</label><input value={form.vesting} onChange={(e) => set('vesting', e.target.value)} style={input()} /></div>
          </div>
        </Card>

        <Card title="Reward (₦)">
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(200px,1fr))', gap: '0.75rem' }}>
            <div><label style={label()}>Referrer reward (₦)</label><input type="number" min={0} value={form.referrer_reward_naira} onChange={(e) => set('referrer_reward_naira', e.target.value)} style={input()} /></div>
            <div><label style={label()}>Referee reward (₦)</label><input type="number" min={0} value={form.referee_reward_naira} onChange={(e) => set('referee_reward_naira', e.target.value)} style={input()} /></div>
          </div>
        </Card>

        <Card title="Budget & caps (A-CMP-06) — ₦">
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(200px,1fr))', gap: '0.75rem' }}>
            <div><label style={label()}>Total budget (₦)</label><input type="number" min={0} value={form.budget_naira} onChange={(e) => set('budget_naira', e.target.value)} style={input()} /></div>
            <div><label style={label()}>Per-user cap (₦)</label><input type="number" min={0} value={form.per_user_cap_naira} onChange={(e) => set('per_user_cap_naira', e.target.value)} style={input()} /></div>
            <div><label style={label()}>Daily cap (₦)</label><input type="number" min={0} value={form.daily_cap_naira} onChange={(e) => set('daily_cap_naira', e.target.value)} style={input()} /></div>
          </div>
        </Card>

        <Card title="Schedule">
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(220px,1fr))', gap: '0.75rem' }}>
            <div><label style={label()}>Starts at</label><input type="datetime-local" value={form.starts_at} onChange={(e) => set('starts_at', e.target.value)} style={input()} /></div>
            <div><label style={label()}>Ends at (optional)</label><input type="datetime-local" value={form.ends_at} onChange={(e) => set('ends_at', e.target.value)} style={input()} /></div>
          </div>
        </Card>

        {error && <p style={{ color: '#dc2626' }}>{error}</p>}
        <div style={{ display: 'flex', gap: '0.5rem' }}>
          <button type="submit" disabled={submitting} style={{ ...btnPrimary(), opacity: submitting ? 0.6 : 1 }}>{submitting ? 'Creating…' : 'Create campaign'}</button>
          <button type="button" onClick={() => router.push('/admin/referral/campaigns')} style={btn()}>Cancel</button>
        </div>
      </form>
    </div>
  );
}
