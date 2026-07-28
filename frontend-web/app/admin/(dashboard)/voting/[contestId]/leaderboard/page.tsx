'use client';

import { useEffect, useState, useCallback } from 'react';
import { useParams } from 'next/navigation';
import { authHeaders } from '@/src/lib/auth/client';
import type { LeaderboardEntry } from '@/src/features/voting/types';

export default function AdminLeaderboardPage() {
  const { contestId } = useParams() as { contestId: string };
  const [leaderboard, setLeaderboard] = useState<LeaderboardEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [freezing, setFreezing] = useState(false);
  const [frozen, setFrozen] = useState(false);
  const [adjustId, setAdjustId] = useState('');
  const [adjustQty, setAdjustQty] = useState(0);
  const [adjustReason, setAdjustReason] = useState('');
  const [adjustType, setAdjustType] = useState<'add' | 'subtract'>('add');
  const [adjustMsg, setAdjustMsg] = useState('');

  const load = useCallback(async () => {
    const headers = await authHeaders();
    const res = await fetch(`/api/admin/voting/${contestId}/leaderboard?limit=200`, { headers });
    if (res.ok) {
      const json = await res.json();
      setLeaderboard(json.leaderboard ?? []);
      setFrozen(json.frozen ?? false);
    }
    setLoading(false);
  }, [contestId]);

  useEffect(() => { load(); }, [load]);

  async function toggleFreeze() {
    setFreezing(true);
    const headers = await authHeaders(true);
    await fetch(`/api/admin/voting/${contestId}/freeze`, {
      method: 'POST',
      headers,
      body: JSON.stringify({ action: frozen ? 'unfreeze' : 'freeze' }),
    });
    setFrozen(!frozen);
    setFreezing(false);
    load();
  }

  async function applyAdjustment() {
    if (!adjustId || adjustQty <= 0 || adjustReason.length < 5) {
      setAdjustMsg('Fill all fields (reason must be ≥ 5 chars)');
      return;
    }
    const headers = await authHeaders(true);
    const res = await fetch(`/api/admin/voting/${contestId}/adjust`, {
      method: 'POST',
      headers,
      body: JSON.stringify({ contestantId: adjustId, adjustmentType: adjustType, voteQuantity: adjustQty, reason: adjustReason }),
    });
    const json = await res.json();
    setAdjustMsg(json.success ? `✅ Done: ${json.beforeTotal} → ${json.afterTotal}` : `❌ ${json.error}`);
    if (json.success) { setAdjustId(''); setAdjustQty(0); setAdjustReason(''); load(); }
  }

  if (loading) return <div className="p-8 text-gray-400 animate-pulse">Loading leaderboard…</div>;

  return (
    <div className="p-6 max-w-5xl mx-auto">
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-xl font-bold text-white">Live Leaderboard</h1>
        <div className="flex gap-2">
          <button onClick={load} className="text-xs bg-gray-700 hover:bg-gray-600 text-white px-3 py-2 rounded-lg">
            Refresh
          </button>
          <button
            onClick={toggleFreeze}
            disabled={freezing}
            className={`text-xs font-bold px-3 py-2 rounded-lg transition-all ${
              frozen ? 'bg-green-600 hover:bg-green-500 text-white' : 'bg-red-700 hover:bg-red-600 text-white'
            }`}
          >
            {freezing ? '…' : frozen ? '🔓 Unfreeze' : '🔒 Freeze Leaderboard'}
          </button>
        </div>
      </div>

      {frozen && (
        <div className="bg-amber-600/10 border border-amber-500 rounded-xl p-3 text-amber-400 text-sm mb-4">
          Leaderboard is frozen — showing last snapshot.
        </div>
      )}

      {/* Leaderboard table */}
      <div className="bg-gray-900 rounded-2xl overflow-hidden mb-8">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-gray-800 text-gray-400 text-xs uppercase tracking-wider">
              <th className="py-3 px-4 text-left">#</th>
              <th className="py-3 px-4 text-left">Contestant</th>
              <th className="py-3 px-4 text-right">Total Votes</th>
              <th className="py-3 px-4 text-right">Free</th>
              <th className="py-3 px-4 text-right">Paid</th>
              <th className="py-3 px-4 text-right">Last Vote</th>
              <th className="py-3 px-4 text-right">Actions</th>
            </tr>
          </thead>
          <tbody>
            {leaderboard.map((entry) => (
              <tr key={entry.contestantId} className="border-b border-gray-800/50 hover:bg-gray-800/30">
                <td className="py-3 px-4">
                  <span className={`font-bold ${entry.rank <= 3 ? 'text-amber-400' : 'text-gray-400'}`}>
                    {entry.rank <= 3 ? ['🥇', '🥈', '🥉'][entry.rank - 1] : `#${entry.rank}`}
                  </span>
                </td>
                <td className="py-3 px-4">
                  <p className="text-white font-medium">{entry.contestantName || 'Unknown'}</p>
                  {entry.stageName && <p className="text-gray-500 text-xs">{entry.stageName}</p>}
                </td>
                <td className="py-3 px-4 text-right font-bold text-amber-400">
                  {entry.totalConfirmedVotes.toLocaleString()}
                </td>
                <td className="py-3 px-4 text-right text-gray-400">{entry.freeVotes.toLocaleString()}</td>
                <td className="py-3 px-4 text-right text-green-400">{entry.paidVotes.toLocaleString()}</td>
                <td className="py-3 px-4 text-right text-gray-500 text-xs">
                  {entry.lastVoteAt ? new Date(entry.lastVoteAt).toLocaleString() : '—'}
                </td>
                <td className="py-3 px-4 text-right">
                  <button
                    onClick={() => setAdjustId(entry.contestantId)}
                    className="text-xs text-amber-400 hover:text-amber-300 underline"
                  >
                    Adjust
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Vote Adjustment Panel */}
      <div className="bg-gray-900 rounded-2xl p-5">
        <h2 className="text-sm font-bold text-white mb-4">Manual Vote Adjustment</h2>
        <p className="text-xs text-red-400 mb-3">All adjustments are logged and audited. A reason is mandatory.</p>
        <div className="grid grid-cols-2 gap-3">
          <input
            placeholder="Contestant ID"
            value={adjustId}
            onChange={(e) => setAdjustId(e.target.value)}
            className="col-span-2 bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-white text-sm"
          />
          <select
            value={adjustType}
            onChange={(e) => setAdjustType(e.target.value as 'add' | 'subtract')}
            className="bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-white text-sm"
          >
            <option value="add">Add votes</option>
            <option value="subtract">Subtract votes</option>
          </select>
          <input
            type="number"
            min={1}
            placeholder="Vote quantity"
            value={adjustQty || ''}
            onChange={(e) => setAdjustQty(Number(e.target.value))}
            className="bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-white text-sm"
          />
          <input
            placeholder="Reason (min 5 characters)"
            value={adjustReason}
            onChange={(e) => setAdjustReason(e.target.value)}
            className="col-span-2 bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-white text-sm"
          />
        </div>
        {adjustMsg && <p className={`text-sm mt-2 ${adjustMsg.startsWith('✅') ? 'text-green-400' : 'text-red-400'}`}>{adjustMsg}</p>}
        <button
          onClick={applyAdjustment}
          className="mt-3 bg-amber-500 hover:bg-amber-400 text-black font-bold px-5 py-2 rounded-xl text-sm"
        >
          Apply Adjustment
        </button>
      </div>
    </div>
  );
}
