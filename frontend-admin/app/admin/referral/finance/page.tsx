'use client';

import { useEffect, useState } from 'react';
import { listPayouts, approvePayout, getBudgetBurn, formatNaira } from '@/services/referralAdminOpsService';
import type { Payout, BudgetBurn } from '@/types/referralAdminOps';
import { PageHeader, Card, Kpi, Badge, btn, btnPrimary, th, td, timeAgo, StateBlock } from '../_ui';

const STATUSES = ['all', 'pending', 'approved', 'paid', 'on_hold', 'rejected'];

export default function FinancePayoutsPage() {
  const [rows, setRows] = useState<Payout[] | null>(null);
  const [budget, setBudget] = useState<BudgetBurn | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [status, setStatus] = useState('pending');
  const [busy, setBusy] = useState<string | null>(null);

  async function load() {
    setLoading(true); setError(null);
    try {
      const [p, b] = await Promise.all([listPayouts(status), getBudgetBurn()]);
      setRows(p); setBudget(b);
    } catch (e) { setError(String(e)); }
    finally { setLoading(false); }
  }
  useEffect(() => { load(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [status]);

  async function approve(p: Payout) {
    setBusy(p.id);
    try {
      await approvePayout(p.id, 'Approved from payout queue');
      setRows((cur) => (cur ?? []).map((r) => r.id === p.id ? { ...r, status: 'approved', approved_by: 'you', approved_at: new Date().toISOString() } : r));
    } catch (e) { setError(String(e)); }
    finally { setBusy(null); }
  }

  const ltv = budget ? `${(budget.reward_to_ltv_ratio * 100).toFixed(1)}%` : '—';

  return (
    <div style={{ padding: '0.5rem 0.5rem 2rem' }}>
      <PageHeader
        title="Finance — Payout queue & approvals"
        subtitle="Approve & track reward payouts to wallets (A-FIN-01). Every approval requires an Idempotency-Key, posts balanced ledger entries and emits an audit event."
        action={<button onClick={load} style={btn()}>Refresh</button>}
      />

      {budget && (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(190px,1fr))', gap: '0.75rem', marginBottom: '1.25rem' }}>
          <Kpi label="Reward budget" value={formatNaira(budget.program_budget_kobo)} />
          <Kpi label="Spent / burn" value={formatNaira(budget.program_spent_kobo)} sub={`${Math.round((budget.program_spent_kobo / Math.max(budget.program_budget_kobo, 1)) * 100)}% of budget`} accent={budget.program_spent_kobo / budget.program_budget_kobo > 0.8 ? '#9a3412' : undefined} />
          <Kpi label="Reward-to-LTV (A-FIN-04)" value={ltv} sub={`Cap ${budget.reward_to_ltv_cap_pct}%`} accent={budget.reward_to_ltv_ratio * 100 > budget.reward_to_ltv_cap_pct ? '#b91c1c' : '#15803d'} />
        </div>
      )}

      <Card title="Payout queue" right={
        <select value={status} onChange={(e) => setStatus(e.target.value)} style={{ ...btn(), cursor: 'pointer' }}>
          {STATUSES.map((s) => <option key={s} value={s}>{s === 'all' ? 'All statuses' : s.replace(/_/g, ' ')}</option>)}
        </select>
      }>
        <StateBlock loading={loading} error={error} empty={!rows || rows.length === 0} emptyText="No payouts in this state.">
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead><tr>
              <th style={th()}>Beneficiary</th><th style={th()}>Amount</th><th style={th()}>Rewards</th>
              <th style={th()}>Risk</th><th style={th()}>Status</th><th style={th()}>Requested</th><th style={th()} />
            </tr></thead>
            <tbody>
              {(rows ?? []).map((p) => (
                <tr key={p.id}>
                  <td style={td()}>{p.beneficiary_name}<br /><code style={{ fontSize: '0.72rem', color: '#9ca3af' }}>{p.beneficiary_id}</code></td>
                  <td style={td()}><strong>{formatNaira(p.amount_kobo)}</strong></td>
                  <td style={td()}>{p.reward_ids.length}</td>
                  <td style={td()}><Badge status={p.risk_flag} /></td>
                  <td style={td()}><Badge status={p.status} /></td>
                  <td style={td()}>{timeAgo(p.requested_at)}</td>
                  <td style={td()}>
                    {p.status === 'pending'
                      ? <button disabled={busy === p.id} onClick={() => approve(p)} style={btnPrimary()}>{busy === p.id ? '…' : 'Approve'}</button>
                      : <span style={{ fontSize: '0.78rem', color: '#9ca3af' }}>{p.approved_by ? `by ${p.approved_by}` : '—'}</span>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </StateBlock>
      </Card>
    </div>
  );
}
