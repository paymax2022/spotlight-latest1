'use client';

import { Fragment, useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import type { PayoutFilters, PayoutRun } from '@/types/nutritionAdmin';
import { listPayoutRuns, reconcilePayoutRun, formatKobo, ageFromNow } from '@/services/nutritionAdminService';
import { PayoutStatusBadge } from '../statusBadge';
import { useNutritionPermissions, NUTRITION_PERMS } from '../_ui';

const card = { border: '1px solid #2a2a2a', padding: 12, borderRadius: 6 } as const;
const th = { padding: '8px 6px', fontWeight: 600, opacity: 0.8 } as const;
const td = { padding: '8px 6px' } as const;
const input = { background: '#111', color: '#eee', border: '1px solid #2a2a2a', padding: '4px 6px', borderRadius: 4 } as const;

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
    <div>
      <p><Link href="/admin/nutrition">← Back to Nutrition console</Link></p>
      <h1>Nutritionist Payouts</h1>
      <p style={{ fontSize: 13, opacity: 0.7 }}>
        Payout runs settle nutritionist earnings per period. Amounts are in kobo (minor units);
        reconciliation posts a balanced double-entry against the ledger settlement account server-side.
        Reconcile is role-gated (nutrition.admin.resolve).
      </p>
      <p style={{ fontSize: 12, color: '#fde68a', ...card, background: '#1a1400', borderColor: '#78350f' }}>
        ⚠ Mock surface — no nutritionist-settlement backend exists yet. Runs are fixtures until
        /api/nutrition/admin/payouts is delivered. Money mutations remain backend-only.
      </p>

      {message ? <p style={{ color: 'lightgreen' }}>{message}</p> : null}
      {error ? <p style={{ color: 'salmon' }}>{error}</p> : null}

      <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap', marginTop: 12 }}>
        <select value={filters.status} onChange={(e) => setFilters((f) => ({ ...f, status: e.target.value }))} style={input}>
          {STATUS_OPTIONS.map((v) => <option key={v} value={v}>{v || 'All statuses'}</option>)}
        </select>
        <input placeholder="Period (e.g. 2026-07)" value={filters.period} onChange={(e) => setFilters((f) => ({ ...f, period: e.target.value }))} style={input} />
        <button onClick={() => void load()} disabled={loading}>{loading ? 'Loading…' : 'Apply'}</button>
        <button onClick={() => setFilters(defaultFilters)} disabled={loading}>Reset</button>
        <span style={{ fontSize: 12, opacity: 0.7 }}>{runs.length} run(s)</span>
      </div>

      {!loading && runs.length === 0 ? (
        <p style={{ opacity: 0.6, marginTop: 24 }}>No payout runs match the current filters.</p>
      ) : null}

      {runs.length > 0 ? (
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13, marginTop: 16 }}>
          <thead>
            <tr style={{ borderBottom: '1px solid #2a2a2a', textAlign: 'left' }}>
              {['Run / Period', 'Status', 'Lines', 'Net payout', 'Platform fee', 'Reconciled', 'Created', 'Actions'].map((h) => (
                <th key={h} style={th}>{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {runs.map((r) => (
              <Fragment key={r.id}>
                <tr style={{ borderBottom: '1px solid #1c1c1c' }}>
                  <td style={td}>
                    <button
                      onClick={() => setExpanded((e) => (e === r.id ? '' : r.id))}
                      style={{ background: 'transparent', border: 'none', color: '#93c5fd', cursor: 'pointer', padding: 0, fontWeight: 600 }}
                    >
                      {expanded === r.id ? '▾' : '▸'} {r.period}
                    </button>
                    <div style={{ fontSize: 11, opacity: 0.5, fontFamily: 'monospace' }}>{r.id}</div>
                  </td>
                  <td style={td}><PayoutStatusBadge status={r.status} /></td>
                  <td style={td}>{r.lineCount}</td>
                  <td style={td}>{formatKobo(r.totalNetKobo)}</td>
                  <td style={{ ...td, opacity: 0.7 }}>{formatKobo(r.totalFeeKobo)}</td>
                  <td style={td}>
                    {formatKobo(r.reconciledKobo)}
                    {r.reconciledKobo < r.totalNetKobo ? (
                      <span style={{ color: '#fca5a5', fontSize: 11, marginLeft: 6 }}>● unreconciled</span>
                    ) : null}
                  </td>
                  <td style={{ ...td, opacity: 0.6 }}>{ageFromNow(r.createdAt)}</td>
                  <td style={td}>
                    {r.status !== 'RECONCILED' ? (
                      <button
                        onClick={() => onReconcile(r.id)}
                        disabled={busyId === r.id || !canPayout}
                        title={!canPayout ? 'Requires nutrition.admin.resolve' : 'Reconcile against the ledger settlement account'}
                      >
                        {busyId === r.id ? '…' : 'Reconcile'}
                      </button>
                    ) : (
                      <span style={{ fontSize: 11, color: '#a7f3d0' }}>Paid {ageFromNow(r.paidAt)} ago</span>
                    )}
                  </td>
                </tr>
                {expanded === r.id && r.lines ? (
                  <tr>
                    <td colSpan={8} style={{ padding: '4px 6px 12px' }}>
                      <div style={{ ...card, background: '#0f0f0f' }}>
                        <strong style={{ fontSize: 12 }}>Payout lines</strong>
                        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12, marginTop: 8 }}>
                          <thead>
                            <tr style={{ borderBottom: '1px solid #2a2a2a', textAlign: 'left', opacity: 0.7 }}>
                              {['Nutritionist', 'Consults', 'Gross', 'Fee', 'Net', 'Status'].map((h) => (
                                <th key={h} style={{ padding: '4px 6px' }}>{h}</th>
                              ))}
                            </tr>
                          </thead>
                          <tbody>
                            {r.lines.map((l) => (
                              <tr key={l.nutritionistId} style={{ borderBottom: '1px solid #1c1c1c' }}>
                                <td style={{ padding: '4px 6px' }}>{l.nutritionistName}</td>
                                <td style={{ padding: '4px 6px' }}>{l.consults}</td>
                                <td style={{ padding: '4px 6px' }}>{formatKobo(l.grossKobo)}</td>
                                <td style={{ padding: '4px 6px', opacity: 0.7 }}>{formatKobo(l.feeKobo)}</td>
                                <td style={{ padding: '4px 6px' }}>{formatKobo(l.netKobo)}</td>
                                <td style={{ padding: '4px 6px' }}><PayoutStatusBadge status={l.status} /></td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    </td>
                  </tr>
                ) : null}
              </Fragment>
            ))}
          </tbody>
        </table>
      ) : null}
    </div>
  );
}
