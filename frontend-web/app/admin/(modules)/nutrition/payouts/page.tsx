'use client';

import { Fragment, useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import type { PayoutFilters, PayoutRun } from '@/types/nutritionAdmin';
import { listPayoutRuns, reconcilePayoutRun, formatKobo, ageFromNow } from '@/services/nutritionAdminService';
import { PayoutStatusBadge } from '../statusBadge';
import { useNutritionPermissions, NUTRITION_PERMS } from '../_ui';
import { Page, PageHeader, Card, Button, Input, colors, tint, thCell, tdCell } from '@/components/ui/vuexy';

const STATUS_OPTIONS = ['', 'DRAFT', 'PENDING', 'PAID', 'FAILED', 'RECONCILED'];

const defaultFilters: PayoutFilters = { status: '', period: '' };

export default function NutritionPayoutsPage() {
  const { can } = useNutritionPermissions();
  const canPayout = can(NUTRITION_PERMS.payout);

  const [filters, setFilters] = useState<PayoutFilters>(defaultFilters);
  const [runs, setRuns] = useState<PayoutRun[]>([]);
  const [expanded, setExpanded] = useState<string>('');
  const [loading, setLoading] = useState(true);
  const [busyId, setBusyId] = useState('');
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      setRuns(await listPayoutRuns(filters));
    } catch (e) {
      setError(String(e));
    } finally {
      setLoading(false);
    }
  }, [filters]);

  useEffect(() => {
    void load();
  }, [load]);

  const onReconcile = async (id: string) => {
    if (!confirm('Reconcile this payout run against the ledger settlement account? The balanced double-entry is posted server-side.')) return;
    setBusyId(id);
    setError('');
    setMessage('');
    try {
      await reconcilePayoutRun(id);
      setMessage(`Payout run ${id} reconciled.`);
      await load();
    } catch (e) {
      setError(`Reconcile failed: ${String(e)}`);
    } finally {
      setBusyId('');
    }
  };

  return (
    <Page>
      <p><Link href="/admin/nutrition">← Back to Nutrition console</Link></p>
      <PageHeader
        title="Nutritionist Payouts"
        subtitle="Payout runs settle nutritionist earnings per period. Amounts are in kobo (minor units); reconciliation posts a balanced double-entry against the ledger settlement account server-side. Reconcile is role-gated (nutrition.admin.resolve)."
      />
      <Card style={{ fontSize: 12, color: colors.warning, background: tint(colors.warning, 0.08), borderColor: colors.warning, marginBottom: 12 }}>
        ⚠ Mock surface — no nutritionist-settlement backend exists yet. Runs are fixtures until
        /api/nutrition/admin/payouts is delivered. Money mutations remain backend-only.
      </Card>

      {message ? <p style={{ color: colors.success }}>{message}</p> : null}
      {error ? <p style={{ color: colors.danger }}>{error}</p> : null}

      <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap', marginTop: 12 }}>
        <select value={filters.status} onChange={(e) => setFilters((f) => ({ ...f, status: e.target.value }))}>
          {STATUS_OPTIONS.map((v) => <option key={v} value={v}>{v || 'All statuses'}</option>)}
        </select>
        <Input placeholder="Period (e.g. 2026-07)" value={filters.period} onChange={(e) => setFilters((f) => ({ ...f, period: e.target.value }))} />
        <Button variant="outline" onClick={() => void load()} disabled={loading}>{loading ? 'Loading…' : 'Apply'}</Button>
        <Button variant="outline" onClick={() => setFilters(defaultFilters)} disabled={loading}>Reset</Button>
        <span style={{ fontSize: 12, color: colors.muted }}>{runs.length} run(s)</span>
      </div>

      {!loading && runs.length === 0 ? (
        <p style={{ color: colors.muted, marginTop: 24 }}>No payout runs match the current filters.</p>
      ) : null}

      {runs.length > 0 ? (
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13, marginTop: 16 }}>
          <thead>
            <tr>
              {['Run / Period', 'Status', 'Lines', 'Net payout', 'Platform fee', 'Reconciled', 'Created', 'Actions'].map((h) => (
                <th key={h} style={thCell}>{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {runs.map((r) => (
              <Fragment key={r.id}>
                <tr>
                  <td style={tdCell}>
                    <button
                      onClick={() => setExpanded((e) => (e === r.id ? '' : r.id))}
                      style={{ background: 'transparent', border: 'none', color: colors.info, cursor: 'pointer', padding: 0, fontWeight: 600 }}
                    >
                      {expanded === r.id ? '▾' : '▸'} {r.period}
                    </button>
                    <div style={{ fontSize: 11, color: colors.muted, fontFamily: 'monospace' }}>{r.id}</div>
                  </td>
                  <td style={tdCell}><PayoutStatusBadge status={r.status} /></td>
                  <td style={tdCell}>{r.lineCount}</td>
                  <td style={tdCell}>{formatKobo(r.totalNetKobo)}</td>
                  <td style={{ ...tdCell, color: colors.muted }}>{formatKobo(r.totalFeeKobo)}</td>
                  <td style={tdCell}>
                    {formatKobo(r.reconciledKobo)}
                    {r.reconciledKobo < r.totalNetKobo ? (
                      <span style={{ color: colors.danger, fontSize: 11, marginLeft: 6 }}>● unreconciled</span>
                    ) : null}
                  </td>
                  <td style={{ ...tdCell, color: colors.muted }}>{ageFromNow(r.createdAt)}</td>
                  <td style={tdCell}>
                    {r.status !== 'RECONCILED' ? (
                      <Button
                        sm
                        variant="outline"
                        onClick={() => onReconcile(r.id)}
                        disabled={busyId === r.id || !canPayout}
                        title={!canPayout ? 'Requires nutrition.admin.resolve' : 'Reconcile against the ledger settlement account'}
                      >
                        {busyId === r.id ? '…' : 'Reconcile'}
                      </Button>
                    ) : (
                      <span style={{ fontSize: 11, color: colors.success }}>Paid {ageFromNow(r.paidAt)} ago</span>
                    )}
                  </td>
                </tr>
                {expanded === r.id && r.lines ? (
                  <tr>
                    <td colSpan={8} style={{ padding: '4px 6px 12px' }}>
                      <Card style={{ background: colors.headBg }}>
                        <strong style={{ fontSize: 12 }}>Payout lines</strong>
                        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12, marginTop: 8 }}>
                          <thead>
                            <tr>
                              {['Nutritionist', 'Consults', 'Gross', 'Fee', 'Net', 'Status'].map((h) => (
                                <th key={h} style={{ ...thCell, padding: '4px 6px' }}>{h}</th>
                              ))}
                            </tr>
                          </thead>
                          <tbody>
                            {r.lines.map((l) => (
                              <tr key={l.nutritionistId}>
                                <td style={{ ...tdCell, padding: '4px 6px' }}>{l.nutritionistName}</td>
                                <td style={{ ...tdCell, padding: '4px 6px' }}>{l.consults}</td>
                                <td style={{ ...tdCell, padding: '4px 6px' }}>{formatKobo(l.grossKobo)}</td>
                                <td style={{ ...tdCell, padding: '4px 6px', color: colors.muted }}>{formatKobo(l.feeKobo)}</td>
                                <td style={{ ...tdCell, padding: '4px 6px' }}>{formatKobo(l.netKobo)}</td>
                                <td style={{ ...tdCell, padding: '4px 6px' }}><PayoutStatusBadge status={l.status} /></td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </Card>
                    </td>
                  </tr>
                ) : null}
              </Fragment>
            ))}
          </tbody>
        </table>
      ) : null}
    </Page>
  );
}
