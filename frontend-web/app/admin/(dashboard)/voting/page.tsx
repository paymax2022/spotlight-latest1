'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { authHeaders } from '@/src/lib/auth/client';

interface ContestVotingSummary {
  contestId: string;
  contestName: string;
  contestSlug: string;
  status: string;
  votingEnabled: boolean;
  votingType: string;
  totalVotes: number;
  totalRevenue: number;
  openFraudFlags: number;
  votingEndsAt: string | null;
}

export default function AdminVotingDashboard() {
  const [contests, setContests] = useState<ContestVotingSummary[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    (async () => {
      const headers = await authHeaders();
      const res = await fetch('/api/admin/voting/settings', { headers });
      if (res.ok) {
        const json = await res.json();
        setContests(json.settings ?? []);
      }
      setLoading(false);
    })();
  }, []);

  if (loading) return <div className="p-8 text-gray-400 animate-pulse">Loading voting dashboard…</div>;

  return (
    <div className="p-6 max-w-6xl mx-auto">
      <div className="flex items-center justify-between mb-8">
        <div>
          <h1 className="text-2xl font-bold text-white">Voting Engine</h1>
          <p className="text-gray-400 text-sm mt-1">Manage voting for all active contests</p>
        </div>
      </div>

      {contests.length === 0 ? (
        <div className="bg-gray-800 rounded-2xl p-12 text-center">
          <p className="text-gray-400">No voting settings configured yet.</p>
          <p className="text-gray-500 text-sm mt-2">Open a contest and enable voting in its settings.</p>
        </div>
      ) : (
        <div className="grid gap-4">
          {contests.map((c) => (
            <div key={c.contestId} className="bg-gray-800 rounded-2xl p-5 flex items-center justify-between gap-4">
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2">
                  <h3 className="text-white font-semibold truncate">{c.contestName || c.contestSlug || c.contestId}</h3>
                  <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${
                    c.status === 'active' ? 'bg-green-600/20 text-green-400' : 'bg-gray-700 text-gray-400'
                  }`}>
                    {c.status}
                  </span>
                  {c.votingEnabled && (
                    <span className="text-xs px-2 py-0.5 rounded-full bg-amber-600/20 text-amber-400 font-medium">
                      Voting ON
                    </span>
                  )}
                </div>
                <div className="flex gap-4 mt-2 text-sm text-gray-400">
                  <span>Type: {c.votingType}</span>
                </div>
              </div>

              <div className="flex items-center gap-2 shrink-0">
                <Link
                  href={`/admin/voting/${c.contestId}/settings`}
                  className="bg-gray-700 hover:bg-gray-600 text-white text-xs px-3 py-2 rounded-lg transition-all"
                >
                  Settings
                </Link>
                <Link
                  href={`/admin/voting/${c.contestId}/leaderboard`}
                  className="bg-gray-700 hover:bg-gray-600 text-white text-xs px-3 py-2 rounded-lg transition-all"
                >
                  Leaderboard
                </Link>
                <Link
                  href={`/admin/voting/${c.contestId}/revenue`}
                  className="bg-amber-600 hover:bg-amber-500 text-white text-xs px-3 py-2 rounded-lg transition-all"
                >
                  Revenue
                </Link>
                <Link
                  href={`/admin/voting/${c.contestId}/fraud`}
                  className="bg-red-700 hover:bg-red-600 text-white text-xs px-3 py-2 rounded-lg transition-all"
                >
                  Fraud
                </Link>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
