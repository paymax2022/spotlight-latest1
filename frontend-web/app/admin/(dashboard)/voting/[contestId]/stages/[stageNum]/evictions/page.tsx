'use client';

import { useEffect, useState, useCallback } from 'react';
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

interface Toast {
  id: string;
  type: 'success' | 'error' | 'info';
  message: string;
}

interface ConfirmDialogState {
  show: boolean;
  title: string;
  message: string;
  variant: 'danger' | 'warning' | 'info';
  onConfirm: () => Promise<void>;
  onCancel?: () => void;
}

const Toast = ({ toast, onDismiss }: { toast: Toast; onDismiss: () => void }) => {
  useEffect(() => {
    const timer = setTimeout(onDismiss, 4000);
    return () => clearTimeout(timer);
  }, [onDismiss]);

  const bgColor = {
    success: 'bg-green-900/20 border-green-700 text-green-300',
    error: 'bg-red-900/20 border-red-700 text-red-300',
    info: 'bg-blue-900/20 border-blue-700 text-blue-300',
  }[toast.type];

  return (
    <div className={`p-4 rounded-lg border ${bgColor} flex justify-between items-center`}>
      <span>{toast.message}</span>
      <button
        onClick={onDismiss}
        className="text-xs opacity-60 hover:opacity-100 ml-4"
      >
        ✕
      </button>
    </div>
  );
};

const ConfirmDialog = ({ state, isSubmitting }: { state: ConfirmDialogState; isSubmitting: boolean }) => {
  if (!state.show) return null;

  const buttonColors = {
    danger: 'bg-red-600 hover:bg-red-700',
    warning: 'bg-orange-600 hover:bg-orange-700',
    info: 'bg-blue-600 hover:bg-blue-700',
  };

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
      <div className="bg-gray-800 rounded-lg border border-gray-700 p-6 max-w-sm">
        <h2 className="text-lg font-semibold text-white mb-2">{state.title}</h2>
        <p className="text-gray-300 mb-6">{state.message}</p>
        <div className="flex gap-3 justify-end">
          <button
            onClick={state.onCancel}
            disabled={isSubmitting}
            className="px-4 py-2 rounded-lg border border-gray-600 text-gray-300 hover:bg-gray-700 transition disabled:opacity-50"
          >
            Cancel
          </button>
          <button
            onClick={state.onConfirm}
            disabled={isSubmitting}
            className={`px-4 py-2 rounded-lg text-white transition disabled:opacity-50 flex items-center gap-2 ${buttonColors[state.variant]}`}
          >
            {isSubmitting && <span className="inline-block w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin"></span>}
            Confirm
          </button>
        </div>
      </div>
    </div>
  );
};

const LoadingSkeleton = () => (
  <div className="space-y-6">
    {[1, 2].map(i => (
      <div key={i} className="p-6 rounded-lg bg-gray-800 border border-gray-700 animate-pulse">
        <div className="h-6 bg-gray-700 rounded w-1/4 mb-4"></div>
        <div className="space-y-3">
          {[1, 2, 3].map(j => (
            <div key={j} className="h-20 bg-gray-700 rounded"></div>
          ))}
        </div>
      </div>
    ))}
  </div>
);

const GracePeriodCounter = ({ endsAt }: { endsAt: string }) => {
  const [hoursRemaining, setHoursRemaining] = useState(0);

  useEffect(() => {
    const updateCounter = () => {
      const gracePeriodDate = new Date(endsAt);
      const now = new Date();
      const hours = (gracePeriodDate.getTime() - now.getTime()) / (1000 * 60 * 60);
      setHoursRemaining(Math.max(0, Math.floor(hours)));
    };

    updateCounter();
    const interval = setInterval(updateCounter, 60000); // Update every minute
    return () => clearInterval(interval);
  }, [endsAt]);

  return (
    <span className="px-3 py-1 rounded-full text-xs font-semibold bg-orange-900/50 text-orange-300">
      {hoursRemaining > 0 ? `${hoursRemaining}h remaining` : 'Grace period expired'}
    </span>
  );
};

export default function EvictionManagement() {
  const params = useParams();
  const contestId = (params?.contestId as string) || 'default';
  const stageNum = (params?.stageNum as string) || '1';

  const [evictions, setEvictions] = useState<Eviction[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [toasts, setToasts] = useState<Toast[]>([]);
  const [confirmDialog, setConfirmDialog] = useState<ConfirmDialogState>({
    show: false,
    title: '',
    message: '',
    variant: 'info',
    onConfirm: async () => {},
  });
  const [savingEvictionId, setSavingEvictionId] = useState<string | null>(null);
  const [extendingGracePeriodId, setExtendingGracePeriodId] = useState<string | null>(null);
  const [saveReason, setSaveReason] = useState<{ [key: string]: string }>({});

  const addToast = useCallback((message: string, type: 'success' | 'error' | 'info' = 'info') => {
    const id = Date.now().toString();
    setToasts(prev => [...prev, { id, message, type }]);
  }, []);

  const removeToast = useCallback((id: string) => {
    setToasts(prev => prev.filter(t => t.id !== id));
  }, []);

  useEffect(() => {
    loadEvictions();
    const interval = setInterval(loadEvictions, 10000);
    return () => clearInterval(interval);
  }, [contestId, stageNum]);

  const loadEvictions = async () => {
    try {
      setLoading(true);
      setError(null);
      const headers = await authHeaders();
      const res = await fetch(`/api/v1/connect/contests/${contestId}/evictions?stage=${stageNum}`, { headers });

      if (res.status === 401 || res.status === 403) {
        addToast('Permission denied: You cannot manage evictions', 'error');
        setError('Permission denied');
        return;
      }
      if (!res.ok) throw new Error(`Failed to load evictions: ${res.status}`);

      const json: EvictionsResponse = await res.json();
      setEvictions(json.data || []);
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Unknown error';
      setError(message);
      addToast(message, 'error');
    } finally {
      setLoading(false);
    }
  };

  const handleTriggerEvictionsClick = async () => {
    const pendingCount = evictions.filter(e => e.status === 'pending').length;
    if (pendingCount > 0) {
      addToast('Evictions already triggered for this stage', 'error');
      return;
    }

    setConfirmDialog({
      show: true,
      title: 'Trigger Evictions?',
      message: 'This will mark the bottom 20% of contestants for eviction and set a 24-hour grace period. They can still receive votes and be saved during this time.',
      variant: 'danger',
      onConfirm: handleConfirmTriggerEvictions,
      onCancel: () => setConfirmDialog(prev => ({ ...prev, show: false })),
    });
  };

  const handleConfirmTriggerEvictions = async () => {
    try {
      setSubmitting(true);
      const headers = await authHeaders();
      const res = await fetch(`/api/v1/connect/contests/${contestId}/stages/${stageNum}/evict`, {
        method: 'POST',
        headers: { ...headers, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          stage_number: parseInt(stageNum),
          eviction_percentage: 20,
          grace_period_hours: 24,
        }),
      });

      if (res.status === 401 || res.status === 403) {
        addToast('Permission denied: You cannot trigger evictions', 'error');
        return;
      }
      if (!res.ok) throw new Error('Failed to trigger evictions');

      await loadEvictions();
      setConfirmDialog(prev => ({ ...prev, show: false }));
      addToast('Evictions triggered! Grace period is 24 hours', 'success');
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to trigger evictions';
      addToast(message, 'error');
    } finally {
      setSubmitting(false);
    }
  };

  const handleSaveContestantClick = (evictionId: string, contestantName: string) => {
    setConfirmDialog({
      show: true,
      title: 'Save Contestant?',
      message: `Save "${contestantName}" from eviction? Judges can only save one contestant per stage.`,
      variant: 'warning',
      onConfirm: () => handleConfirmSaveContestant(evictionId),
      onCancel: () => setConfirmDialog(prev => ({ ...prev, show: false })),
    });
  };

  const handleConfirmSaveContestant = async (evictionId: string) => {
    try {
      setSavingEvictionId(evictionId);
      const headers = await authHeaders();
      const res = await fetch(`/api/v1/connect/contests/${contestId}/save`, {
        method: 'POST',
        headers: { ...headers, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          eviction_id: evictionId,
          reason: saveReason[evictionId] || 'Judge decision',
        }),
      });

      if (res.status === 401 || res.status === 403) {
        addToast('Permission denied: You cannot save contestants', 'error');
        return;
      }
      if (!res.ok) {
        const errorData = await res.json().catch(() => ({}));
        throw new Error(errorData.error || 'Failed to save contestant');
      }

      setSaveReason(prev => ({ ...prev, [evictionId]: '' }));
      await loadEvictions();
      setConfirmDialog(prev => ({ ...prev, show: false }));
      addToast('Contestant saved successfully!', 'success');
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to save contestant';
      addToast(message, 'error');
    } finally {
      setSavingEvictionId(null);
    }
  };

  const handleExtendGracePeriodClick = (evictionId: string, contestantName: string) => {
    setConfirmDialog({
      show: true,
      title: 'Extend Grace Period?',
      message: `Extend grace period by 24 hours for "${contestantName}"? This delays the final eviction decision.`,
      variant: 'warning',
      onConfirm: () => handleConfirmExtendGracePeriod(evictionId),
      onCancel: () => setConfirmDialog(prev => ({ ...prev, show: false })),
    });
  };

  const handleConfirmExtendGracePeriod = async (evictionId: string) => {
    try {
      setExtendingGracePeriodId(evictionId);
      const headers = await authHeaders();
      const res = await fetch(`/api/v1/connect/contests/${contestId}/extend-grace-period`, {
        method: 'POST',
        headers: { ...headers, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          eviction_id: evictionId,
          additional_hours: 24,
        }),
      });

      if (res.status === 401 || res.status === 403) {
        addToast('Permission denied: You cannot extend grace periods', 'error');
        return;
      }
      if (!res.ok) throw new Error('Failed to extend grace period');

      await loadEvictions();
      setConfirmDialog(prev => ({ ...prev, show: false }));
      addToast('Grace period extended by 24 hours', 'success');
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to extend grace period';
      addToast(message, 'error');
    } finally {
      setExtendingGracePeriodId(null);
    }
  };

  const handleFinalizeEvictionsClick = async () => {
    const pendingCount = evictions.filter(e => e.status === 'pending').length;
    if (pendingCount === 0) {
      addToast('No pending evictions to finalize', 'info');
      return;
    }

    setConfirmDialog({
      show: true,
      title: 'Finalize Evictions?',
      message: `This will permanently remove ${pendingCount} unsaved contestant(s) from this stage. Saved contestants will remain. This action cannot be undone.`,
      variant: 'danger',
      onConfirm: handleConfirmFinalizeEvictions,
      onCancel: () => setConfirmDialog(prev => ({ ...prev, show: false })),
    });
  };

  const handleConfirmFinalizeEvictions = async () => {
    try {
      setSubmitting(true);
      const headers = await authHeaders();
      const res = await fetch(`/api/v1/connect/contests/${contestId}/stages/${stageNum}/finalize-evictions`, {
        method: 'POST',
        headers: { ...headers, 'Content-Type': 'application/json' },
      });

      if (res.status === 401 || res.status === 403) {
        addToast('Permission denied: You cannot finalize evictions', 'error');
        return;
      }
      if (!res.ok) throw new Error('Failed to finalize evictions');

      await loadEvictions();
      setConfirmDialog(prev => ({ ...prev, show: false }));
      addToast('Evictions finalized! Unsaved contestants have been removed', 'success');
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to finalize evictions';
      addToast(message, 'error');
    } finally {
      setSubmitting(false);
    }
  };

  const pendingEvictions = evictions.filter((e) => e.status === 'pending');
  const savedEvictions = evictions.filter((e) => e.status === 'saved');
  const finalizedEvictions = evictions.filter((e) => e.status === 'finalized');

  return (
    <div className="p-6 max-w-6xl mx-auto">
      {/* Toast Container */}
      <div className="fixed top-4 right-4 z-40 space-y-2 max-w-sm">
        {toasts.map(toast => (
          <Toast
            key={toast.id}
            toast={toast}
            onDismiss={() => removeToast(toast.id)}
          />
        ))}
      </div>

      {/* Confirm Dialog */}
      <ConfirmDialog state={confirmDialog} isSubmitting={submitting} />

      {/* Header */}
      <div className="flex items-center justify-between mb-8">
        <div>
          <h1 className="text-2xl font-bold text-white">Stage {stageNum} Eviction Management</h1>
          <p className="text-gray-400 text-sm mt-1">Manage contestant evictions, saves, and grace periods</p>
        </div>
        <div className="flex gap-2">
          <button
            onClick={handleFinalizeEvictionsClick}
            disabled={submitting || pendingEvictions.length === 0}
            className="px-6 py-2 rounded-lg bg-orange-600 text-white hover:bg-orange-700 disabled:opacity-50 transition font-medium flex items-center gap-2"
          >
            {submitting && <span className="inline-block w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin"></span>}
            Finalize All
          </button>
          <button
            onClick={handleTriggerEvictionsClick}
            disabled={submitting || pendingEvictions.length > 0}
            className="px-6 py-2 rounded-lg bg-red-600 text-white hover:bg-red-700 disabled:opacity-50 transition font-medium flex items-center gap-2"
          >
            {submitting && <span className="inline-block w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin"></span>}
            Trigger Evictions
          </button>
        </div>
      </div>

      {/* Error Alert with Retry */}
      {error && (
        <div className="mb-6 p-4 rounded-lg bg-red-900/20 border border-red-700 text-red-300 flex justify-between items-center">
          <span>{error}</span>
          <button
            onClick={loadEvictions}
            className="text-sm font-medium px-3 py-1 rounded bg-red-700 hover:bg-red-600 transition"
          >
            Retry
          </button>
        </div>
      )}

      {/* Loading State */}
      {loading ? (
        <LoadingSkeleton />
      ) : (
        <div className="space-y-6">
          {/* Pending Evictions */}
          {pendingEvictions.length > 0 && (
            <div className="p-6 rounded-lg bg-orange-900/10 border border-orange-700/50">
              <div className="flex items-center justify-between mb-4">
                <h2 className="text-lg font-semibold text-orange-300">
                  Pending Evictions ({pendingEvictions.length})
                </h2>
                <div className="text-sm text-orange-200">
                  Grace period active • Save before finalizing
                </div>
              </div>

              <div className="space-y-3">
                {pendingEvictions.map((eviction) => (
                  <div
                    key={eviction.id}
                    className="p-4 rounded-lg bg-gray-800 border border-orange-700/50 hover:border-orange-600 transition"
                  >
                    <div className="flex items-start justify-between mb-3">
                      <div className="flex-1">
                        <h3 className="text-white font-semibold">{eviction.contestant_name}</h3>
                        <p className="text-gray-400 text-sm">
                          #{eviction.eviction_rank} • {eviction.vote_count} votes
                        </p>
                      </div>
                      <GracePeriodCounter endsAt={eviction.grace_period_ends_at} />
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
                        className="w-full px-3 py-2 rounded bg-gray-700 border border-gray-600 text-white text-sm focus:border-blue-500 focus:outline-none transition"
                        rows={2}
                      />
                      <p className="text-xs text-gray-400 mt-1">
                        {eviction.can_be_saved ? '✓ You can save this contestant' : '✗ You have already saved one contestant this stage'}
                      </p>
                    </div>

                    <div className="flex gap-2">
                      <button
                        onClick={() => handleSaveContestantClick(eviction.id, eviction.contestant_name)}
                        disabled={savingEvictionId === eviction.id || !eviction.can_be_saved || submitting}
                        className="flex-1 px-3 py-2 rounded-lg bg-green-600 text-white hover:bg-green-700 disabled:opacity-50 transition text-sm font-medium flex items-center justify-center gap-2"
                      >
                        {savingEvictionId === eviction.id && <span className="inline-block w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin"></span>}
                        {savingEvictionId === eviction.id ? 'Saving...' : eviction.can_be_saved ? 'Save Contestant' : 'Already Saved'}
                      </button>

                      <button
                        onClick={() => handleExtendGracePeriodClick(eviction.id, eviction.contestant_name)}
                        disabled={extendingGracePeriodId === eviction.id || submitting}
                        className="px-3 py-2 rounded-lg border border-gray-600 text-gray-300 hover:bg-gray-700 disabled:opacity-50 transition text-sm font-medium"
                      >
                        {extendingGracePeriodId === eviction.id ? 'Extending...' : 'Extend'}
                      </button>
                    </div>
                  </div>
                ))}
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
                      <p className="text-gray-400 text-sm">#{eviction.eviction_rank} • {eviction.vote_count} votes • {eviction.save_count} save(s)</p>
                    </div>
                    <span className="px-3 py-1 rounded-full text-xs font-semibold bg-green-900/50 text-green-300">
                      ✓ Saved
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
                      ✕ Removed
                    </span>
                  </div>
                ))}
              </div>
            </div>
          )}

          {pendingEvictions.length === 0 && savedEvictions.length === 0 && finalizedEvictions.length === 0 && (
            <div className="bg-gray-800 rounded-lg p-12 text-center border border-gray-700">
              <p className="text-gray-400 text-lg">No evictions for this stage yet.</p>
              <p className="text-gray-500 text-sm mt-2">
                Click "Trigger Evictions" to mark the bottom 20% of contestants for eviction.
              </p>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
