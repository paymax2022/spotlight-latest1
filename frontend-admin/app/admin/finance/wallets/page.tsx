'use client';

import { useState } from 'react';
import { getAdminWalletBalance, getAdminWalletTransactions, formatKobo } from '@/services/fintechService';
import type { WalletBalance, LedgerEntry } from '@/types/fintech';
import { Page, PageHeader, Card, Button, Input, colors, tint, thCell, tdCell } from '@/components/ui/vuexy';

// Keyed on the lowercase credit/debit the Go handler emits. The uppercase raw
// ledger types are kept so a future richer projection still colours correctly.
const TYPE_COLOR: Record<string, string> = {
  credit: colors.success,
  debit: colors.danger,
  CREDIT: colors.success,
  DEBIT: colors.danger,
  REVERSAL_CREDIT: colors.info,
  REVERSAL_DEBIT: colors.warning,
};

export default function WalletLookupPage() {
  const [userId, setUserId] = useState('');
  const [balance, setBalance] = useState<WalletBalance | null>(null);
  const [entries, setEntries] = useState<LedgerEntry[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function lookup() {
    if (!userId.trim()) return;
    setLoading(true);
    setError(null);
    setBalance(null);
    setEntries([]);
    try {
      const [bal, txs] = await Promise.all([
        getAdminWalletBalance(userId.trim()),
        getAdminWalletTransactions(userId.trim()),
      ]);
      setBalance(bal);
      setEntries(txs.transactions ?? []);
    } catch (e) {
      setError(String(e));
    } finally {
      setLoading(false);
    }
  }

  return (
    <Page>
      <PageHeader title="Wallet Lookup" />

      <div style={{ display: 'flex', gap: '0.75rem', marginBottom: '1.5rem' }}>
        <Input
          value={userId}
          onChange={(e) => setUserId(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && lookup()}
          placeholder="User UUID"
          style={{ flex: 1, fontFamily: 'monospace' }}
        />
        <Button variant="primary" onClick={lookup} disabled={loading || !userId.trim()}>
          {loading ? 'Loading…' : 'Look up'}
        </Button>
      </div>

      {error && (
        <div style={{ background: '#fef2f2', border: '1px solid #fca5a5', borderRadius: '0.5rem', padding: '0.75rem', marginBottom: '1rem', color: colors.danger }}>
          {error}
        </div>
      )}

      {balance && (
        <div style={{ background: tint(colors.success, 0.08), border: `1px solid ${tint(colors.success, 0.4)}`, borderRadius: '0.75rem', padding: '1.25rem', marginBottom: '1.5rem', display: 'flex', gap: '2rem' }}>
          <div>
            <div style={{ fontSize: '0.75rem', color: colors.muted, marginBottom: '0.25rem' }}>User ID</div>
            <div style={{ fontFamily: 'monospace', fontSize: '0.875rem' }}>{balance.user_id}</div>
          </div>
          <div>
            <div style={{ fontSize: '0.75rem', color: colors.muted, marginBottom: '0.25rem' }}>Available Balance</div>
            <div style={{ fontSize: '1.5rem', fontWeight: 700, color: colors.success }}>
              {formatKobo(balance.balance_kobo)}
            </div>
          </div>
          <div>
            <div style={{ fontSize: '0.75rem', color: colors.muted, marginBottom: '0.25rem' }}>Raw (kobo)</div>
            <div style={{ fontFamily: 'monospace' }}>{balance.balance_kobo.toLocaleString()}</div>
          </div>
        </div>
      )}

      {entries.length > 0 && (
        <>
          <h2 style={{ fontSize: '1rem', fontWeight: 600, marginBottom: '0.75rem' }}>
            Ledger Entries ({entries.length})
          </h2>
          <Card style={{ padding: 0, overflow: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.8rem' }}>
              <thead>
                <tr>
                  {['Type', 'Amount', 'Reference', 'Created At'].map((h) => (
                    <th key={h} style={thCell}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {entries.map((e) => {
                  const c = TYPE_COLOR[e.type] ?? colors.secondary;
                  return (
                    <tr key={e.id}>
                      <td style={tdCell}>
                        <span style={{ background: tint(c, 0.12), color: c, padding: '0.125rem 0.5rem', borderRadius: '9999px' }}>
                          {e.type}
                        </span>
                      </td>
                      <td style={{ ...tdCell, fontWeight: 600 }}>{formatKobo(e.amount_kobo)}</td>
                      <td style={{ ...tdCell, fontFamily: 'monospace', maxWidth: '200px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                        {e.reference}
                      </td>
                      <td style={{ ...tdCell, color: colors.muted }}>
                        {new Date(e.created_at).toLocaleString()}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </Card>
        </>
      )}
    </Page>
  );
}
