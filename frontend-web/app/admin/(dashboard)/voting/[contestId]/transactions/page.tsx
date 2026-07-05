'use client';

import { useEffect, useState, useCallback } from 'react';
import { useParams } from 'next/navigation';
import { authHeaders } from '@/src/lib/auth/client';
import { FORMAT_NAIRA } from '@/src/features/voting/constants';

const STATUS_COLORS: Record<string, string> = {
  successful: 'bg-green-600/20 text-green-400',
  failed: 'bg-red-600/20 text-red-400',
  pending: 'bg-yellow-600/20 text-yellow-400',
  abandoned: 'bg-gray-700 text-gray-400',
  refunded: 'bg-blue-600/20 text-blue-400',
  chargeback: 'bg-orange-600/20 text-orange-400',
};

export default function TransactionsPage() {
  const { contestId } = useParams() as { contestId: string };
  const [txs, setTxs] = useState<any[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [status, setStatus] = useState('');
  const [search, setSearch] = useState('');
  const [offset, setOffset] = useState(0);
  const limit = 50;

  const load = useCallback(async () => {
    setLoading(true);
    const headers = await authHeaders();
    const params = new URLSearchParams({ limit: String(limit), offset: String(offset) });
    if (status) params.set('status', status);
    if (search) params.set('search', search);
    const res = await fetch(`/api/admin/voting/${contestId}/transactions?${params}`, { headers });
    if (res.ok) {
      const json = await res.json();
      setTxs(json.transactions ?? []);
      setTotal(json.total ?? 0);
    }
    setLoading(false);
  }, [contestId, status, search, offset]);

  useEffect(() => { load(); }, [load]);

  async function downloadCSV() {
    const headers = await authHeaders();
    const res = await fetch(`/api/admin/voting/${contestId}/export?type=transactions`, { headers });
    if (res.ok) {
      const blob = await res.blob();
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = `transactions-${contestId}.csv`;
      a.click();
    }
  }

  return (
    <div className="p-6 max-w-6xl mx-auto">
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-xl font-bold text-white">Payment Transactions</h1>
        <button
          onClick={downloadCSV}
          className="text-xs bg-gray-700 hover:bg-gray-600 text-white px-4 py-2 rounded-lg transition-all"
        >
          Export CSV
        </button>
      </div>

      {/* Filters */}
      <div className="flex gap-3 mb-4 flex-wrap">
        <input
          placeholder="Search reference…"
          value={search}
          onChange={(e) => { setSearch(e.target.value); setOffset(0); }}
          className="bg-gray-800 border border-gray-700 rounded-xl px-3 py-2 text-white text-sm w-64"
        />
        <div className="flex gap-1">
          {['', 'successful', 'failed', 'pending', 'abandoned', 'refunded'].map((s) => (
            <button
              key={s}
              onClick={() => { setStatus(s); setOffset(0); }}
              className={`text-xs px-3 py-1.5 rounded-lg capitalize transition-all ${
                status === s ? 'bg-amber-500 text-black font-bold' : 'bg-gray-800 text-gray-400 hover:bg-gray-700'
              }`}
            >
              {s || 'All'}
            </button>
          ))}
        </div>
      </div>

      <div className="bg-gray-900 rounded-2xl overflow-hidden">
        {loading ? (
          <div className="p-8 text-center text-gray-400 animate-pulse">Loading…</div>
        ) : txs.length === 0 ? (
          <div className="p-8 text-center text-gray-500">No transactions found</div>
        ) : (
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-gray-800 text-xs text-gray-400 uppercase tracking-wider">
                <th className="py-3 px-4 text-left">Reference</th>
                <th className="py-3 px-4 text-left">Voter</th>
                <th className="py-3 px-4 text-right">Votes</th>
                <th className="py-3 px-4 text-right">Amount</th>
                <th className="py-3 px-4 text-center">Status</th>
                <th className="py-3 px-4 text-center">Credited</th>
                <th className="py-3 px-4 text-right">Date</th>
              </tr>
            </thead>
            <tbody>
              {txs.map((tx: any) => (
                <tr key={tx.id} className="border-b border-gray-800/50 hover:bg-gray-800/30">
                  <td className="py-3 px-4">
                    <span className="font-mono text-xs text-gray-300">{tx.payment_reference}</span>
                  </td>
                  <td className="py-3 px-4 text-gray-400 text-xs">
                    <p>{tx.voter_name ?? '—'}</p>
                    <p className="text-gray-600">{tx.voter_email ?? ''}</p>
                  </td>
                  <td className="py-3 px-4 text-right text-amber-400 font-semibold">
                    {(tx.total_votes_to_credit ?? 0).toLocaleString()}
                  </td>
                  <td className="py-3 px-4 text-right text-green-400 font-semibold">
                    {FORMAT_NAIRA(tx.amount_paid ?? tx.amount_expected ?? 0)}
                  </td>
                  <td className="py-3 px-4 text-center">
                    <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${STATUS_COLORS[tx.payment_status] ?? STATUS_COLORS.abandoned}`}>
                      {tx.payment_status}
                    </span>
                  </td>
                  <td className="py-3 px-4 text-center">
                    <span className={`text-xs ${tx.vote_credit_status === 'credited' ? 'text-green-400' : 'text-gray-500'}`}>
                      {tx.vote_credit_status}
                    </span>
                  </td>
                  <td className="py-3 px-4 text-right text-gray-500 text-xs">
                    {new Date(tx.created_at).toLocaleDateString()}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {/* Pagination */}
      {total > limit && (
        <div className="flex items-center justify-between mt-4 text-sm text-gray-400">
          <span>Showing {offset + 1}–{Math.min(offset + limit, total)} of {total}</span>
          <div className="flex gap-2">
            <button
              onClick={() => setOffset(Math.max(0, offset - limit))}
              disabled={offset === 0}
              className="px-3 py-1.5 bg-gray-800 rounded-lg disabled:opacity-40 hover:bg-gray-700 text-xs"
            >← Prev</button>
            <button
              onClick={() => setOffset(offset + limit)}
              disabled={offset + limit >= total}
              className="px-3 py-1.5 bg-gray-800 rounded-lg disabled:opacity-40 hover:bg-gray-700 text-xs"
            >Next →</button>
          </div>
        </div>
      )}
    </div>
  );
}
