'use client';

import { useEffect, useState, useCallback } from 'react';
import { useParams, useSearchParams } from 'next/navigation';
import Link from 'next/link';
import VoteModal from '@/components/voting/VoteModal';
import VoteCountDisplay from '@/components/voting/VoteCountDisplay';
import ShareToolkit from '@/components/voting/ShareToolkit';
import CountdownTimer from '@/components/voting/CountdownTimer';
import type { VotingSettings, VotePackage, LeaderboardEntry, ContestantShareLink } from '@/src/features/voting/types';
import { FORMAT_NAIRA } from '@/src/features/voting/constants';

interface ContestantProfile {
  id: string;
  name: string;
  stageName: string | null;
  photoUrl: string | null;
  bio: string | null;
  category: string | null;
  state: string | null;
  videoUrl: string | null;
  audioUrl: string | null;
  contestName: string;
  contestSlug: string;
  // Eviction status fields (Phase 4)
  eviction_status?: 'none' | 'pending' | 'saved' | 'finalized';
  eviction_template?: 'normal' | 'evicted' | 'saved';
  grace_period_ends_at?: string;
  current_stage_number?: number;
}

interface PageData {
  contestant: ContestantProfile;
  settings: VotingSettings;
  packages: VotePackage[];
  totals: LeaderboardEntry | null;
  shareLink: ContestantShareLink | null;
  freeVotesRemaining: number;
  freeVotesPerDay: number;
  resetAt: string;
}

const GracePeriodCountdown = ({ endsAt }: { endsAt: string }) => {
  const [hoursRemaining, setHoursRemaining] = useState(0);
  const [minutesRemaining, setMinutesRemaining] = useState(0);

  useEffect(() => {
    const updateCounter = () => {
      const endDate = new Date(endsAt);
      const now = new Date();
      const diff = (endDate.getTime() - now.getTime()) / 1000 / 60; // minutes
      setHoursRemaining(Math.floor(diff / 60));
      setMinutesRemaining(Math.floor(diff % 60));
    };

    updateCounter();
    const interval = setInterval(updateCounter, 10000); // Update every 10s
    return () => clearInterval(interval);
  }, [endsAt]);

  if (hoursRemaining <= 0 && minutesRemaining <= 0) {
    return <span className="text-red-400 font-semibold">Grace period expired</span>;
  }

  return (
    <span className="text-orange-300 font-semibold">
      {hoursRemaining > 0 ? `${hoursRemaining}h ${minutesRemaining}m remaining` : `${minutesRemaining}m remaining`}
    </span>
  );
};

export default function PublicVotingPage() {
  const params = useParams() ?? {};
  const searchParams = useSearchParams();
  const contestSlug = (params as any).contestSlug as string;
  const contestantSlug = (params as any).contestantSlug as string;
  const shareCode = searchParams?.get('ref') ?? undefined;

  const [data, setData] = useState<PageData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [showVoteModal, setShowVoteModal] = useState(false);
  const [voteSuccess, setVoteSuccess] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      setLoading(true);
      const res = await fetch(
        `/api/vote-page?contestSlug=${contestSlug}&contestantSlug=${contestantSlug}${shareCode ? `&ref=${shareCode}` : ''}`,
      );
      if (!res.ok) throw new Error('Failed to load contestant profile');
      const json = await res.json();
      setData(json);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load');
    } finally {
      setLoading(false);
    }
  }, [contestSlug, contestantSlug, shareCode]);

  useEffect(() => {
    load();
  }, [load]);

  // SSE — real-time vote count updates
  useEffect(() => {
    if (!data?.contestant.id || !data?.settings.contestId) return;
    const url = `/api/votes/stream?contestId=${data.settings.contestId}&contestantId=${data.contestant.id}`;
    const es = new EventSource(url);
    es.onmessage = (e) => {
      try {
        const update = JSON.parse(e.data) as { totalConfirmedVotes: number; rank: number };
        setData((prev) =>
          prev
            ? {
                ...prev,
                totals: prev.totals
                  ? { ...prev.totals, totalConfirmedVotes: update.totalConfirmedVotes, rank: update.rank }
                  : prev.totals,
              }
            : prev,
        );
      } catch {}
    };
    return () => es.close();
  }, [data?.contestant.id, data?.settings.contestId]);

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-950">
        <div className="text-white text-lg animate-pulse">Loading…</div>
      </div>
    );
  }

  if (error || !data) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-950">
        <div className="text-center text-white">
          <p className="text-xl font-semibold">Contestant not found</p>
          <p className="text-gray-400 mt-2">{error}</p>
        </div>
      </div>
    );
  }

  const { contestant, settings, packages, totals, shareLink, freeVotesRemaining, freeVotesPerDay, resetAt } = data;

  // Determine if contestant is evicted or has pending eviction
  const isEvicted = contestant.eviction_status === 'finalized';
  const isPendingEviction = contestant.eviction_status === 'pending';
  const isSaved = contestant.eviction_status === 'saved';
  const isAppliedEvictionTemplate = contestant.eviction_template === 'evicted';

  return (
    <main className="min-h-screen bg-gradient-to-b from-gray-950 via-gray-900 to-gray-950 text-white">
      {/* Contest Header */}
      <div className="bg-amber-600 text-black text-sm text-center py-2 font-semibold">
        {contestant.contestName} — Voting is LIVE
      </div>

      <div className="max-w-2xl mx-auto px-4 py-8">
        {/* Contestant Card — with eviction template styling */}
        <div className={`${isAppliedEvictionTemplate ? 'opacity-75 bg-gray-800' : 'bg-gray-900'} rounded-2xl overflow-hidden shadow-2xl transition-all`}>
          {/* Photo / Video — darkened if evicted */}
          <div className={isAppliedEvictionTemplate ? 'relative' : ''}>
            {contestant.videoUrl ? (
              <div className="aspect-video bg-black">
                <video src={contestant.videoUrl} controls className={`w-full h-full object-cover ${isAppliedEvictionTemplate ? 'opacity-50' : ''}`} />
              </div>
            ) : contestant.photoUrl ? (
              <img src={contestant.photoUrl} alt={contestant.name} className={`w-full aspect-[4/3] object-cover ${isAppliedEvictionTemplate ? 'opacity-50' : ''}`} />
            ) : (
              <div className={`aspect-[4/3] bg-gray-800 flex items-center justify-center ${isAppliedEvictionTemplate ? 'opacity-50' : ''}`}>
                <span className="text-6xl text-gray-600">🎤</span>
              </div>
            )}

            {/* Eviction Overlay */}
            {isAppliedEvictionTemplate && (
              <div className="absolute inset-0 flex items-center justify-center bg-black/60 backdrop-blur-sm">
                <div className="text-center">
                  <p className="text-4xl mb-2">✕</p>
                  <p className="text-white font-bold text-lg">Evicted</p>
                </div>
              </div>
            )}
          </div>

          {/* Info */}
          <div className="p-6">
            <div className="flex items-start justify-between mb-2">
              <p className="text-amber-400 text-sm font-medium uppercase tracking-wider">
                {contestant.category ?? contestant.contestName}
              </p>

              {/* Eviction Status Badge */}
              {isEvicted && (
                <span className="px-3 py-1 rounded-full text-xs font-semibold bg-red-900/50 text-red-300 whitespace-nowrap ml-2">
                  ✕ Removed
                </span>
              )}
              {isPendingEviction && (
                <span className="px-3 py-1 rounded-full text-xs font-semibold bg-orange-900/50 text-orange-300 whitespace-nowrap ml-2">
                  ⚠ At Risk
                </span>
              )}
              {isSaved && (
                <span className="px-3 py-1 rounded-full text-xs font-semibold bg-green-900/50 text-green-300 whitespace-nowrap ml-2">
                  ✓ Saved
                </span>
              )}
            </div>

            <h1 className={`text-3xl font-bold mt-1 ${isAppliedEvictionTemplate ? 'text-gray-400' : ''}`}>
              {contestant.name}
            </h1>

            {contestant.stageName && contestant.stageName !== contestant.name && (
              <p className="text-gray-400 text-sm mt-0.5">"{contestant.stageName}"</p>
            )}

            {contestant.state && (
              <p className="text-gray-500 text-sm mt-1">📍 {contestant.state}</p>
            )}

            {contestant.bio && (
              <p className="text-gray-300 mt-3 text-sm leading-relaxed">{contestant.bio}</p>
            )}

            {/* Eviction Alert */}
            {isPendingEviction && contestant.grace_period_ends_at && (
              <div className="mt-4 bg-orange-900/20 border border-orange-700 rounded-lg p-4">
                <div className="flex items-start gap-3">
                  <span className="text-xl mt-0.5">⚠️</span>
                  <div>
                    <p className="font-semibold text-orange-300">In Eviction Grace Period</p>
                    <p className="text-sm text-orange-200 mt-1">
                      This contestant is at risk of removal. You can still vote and support them during the grace period: <GracePeriodCountdown endsAt={contestant.grace_period_ends_at} />
                    </p>
                  </div>
                </div>
              </div>
            )}

            {isEvicted && (
              <div className="mt-4 bg-red-900/20 border border-red-700 rounded-lg p-4">
                <div className="flex items-start gap-3">
                  <span className="text-xl mt-0.5">✕</span>
                  <div>
                    <p className="font-semibold text-red-300">Contestant Removed</p>
                    <p className="text-sm text-red-200 mt-1">
                      This contestant has been removed from this stage and is no longer eligible for votes.
                    </p>
                  </div>
                </div>
              </div>
            )}

            {isSaved && (
              <div className="mt-4 bg-green-900/20 border border-green-700 rounded-lg p-4">
                <div className="flex items-start gap-3">
                  <span className="text-xl mt-0.5">✓</span>
                  <div>
                    <p className="font-semibold text-green-300">Saved from Eviction</p>
                    <p className="text-sm text-green-200 mt-1">
                      This contestant was saved and will continue to the next stage.
                    </p>
                  </div>
                </div>
              </div>
            )}

            {/* Vote counts */}
            {settings.showPublicVoteCount && totals && (
              <VoteCountDisplay
                totalVotes={totals.totalConfirmedVotes}
                rank={settings.showPublicRank ? (totals.rank ?? undefined) : undefined}
                className="mt-4"
              />
            )}

            {/* Countdown */}
            {settings.votingEndsAt && (
              <CountdownTimer endsAt={settings.votingEndsAt} className="mt-4" />
            )}

            {/* Vote success message */}
            {voteSuccess && (
              <div className="mt-4 bg-green-600/20 border border-green-500 rounded-xl p-4 text-green-400 text-sm font-medium">
                ✅ {voteSuccess}
              </div>
            )}

            {/* Vote button — disabled if evicted */}
            {settings.votingEnabled && !isEvicted && (
              <button
                onClick={() => setShowVoteModal(true)}
                disabled={isPendingEviction} // warn but allow voting during grace period
                className={`mt-6 w-full font-bold py-4 rounded-xl text-lg transition-all shadow-lg active:scale-95 ${
                  isPendingEviction
                    ? 'bg-orange-500 hover:bg-orange-400 text-black shadow-orange-500/30'
                    : 'bg-amber-500 hover:bg-amber-400 text-black shadow-amber-500/30'
                }`}
              >
                {isPendingEviction ? '⚠️ Vote to Save' : `Vote for ${contestant.name}`}
              </button>
            )}

            {isEvicted && (
              <div className="mt-6 w-full py-4 rounded-xl text-center text-sm font-medium bg-gray-700/50 text-gray-400 cursor-not-allowed">
                Voting Closed — Contestant Removed
              </div>
            )}

            {/* Free votes indicator */}
            {settings.freeVotingEnabled && !isEvicted && (
              <p className="text-center text-sm text-gray-400 mt-2">
                {freeVotesRemaining > 0
                  ? `You have ${freeVotesRemaining} free vote${freeVotesRemaining !== 1 ? 's' : ''} remaining today`
                  : `Your free votes reset at midnight`}
              </p>
            )}

            {/* Share */}
            {settings.allowVoteSharing && shareLink && !isEvicted && (
              <ShareToolkit
                shareLink={shareLink}
                contestantName={contestant.name}
                contestName={contestant.contestName}
                className="mt-6"
              />
            )}
          </div>
        </div>

        {/* Leaderboard link */}
        {settings.showPublicLeaderboard && (
          <div className="mt-4 text-center">
            <Link
              href={`/vote/${contestantSlug}?leaderboard=1`}
              className="text-amber-400 hover:text-amber-300 text-sm underline"
            >
              View full leaderboard →
            </Link>
          </div>
        )}

        {/* Rules */}
        <div className="mt-8 bg-gray-900/50 rounded-xl p-4 text-xs text-gray-500">
          <p className="font-semibold text-gray-400 mb-1">Voting Rules</p>
          <ul className="list-disc list-inside space-y-1">
            <li>Free voting: {freeVotesPerDay} votes per day per voter</li>
            {settings.paidVotingEnabled && <li>Buy votes for unlimited support — no daily limit on paid votes</li>}
            <li>Only confirmed votes count toward rankings</li>
            <li>Contestants in eviction may be removed at the end of the grace period if not saved</li>
            <li>Vote manipulation and bot voting are prohibited</li>
            <li>Spotlight reserves the right to reverse fraudulent votes</li>
          </ul>
        </div>
      </div>

      {/* Vote Modal */}
      {showVoteModal && !isEvicted && (
        <VoteModal
          contestId={settings.contestId}
          contestantId={contestant.id}
          contestantName={contestant.name}
          packages={packages}
          settings={settings}
          freeVotesRemaining={freeVotesRemaining}
          shareCode={shareCode}
          onClose={() => setShowVoteModal(false)}
          onVoteSuccess={(msg) => {
            setVoteSuccess(msg);
            setShowVoteModal(false);
            load();
          }}
        />
      )}
    </main>
  );
}
