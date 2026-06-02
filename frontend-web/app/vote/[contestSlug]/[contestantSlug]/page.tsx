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

  return (
    <main className="min-h-screen bg-gradient-to-b from-gray-950 via-gray-900 to-gray-950 text-white">
      {/* Contest Header */}
      <div className="bg-amber-600 text-black text-sm text-center py-2 font-semibold">
        {contestant.contestName} — Voting is LIVE
      </div>

      <div className="max-w-2xl mx-auto px-4 py-8">
        {/* Contestant Card */}
        <div className="bg-gray-900 rounded-2xl overflow-hidden shadow-2xl">
          {/* Photo / Video */}
          {contestant.videoUrl ? (
            <div className="aspect-video bg-black">
              <video src={contestant.videoUrl} controls className="w-full h-full object-cover" />
            </div>
          ) : contestant.photoUrl ? (
            <img src={contestant.photoUrl} alt={contestant.name} className="w-full aspect-[4/3] object-cover" />
          ) : (
            <div className="aspect-[4/3] bg-gray-800 flex items-center justify-center">
              <span className="text-6xl text-gray-600">🎤</span>
            </div>
          )}

          {/* Info */}
          <div className="p-6">
            <p className="text-amber-400 text-sm font-medium uppercase tracking-wider">
              {contestant.category ?? contestant.contestName}
            </p>
            <h1 className="text-3xl font-bold mt-1">{contestant.name}</h1>
            {contestant.stageName && contestant.stageName !== contestant.name && (
              <p className="text-gray-400 text-sm mt-0.5">"{contestant.stageName}"</p>
            )}
            {contestant.state && (
              <p className="text-gray-500 text-sm mt-1">📍 {contestant.state}</p>
            )}
            {contestant.bio && (
              <p className="text-gray-300 mt-3 text-sm leading-relaxed">{contestant.bio}</p>
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

            {/* Vote button */}
            {settings.votingEnabled && (
              <button
                onClick={() => setShowVoteModal(true)}
                className="mt-6 w-full bg-amber-500 hover:bg-amber-400 text-black font-bold py-4 rounded-xl text-lg transition-all shadow-lg shadow-amber-500/30 active:scale-95"
              >
                Vote for {contestant.name}
              </button>
            )}

            {/* Free votes indicator */}
            {settings.freeVotingEnabled && (
              <p className="text-center text-sm text-gray-400 mt-2">
                {freeVotesRemaining > 0
                  ? `You have ${freeVotesRemaining} free vote${freeVotesRemaining !== 1 ? 's' : ''} remaining today`
                  : `Your free votes reset at midnight`}
              </p>
            )}

            {/* Share */}
            {settings.allowVoteSharing && shareLink && (
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
            <li>Vote manipulation and bot voting are prohibited</li>
            <li>Spotlight reserves the right to reverse fraudulent votes</li>
          </ul>
        </div>
      </div>

      {/* Vote Modal */}
      {showVoteModal && (
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
