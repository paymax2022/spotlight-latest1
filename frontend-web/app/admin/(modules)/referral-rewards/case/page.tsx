'use client';

// A5 — Referrer Case View (support tool). One referrer's full picture: tier status,
// reward history, milestone history. Manual reward adjustment requires a logged
// reason (never a silent edit) and sends an Idempotency-Key (money mutation).
// RBAC: referral.admin.case (Support view / Support Lead adjust).

import { useState } from 'react';
import Link from 'next/link';
import { getReferrerCase, adjustReferrerCase, formatNaira, formatPct } from '@/services/referralRewardsAdminService';
import type { ReferrerCase } from '@/types/referralRewardsAdmin';
import { Page, PageHeader, Card, Button, Input, Badge, colors, tint, thCell, tdCell } from '@/components/ui/vuexy';
import { timeAgo } from '../_ui';

const REWARDS_TABS = [
  { href: '/admin/referral-rewards/config', label: 'A1 · Config', key: 'config' },
  { href: '/admin/referral-rewards/analytics', label: 'A2 · Analytics', key: 'analytics' },
  { href: '/admin/referral-rewards/fraud', label: 'A3 · Fraud queue', key: 'fraud' },
  { href: '/admin/referral-rewards/ledger', label: 'A4 · Ledger', key: 'ledger' },
  { href: '/admin/referral-rewards/case', label: 'A5 · Case view', key: 'case' },
  { href: '/admin/referral-rewards/milestones', label: 'A6 · Milestones', key: 'milestones' },
  { href: '/admin/referral-rewards/module-status', label: 'A7 · Module status', key: 'module-status' },
];

function RewardsTabs({ active }: { active: string }) {
  return (
    <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginBottom: 20, borderBottom: `1px solid ${colors.border}`, paddingBottom: 8 }}>
      {REWARDS_TABS.map((t) => (
        <Link
          key={t.key}
          href={t.href}
          style={{
            textDecoration: 'none', padding: '6px 12px', borderRadius: 6, fontSize: 13, fontWeight: 600,
            color: active === t.key ? '#fff' : colors.text,
            background: active === t.key ? colors.primary : tint(colors.primary, 0.06),
          }}
        >
          {t.label}
        </Link>
      ))}
    </div>
  );
}

const STATUS_BADGE: Record<string, string> = {
  pending: colors.warning,
  credited: colors.success,
  paid: colors.success,
  active: colors.success,
  achieved: colors.info,
  reversed: colors.danger,
  voided: colors.danger,
  suspended: colors.danger,
  starter: colors.secondary,
  growth: colors.info,
  pro: colors.primary,
  elite: colors.warning,
};
function statusColor(status: string): string {
  return STATUS_BADGE[status.toLowerCase()] ?? colors.secondary;
}
function statusLabel(status: string): string {
  return status.replace(/_/g, ' ').toLowerCase();
}

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
    <Page>
      <PageHeader
        title="Referrer Case View"
        subtitle="Resolve support tickets ('why wasn't I credited?'). Full attribution / reward / tier / milestone history for one referrer, with an audited manual adjustment. (A5)"
      />
      <RewardsTabs active="case" />

      <Card title="Find a referrer" style={{ marginBottom: 16 }}>
        <div style={{ display: 'flex', gap: 12, alignItems: 'flex-end', flexWrap: 'wrap', marginTop: 12 }}>
          <div style={{ minWidth: 300, flex: 1 }}>
            <label style={{ display: 'block', fontSize: 12, fontWeight: 600, color: colors.text, marginBottom: 4 }}>Referrer ID</label>
            <Input value={query} onChange={(e) => setQuery(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && search()} placeholder="usr_a12" />
          </div>
          <Button variant="primary" onClick={search}>Look up</Button>
        </div>
      </Card>

      {loading ? (
        <p style={{ color: colors.muted }}>Loading…</p>
      ) : error ? (
        <p style={{ color: colors.danger }}>{error}</p>
      ) : data ? (
        <>
          <Card style={{ marginBottom: 16 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12, gap: 8, flexWrap: 'wrap' }}>
              <h2 style={{ margin: 0, fontSize: 16, fontWeight: 700, color: colors.text }}>Tier status</h2>
              <Badge text={data.tier.current_tier} color={statusColor(data.tier.current_tier)} />
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(200px,1fr))', gap: 12 }}>
              <Field label="Referrer" value={<code>{data.referrer_id}</code>} />
              <Field label="Active referrals" value={data.tier.active_referral_count.toLocaleString()} />
              <Field label="Current tier" value={<Badge text={data.tier.current_tier} color={statusColor(data.tier.current_tier)} />} />
              <Field label="Current rate" value={formatPct(data.tier.current_rate)} />
              <Field label="Last recalculated" value={timeAgo(data.tier.last_recalculated_at)} />
            </div>
          </Card>

          <Card title={`Reward history (${data.rewards.length})`} style={{ marginBottom: 16 }}>
            {data.rewards.length === 0 ? (
              <p style={{ color: colors.muted, marginTop: 12 }}>No rewards yet for this referrer.</p>
            ) : (
              <div style={{ overflowX: 'auto' }}>
                <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: 720, marginTop: 12 }}>
                  <thead><tr><th style={thCell}>Reward</th><th style={thCell}>Referred</th><th style={thCell}>Module</th><th style={thCell}>Margin</th><th style={thCell}>Rate</th><th style={thCell}>Reward</th><th style={thCell}>Status</th><th style={thCell}>Created</th></tr></thead>
                  <tbody>
                    {data.rewards.map((r) => (
                      <tr key={r.id}>
                        <td style={tdCell}><code style={{ fontSize: 12 }}>{r.id}</code></td>
                        <td style={tdCell}><code style={{ fontSize: 12 }}>{r.referred_user_id}</code></td>
                        <td style={{ ...tdCell, textTransform: 'capitalize' }}>{r.module}</td>
                        <td style={tdCell}>{formatNaira(r.margin_amount_kobo)}</td>
                        <td style={tdCell}>{formatPct(r.applied_rate)}</td>
                        <td style={tdCell}><strong>{formatNaira(r.reward_amount_kobo)}</strong></td>
                        <td style={tdCell}><Badge text={statusLabel(r.status)} color={statusColor(r.status)} /></td>
                        <td style={{ ...tdCell, color: colors.muted }}>{timeAgo(r.created_at)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </Card>

          <Card title={`Milestone history (${data.milestones.length})`} style={{ marginBottom: 16 }}>
            {data.milestones.length === 0 ? (
              <p style={{ color: colors.muted, marginTop: 12 }}>No milestones achieved yet.</p>
            ) : (
              <table style={{ width: '100%', borderCollapse: 'collapse', marginTop: 12 }}>
                <thead><tr><th style={thCell}>Threshold</th><th style={thCell}>Bonus</th><th style={thCell}>Status</th><th style={thCell}>Achieved</th><th style={thCell}>Paid</th></tr></thead>
                <tbody>
                  {data.milestones.map((m) => (
                    <tr key={m.id}>
                      <td style={tdCell}>{m.threshold.toLocaleString()}</td>
                      <td style={tdCell}><strong>{formatNaira(m.bonus_kobo)}</strong></td>
                      <td style={tdCell}><Badge text={statusLabel(m.status)} color={statusColor(m.status)} /></td>
                      <td style={{ ...tdCell, color: colors.muted }}>{timeAgo(m.achieved_at)}</td>
                      <td style={{ ...tdCell, color: colors.muted }}>{timeAgo(m.paid_at)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </Card>

          <Card title="Manual adjustment (Support Lead)">
            <p style={{ fontSize: 13, color: colors.warning, marginTop: 0 }}>
              Adjustments are a money mutation: they require a reason, are sent with an Idempotency-Key, and are logged to the audit trail. Never a silent edit.
            </p>
            <div style={{ display: 'grid', gridTemplateColumns: '200px 1fr auto', gap: 12, alignItems: 'flex-end' }}>
              <div>
                <label style={{ display: 'block', fontSize: 12, fontWeight: 600, color: colors.text, marginBottom: 4 }}>Amount (kobo; − = debit)</label>
                <Input type="number" value={adjustKobo} onChange={(e) => setAdjustKobo(e.target.value)} placeholder="e.g. 5000 or -2000" />
              </div>
              <div>
                <label style={{ display: 'block', fontSize: 12, fontWeight: 600, color: colors.text, marginBottom: 4 }}>Reason (required)</label>
                <Input value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Ticket #… — goodwill credit for delayed settlement" />
              </div>
              <Button variant="primary" onClick={adjust} disabled={adjusting}>{adjusting ? 'Applying…' : 'Apply adjustment'}</Button>
            </div>
            {msg && <div style={{ marginTop: 12, fontSize: 13, color: colors.info }}>{msg}</div>}
          </Card>
        </>
      ) : null}
    </Page>
  );
}

function Field({ label: lbl, value }: { label: string; value: React.ReactNode }) {
  return (
    <div>
      <div style={{ fontSize: 11, textTransform: 'uppercase', letterSpacing: 0.3, color: colors.muted, fontWeight: 600 }}>{lbl}</div>
      <div style={{ fontSize: 14, marginTop: 2, color: colors.text }}>{value}</div>
    </div>
  );
}
