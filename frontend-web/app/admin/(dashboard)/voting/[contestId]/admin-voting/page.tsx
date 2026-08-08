'use client';

import { useEffect, useState } from 'react';
import { useParams } from 'next/navigation';
import { authHeaders } from '@/src/lib/auth/client';

interface Contestant {
  id: string;
  name: string;
  photo_url: string;
  vote_count: number;
  eviction_status: string;
  eviction_template: string;
}

interface ContestantsResponse {
  data: Contestant[];
  error?: string;
}

export default function AdminVotingInterface() {
  const params = useParams();
  const contestId = (params?.contestId as string) || 'default';

  const [contestants, setContestants] = useState<Contestant[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [selectedContestantId, setSelectedContestantId] = useState<string | null>(null);
  const [voteQuantity, setVoteQuantity] = useState(1);
  const [votingInProgress, setVotingInProgress] = useState(false);
  const [searchTerm, setSearchTerm] = useState('');
  const [stageNumber, setStageNumber] = useState(1);

  useEffect(() => {
    loadContestants();
  }, [contestId, stageNumber]);

  const loadContestants = async () => {
    try {
      setLoading(true);
      const headers = await authHeaders();
      const res = await fetch(
        `/api/v1/connect/contests/${contestId}/stages/${stageNumber}/contestants`,
        { headers }
      );
      if (!res.ok) throw new Error(`Failed to load contestants: ${res.status}`);
      const json: ContestantsResponse = await res.json();
      setContestants(json.data || []);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unknown error');
    } finally {
      setLoading(false);
    }
  };

  const handleCastVote = async (contestantId: string) => {
    if (voteQuantity < 1) {
      alert('Vote quantity must be at least 1');
      return;
    }

    setVotingInProgress(true);
    try {
      const headers = await authHeaders();
      const res = await fetch(`/api/v1/connect/contests/${contestId}/admin-vote`, {
        method: 'POST',
        headers: { ...headers, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contestant_id: contestantId,
          vote_quantity: voteQuantity,
        }),
      });

      if (!res.ok) throw new Error('Failed to cast vote');

      setSuccess(`${voteQuantity} admin votes cast successfully!`);
      setSelectedContestantId(null);
      setVoteQuantity(1);
      await loadContestants();
    } catch (err) {
      alert(err instanceof Error ? err.message : 'Failed to cast vote');
    } finally {
      setVotingInProgress(false);
    }
  };

  const filteredContestants = contestants.filter((c) =>
    c.name.toLowerCase().includes(searchTerm.toLowerCase())
  );

  return (
    <div className="p-6 max-w-7xl mx-auto">
      <div className="flex items-center justify-between mb-8">
        <div>
          <h1 className="text-2xl font-bold text-white">Admin Voting Console</h1>
          <p className="text-gray-400 text-sm mt-1">Cast unlimited votes for contestants (no payment required)</p>
        </div>
      </div>

      {error && (
        <div className="mb-6 p-4 rounded-lg bg-red-900/20 border border-red-700 text-red-300">
          {error}
          <button
            onClick={() => setError(null)}
            className="float-right text-xl leading-none"
          >
            ✕
          </button>
        </div>
      )}

      {success && (
        <div className="mb-6 p-4 rounded-lg bg-green-900/20 border border-green-700 text-green-300">
          {success}
          <button
            onClick={() => setSuccess(null)}
            className="float-right text-xl leading-none"
          >
            ✕
          </button>
        </div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-4 gap-6 mb-8">
        <div className="lg:col-span-3">
          <label className="block text-sm font-medium text-gray-300 mb-2">Search Contestants</label>
          <input
            type="text"
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            placeholder="Search by name..."
            className="w-full px-4 py-2 rounded-lg bg-gray-800 border border-gray-700 text-white placeholder-gray-500 focus:border-blue-500 transition"
          />
        </div>

        <div>
          <label className="block text-sm font-medium text-gray-300 mb-2">Stage</label>
          <input
            type="number"
            min="1"
            value={stageNumber}
            onChange={(e) => setStageNumber(Math.max(1, parseInt(e.target.value) || 1))}
            className="w-full px-4 py-2 rounded-lg bg-gray-800 border border-gray-700 text-white focus:border-blue-500 transition"
          />
        </div>
      </div>

      {loading ? (
        <div className="p-8 text-gray-400 animate-pulse">Loading contestants…</div>
      ) : filteredContestants.length === 0 ? (
        <div className="bg-gray-800 rounded-lg p-12 text-center border border-gray-700">
          <p className="text-gray-400">
            {searchTerm ? 'No contestants match your search.' : 'No contestants found for this stage.'}
          </p>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {filteredContestants.map((contestant) => (
            <div
              key={contestant.id}
              className={`p-4 rounded-lg border transition cursor-pointer ${
                selectedContestantId === contestant.id
                  ? 'bg-blue-900/20 border-blue-600'
                  : 'bg-gray-800 border-gray-700 hover:border-gray-600'
              }`}
              onClick={() => setSelectedContestantId(contestant.id)}
            >
              <div className="flex items-start justify-between mb-3">
                <div className="flex-1">
                  <h3 className="text-white font-semibold">{contestant.name}</h3>
                  <p className="text-gray-400 text-sm">{contestant.vote_count} votes</p>
                </div>
                {contestant.photo_url && (
                  <img
                    src={contestant.photo_url}
                    alt={contestant.name}
                    className="w-12 h-12 rounded-full object-cover"
                  />
                )}
              </div>

              {contestant.eviction_status === 'pending' && (
                <div className="mb-3 px-2 py-1 rounded-full bg-orange-900/50 text-orange-300 text-xs font-semibold w-fit">
                  ⚠️ Marked for Eviction
                </div>
              )}

              {contestant.eviction_status === 'saved' && (
                <div className="mb-3 px-2 py-1 rounded-full bg-green-900/50 text-green-300 text-xs font-semibold w-fit">
                  ✓ Saved from Eviction
                </div>
              )}

              {selectedContestantId === contestant.id && (
                <div className="mt-4 pt-4 border-t border-gray-700">
                  <label className="block text-sm font-medium text-gray-300 mb-2">
                    Number of Votes to Cast
                  </label>
                  <div className="flex gap-2 mb-3">
                    <input
                      type="number"
                      min="1"
                      max="100000"
                      value={voteQuantity}
                      onChange={(e) => setVoteQuantity(Math.max(1, parseInt(e.target.value) || 1))}
                      className="flex-1 px-3 py-2 rounded-lg bg-gray-700 border border-gray-600 text-white"
                    />
                    <button
                      onClick={() => setVoteQuantity(Math.max(1, voteQuantity - 1))}
                      className="px-3 py-2 rounded-lg bg-gray-700 border border-gray-600 text-white hover:bg-gray-600 transition"
                    >
                      -
                    </button>
                    <button
                      onClick={() => setVoteQuantity(voteQuantity + 1)}
                      className="px-3 py-2 rounded-lg bg-gray-700 border border-gray-600 text-white hover:bg-gray-600 transition"
                    >
                      +
                    </button>
                  </div>

                  <button
                    onClick={() => handleCastVote(contestant.id)}
                    disabled={votingInProgress}
                    className="w-full px-4 py-2 rounded-lg bg-green-600 text-white hover:bg-green-700 disabled:bg-gray-600 transition font-medium"
                  >
                    {votingInProgress ? 'Casting...' : `Cast ${voteQuantity} Vote${voteQuantity !== 1 ? 's' : ''}`}
                  </button>
                </div>
              )}
            </div>
          ))}
        </div>
      )}

      <div className="mt-8 p-6 rounded-lg bg-blue-900/10 border border-blue-700/50">
        <h3 className="text-lg font-semibold text-blue-300 mb-2">ℹ️ Admin Voting Info</h3>
        <ul className="text-gray-300 text-sm space-y-1">
          <li>• Admins can cast unlimited votes without payment</li>
          <li>• Votes are recorded as admin adjustments in the audit log</li>
          <li>• Each vote is timestamped and attributed to the admin user</li>
          <li>• Use this to correct for fraud, support promotion, or balance contested votes</li>
        </ul>
      </div>
    </div>
  );
}
