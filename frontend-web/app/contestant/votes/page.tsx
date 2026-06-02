'use client';

import { useEffect, useState, useCallback } from 'react';
import { useSearchParams } from 'next/navigation';
import { authHeaders } from '@/src/lib/auth/client';
import ShareToolkit from '@/components/voting/ShareToolkit';
import VoteCountDisplay from '@/components/voting/VoteCountDisplay';
import CountdownTimer from '@/components/voting/CountdownTimer';
import type { ContestantShareLink, VoteTotals } from '@/src/features/voting/types';
import { FORMAT_NAIRA } from '@/src/features/voting/constants';

interface Summary {
  contestId: string;
  contestantId: string;
  stageName: string | null;
  totals: VoteTotals | null;
  shareLink: ContestantShareLink | null;
  votesToNextRank: number;
  currentRank: number | null;
}

interface TimelineEntry {
  date: string;
  free: number;
  paid: number;
  total: number;
}

export default function ContestantVotesPage() {
  const searchParams = useSearchParams();
  const contestId = searchParams?.get('contestId') ?? '';

  const [summary, setSummary] = useState<Summary | null>(null);
  const [timeline, setTimeline] = useState<TimelineEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [shareMsg, setShareMsg] = useState<{ text: string; error: boolean } | null>(null);

  const load = useCallback(async () => {
    if (!contestId) return;
    const headers = await authHeaders();
    const [sumRes, tlRes] = await Promise.all([
      fetch(`/api/contestant/votes/summary?contestId=${contestId}`, { headers }),
      fetch(`/api/contestant/votes/timeline?contestId=${contestId}`, { headers }),
    ]);

    if (sumRes.ok) setSummary(await sumRes.json());
    if (tlRes.ok) {
      const json = await tlRes.json();
      setTimeline(json.timeline ?? []);
    }
    setLoading(false);
  }, [contestId]);

  useEffect(() => { load(); }, [load]);

  if (!contestId) {
    return <div className="p-8 text-gray-400">No contest selected. Add ?contestId= to the URL.</div>;
  }

  if (loading) return <div className="p-8 text-gray-400 animate-pulse">Loading your vote dashboard…</div>;
  if (!summary) return <div className="p-8 text-red-400">Failed to load summary</div>;

  const { totals, shareLink, votesToNextRank, currentRank } = summary;

  const maxVotes = timeline.length > 0 ? Math.max(...timeline.map((d) => d.total), 1) : 1;

  return (
    <div className="p-6 max-w-3xl mx-auto">
      <h1 className="text-2xl font-bold text-white mb-1">My Votes</h1>
      {summary.stageName && <p className="text-gray-400 text-sm mb-6">"{summary.stageName}"</p>}

      {/* Stats */}
      <div className="grid grid-cols-2 gap-4 mb-6">
        {totals && (
          <VoteCountDisplay
            totalVotes={totals.totalConfirmedVotes}
            rank={currentRank ?? undefined}
            className="col-span-2"
          />
        )}

        <div className="bg-gray-900 rounded-2xl p-4">
          <p className="text-xs text-gray-500 mb-1">Free Votes</p>
          <p className="text-xl font-bold text-white">{(totals?.freeVotes ?? 0).toLocaleString()}</p>
        </div>
        <div className="bg-gray-900 rounded-2xl p-4">
          <p className="text-xs text-gray-500 mb-1">Paid Votes</p>
          <p className="text-xl font-bold text-green-400">{(totals?.paidVotes ?? 0).toLocaleString()}</p>
        </div>
        <div className="bg-gray-900 rounded-2xl p-4">
          <p className="text-xs text-gray-500 mb-1">Bonus Votes</p>
          <p className="text-xl font-bold text-purple-400">{(totals?.bonusVotes ?? 0).toLocaleString()}</p>
        </div>
        <div className="bg-gray-900 rounded-2xl p-4">
          <p className="text-xs text-gray-500 mb-1">Reversed</p>
          <p className="text-xl font-bold text-red-400">{(totals?.reversedVotes ?? 0).toLocaleString()}</p>
        </div>
      </div>

      {/* Rank gap */}
      {currentRank && currentRank > 1 && votesToNextRank > 0 && (
        <div className="bg-amber-500/10 border border-amber-500/30 rounded-2xl p-4 mb-6">
          <p className="text-amber-300 text-sm font-semibold">
            You currently rank #{currentRank}. You need{' '}
            <span className="font-bold">{votesToNextRank.toLocaleString()} more votes</span> to move up to #
            {currentRank - 1}.
          </p>
          <p className="text-amber-400/70 text-xs mt-1">Share your link to get more support!</p>
        </div>
      )}
      {currentRank === 1 && (
        <div className="bg-green-500/10 border border-green-500/30 rounded-2xl p-4 mb-6">
          <p className="text-green-400 text-sm font-semibold">🥇 You are currently #1! Keep sharing to defend your lead.</p>
        </div>
      )}

      {/* Vote timeline chart */}
      {timeline.length > 0 && (
        <div className="bg-gray-900 rounded-2xl p-5 mb-6">
          <h2 className="text-sm font-bold text-white mb-4">Vote Activity (Last 30 Days)</h2>
          <div className="flex items-end gap-1 h-32">
            {timeline.map((d) => (
              <div key={d.date} className="flex-1 flex flex-col items-center gap-0.5 group relative">
                <div
                  className="w-full bg-amber-500/30 rounded-t"
                  style={{ height: `${Math.round((d.paid / maxVotes) * 100)}%`, minHeight: d.paid > 0 ? 2 : 0 }}
                />
                <div
                  className="w-full bg-green-500/40 rounded-t"
                  style={{ height: `${Math.round((d.free / maxVotes) * 100)}%`, minHeight: d.free > 0 ? 2 : 0 }}
                />
                <span className="absolute -top-5 left-1/2 -translate-x-1/2 text-xs text-white bg-gray-700 px-1 rounded opacity-0 group-hover:opacity-100 whitespace-nowrap pointer-events-none">
                  {d.date}: {d.total}
                </span>
              </div>
            ))}
          </div>
          <div className="flex gap-3 mt-2 text-xs text-gray-500">
            <span className="flex items-center gap-1"><span className="w-2 h-2 bg-green-500/40 rounded" /> Free</span>
            <span className="flex items-center gap-1"><span className="w-2 h-2 bg-amber-500/30 rounded" /> Paid</span>
          </div>
        </div>
      )}

      {/* Share toolkit */}
      {shareLink && (
        <div className="bg-gray-900 rounded-2xl p-5">
          <h2 className="text-sm font-bold text-white mb-4">Share Your Voting Link</h2>
          <ShareToolkit
            shareLink={shareLink}
            contestantName={summary.stageName ?? 'me'}
            contestName="Spotlight Contest"
          />
        </div>
      )}
    </div>
  );
}
