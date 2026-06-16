'use client';

import { useState } from 'react';
import { getAdminWalletBalance, getAdminWalletTransactions, formatKobo } from '@/services/fintechService';
import type { WalletBalance, LedgerEntry } from '@/types/fintech';

const TYPE_STYLES: Record<string, { bg: string; color: string }> = {
  CREDIT:           { bg: '#d1fae5', color: '#065f46' },
  DEBIT:            { bg: '#fee2e2', color: '#991b1b' },
  REVERSAL_CREDIT:  { bg: '#e0e7ff', color: '#3730a3' },
  REVERSAL_DEBIT:   { bg: '#fef3c7', color: '#92400e' },
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
      setEntries(txs.entries ?? []);
    } catch (e) {
      setError(String(e));
    } finally {
      setLoading(false);
    }
  }

  return (
    <div style={{ padding: '2rem', fontFamily: 'inherit' }}>
      <h1 style={{ fontSize: '1.5rem', fontWeight: 700, marginBottom: '1.5rem' }}>Wallet Lookup</h1>

      <div style={{ display: 'flex', gap: '0.75rem', marginBottom: '1.5rem' }}>
        <input
          value={userId}
          onChange={(e) => setUserId(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && lookup()}
          placeholder="User UUID"
          style={{
            flex: 1, padding: '0.625rem 0.875rem',
            border: '1px solid #d1d5db', borderRadius: '0.5rem',
            fontFamily: 'monospace', fontSize: '0.875rem',
          }}
        />
        <button
          onClick={lookup}
          disabled={loading || !userId.trim()}
          style={{
            padding: '0.625rem 1.25rem', borderRadius: '0.5rem', border: 'none',
            background: '#6366f1', color: '#fff', cursor: 'pointer', fontWeight: 600,
          }}
        >
          {loading ? 'Loading…' : 'Look up'}
        </button>
      </div>

      {error && (
        <div style={{ background: '#fef2f2', border: '1px solid #fca5a5', borderRadius: '0.5rem', padding: '0.75rem', marginBottom: '1rem', color: '#dc2626' }}>
          {error}
        </div>
      )}

      {balance && (
        <div style={{ background: '#f0fdf4', border: '1px solid #86efac', borderRadius: '0.75rem', padding: '1.25rem', marginBottom: '1.5rem', display: 'flex', gap: '2rem' }}>
          <div>
            <div style={{ fontSize: '0.75rem', color: '#6b7280', marginBottom: '0.25rem' }}>User ID</div>
            <div style={{ fontFamily: 'monospace', fontSize: '0.875rem' }}>{balance.user_id}</div>
          </div>
          <div>
            <div style={{ fontSize: '0.75rem', color: '#6b7280', marginBottom: '0.25rem' }}>Available Balance</div>
            <div style={{ fontSize: '1.5rem', fontWeight: 700, color: '#065f46' }}>
              {formatKobo(balance.balance_kobo)}
            </div>
          </div>
          <div>
            <div style={{ fontSize: '0.75rem', color: '#6b7280', marginBottom: '0.25rem' }}>Raw (kobo)</div>
            <div style={{ fontFamily: 'monospace' }}>{balance.balance_kobo.toLocaleString()}</div>
          </div>
        </div>
      )}

      {entries.length > 0 && (
        <>
          <h2 style={{ fontSize: '1rem', fontWeight: 600, marginBottom: '0.75rem' }}>
            Ledger Entries ({entries.length})
          </h2>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.8rem' }}>
            <thead>
              <tr style={{ borderBottom: '2px solid #e5e7eb' }}>
                {['Type', 'Amount', 'Reference', 'Created At'].map((h) => (
                  <th key={h} style={{ textAlign: 'left', padding: '0.5rem', fontWeight: 600, color: '#374151' }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {entries.map((e) => {
                const s = TYPE_STYLES[e.type] ?? { bg: '#f9fafb', color: '#374151' };
                return (
                  <tr key={e.id} style={{ borderBottom: '1px solid #f3f4f6' }}>
                    <td style={{ padding: '0.5rem' }}>
                      <span style={{ background: s.bg, color: s.color, padding: '0.125rem 0.5rem', borderRadius: '9999px' }}>
                        {e.type}
                      </span>
                    </td>
                    <td style={{ padding: '0.5rem', fontWeight: 600 }}>{formatKobo(e.amount_kobo)}</td>
                    <td style={{ padding: '0.5rem', fontFamily: 'monospace', maxWidth: '200px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      {e.reference}
                    </td>
                    <td style={{ padding: '0.5rem', color: '#6b7280' }}>
                      {new Date(e.created_at).toLocaleString()}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </>
      )}
    </div>
  );
}
