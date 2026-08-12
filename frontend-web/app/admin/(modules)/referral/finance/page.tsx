'use client';

import { useEffect, useState } from 'react';
import { listPayouts, approvePayout, getBudgetBurn, formatNaira } from '@/services/referralAdminOpsService';
import type { Payout, BudgetBurn } from '@/types/referralAdminOps';
import { Page, PageHeader, Card, Button, Badge, colors, thCell, tdCell } from '@/components/ui/vuexy';

const STATUSES = ['all', 'pending', 'approved', 'paid', 'on_hold', 'rejected'];

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
  if (['active', 'approved', 'resolved', 'eligible', 'paid'].includes(s)) return colors.success;
  if (['closed', 'ended', 'draft'].includes(s)) return colors.secondary;
  if (['rejected', 'clawed_back', 'critical'].includes(s)) return colors.danger;
  if (['open', 'pending', 'high'].includes(s)) return colors.warning;
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
    <Page>
      <PageHeader
        title="Finance — Payout queue & approvals"
        subtitle="Approve & track reward payouts to wallets (A-FIN-01). Every approval requires an Idempotency-Key, posts balanced ledger entries and emits an audit event."
        actions={<Button variant="outline" sm onClick={load}>Refresh</Button>}
      />

      {budget && (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(190px,1fr))', gap: 12, marginBottom: 20 }}>
          <Kpi label="Reward budget" value={formatNaira(budget.program_budget_kobo)} />
          <Kpi label="Spent / burn" value={formatNaira(budget.program_spent_kobo)} sub={`${Math.round((budget.program_spent_kobo / Math.max(budget.program_budget_kobo, 1)) * 100)}% of budget`} accent={budget.program_spent_kobo / budget.program_budget_kobo > 0.8 ? colors.warning : undefined} />
          <Kpi label="Reward-to-LTV (A-FIN-04)" value={ltv} sub={`Cap ${budget.reward_to_ltv_cap_pct}%`} accent={budget.reward_to_ltv_ratio * 100 > budget.reward_to_ltv_cap_pct ? colors.danger : colors.success} />
        </div>
      )}

      <Card title="Payout queue">
        <div style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: 12 }}>
          <select value={status} onChange={(e) => setStatus(e.target.value)}>
            {STATUSES.map((s) => <option key={s} value={s}>{s === 'all' ? 'All statuses' : s.replace(/_/g, ' ')}</option>)}
          </select>
        </div>
        {loading ? (
          <p style={{ color: colors.muted }}>Loading…</p>
        ) : error ? (
          <p style={{ color: colors.danger }}>{error}</p>
        ) : !rows || rows.length === 0 ? (
          <p style={{ color: colors.muted }}>No payouts in this state.</p>
        ) : (
          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse' }}>
              <thead><tr>
                <th style={thCell}>Beneficiary</th><th style={thCell}>Amount</th><th style={thCell}>Rewards</th>
                <th style={thCell}>Risk</th><th style={thCell}>Status</th><th style={thCell}>Requested</th><th style={thCell} />
              </tr></thead>
              <tbody>
                {rows.map((p) => (
                  <tr key={p.id}>
                    <td style={tdCell}>{p.beneficiary_name}<br /><code style={{ fontSize: '0.72rem', color: colors.muted }}>{p.beneficiary_id}</code></td>
                    <td style={tdCell}><strong>{formatNaira(p.amount_kobo)}</strong></td>
                    <td style={tdCell}>{p.reward_ids.length}</td>
                    <td style={tdCell}><StatusBadge status={p.risk_flag} /></td>
                    <td style={tdCell}><StatusBadge status={p.status} /></td>
                    <td style={tdCell}>{timeAgo(p.requested_at)}</td>
                    <td style={tdCell}>
                      {p.status === 'pending'
                        ? <Button variant="primary" sm disabled={busy === p.id} onClick={() => approve(p)}>{busy === p.id ? '…' : 'Approve'}</Button>
                        : <span style={{ fontSize: '0.78rem', color: colors.muted }}>{p.approved_by ? `by ${p.approved_by}` : '—'}</span>}
                    </td>
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
