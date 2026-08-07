'use client';

import { useEffect, useState } from 'react';
import { useParams } from 'next/navigation';
import { authHeaders } from '@/src/lib/auth/client';

interface Eviction {
  id: string;
  contestant_id: string;
  contestant_name: string;
  stage_number: number;
  vote_count: number;
  eviction_rank: number;
  grace_period_ends_at: string;
  status: 'pending' | 'saved' | 'finalized';
  save_count: number;
  can_be_saved: boolean;
}

interface EvictionsResponse {
  data: Eviction[];
  error?: string;
}

export default function EvictionManagement() {
  const params = useParams();
  const contestId = params.contestId as string;
  const stageNum = params.stageNum as string;

  const [evictions, setEvictions] = useState<Eviction[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [savingEvictionId, setSavingEvictionId] = useState<string | null>(null);
  const [triggeringEvictions, setTriggeringEvictions] = useState(false);
  const [finalizingEvictions, setFinalizingEvictions] = useState(false);
  const [extendingGracePeriod, setExtendingGracePeriod] = useState<string | null>(null);
  const [saveReason, setSaveReason] = useState<{ [key: string]: string }>({});

  useEffect(() => {
    loadEvictions();
    // Poll for updates every 10 seconds
    const interval = setInterval(loadEvictions, 10000);
    return () => clearInterval(interval);
  }, [contestId, stageNum]);

  const loadEvictions = async () => {
    try {
      const headers = await authHeaders();
      const res = await fetch(
        `/api/v1/connect/contests/${contestId}/evictions?stage=${stageNum}`,
        { headers }
      );
      if (!res.ok) throw new Error(`Failed to load evictions: ${res.status}`);
      const json: EvictionsResponse = await res.json();
      setEvictions(json.data || []);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unknown error');
    } finally {
      setLoading(false);
    }
  };

  const handleTriggerEvictions = async () => {
    if (!confirm('This will mark the bottom 20% of contestants for eviction. Continue?')) return;

    setTriggeringEvictions(true);
    try {
      const headers = await authHeaders();
      const res = await fetch(
        `/api/v1/connect/contests/${contestId}/stages/${stageNum}/evict`,
        {
          method: 'POST',
          headers: { ...headers, 'Content-Type': 'application/json' },
          body: JSON.stringify({
            stage_number: parseInt(stageNum),
            eviction_percentage: 20,
            grace_period_hours: 24,
          }),
        }
      );

      if (!res.ok) throw new Error('Failed to trigger evictions');

      setSuccess(`Evictions triggered! ${res.headers.get('x-count') || 'Multiple'} contestants marked.`);
      await loadEvictions();
    } catch (err) {
      alert(err instanceof Error ? err.message : 'Failed to trigger evictions');
    } finally {
      setTriggeringEvictions(false);
    }
  };

  const handleSaveContestant = async (evictionId: string) => {
    setSavingEvictionId(evictionId);
    try {
      const headers = await authHeaders();
      const res = await fetch(`/api/v1/connect/contests/${contestId}/save`, {
        method: 'POST',
        headers: { ...headers, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          eviction_id: evictionId,
          reason: saveReason[evictionId] || 'Judge override',
        }),
      });

      if (!res.ok) {
        const errorData = await res.json();
        throw new Error(errorData.error || 'Failed to save contestant');
      }

      setSuccess('Contestant saved successfully!');
      setSaveReason({ ...saveReason, [evictionId]: '' });
      await loadEvictions();
    } catch (err) {
      alert(err instanceof Error ? err.message : 'Failed to save contestant');
    } finally {
      setSavingEvictionId(null);
    }
  };

  const handleExtendGracePeriod = async (evictionId: string) => {
    if (!confirm('Extend grace period by 24 hours?')) return;

    setExtendingGracePeriod(evictionId);
    try {
      const headers = await authHeaders();
      const res = await fetch(`/api/v1/connect/contests/${contestId}/extend-grace-period`, {
        method: 'POST',
        headers: { ...headers, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          eviction_id: evictionId,
          additional_hours: 24,
        }),
      });

      if (!res.ok) throw new Error('Failed to extend grace period');

      setSuccess('Grace period extended!');
      await loadEvictions();
    } catch (err) {
      alert(err instanceof Error ? err.message : 'Failed to extend grace period');
    } finally {
      setExtendingGracePeriod(null);
    }
  };

  const handleFinalizeEvictions = async () => {
    if (!confirm('Finalize evictions? This will remove unsaved contestants from the stage.')) return;

    setFinalizingEvictions(true);
    try {
      const headers = await authHeaders();
      const res = await fetch(
        `/api/v1/connect/contests/${contestId}/stages/${stageNum}/finalize-evictions`,
        {
          method: 'POST',
          headers: { ...headers, 'Content-Type': 'application/json' },
        }
      );

      if (!res.ok) throw new Error('Failed to finalize evictions');

      setSuccess('Evictions finalized!');
      await loadEvictions();
    } catch (err) {
      alert(err instanceof Error ? err.message : 'Failed to finalize evictions');
    } finally {
      setFinalizingEvictions(false);
    }
  };

  const pendingEvictions = evictions.filter((e) => e.status === 'pending');
  const savedEvictions = evictions.filter((e) => e.status === 'saved');
  const finalizedEvictions = evictions.filter((e) => e.status === 'finalized');

  return (
    <div className="p-6 max-w-6xl mx-auto">
      <div className="flex items-center justify-between mb-8">
        <div>
          <h1 className="text-2xl font-bold text-white">Stage {stageNum} Eviction Management</h1>
          <p className="text-gray-400 text-sm mt-1">Manage contestant evictions and grace period</p>
        </div>
        <button
          onClick={handleTriggerEvictions}
          disabled={triggeringEvictions || pendingEvictions.length > 0}
          className="px-6 py-2 rounded-lg bg-red-600 text-white hover:bg-red-700 disabled:bg-gray-600 transition"
        >
          {triggeringEvictions ? 'Triggering...' : 'Trigger Evictions'}
        </button>
      </div>

      {error && (
        <div className="mb-6 p-4 rounded-lg bg-red-900/20 border border-red-700 text-red-300">
          {error}
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

      {loading ? (
        <div className="p-8 text-gray-400 animate-pulse">Loading evictions…</div>
      ) : (
        <div className="space-y-6">
          {/* Pending Evictions */}
          {pendingEvictions.length > 0 && (
            <div className="p-6 rounded-lg bg-orange-900/10 border border-orange-700/50">
              <div className="flex items-center justify-between mb-4">
                <h2 className="text-lg font-semibold text-orange-300">
                  Pending Evictions ({pendingEvictions.length})
                </h2>
                <button
                  onClick={handleFinalizeEvictions}
                  disabled={finalizingEvictions}
                  className="px-4 py-2 rounded-lg bg-orange-600 text-white hover:bg-orange-700 disabled:bg-gray-600 transition text-sm"
                >
                  {finalizingEvictions ? 'Finalizing...' : 'Finalize All'}
                </button>
              </div>

              <div className="space-y-3">
                {pendingEvictions.map((eviction) => {
                  const gracePeriodDate = new Date(eviction.grace_period_ends_at);
                  const now = new Date();
                  const hoursRemaining = (gracePeriodDate.getTime() - now.getTime()) / (1000 * 60 * 60);

                  return (
                    <div
                      key={eviction.id}
                      className="p-4 rounded-lg bg-gray-800 border border-orange-700/50 hover:border-orange-600 transition"
                    >
                      <div className="flex items-start justify-between mb-3">
                        <div>
                          <h3 className="text-white font-semibold">{eviction.contestant_name}</h3>
                          <p className="text-gray-400 text-sm">
                            #{eviction.eviction_rank} • {eviction.vote_count} votes
                          </p>
                        </div>
                        <span className="px-3 py-1 rounded-full text-xs font-semibold bg-orange-900/50 text-orange-300">
                          Grace: {Math.max(0, Math.floor(hoursRemaining))}h remaining
                        </span>
                      </div>

                      <div className="mb-3">
                        <textarea
                          placeholder="Reason for saving (optional)"
                          value={saveReason[eviction.id] || ''}
                          onChange={(e) =>
                            setSaveReason({
                              ...saveReason,
                              [eviction.id]: e.target.value,
                            })
                          }
                          className="w-full px-3 py-2 rounded bg-gray-700 border border-gray-600 text-white text-sm"
                          rows={2}
                        />
                      </div>

                      <div className="flex gap-2">
                        <button
                          onClick={() => handleSaveContestant(eviction.id)}
                          disabled={savingEvictionId === eviction.id || !eviction.can_be_saved}
                          className="flex-1 px-3 py-2 rounded-lg bg-green-600 text-white hover:bg-green-700 disabled:bg-gray-600 transition text-sm font-medium"
                        >
                          {savingEvictionId === eviction.id ? 'Saving...' : 'Save Contestant'}
                        </button>

                        <button
                          onClick={() => handleExtendGracePeriod(eviction.id)}
                          disabled={extendingGracePeriod === eviction.id}
                          className="px-3 py-2 rounded-lg border border-gray-600 text-gray-300 hover:bg-gray-700 disabled:bg-gray-600 transition text-sm"
                        >
                          {extendingGracePeriod === eviction.id ? 'Extending...' : 'Extend'}
                        </button>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          {/* Saved Evictions */}
          {savedEvictions.length > 0 && (
            <div className="p-6 rounded-lg bg-green-900/10 border border-green-700/50">
              <h2 className="text-lg font-semibold text-green-300 mb-4">
                Saved ({savedEvictions.length})
              </h2>
              <div className="space-y-2">
                {savedEvictions.map((eviction) => (
                  <div
                    key={eviction.id}
                    className="p-3 rounded-lg bg-gray-800 border border-green-700/30 flex items-center justify-between"
                  >
                    <div>
                      <p className="text-white font-semibold">{eviction.contestant_name}</p>
                      <p className="text-gray-400 text-sm">#{eviction.eviction_rank} • {eviction.vote_count} votes • {eviction.save_count} saves</p>
                    </div>
                    <span className="px-3 py-1 rounded-full text-xs font-semibold bg-green-900/50 text-green-300">
                      Saved
                    </span>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Finalized Evictions */}
          {finalizedEvictions.length > 0 && (
            <div className="p-6 rounded-lg bg-red-900/10 border border-red-700/50">
              <h2 className="text-lg font-semibold text-red-300 mb-4">
                Removed ({finalizedEvictions.length})
              </h2>
              <div className="space-y-2">
                {finalizedEvictions.map((eviction) => (
                  <div
                    key={eviction.id}
                    className="p-3 rounded-lg bg-gray-800 border border-red-700/30 flex items-center justify-between"
                  >
                    <div>
                      <p className="text-white font-semibold">{eviction.contestant_name}</p>
                      <p className="text-gray-400 text-sm">#{eviction.eviction_rank} • {eviction.vote_count} votes</p>
                    </div>
                    <span className="px-3 py-1 rounded-full text-xs font-semibold bg-red-900/50 text-red-300">
                      Removed
                    </span>
                  </div>
                ))}
              </div>
            </div>
          )}

          {pendingEvictions.length === 0 && savedEvictions.length === 0 && finalizedEvictions.length === 0 && (
            <div className="bg-gray-800 rounded-lg p-12 text-center border border-gray-700">
              <p className="text-gray-400">No evictions for this stage yet.</p>
              <p className="text-gray-500 text-sm mt-2">
                Click "Trigger Evictions" above to mark the bottom 20% of contestants.
              </p>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
