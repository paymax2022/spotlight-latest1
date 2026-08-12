'use client';

// A6 — Milestone Payout Log. Chronological view of the one-time bonus payouts,
// tracked separately from the high-volume ongoing-share ledger.
// RBAC: referral.admin.milestones (Finance).

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { getMilestonesLog, formatNaira } from '@/services/referralRewardsAdminService';
import type { MilestonePayout } from '@/types/referralRewardsAdmin';
import { Page, PageHeader, Card, Button, Badge, colors, tint, thCell, tdCell } from '@/components/ui/vuexy';
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
  paid: colors.success,
  achieved: colors.info,
  voided: colors.danger,
};
function statusColor(status: string): string {
  return STATUS_BADGE[status.toLowerCase()] ?? colors.secondary;
}
function statusLabel(status: string): string {
  return status.replace(/_/g, ' ').toLowerCase();
}

export default function ReferralRewardsMilestonesPage() {
  const [rows, setRows] = useState<MilestonePayout[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  async function load() {
    setLoading(true); setError(null);
    try { setRows(await getMilestonesLog(100, 0)); }
    catch (e) { setError(String(e)); }
    finally { setLoading(false); }
  }
  useEffect(() => { load(); }, []);

  return (
    <Page>
      <PageHeader
        title="Milestone Payout Log"
        subtitle="The one-time bonus payouts (10 / 50 / 250 / 1,000 active referrals) — larger, less frequent, and tracked separately from the ongoing-share ledger. (A6)"
        actions={<Button variant="outline" onClick={load}>Refresh</Button>}
      />
      <RewardsTabs active="milestones" />

      <Card title={`Milestone payouts (${rows.length})`}>
        {loading ? (
          <p style={{ color: colors.muted, marginTop: 12 }}>Loading…</p>
        ) : error ? (
          <p style={{ color: colors.danger, marginTop: 12 }}>{error}</p>
        ) : rows.length === 0 ? (
          <p style={{ color: colors.muted, marginTop: 12 }}>No milestone payouts recorded yet.</p>
        ) : (
          <table style={{ width: '100%', borderCollapse: 'collapse', marginTop: 12 }}>
            <thead><tr><th style={thCell}>Payout</th><th style={thCell}>Referrer</th><th style={thCell}>Threshold</th><th style={thCell}>Bonus</th><th style={thCell}>Status</th><th style={thCell}>Achieved</th><th style={thCell}>Paid</th></tr></thead>
            <tbody>
              {rows.map((m) => (
                <tr key={m.id}>
                  <td style={tdCell}><code style={{ fontSize: 12 }}>{m.id}</code></td>
                  <td style={tdCell}><code style={{ fontSize: 12 }}>{m.referrer_id}</code></td>
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
    </Page>
  );
}
