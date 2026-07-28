'use client';

// A7 — Module Integration Status. Per-module last-event timestamp + volume, with a
// quiet-alert when a module hasn't emitted PurchaseSettled recently — catches a
// silently-broken integration before it costs referrers their rewards.
// RBAC: referral.admin.module (Engineering / Platform).

import { useEffect, useState } from 'react';
import { getModuleStatus, formatNaira } from '@/services/referralRewardsAdminService';
import type { ModuleStatus } from '@/types/referralRewardsAdmin';
import { PageHeader, RewardsTabs, Card, Badge, StateBlock, btn, th, td, timeAgo } from '../_ui';

// A module is "quiet" if its last PurchaseSettled event is older than this.
const QUIET_THRESHOLD_HOURS = 24;

function isQuiet(lastEventAt: string | null): boolean {
  if (!lastEventAt) return true;
  return Date.now() - new Date(lastEventAt).getTime() > QUIET_THRESHOLD_HOURS * 3_600_000;
}

export default function ReferralRewardsModuleStatusPage() {
  const [rows, setRows] = useState<ModuleStatus[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  async function load() {
    setLoading(true); setError(null);
    try { setRows(await getModuleStatus()); }
    catch (e) { setError(String(e)); }
    finally { setLoading(false); }
  }
  useEffect(() => { load(); }, []);

  const quietCount = rows.filter((r) => isQuiet(r.last_event_at)).length;

  return (
    <div style={{ padding: '0.5rem 0.5rem 2rem' }}>
      <PageHeader
        title="Module Integration Status"
        subtitle={`Which revenue modules are correctly emitting PurchaseSettled events into the Referral Reward Engine. A module going quiet (> ${QUIET_THRESHOLD_HOURS}h without an event) is flagged so a silently-broken integration is caught early. (A7)`}
        action={<button onClick={load} style={btn()}>Refresh</button>}
      />
      <RewardsTabs active="module-status" />

      {quietCount > 0 && (
        <div style={{ border: '1px solid #fca5a5', background: '#fef2f2', color: '#b91c1c', borderRadius: '0.5rem', padding: '0.7rem 0.9rem', fontSize: '0.85rem', marginBottom: '1.25rem' }}>
          <strong>{quietCount}</strong> module{quietCount > 1 ? 's have' : ' has'} gone quiet ({'>'} {QUIET_THRESHOLD_HOURS}h without a PurchaseSettled event). Investigate the integration before referrers lose rewards.
        </div>
      )}

      <Card title={`Modules (${rows.length})`}>
        <StateBlock loading={loading} error={error} empty={rows.length === 0} emptyText="No modules have emitted events yet.">
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead><tr><th style={th()}>Module</th><th style={th()}>Reward volume</th><th style={th()}>Reward count</th><th style={th()}>Last event</th><th style={th()}>Health</th></tr></thead>
            <tbody>
              {rows.map((m) => {
                const quiet = isQuiet(m.last_event_at);
                return (
                  <tr key={m.module}>
                    <td style={td()}><strong style={{ textTransform: 'capitalize' }}>{m.module}</strong></td>
                    <td style={td()}>{formatNaira(m.reward_kobo)}</td>
                    <td style={td()}>{m.reward_count.toLocaleString()}</td>
                    <td style={{ ...td(), color: '#6b7280' }}>{timeAgo(m.last_event_at)}</td>
                    <td style={td()}><Badge status={quiet ? 'voided' : 'active'} label={quiet ? 'Quiet' : 'Healthy'} /></td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </StateBlock>
      </Card>
    </div>
  );
}
