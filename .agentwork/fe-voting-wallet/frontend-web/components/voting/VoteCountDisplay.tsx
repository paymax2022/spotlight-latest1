'use client';

interface Props {
  totalVotes: number;
  rank?: number;
  className?: string;
}

export default function VoteCountDisplay({ totalVotes, rank, className = '' }: Props) {
  return (
    <div className={`flex items-center gap-4 ${className}`}>
      <div className="bg-amber-500/10 border border-amber-500/30 rounded-xl px-4 py-2.5 text-center">
        <p className="text-amber-400 text-xs font-medium uppercase tracking-wider">Total Votes</p>
        <p className="text-white text-2xl font-bold">{totalVotes.toLocaleString()}</p>
      </div>
      {rank != null && (
        <div className="bg-purple-500/10 border border-purple-500/30 rounded-xl px-4 py-2.5 text-center">
          <p className="text-purple-400 text-xs font-medium uppercase tracking-wider">Current Rank</p>
          <p className="text-white text-2xl font-bold">#{rank}</p>
        </div>
      )}
    </div>
  );
}
