'use client';

// A4 — Referral Ledger & Reconciliation. Every referral_rewards row, filterable by
// status / module / referrer, exportable to CSV for finance reconciliation.
// RBAC: referral.admin.ledger (Finance).

import { useEffect, useMemo, useState } from 'react';
import { getLedger, formatNaira, formatPct } from '@/services/referralRewardsAdminService';
import type { Reward } from '@/types/referralRewardsAdmin';
import { PageHeader, RewardsTabs, Card, Badge, StateBlock, btn, th, td, input, label } from '../_ui';

const STATUSES = ['all', 'PENDING', 'CREDITED', 'REVERSED'];

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
    <div style={{ padding: '0.5rem 0.5rem 2rem' }}>
      <PageHeader
        title="Referral Ledger & Reconciliation"
        subtitle="Full audit trail of every reward row (PENDING → CREDITED, or REVERSED on refund). Filter and export to CSV for finance reconciliation. (A4)"
        action={<button onClick={load} style={btn()}>Refresh</button>}
      />
      <RewardsTabs active="ledger" />

      <Card title="Filters" right={<button onClick={exportCsv} style={btn()}>Export CSV</button>}>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(200px,1fr))', gap: '0.75rem' }}>
          <div>
            <label style={label()}>Status</label>
            <select style={input()} value={status} onChange={(e) => setStatus(e.target.value)}>
              {STATUSES.map((s) => <option key={s} value={s}>{s === 'all' ? 'All' : s}</option>)}
            </select>
          </div>
          <div>
            <label style={label()}>Module</label>
            <select style={input()} value={moduleFilter} onChange={(e) => setModuleFilter(e.target.value)}>
              {modules.map((m) => <option key={m} value={m}>{m === 'all' ? 'All' : m}</option>)}
            </select>
          </div>
          <div>
            <label style={label()}>Referrer ID (contains)</label>
            <input style={input()} value={referrer} onChange={(e) => setReferrer(e.target.value)} placeholder="usr_…" />
          </div>
        </div>
      </Card>

      <Card title={`Rewards (${filtered.length})`}>
        <StateBlock loading={loading} error={error} empty={filtered.length === 0} emptyText="No reward rows match these filters.">
          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: 900 }}>
              <thead><tr>
                <th style={th()}>Reward</th><th style={th()}>Referrer</th><th style={th()}>Referred</th><th style={th()}>Source txn</th>
                <th style={th()}>Module</th><th style={th()}>Margin</th><th style={th()}>Rate</th><th style={th()}>Reward</th><th style={th()}>Status</th>
              </tr></thead>
              <tbody>
                {filtered.map((r) => (
                  <tr key={r.id}>
                    <td style={td()}><code style={{ fontSize: '0.76rem' }}>{r.id}</code></td>
                    <td style={td()}><code style={{ fontSize: '0.76rem' }}>{r.referrer_id}</code></td>
                    <td style={td()}><code style={{ fontSize: '0.76rem' }}>{r.referred_user_id}</code></td>
                    <td style={td()}><code style={{ fontSize: '0.76rem' }}>{r.source_transaction_id}</code></td>
                    <td style={{ ...td(), textTransform: 'capitalize' }}>{r.module}</td>
                    <td style={td()}>{formatNaira(r.margin_amount_kobo)}</td>
                    <td style={td()}>{formatPct(r.applied_rate)}</td>
                    <td style={td()}><strong>{formatNaira(r.reward_amount_kobo)}</strong></td>
                    <td style={td()}><Badge status={r.status} /></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </StateBlock>
      </Card>
    </div>
  );
}
