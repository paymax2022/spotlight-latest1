'use client';

import { useCallback, useEffect, useState } from 'react';
import { listWithdrawals, markWithdrawalPaid, markWithdrawalFailed } from '@/services/restaurantAdminService';
import type { Withdrawal, WithdrawalStatus } from '@/types/restaurantAdmin';
import { naira, RESTAURANT_PERMS, useRestaurantPermissions, AccessNotice } from '../_ui';
import { Page, PageHeader, Card, Button, Badge, colors, thCell, tdCell } from '@/components/ui/vuexy';

const STATUS_FILTERS: (WithdrawalStatus | '')[] = ['', 'pending', 'processing', 'paid', 'failed', 'reversed'];

const STATUS_COLOR: Record<string, string> = {
  pending: colors.secondary,
  processing: colors.warning,
  paid: colors.success,
  failed: colors.danger,
  reversed: colors.danger,
};

function StatusBadge({ status }: { status: string }) {
  return <Badge text={status} color={STATUS_COLOR[status] ?? colors.secondary} />;
}

export default function WithdrawalsPage() {
  const { can } = useRestaurantPermissions();
  const canView = can(RESTAURANT_PERMS.withdrawals);
  const canAct = can(RESTAURANT_PERMS.withdrawals);

  const [withdrawals, setWithdrawals] = useState<Withdrawal[]>([]);
  const [status, setStatus] = useState<WithdrawalStatus | ''>('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [reasonFor, setReasonFor] = useState<string | null>(null);
  const [reason, setReason] = useState('');

  const load = useCallback(async (s: WithdrawalStatus | '') => {
    setLoading(true);
    setError(null);
    try {
      setWithdrawals(await listWithdrawals(s));
    } catch (e) {
      setError(String(e));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load(status);
  }, [status, load]);

  async function onMarkPaid(id: string) {
    setBusy(id);
    setError(null);
    setMessage(null);
    try {
      await markWithdrawalPaid(id);
      setMessage(`Withdrawal ${id} marked paid.`);
      await load(status);
    } catch (e) {
      setError(String(e));
    } finally {
      setBusy(null);
    }
  }

  async function onMarkFailed(id: string) {
    setError(null);
    setMessage(null);
    if (!reason.trim()) {
      setError('A failure reason is required to reverse a withdrawal.');
      return;
    }
    setBusy(id);
    try {
      await markWithdrawalFailed(id, reason.trim());
      setMessage(`Withdrawal ${id} marked failed and reversed to the merchant's wallet.`);
      setReasonFor(null);
      setReason('');
      await load(status);
    } catch (e) {
      setError(String(e));
    } finally {
      setBusy(null);
    }
  }

  const pendingTotal = withdrawals
    .filter((w) => w.status === 'pending' || w.status === 'processing')
    .reduce((s, w) => s + w.amount_kobo, 0);

  if (!canView) {
    return (
      <Page>
        <PageHeader title="Withdrawals" />
        <AccessNotice perm="restaurant.admin.withdrawals" />
      </Page>
    );
  }

  return (
    <Page>
      <PageHeader
        title="Restaurant & Rider Withdrawals"
        subtitle="Merchant/rider requests to move their wallet balance out to a saved bank account (distinct from payout runs, which fund the wallet)."
        actions={<Button variant="outline" onClick={() => void load(status)}>Refresh</Button>}
      />

      {error && <p style={{ color: colors.danger }}>{error}</p>}
      {message && <p style={{ color: colors.success }}>{message}</p>}

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(190px, 1fr))', gap: '0.75rem', marginBottom: '1.25rem' }}>
        <Card style={{ padding: 14 }}>
          <div style={{ fontSize: 12, color: colors.muted }}>Requests</div>
          <div style={{ fontSize: 22, fontWeight: 800, marginTop: 4 }}>{withdrawals.length}</div>
        </Card>
        <Card style={{ padding: 14 }}>
          <div style={{ fontSize: 12, color: colors.muted }}>Reserved (pending/processing)</div>
          <div style={{ fontSize: 22, fontWeight: 800, color: colors.warning, marginTop: 4 }}>{naira(pendingTotal)}</div>
        </Card>
      </div>

      <div style={{ display: 'flex', gap: 6, margin: '0 0 1rem', flexWrap: 'wrap' }}>
        {STATUS_FILTERS.map((s) => (
          <Button key={s || 'all'} sm variant={status === s ? 'primary' : 'outline'} onClick={() => setStatus(s)}>
            {s || 'All statuses'}
          </Button>
        ))}
      </div>

      <Card title="Withdrawal requests">
        {loading ? (
          <p style={{ color: colors.muted }}>Loading…</p>
        ) : withdrawals.length === 0 ? (
          <p style={{ color: colors.muted }}>No withdrawal requests for this filter.</p>
        ) : (
          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.85rem' }}>
              <thead>
                <tr>
                  <th style={thCell}>Withdrawal</th>
                  <th style={thCell}>Merchant/rider</th>
                  <th style={thCell}>Amount</th>
                  <th style={thCell}>Status</th>
                  <th style={thCell}>Provider ref</th>
                  <th style={thCell}>Requested</th>
                  <th style={thCell}></th>
                </tr>
              </thead>
              <tbody>
                {withdrawals.map((w) => (
                  <tr key={w.id}>
                    <td style={tdCell} title={w.id}>{w.id.slice(0, 8)}…</td>
                    <td style={tdCell} title={w.user_id}>{w.user_id.slice(0, 8)}…</td>
                    <td style={tdCell}><strong>{naira(w.amount_kobo)}</strong></td>
                    <td style={tdCell}><StatusBadge status={w.status} /></td>
                    <td style={tdCell}>{w.provider_reference ?? '—'}</td>
                    <td style={tdCell}>{new Date(w.created_at).toLocaleString()}</td>
                    <td style={tdCell}>
                      {(w.status === 'pending' || w.status === 'processing') && (
                        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                          <Button
                            sm
                            variant="primary"
                            disabled={!canAct || busy === w.id}
                            title={!canAct ? 'Requires restaurant.admin.withdrawals' : 'Mark this withdrawal paid'}
                            onClick={() => void onMarkPaid(w.id)}
                          >
                            {busy === w.id ? '…' : 'Mark paid'}
                          </Button>
                          {reasonFor === w.id ? (
                            <>
                              <input
                                value={reason}
                                onChange={(e) => setReason(e.target.value)}
                                placeholder="Failure reason"
                                style={{ fontSize: '0.8rem', padding: '0.2rem 0.4rem', border: `1px solid ${colors.border}`, borderRadius: 4 }}
                              />
                              <Button sm variant="secondary" disabled={!canAct || busy === w.id} onClick={() => void onMarkFailed(w.id)}>
                                Confirm reverse
                              </Button>
                              <Button sm variant="outline" onClick={() => { setReasonFor(null); setReason(''); }}>Cancel</Button>
                            </>
                          ) : (
                            <Button
                              sm
                              variant="outline"
                              disabled={!canAct || busy === w.id}
                              title={!canAct ? 'Requires restaurant.admin.withdrawals' : 'Mark this withdrawal failed and return funds to the wallet'}
                              onClick={() => setReasonFor(w.id)}
                            >
                              Mark failed
                            </Button>
                          )}
                        </div>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      <p style={{ marginTop: '1.5rem', fontSize: '0.8rem', color: colors.muted }}>
        All amounts are integer kobo. Marking a withdrawal paid or failed is a money mutation — the
        server posts a balanced ledger leg (settle or reversal) under a row lock, so a retry is a safe
        no-op. Target routes <code>GET /api/restaurant/admin/withdrawals</code>,{' '}
        <code>POST /api/restaurant/admin/withdrawals/:id/paid</code> and{' '}
        <code>POST /api/restaurant/admin/withdrawals/:id/failed</code> (RBAC{' '}
        <code>restaurant.admin.withdrawals</code>). Bank-account capture and the withdrawal request
        itself are member-facing (<code>/api/finance/restaurant/bank-accounts</code>,{' '}
        <code>/api/finance/restaurant/withdrawals</code>) — there is no owner/rider-facing mobile or
        web UI for requesting a withdrawal yet; that is a separate, larger gap this console does not
        cover.
      </p>
    </Page>
  );
}
