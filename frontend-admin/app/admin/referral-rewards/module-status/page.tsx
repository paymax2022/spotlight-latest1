'use client';

// A7 — Module Integration Status. Per-module last-event timestamp + volume, with a
// quiet-alert when a module hasn't emitted PurchaseSettled recently — catches a
// silently-broken integration before it costs referrers their rewards.
// RBAC: referral.admin.module (Engineering / Platform).

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { getModuleStatus, formatNaira } from '@/services/referralRewardsAdminService';
import type { ModuleStatus } from '@/types/referralRewardsAdmin';
import { Page, PageHeader, Card, Button, Badge, colors, tint, thCell, tdCell } from '@/components/ui/vuexy';
import { timeAgo } from '../_ui';

// A module is "quiet" if its last PurchaseSettled event is older than this.
const QUIET_THRESHOLD_HOURS = 24;

function isQuiet(lastEventAt: string | null): boolean {
  if (!lastEventAt) return true;
  return Date.now() - new Date(lastEventAt).getTime() > QUIET_THRESHOLD_HOURS * 3_600_000;
}

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
    <Page>
      <PageHeader
        title="Module Integration Status"
        subtitle={`Which revenue modules are correctly emitting PurchaseSettled events into the Referral Reward Engine. A module going quiet (> ${QUIET_THRESHOLD_HOURS}h without an event) is flagged so a silently-broken integration is caught early. (A7)`}
        actions={<Button variant="outline" onClick={load}>Refresh</Button>}
      />
      <RewardsTabs active="module-status" />

      {quietCount > 0 && (
        <div style={{ border: `1px solid ${colors.danger}`, background: tint(colors.danger, 0.08), color: colors.danger, borderRadius: 8, padding: '11px 14px', fontSize: 13, marginBottom: 20 }}>
          <strong>{quietCount}</strong> module{quietCount > 1 ? 's have' : ' has'} gone quiet ({'>'} {QUIET_THRESHOLD_HOURS}h without a PurchaseSettled event). Investigate the integration before referrers lose rewards.
        </div>
      )}

      <Card title={`Modules (${rows.length})`}>
        {loading ? (
          <p style={{ color: colors.muted, marginTop: 12 }}>Loading…</p>
        ) : error ? (
          <p style={{ color: colors.danger, marginTop: 12 }}>{error}</p>
        ) : rows.length === 0 ? (
          <p style={{ color: colors.muted, marginTop: 12 }}>No modules have emitted events yet.</p>
        ) : (
          <table style={{ width: '100%', borderCollapse: 'collapse', marginTop: 12 }}>
            <thead><tr><th style={thCell}>Module</th><th style={thCell}>Reward volume</th><th style={thCell}>Reward count</th><th style={thCell}>Last event</th><th style={thCell}>Health</th></tr></thead>
            <tbody>
              {rows.map((m) => {
                const quiet = isQuiet(m.last_event_at);
                return (
                  <tr key={m.module}>
                    <td style={tdCell}><strong style={{ textTransform: 'capitalize' }}>{m.module}</strong></td>
                    <td style={tdCell}>{formatNaira(m.reward_kobo)}</td>
                    <td style={tdCell}>{m.reward_count.toLocaleString()}</td>
                    <td style={{ ...tdCell, color: colors.muted }}>{timeAgo(m.last_event_at)}</td>
                    <td style={tdCell}><Badge text={quiet ? 'Quiet' : 'Healthy'} color={quiet ? colors.danger : colors.success} /></td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </Card>
    </Page>
  );
}
