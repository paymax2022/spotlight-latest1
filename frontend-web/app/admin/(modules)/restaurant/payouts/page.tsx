'use client';

import { Fragment, useCallback, useEffect, useState } from 'react';
import { listPayoutRuns, getPayoutLines, processPayoutRun } from '@/services/restaurantAdminService';
import type { PayoutRun, PayoutLine, PayeeType } from '@/types/restaurantAdmin';
import { naira, RESTAURANT_PERMS, useRestaurantPermissions, AccessNotice } from '../_ui';
import { Page, PageHeader, Card, Button, Badge, colors, tint, thCell, tdCell } from '@/components/ui/vuexy';

const PAYEE_FILTERS: (PayeeType | '')[] = ['', 'restaurant', 'rider'];

const STATUS_COLOR: Record<string, string> = {
  draft: colors.secondary,
  pending: colors.warning,
  processing: colors.info,
  paid: colors.success,
  failed: colors.danger,
  reconciled: colors.success,
};

function StatusBadge({ status, label }: { status: string; label?: string }) {
  return <Badge text={label ?? status} color={STATUS_COLOR[status] ?? colors.secondary} />;
}

function KpiTile({ label, value, accent, sub }: { label: string; value: string; accent?: string; sub?: string }) {
  return (
    <Card style={{ padding: 14 }}>
      <div style={{ fontSize: 12, color: colors.muted }}>{label}</div>
      <div style={{ fontSize: 22, fontWeight: 800, color: accent ?? colors.text, marginTop: 4 }}>{value}</div>
      {sub ? <div style={{ fontSize: 11, color: colors.muted, marginTop: 2 }}>{sub}</div> : null}
    </Card>
  );
}

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
      <Page>
        <PageHeader title="Payouts" />
        <AccessNotice perm="restaurant.admin.payouts" />
      </Page>
    );
  }

  return (
    <Page>
      <PageHeader
        title="Restaurant & Rider Payouts"
        subtitle="Payout runs and ledger reconciliation. Net amounts are the disbursable settlement per payee."
        actions={<Button variant="outline" onClick={() => void load(payee)}>Refresh</Button>}
      />

      {error && <p style={{ color: colors.danger }}>{error}</p>}
      {message && <p style={{ color: colors.success }}>{message}</p>}

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(190px, 1fr))', gap: '0.75rem', marginBottom: '1.25rem' }}>
        <KpiTile label="Runs" value={String(runs.length)} />
        <KpiTile label="Pending net" value={naira(pendingTotal)} accent={colors.warning} sub="awaiting processing" />
        <KpiTile label="Unreconciled" value={String(unreconciled)} accent={unreconciled ? colors.danger : colors.success} sub="net ≠ ledger-settled" />
      </div>

      <div style={{ display: 'flex', gap: 6, margin: '0 0 1rem', flexWrap: 'wrap' }}>
        {PAYEE_FILTERS.map((p) => (
          <Button
            key={p || 'all'}
            sm
            variant={payee === p ? 'primary' : 'outline'}
            onClick={() => setPayee(p)}
          >
            {p || 'All payees'}
          </Button>
        ))}
      </div>

      <Card title="Payout runs">
        {loading ? (
          <p style={{ color: colors.muted }}>Loading…</p>
        ) : runs.length === 0 ? (
          <p style={{ color: colors.muted }}>No payout runs for this filter.</p>
        ) : (
          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.85rem' }}>
              <thead>
                <tr>
                  <th style={thCell}>Run</th>
                  <th style={thCell}>Payee type</th>
                  <th style={thCell}>Period</th>
                  <th style={thCell}>Lines</th>
                  <th style={thCell}>Net total</th>
                  <th style={thCell}>Reconciliation</th>
                  <th style={thCell}>Status</th>
                  <th style={thCell}></th>
                </tr>
              </thead>
              <tbody>
                {runs.map((r) => (
                  <Fragment key={r.id}>
                    <tr>
                      <td style={tdCell} title={r.id}>{r.id}</td>
                      <td style={tdCell}>{r.payee_type}</td>
                      <td style={tdCell}>{r.period_start} → {r.period_end}</td>
                      <td style={tdCell}>{r.lines_count}</td>
                      <td style={tdCell}><strong>{naira(r.total_net_kobo)}</strong></td>
                      <td style={tdCell}>
                        {r.reconciled === false ? (
                          <span style={{ color: colors.danger }}>
                            off by {naira((r.ledger_settled_kobo ?? 0) - r.total_net_kobo)}
                          </span>
                        ) : (
                          <StatusBadge status="reconciled" label="reconciled" />
                        )}
                      </td>
                      <td style={tdCell}><StatusBadge status={r.status} label={r.status} /></td>
                      <td style={tdCell}>
                        <div style={{ display: 'flex', gap: 6 }}>
                          <Button sm variant="outline" onClick={() => void toggle(r.id)}>{expanded === r.id ? 'Hide' : 'Lines'}</Button>
                          {r.status === 'pending' && (
                            <Button
                              sm
                              variant={r.reconciled === false ? 'secondary' : 'primary'}
                              disabled={!canProcess || busy === r.id || r.reconciled === false}
                              title={!canProcess ? 'Requires restaurant.admin.payouts' : r.reconciled === false ? 'Reconcile before processing' : 'Process this run'}
                              onClick={() => void onProcess(r.id)}
                            >
                              {busy === r.id ? '…' : 'Process'}
                            </Button>
                          )}
                        </div>
                      </td>
                    </tr>
                    {expanded === r.id && (
                      <tr>
                        <td style={{ ...tdCell, background: tint(colors.secondary, 0.06) }} colSpan={8}>
                          {linesLoading ? (
                            <span style={{ color: colors.muted }}>Loading lines…</span>
                          ) : lines.length === 0 ? (
                            <span style={{ color: colors.muted }}>No lines.</span>
                          ) : (
                            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.8rem' }}>
                              <thead>
                                <tr>
                                  <th style={thCell}>Payee</th>
                                  <th style={thCell}>Orders</th>
                                  <th style={thCell}>Gross</th>
                                  <th style={thCell}>Fees</th>
                                  <th style={thCell}>Net</th>
                                  <th style={thCell}>Bank</th>
                                </tr>
                              </thead>
                              <tbody>
                                {lines.map((l) => (
                                  <tr key={l.id}>
                                    <td style={tdCell}>{l.payee_name}</td>
                                    <td style={tdCell}>{l.orders_count}</td>
                                    <td style={tdCell}>{naira(l.gross_kobo)}</td>
                                    <td style={tdCell}>{naira(l.fees_kobo)}</td>
                                    <td style={tdCell}><strong>{naira(l.net_kobo)}</strong></td>
                                    <td style={tdCell}>{l.bank_account ?? '—'}</td>
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

      <p style={{ marginTop: '1.5rem', fontSize: '0.8rem', color: colors.muted }}>
        All amounts are integer kobo. Processing a run is a money mutation — the server requires an{' '}
        <code>Idempotency-Key</code>, posts balanced double-entry ledger legs, and emits an audit
        event. Mock-first; target routes <code>GET /api/restaurant/admin/payouts</code> and{' '}
        <code>POST /api/restaurant/admin/payouts/:id/process</code> (RBAC{' '}
        <code>restaurant.admin.payouts</code>).
      </p>
    </Page>
  );
}
