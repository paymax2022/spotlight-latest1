'use client';

// A5 — Referrer Case View (support tool). One referrer's full picture: tier status,
// reward history, milestone history. Manual reward adjustment requires a logged
// reason (never a silent edit) and sends an Idempotency-Key (money mutation).
// RBAC: referral.admin.case (Support view / Support Lead adjust).

import { useState } from 'react';
import { getReferrerCase, adjustReferrerCase, formatNaira, formatPct } from '@/services/referralRewardsAdminService';
import type { ReferrerCase } from '@/types/referralRewardsAdmin';
import { PageHeader, RewardsTabs, Card, Badge, StateBlock, btn, btnPrimary, th, td, input, label, timeAgo } from '../_ui';

export default function ReferralRewardsCasePage() {
  const [query, setQuery] = useState('');
  const [data, setData] = useState<ReferrerCase | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [adjustKobo, setAdjustKobo] = useState('');
  const [reason, setReason] = useState('');
  const [adjusting, setAdjusting] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  async function search() {
    if (!query.trim()) return;
    setLoading(true); setError(null); setData(null); setMsg(null);
    try { setData(await getReferrerCase(query.trim())); }
    catch (e) { setError(String(e)); }
    finally { setLoading(false); }
  }

  async function adjust() {
    if (!data) return;
    const kobo = Number(adjustKobo);
    if (!Number.isFinite(kobo) || kobo === 0) { setMsg('Enter a non-zero adjustment amount (kobo; negative = debit).'); return; }
    if (!reason.trim()) { setMsg('A reason is required — the adjustment is logged to the audit trail.'); return; }
    setAdjusting(true); setMsg(null); setError(null);
    try {
      await adjustReferrerCase(data.referrer_id, { adjust_kobo: kobo, reason: reason.trim() });
      setMsg(`Adjustment of ${formatNaira(kobo)} applied and logged. Reloading case…`);
      setAdjustKobo(''); setReason('');
      setData(await getReferrerCase(data.referrer_id));
    } catch (e) { setError(String(e)); }
    finally { setAdjusting(false); }
  }

  return (
    <div style={{ padding: '0.5rem 0.5rem 2rem' }}>
      <PageHeader
        title="Referrer Case View"
        subtitle="Resolve support tickets ('why wasn't I credited?'). Full attribution / reward / tier / milestone history for one referrer, with an audited manual adjustment. (A5)"
      />
      <RewardsTabs active="case" />

      <Card title="Find a referrer">
        <div style={{ display: 'flex', gap: '0.75rem', alignItems: 'flex-end', flexWrap: 'wrap' }}>
          <div style={{ minWidth: 300, flex: 1 }}>
            <label style={label()}>Referrer ID</label>
            <input style={input()} value={query} onChange={(e) => setQuery(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && search()} placeholder="usr_a12" />
          </div>
          <button onClick={search} style={btnPrimary()}>Look up</button>
        </div>
      </Card>

      <StateBlock loading={loading} error={error} empty={false}>
        {data && (
          <>
            <Card title="Tier status" right={<Badge status={data.tier.current_tier} />}>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(200px,1fr))', gap: '0.75rem' }}>
                <Field label="Referrer" value={<code>{data.referrer_id}</code>} />
                <Field label="Active referrals" value={data.tier.active_referral_count.toLocaleString()} />
                <Field label="Current tier" value={<Badge status={data.tier.current_tier} />} />
                <Field label="Current rate" value={formatPct(data.tier.current_rate)} />
                <Field label="Last recalculated" value={timeAgo(data.tier.last_recalculated_at)} />
              </div>
            </Card>

            <Card title={`Reward history (${data.rewards.length})`}>
              <StateBlock loading={false} error={null} empty={data.rewards.length === 0} emptyText="No rewards yet for this referrer.">
                <div style={{ overflowX: 'auto' }}>
                  <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: 720 }}>
                    <thead><tr><th style={th()}>Reward</th><th style={th()}>Referred</th><th style={th()}>Module</th><th style={th()}>Margin</th><th style={th()}>Rate</th><th style={th()}>Reward</th><th style={th()}>Status</th><th style={th()}>Created</th></tr></thead>
                    <tbody>
                      {data.rewards.map((r) => (
                        <tr key={r.id}>
                          <td style={td()}><code style={{ fontSize: '0.76rem' }}>{r.id}</code></td>
                          <td style={td()}><code style={{ fontSize: '0.76rem' }}>{r.referred_user_id}</code></td>
                          <td style={{ ...td(), textTransform: 'capitalize' }}>{r.module}</td>
                          <td style={td()}>{formatNaira(r.margin_amount_kobo)}</td>
                          <td style={td()}>{formatPct(r.applied_rate)}</td>
                          <td style={td()}><strong>{formatNaira(r.reward_amount_kobo)}</strong></td>
                          <td style={td()}><Badge status={r.status} /></td>
                          <td style={{ ...td(), color: '#6b7280' }}>{timeAgo(r.created_at)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </StateBlock>
            </Card>

            <Card title={`Milestone history (${data.milestones.length})`}>
              <StateBlock loading={false} error={null} empty={data.milestones.length === 0} emptyText="No milestones achieved yet.">
                <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                  <thead><tr><th style={th()}>Threshold</th><th style={th()}>Bonus</th><th style={th()}>Status</th><th style={th()}>Achieved</th><th style={th()}>Paid</th></tr></thead>
                  <tbody>
                    {data.milestones.map((m) => (
                      <tr key={m.id}>
                        <td style={td()}>{m.threshold.toLocaleString()}</td>
                        <td style={td()}><strong>{formatNaira(m.bonus_kobo)}</strong></td>
                        <td style={td()}><Badge status={m.status} /></td>
                        <td style={{ ...td(), color: '#6b7280' }}>{timeAgo(m.achieved_at)}</td>
                        <td style={{ ...td(), color: '#6b7280' }}>{timeAgo(m.paid_at)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </StateBlock>
            </Card>

            <Card title="Manual adjustment (Support Lead)">
              <p style={{ fontSize: '0.8rem', color: '#9a3412', marginTop: 0 }}>
                Adjustments are a money mutation: they require a reason, are sent with an Idempotency-Key, and are logged to the audit trail. Never a silent edit.
              </p>
              <div style={{ display: 'grid', gridTemplateColumns: '200px 1fr auto', gap: '0.75rem', alignItems: 'flex-end' }}>
                <div>
                  <label style={label()}>Amount (kobo; − = debit)</label>
                  <input style={input()} type="number" value={adjustKobo} onChange={(e) => setAdjustKobo(e.target.value)} placeholder="e.g. 5000 or -2000" />
                </div>
                <div>
                  <label style={label()}>Reason (required)</label>
                  <input style={input()} value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Ticket #… — goodwill credit for delayed settlement" />
                </div>
                <button onClick={adjust} disabled={adjusting} style={btnPrimary()}>{adjusting ? 'Applying…' : 'Apply adjustment'}</button>
              </div>
              {msg && <div style={{ marginTop: '0.75rem', fontSize: '0.85rem', color: '#1e40af' }}>{msg}</div>}
            </Card>
          </>
        )}
      </StateBlock>
    </div>
  );
}

function Field({ label: lbl, value }: { label: string; value: React.ReactNode }) {
  return (
    <div>
      <div style={{ fontSize: '0.72rem', textTransform: 'uppercase', letterSpacing: 0.3, color: '#6b7280', fontWeight: 600 }}>{lbl}</div>
      <div style={{ fontSize: '0.9rem', marginTop: '0.2rem', color: '#111827' }}>{value}</div>
    </div>
  );
}
