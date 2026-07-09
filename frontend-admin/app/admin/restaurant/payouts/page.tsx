'use client';

import { Fragment, useCallback, useEffect, useState } from 'react';
import { listPayoutRuns, getPayoutLines, processPayoutRun } from '@/services/restaurantAdminService';
import type { PayoutRun, PayoutLine, PayeeType } from '@/types/restaurantAdmin';
import {
  PageHeader,
  Card,
  Kpi,
  Badge,
  btn,
  th,
  td,
  naira,
  RESTAURANT_PERMS,
  useRestaurantPermissions,
  AccessNotice,
} from '../_ui';

const PAYEE_FILTERS: (PayeeType | '')[] = ['', 'restaurant', 'rider'];

const RUN_BADGE: Record<string, string> = {
  draft: 'placed',
  pending: 'preparing',
  processing: 'assigned',
  paid: 'delivered',
  failed: 'no_rider',
};

export default function PayoutsPage() {
  const { can } = useRestaurantPermissions();
  const canView = can(RESTAURANT_PERMS.payouts) || can(RESTAURANT_PERMS.manage);
  const canProcess = can(RESTAURANT_PERMS.payouts);

  const [runs, setRuns] = useState<PayoutRun[]>([]);
  const [payee, setPayee] = useState<PayeeType | ''>('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [expanded, setExpanded] = useState<string | null>(null);
  const [lines, setLines] = useState<PayoutLine[]>([]);
  const [linesLoading, setLinesLoading] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);

  const load = useCallback(async (p: PayeeType | '') => {
    setLoading(true);
    setError(null);
    try {
      setRuns(await listPayoutRuns(p));
    } catch (e) {
      setError(String(e));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load(payee);
  }, [payee, load]);

  async function toggle(runId: string) {
    if (expanded === runId) { setExpanded(null); return; }
    setExpanded(runId);
    setLinesLoading(true);
    try {
      setLines(await getPayoutLines(runId));
    } catch (e) {
      setError(String(e));
    } finally {
      setLinesLoading(false);
    }
  }

  async function onProcess(runId: string) {
    setBusy(runId);
    setError(null);
    setMessage(null);
    try {
      await processPayoutRun(runId);
      setMessage(`Payout run ${runId} submitted for processing.`);
      await load(payee);
    } catch (e) {
      setError(String(e));
    } finally {
      setBusy(null);
    }
  }

  const pendingTotal = runs.filter((r) => r.status === 'pending').reduce((s, r) => s + r.total_net_kobo, 0);
  const unreconciled = runs.filter((r) => r.reconciled === false).length;

  if (!canView) {
    return (
      <div style={{ padding: '0.5rem 0.5rem 2rem' }}>
        <PageHeader title="Payouts" />
        <AccessNotice perm="restaurant.admin.payouts" />
      </div>
    );
  }

  return (
    <div style={{ padding: '0.5rem 0.5rem 2rem' }}>
      <PageHeader
        title="Restaurant & Rider Payouts"
        subtitle="Payout runs and ledger reconciliation. Net amounts are the disbursable settlement per payee."
        action={<button onClick={() => void load(payee)} style={btn()}>Refresh</button>}
      />

      {error && <p style={{ color: '#dc2626' }}>{error}</p>}
      {message && <p style={{ color: '#16a34a' }}>{message}</p>}

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(190px, 1fr))', gap: '0.75rem', marginBottom: '1.25rem' }}>
        <Kpi label="Runs" value={String(runs.length)} />
        <Kpi label="Pending net" value={naira(pendingTotal)} accent="#d97706" sub="awaiting processing" />
        <Kpi label="Unreconciled" value={String(unreconciled)} accent={unreconciled ? '#dc2626' : '#16a34a'} sub="net ≠ ledger-settled" />
      </div>

      <div style={{ display: 'flex', gap: 6, margin: '0 0 1rem', flexWrap: 'wrap' }}>
        {PAYEE_FILTERS.map((p) => (
          <button
            key={p || 'all'}
            onClick={() => setPayee(p)}
            style={{ ...btn(), ...(payee === p ? { background: '#340075', color: '#fff', borderColor: '#340075' } : {}) }}
          >
            {p || 'All payees'}
          </button>
        ))}
      </div>

      <Card title="Payout runs">
        {loading ? (
          <p style={{ color: '#6b7280' }}>Loading…</p>
        ) : runs.length === 0 ? (
          <p style={{ color: '#6b7280' }}>No payout runs for this filter.</p>
        ) : (
          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.85rem' }}>
              <thead>
                <tr>
                  <th style={th()}>Run</th>
                  <th style={th()}>Payee type</th>
                  <th style={th()}>Period</th>
                  <th style={th()}>Lines</th>
                  <th style={th()}>Net total</th>
                  <th style={th()}>Reconciliation</th>
                  <th style={th()}>Status</th>
                  <th style={th()}></th>
                </tr>
              </thead>
              <tbody>
                {runs.map((r) => (
                  <Fragment key={r.id}>
                    <tr>
                      <td style={td()} title={r.id}>{r.id}</td>
                      <td style={td()}>{r.payee_type}</td>
                      <td style={td()}>{r.period_start} → {r.period_end}</td>
                      <td style={td()}>{r.lines_count}</td>
                      <td style={td()}><strong>{naira(r.total_net_kobo)}</strong></td>
                      <td style={td()}>
                        {r.reconciled === false ? (
                          <span style={{ color: '#dc2626' }}>
                            off by {naira((r.ledger_settled_kobo ?? 0) - r.total_net_kobo)}
                          </span>
                        ) : (
                          <Badge status="delivered" label="reconciled" />
                        )}
                      </td>
                      <td style={td()}><Badge status={RUN_BADGE[r.status]} label={r.status} /></td>
                      <td style={td()}>
                        <div style={{ display: 'flex', gap: 6 }}>
                          <button onClick={() => void toggle(r.id)} style={btn()}>{expanded === r.id ? 'Hide' : 'Lines'}</button>
                          {r.status === 'pending' && (
                            <button
                              disabled={!canProcess || busy === r.id || r.reconciled === false}
                              title={!canProcess ? 'Requires restaurant.admin.payouts' : r.reconciled === false ? 'Reconcile before processing' : 'Process this run'}
                              onClick={() => void onProcess(r.id)}
                              style={{ ...btn(), background: r.reconciled === false ? '#fff' : '#340075', color: r.reconciled === false ? '#9ca3af' : '#fff', borderColor: r.reconciled === false ? '#d1d5db' : '#340075' }}
                            >
                              {busy === r.id ? '…' : 'Process'}
                            </button>
                          )}
                        </div>
                      </td>
                    </tr>
                    {expanded === r.id && (
                      <tr>
                        <td style={{ ...td(), background: '#f9fafb' }} colSpan={8}>
                          {linesLoading ? (
                            <span style={{ color: '#6b7280' }}>Loading lines…</span>
                          ) : lines.length === 0 ? (
                            <span style={{ color: '#6b7280' }}>No lines.</span>
                          ) : (
                            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.8rem' }}>
                              <thead>
                                <tr>
                                  <th style={th()}>Payee</th>
                                  <th style={th()}>Orders</th>
                                  <th style={th()}>Gross</th>
                                  <th style={th()}>Fees</th>
                                  <th style={th()}>Net</th>
                                  <th style={th()}>Bank</th>
                                </tr>
                              </thead>
                              <tbody>
                                {lines.map((l) => (
                                  <tr key={l.id}>
                                    <td style={td()}>{l.payee_name}</td>
                                    <td style={td()}>{l.orders_count}</td>
                                    <td style={td()}>{naira(l.gross_kobo)}</td>
                                    <td style={td()}>{naira(l.fees_kobo)}</td>
                                    <td style={td()}><strong>{naira(l.net_kobo)}</strong></td>
                                    <td style={td()}>{l.bank_account ?? '—'}</td>
                                  </tr>
                                ))}
                              </tbody>
                            </table>
                          )}
                        </td>
                      </tr>
                    )}
                  </Fragment>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      <p style={{ marginTop: '1.5rem', fontSize: '0.8rem', color: '#9ca3af' }}>
        All amounts are integer kobo. Processing a run is a money mutation — the server requires an{' '}
        <code>Idempotency-Key</code>, posts balanced double-entry ledger legs, and emits an audit
        event. Mock-first; target routes <code>GET /api/restaurant/admin/payouts</code> and{' '}
        <code>POST /api/restaurant/admin/payouts/:id/process</code> (RBAC{' '}
        <code>restaurant.admin.payouts</code>).
      </p>
    </div>
  );
}
