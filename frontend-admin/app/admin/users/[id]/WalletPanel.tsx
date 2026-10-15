'use client';

import { useCallback, useEffect, useState } from 'react';
import { AdminUsersRequestError } from '@/services/usersService';
import { getWalletBalance, getWalletTransactions, type WalletTransactionRow } from '@/services/userFinanceService';
import { Card, Button, colors } from '@/components/ui/vuexy';

const naira = new Intl.NumberFormat('en-NG', { style: 'currency', currency: 'NGN' });

/** Amounts are integer kobo; divide for display only. */
function formatKobo(kobo: number): string {
  return naira.format(kobo / 100);
}

function formatDate(iso: string): string {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? iso : d.toLocaleString('en-NG');
}

const th = { textAlign: 'left' as const, padding: '6px 8px', color: colors.muted, fontWeight: 600 };
const td = { padding: '6px 8px' };

/**
 * Read-only wallet panel for the admin user profile. Self-contained: owns its
 * own loading/empty/error/403 state. Contains no mutation controls.
 */
export function WalletPanel({ userId }: { userId: string }) {
  const [balance, setBalance] = useState<number | null>(null);
  const [txs, setTxs] = useState<WalletTransactionRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [forbidden, setForbidden] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    setForbidden(false);
    try {
      const [b, t] = await Promise.all([getWalletBalance(userId), getWalletTransactions(userId)]);
      setBalance(b.balanceKobo);
      setTxs(t);
    } catch (err) {
      if (err instanceof AdminUsersRequestError && err.status === 403) {
        setForbidden(true);
      } else {
        setError(err instanceof Error ? err.message : 'Loading wallet failed.');
      }
    } finally {
      setLoading(false);
    }
  }, [userId]);

  useEffect(() => {
    void load();
  }, [load]);

  let body;
  if (loading) {
    body = <p style={{ color: colors.muted, fontSize: 13 }}>Loading wallet…</p>;
  } else if (forbidden) {
    body = <p style={{ color: colors.muted, fontSize: 13 }}>You don&apos;t have permission to view this.</p>;
  } else if (error) {
    body = (
      <div style={{ display: 'grid', gap: 8, justifyItems: 'start' }}>
        <p style={{ color: colors.danger, fontSize: 13, margin: 0 }}>{error}</p>
        <Button variant="outline" sm onClick={() => void load()}>Retry</Button>
      </div>
    );
  } else {
    body = (
      <div style={{ display: 'grid', gap: 12 }}>
        <div style={{ fontSize: 13, color: colors.muted }}>
          Balance{' '}
          <strong data-testid="wallet-balance" style={{ fontSize: 18, color: colors.text }}>
            {formatKobo(balance ?? 0)}
          </strong>
        </div>
        {txs.length === 0 ? (
          <p style={{ color: colors.muted, fontSize: 13, margin: 0 }}>No transactions</p>
        ) : (
          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
              <thead>
                <tr>
                  <th style={th}>Type</th>
                  <th style={th}>Amount (₦)</th>
                  <th style={th}>Reference</th>
                  <th style={th}>Date</th>
                </tr>
              </thead>
              <tbody>
                {txs.map((t) => (
                  <tr key={t.id}>
                    <td style={td}>{t.type}</td>
                    <td style={td}>{formatKobo(t.amount_kobo)}</td>
                    <td style={td}>{t.reference}</td>
                    <td style={td}>{formatDate(t.created_at)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    );
  }

  return (
    <div data-testid="wallet-panel">
      <Card title="Wallet">
        <div style={{ marginTop: 8 }}>{body}</div>
      </Card>
    </div>
  );
}
