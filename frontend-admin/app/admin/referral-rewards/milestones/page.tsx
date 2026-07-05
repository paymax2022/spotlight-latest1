'use client';

// A6 — Milestone Payout Log. Chronological view of the one-time bonus payouts,
// tracked separately from the high-volume ongoing-share ledger.
// RBAC: referral.admin.milestones (Finance).

import { useEffect, useState } from 'react';
import { getMilestonesLog, formatNaira } from '@/services/referralRewardsAdminService';
import type { MilestonePayout } from '@/types/referralRewardsAdmin';
import { PageHeader, RewardsTabs, Card, Badge, StateBlock, btn, th, td, timeAgo } from '../_ui';

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
    <div style={{ padding: '0.5rem 0.5rem 2rem' }}>
      <PageHeader
        title="Milestone Payout Log"
        subtitle="The one-time bonus payouts (10 / 50 / 250 / 1,000 active referrals) — larger, less frequent, and tracked separately from the ongoing-share ledger. (A6)"
        action={<button onClick={load} style={btn()}>Refresh</button>}
      />
      <RewardsTabs active="milestones" />

      <Card title={`Milestone payouts (${rows.length})`}>
        <StateBlock loading={loading} error={error} empty={rows.length === 0} emptyText="No milestone payouts recorded yet.">
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead><tr><th style={th()}>Payout</th><th style={th()}>Referrer</th><th style={th()}>Threshold</th><th style={th()}>Bonus</th><th style={th()}>Status</th><th style={th()}>Achieved</th><th style={th()}>Paid</th></tr></thead>
            <tbody>
              {rows.map((m) => (
                <tr key={m.id}>
                  <td style={td()}><code style={{ fontSize: '0.76rem' }}>{m.id}</code></td>
                  <td style={td()}><code style={{ fontSize: '0.76rem' }}>{m.referrer_id}</code></td>
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
    </div>
  );
}
