'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import { getHouseLedger, formatNaira } from '@/services/referralAdminService';
import type { HouseLedger } from '@/types/referralAdmin';
import { Page, PageHeader, Card, Button, Badge, colors, thCell, tdCell } from '@/components/ui/vuexy';

const REFERRAL_TABS = [
  { href: '/admin/referral/dashboard', label: 'Overview', key: 'dashboard' },
  { href: '/admin/referral/campaigns', label: 'Campaigns', key: 'campaigns' },
  { href: '/admin/referral/rewards', label: 'Rewards & Ledger', key: 'rewards' },
  { href: '/admin/referral/attribution', label: 'Attribution', key: 'attribution' },
  { href: '/admin/referral/house', label: 'House ledger', key: 'house' },
  { href: '/admin/referral/config', label: 'Config', key: 'config' },
];

function ReferralTabs({ active }: { active: string }) {
  return (
    <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 20 }}>
      {REFERRAL_TABS.map((t) => (
        <Link key={t.key} href={t.href} style={{
          textDecoration: 'none', padding: '6px 12px', borderRadius: 6, fontSize: 13, fontWeight: 600,
          color: active === t.key ? '#fff' : colors.text,
          background: active === t.key ? colors.primary : colors.headBg,
          border: `1px solid ${active === t.key ? colors.primary : colors.border}`,
        }}>{t.label}</Link>
      ))}
    </div>
  );
}

function timeAgo(isoStr: string): string {
  const diff = Date.now() - new Date(isoStr).getTime();
  const past = diff >= 0;
  const h = Math.floor(Math.abs(diff) / 3_600_000);
  if (h < 1) return 'just now';
  if (h < 24) return past ? `${h}h ago` : `in ${h}h`;
  const d = Math.floor(h / 24);
  return past ? `${d}d ago` : `in ${d}d`;
}

function statusColor(status: string): string {
  const s = status.toLowerCase();
  if (s === 'house') return colors.primary;
  if (['vesting'].includes(s)) return colors.primary;
  if (['active', 'approved', 'resolved', 'eligible', 'paid'].includes(s)) return colors.success;
  if (['closed', 'ended', 'draft'].includes(s)) return colors.secondary;
  if (['rejected', 'clawed_back', 'critical'].includes(s)) return colors.danger;
  if (['normal'].includes(s)) return colors.info;
  return colors.secondary;
}

function StatusBadge({ status, label: lbl }: { status: string; label?: string }) {
  return <Badge text={lbl ?? status.replace(/_/g, ' ')} color={statusColor(status)} />;
}

function Kpi({ label, value, sub, accent }: { label: string; value: string; sub?: string; accent?: string }) {
  return (
    <Card style={{ padding: '14px 16px' }}>
      <div style={{ fontSize: 11, textTransform: 'uppercase', letterSpacing: 0.5, color: colors.muted, fontWeight: 700 }}>{label}</div>
      <div style={{ fontSize: 22, fontWeight: 800, marginTop: 4, color: accent ?? colors.text }}>{value}</div>
      {sub ? <div style={{ fontSize: 12, color: colors.muted, marginTop: 2 }}>{sub}</div> : null}
    </Card>
  );
}

export default function HouseLedgerPage() {
  const [data, setData] = useState<HouseLedger | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  async function load() {
    setLoading(true); setError(null);
    try { setData(await getHouseLedger()); }
    catch (e) { setError(String(e)); }
    finally { setLoading(false); }
  }
  useEffect(() => { load(); }, []);

  return (
    <Page>
      <PageHeader
        title="House / system-account ledger"
        subtitle="A-USR-05 / §7A.2 — Super-Admin house capture of no-code signups. NON-WITHDRAWABLE, segmented from user payouts, excluded from override chains and K-factor."
        actions={<Button variant="outline" sm onClick={load}>Refresh</Button>}
      />
      <ReferralTabs active="house" />

      {loading ? (
        <p style={{ color: colors.muted }}>Loading…</p>
      ) : error ? (
        <p style={{ color: colors.danger }}>{error}</p>
      ) : !data ? (
        <p style={{ color: colors.muted }}>No house ledger data.</p>
      ) : (
        <>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 16 }}>
            <StatusBadge status="critical" label="Non-withdrawable" />
            <StatusBadge status="vesting" label="Excluded from override chains" />
            <StatusBadge status="vesting" label="Excluded from K-factor" />
            <StatusBadge status="house" label={data.budget_neutral ? 'Budget-neutral' : 'Funded house pool'} />
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(200px,1fr))', gap: 12, marginBottom: 20 }}>
            <Kpi label="House-attributed volume" value={data.total_house_volume.toLocaleString('en-NG')} sub="no-code signups captured" />
            <Kpi label="House-attributed value" value={formatNaira(data.total_house_value_kobo)} accent={colors.primary} />
            <Kpi label="House accounts" value={String(data.accounts.length)} />
            <Kpi label="Accounting mode" value={data.budget_neutral ? 'Budget-neutral' : 'Funded pool'} sub="set in Attribution config (§7A.2)" />
          </div>

          <Card title="System / house accounts" style={{ marginBottom: 20 }}>
            {data.accounts.length === 0 ? <p style={{ color: colors.muted }}>No house accounts configured.</p> : (
              <div style={{ overflowX: 'auto' }}>
                <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                  <thead><tr><th style={thCell}>Code</th><th style={thCell}>Scope</th><th style={thCell}>Region</th><th style={thCell}>Owner</th><th style={thCell}>Balance (notional)</th><th style={thCell}>Withdrawable</th></tr></thead>
                  <tbody>
                    {data.accounts.map((a) => (
                      <tr key={a.id}>
                        <td style={tdCell}><code style={{ fontSize: '0.8rem' }}>{a.code}</code></td>
                        <td style={tdCell}><StatusBadge status="normal" label={a.scope} /></td>
                        <td style={tdCell}>{a.region ?? '—'}</td>
                        <td style={tdCell}><code style={{ fontSize: '0.78rem' }}>{a.owner_user_id}</code></td>
                        <td style={tdCell}>{formatNaira(a.balance_kobo)}</td>
                        <td style={tdCell}><StatusBadge status={a.non_withdrawable ? 'critical' : 'active'} label={a.non_withdrawable ? 'No (notional)' : 'Yes'} /></td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </Card>

          <Card title="House-attributed reward entries">
            {data.entries.length === 0 ? <p style={{ color: colors.muted }}>No house-attributed rewards yet.</p> : (
              <div style={{ overflowX: 'auto' }}>
                <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                  <thead><tr><th style={thCell}>ID</th><th style={thCell}>Referred user</th><th style={thCell}>Kind</th><th style={thCell}>Amount</th><th style={thCell}>State</th><th style={thCell}>Captured</th></tr></thead>
                  <tbody>
                    {data.entries.map((e) => (
                      <tr key={e.id}>
                        <td style={tdCell}><code style={{ fontSize: '0.76rem' }}>{e.id}</code></td>
                        <td style={tdCell}><code style={{ fontSize: '0.78rem' }}>{e.referred_user_id ?? '—'}</code></td>
                        <td style={tdCell}><StatusBadge status="normal" label={e.kind} /></td>
                        <td style={tdCell}>{formatNaira(e.amount_kobo)}</td>
                        <td style={tdCell}><StatusBadge status={e.state} /></td>
                        <td style={tdCell}>{timeAgo(e.created_at)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </Card>
        </>
      )}
    </Page>
  );
}
