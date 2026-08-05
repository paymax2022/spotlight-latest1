'use client';

// A4 — Referral Ledger & Reconciliation. Every referral_rewards row, filterable by
// status / module / referrer, exportable to CSV for finance reconciliation.
// RBAC: referral.admin.ledger (Finance).

import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { getLedger, formatNaira, formatPct } from '@/services/referralRewardsAdminService';
import type { Reward } from '@/types/referralRewardsAdmin';
import { Page, PageHeader, Card, Button, Input, Badge, colors, tint, thCell, tdCell } from '@/components/ui/vuexy';

const STATUSES = ['all', 'PENDING', 'CREDITED', 'REVERSED'];

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
  reversed: colors.danger,
};
function statusColor(status: string): string {
  return STATUS_BADGE[status.toLowerCase()] ?? colors.secondary;
}
function statusLabel(status: string): string {
  return status.replace(/_/g, ' ').toLowerCase();
}

export default function ReferralRewardsLedgerPage() {
  const [rows, setRows] = useState<Reward[]>([]);
  const [status, setStatus] = useState('all');
  const [moduleFilter, setModuleFilter] = useState('all');
  const [referrer, setReferrer] = useState('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  async function load() {
    setLoading(true); setError(null);
    try { setRows(await getLedger({ status, module: moduleFilter, limit: 500, offset: 0 })); }
    catch (e) { setError(String(e)); }
    finally { setLoading(false); }
  }
  useEffect(() => { load(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [status, moduleFilter]);

  const modules = useMemo(() => ['all', ...Array.from(new Set(rows.map((r) => r.module)))], [rows]);
  const filtered = useMemo(
    () => (referrer.trim() ? rows.filter((r) => r.referrer_id.includes(referrer.trim())) : rows),
    [rows, referrer],
  );

  function exportCsv() {
    const header = ['id', 'referrer_id', 'referred_user_id', 'source_transaction_id', 'module', 'margin_amount_kobo', 'applied_rate', 'reward_amount_kobo', 'status', 'created_at', 'credited_at', 'reversed_at'];
    const esc = (v: unknown) => `"${String(v ?? '').replace(/"/g, '""')}"`;
    const body = filtered.map((r) => header.map((h) => esc((r as unknown as Record<string, unknown>)[h])).join(',')).join('\n');
    const blob = new Blob([`${header.join(',')}\n${body}`], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = `referral-rewards-ledger-${new Date().toISOString().slice(0, 10)}.csv`;
    a.click(); URL.revokeObjectURL(url);
  }

  return (
    <Page>
      <PageHeader
        title="Referral Ledger & Reconciliation"
        subtitle="Full audit trail of every reward row (PENDING → CREDITED, or REVERSED on refund). Filter and export to CSV for finance reconciliation. (A4)"
        actions={<Button variant="outline" onClick={load}>Refresh</Button>}
      />
      <RewardsTabs active="ledger" />

      <Card style={{ marginBottom: 16 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12, gap: 8, flexWrap: 'wrap' }}>
          <h2 style={{ margin: 0, fontSize: 16, fontWeight: 700, color: colors.text }}>Filters</h2>
          <Button variant="outline" sm onClick={exportCsv}>Export CSV</Button>
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(200px,1fr))', gap: 12 }}>
          <div>
            <label style={{ display: 'block', fontSize: 12, fontWeight: 600, color: colors.text, marginBottom: 4 }}>Status</label>
            <select value={status} onChange={(e) => setStatus(e.target.value)}>
              {STATUSES.map((s) => <option key={s} value={s}>{s === 'all' ? 'All' : s}</option>)}
            </select>
          </div>
          <div>
            <label style={{ display: 'block', fontSize: 12, fontWeight: 600, color: colors.text, marginBottom: 4 }}>Module</label>
            <select value={moduleFilter} onChange={(e) => setModuleFilter(e.target.value)}>
              {modules.map((m) => <option key={m} value={m}>{m === 'all' ? 'All' : m}</option>)}
            </select>
          </div>
          <div>
            <label style={{ display: 'block', fontSize: 12, fontWeight: 600, color: colors.text, marginBottom: 4 }}>Referrer ID (contains)</label>
            <Input value={referrer} onChange={(e) => setReferrer(e.target.value)} placeholder="usr_…" />
          </div>
        </div>
      </Card>

      <Card title={`Rewards (${filtered.length})`}>
        {loading ? (
          <p style={{ color: colors.muted, marginTop: 12 }}>Loading…</p>
        ) : error ? (
          <p style={{ color: colors.danger, marginTop: 12 }}>{error}</p>
        ) : filtered.length === 0 ? (
          <p style={{ color: colors.muted, marginTop: 12 }}>No reward rows match these filters.</p>
        ) : (
          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: 900, marginTop: 12 }}>
              <thead><tr>
                <th style={thCell}>Reward</th><th style={thCell}>Referrer</th><th style={thCell}>Referred</th><th style={thCell}>Source txn</th>
                <th style={thCell}>Module</th><th style={thCell}>Margin</th><th style={thCell}>Rate</th><th style={thCell}>Reward</th><th style={thCell}>Status</th>
              </tr></thead>
              <tbody>
                {filtered.map((r) => (
                  <tr key={r.id}>
                    <td style={tdCell}><code style={{ fontSize: 12 }}>{r.id}</code></td>
                    <td style={tdCell}><code style={{ fontSize: 12 }}>{r.referrer_id}</code></td>
                    <td style={tdCell}><code style={{ fontSize: 12 }}>{r.referred_user_id}</code></td>
                    <td style={tdCell}><code style={{ fontSize: 12 }}>{r.source_transaction_id}</code></td>
                    <td style={{ ...tdCell, textTransform: 'capitalize' }}>{r.module}</td>
                    <td style={tdCell}>{formatNaira(r.margin_amount_kobo)}</td>
                    <td style={tdCell}>{formatPct(r.applied_rate)}</td>
                    <td style={tdCell}><strong>{formatNaira(r.reward_amount_kobo)}</strong></td>
                    <td style={tdCell}><Badge text={statusLabel(r.status)} color={statusColor(r.status)} /></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>
    </Page>
  );
}
