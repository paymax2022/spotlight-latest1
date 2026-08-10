'use client';

import { useEffect, useState, useCallback } from 'react';
import { useParams } from 'next/navigation';
import { authHeaders } from '@/src/lib/auth/client';

interface Stage {
  id: string;
  stage_number: number;
  stage_name: string;
  stage_description?: string;
  eviction_percentage: number;
  voting_starts_at?: string;
  voting_ends_at?: string;
  is_active: boolean;
  created_at: string;
}

interface StagesResponse {
  data: Stage[];
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
  onConfirm: () => Promise<void>;
  onCancel?: () => void;
}

const LoadingSkeleton = () => (
  <div className="space-y-4">
    {[1, 2, 3].map(i => (
      <div key={i} className="p-6 rounded-lg bg-gray-800 border border-gray-700 animate-pulse">
        <div className="h-6 bg-gray-700 rounded w-1/3 mb-4"></div>
        <div className="grid grid-cols-3 gap-4">
          {[1, 2, 3].map(j => (
            <div key={j} className="bg-gray-700/50 p-3 rounded h-16"></div>
          ))}
        </div>
      </div>
    ))}
  </div>
);

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
            className="px-4 py-2 rounded-lg bg-red-600 text-white hover:bg-red-700 transition disabled:opacity-50 flex items-center gap-2"
          >
            {isSubmitting && <span className="inline-block w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin"></span>}
            Confirm
          </button>
        </div>
      </div>
    </div>
  );
};

export default function StagesDashboard() {
  const params = useParams();
  const contestId = (params?.contestId as string) || 'default';

  const [stages, setStages] = useState<Stage[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [showForm, setShowForm] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [toasts, setToasts] = useState<Toast[]>([]);
  const [confirmDialog, setConfirmDialog] = useState<ConfirmDialogState>({
    show: false,
    title: '',
    message: '',
    onConfirm: async () => {},
  });
  const [formData, setFormData] = useState({
    stage_number: '',
    stage_name: '',
    stage_description: '',
    eviction_percentage: '20',
  });

  const addToast = useCallback((message: string, type: 'success' | 'error' | 'info' = 'info') => {
    const id = Date.now().toString();
    setToasts(prev => [...prev, { id, message, type }]);
  }, []);

  const removeToast = useCallback((id: string) => {
    setToasts(prev => prev.filter(t => t.id !== id));
  }, []);

  useEffect(() => {
    loadStages();
  }, [contestId]);

  const loadStages = async () => {
    try {
      setLoading(true);
      setError(null);
      const headers = await authHeaders();
      const res = await fetch(`/api/v1/connect/contests/${contestId}/stages`, { headers });
      if (res.status === 401) {
        addToast('Unauthorized: You do not have permission to manage stages', 'error');
        setError('Permission denied');
        return;
      }
      if (res.status === 403) {
        addToast('Forbidden: Your role does not permit stage management', 'error');
        setError('Permission denied');
        return;
      }
      if (!res.ok) throw new Error(`Failed to load stages: ${res.status}`);
      const json: StagesResponse = await res.json();
      setStages(json.data || []);
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Unknown error';
      setError(message);
      addToast(message, 'error');
    } finally {
      setLoading(false);
    }
  };

  const handleCreateStageClick = (e: React.FormEvent) => {
    e.preventDefault();
    if (!formData.stage_number || !formData.stage_name) {
      addToast('Please fill in required fields (Stage Number and Stage Name)', 'error');
      return;
    }

    setConfirmDialog({
      show: true,
      title: 'Create New Stage?',
      message: `Create stage "${formData.stage_name}" (Stage ${formData.stage_number}) with ${formData.eviction_percentage}% eviction rate?`,
      onConfirm: handleConfirmCreateStage,
      onCancel: () => setConfirmDialog(prev => ({ ...prev, show: false })),
    });
  };

  const handleConfirmCreateStage = async () => {
    if (!formData.stage_number || !formData.stage_name) return;

    try {
      setSubmitting(true);
      const headers = await authHeaders();
      const stageName = formData.stage_name;
      const res = await fetch(`/api/v1/connect/contests/${contestId}/stages`, {
        method: 'POST',
        headers: { ...headers, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          stage_number: parseInt(formData.stage_number),
          stage_name: formData.stage_name,
          stage_description: formData.stage_description,
          eviction_percentage: parseInt(formData.eviction_percentage),
        }),
      });

      if (res.status === 401 || res.status === 403) {
        addToast('Permission denied: You cannot create stages', 'error');
        return;
      }
      if (!res.ok) throw new Error('Failed to create stage');

      await loadStages();
      setShowForm(false);
      setFormData({
        stage_number: '',
        stage_name: '',
        stage_description: '',
        eviction_percentage: '20',
      });
      setConfirmDialog(prev => ({ ...prev, show: false }));
      addToast(`Stage "${stageName}" created successfully`, 'success');
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to create stage';
      addToast(message, 'error');
    } finally {
      setSubmitting(false);
    }
  };

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
          <h1 className="text-2xl font-bold text-white">Contest Stages</h1>
          <p className="text-gray-400 text-sm mt-1">Configure stages and eviction rules for this contest</p>
        </div>
        <button
          onClick={() => setShowForm(!showForm)}
          disabled={submitting}
          className="px-6 py-2 rounded-lg bg-blue-600 text-white hover:bg-blue-700 transition disabled:opacity-50 font-medium"
        >
          {showForm ? 'Cancel' : '+ Create Stage'}
        </button>
      </div>

      {/* Error Alert with Retry */}
      {error && (
        <div className="mb-6 p-4 rounded-lg bg-red-900/20 border border-red-700 text-red-300 flex justify-between items-center">
          <span>{error}</span>
          <button
            onClick={loadStages}
            className="text-sm font-medium px-3 py-1 rounded bg-red-700 hover:bg-red-600 transition"
          >
            Retry
          </button>
        </div>
      )}

      {/* Create Form */}
      {showForm && (
        <form onSubmit={handleCreateStageClick} className="mb-8 p-6 rounded-lg bg-gray-800 border border-gray-700">
          <h3 className="text-lg font-semibold text-white mb-4">Create New Stage</h3>

          <div className="grid grid-cols-2 gap-4 mb-4">
            <div>
              <label className="block text-sm font-medium text-gray-300 mb-2">Stage Number *</label>
              <input
                type="number"
                min="1"
                value={formData.stage_number}
                onChange={(e) => setFormData({ ...formData, stage_number: e.target.value })}
                className="w-full px-3 py-2 rounded bg-gray-700 border border-gray-600 text-white focus:border-blue-500 focus:outline-none transition"
                required
              />
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-300 mb-2">Eviction Percentage *</label>
              <input
                type="number"
                min="1"
                max="99"
                value={formData.eviction_percentage}
                onChange={(e) => setFormData({ ...formData, eviction_percentage: e.target.value })}
                className="w-full px-3 py-2 rounded bg-gray-700 border border-gray-600 text-white focus:border-blue-500 focus:outline-none transition"
              />
              <p className="text-xs text-gray-400 mt-1">Bottom % of contestants to evict</p>
            </div>
          </div>

          <div className="mb-4">
            <label className="block text-sm font-medium text-gray-300 mb-2">Stage Name *</label>
            <input
              type="text"
              value={formData.stage_name}
              onChange={(e) => setFormData({ ...formData, stage_name: e.target.value })}
              className="w-full px-3 py-2 rounded bg-gray-700 border border-gray-600 text-white focus:border-blue-500 focus:outline-none transition"
              placeholder="e.g., Auditions, Semi-Finals, Finals"
              required
            />
          </div>

          <div className="mb-6">
            <label className="block text-sm font-medium text-gray-300 mb-2">Description (Optional)</label>
            <textarea
              value={formData.stage_description}
              onChange={(e) => setFormData({ ...formData, stage_description: e.target.value })}
              className="w-full px-3 py-2 rounded bg-gray-700 border border-gray-600 text-white focus:border-blue-500 focus:outline-none transition"
              placeholder="Optional description for this stage"
              rows={3}
            />
          </div>

          <div className="flex gap-3">
            <button
              type="submit"
              disabled={submitting}
              className="px-6 py-2 rounded-lg bg-green-600 text-white hover:bg-green-700 transition disabled:opacity-50 font-medium"
            >
              {submitting ? 'Creating...' : 'Create Stage'}
            </button>
            <button
              type="button"
              onClick={() => setShowForm(false)}
              className="px-6 py-2 rounded-lg border border-gray-600 text-gray-300 hover:bg-gray-700 transition"
            >
              Cancel
            </button>
          </div>
        </form>
      )}

      {/* Loading State */}
      {loading ? (
        <LoadingSkeleton />
      ) : stages.length === 0 ? (
        <div className="bg-gray-800 rounded-lg p-12 text-center border border-gray-700">
          <p className="text-gray-400 text-lg">No stages created yet.</p>
          <p className="text-gray-500 text-sm mt-2">Click "Create Stage" to set up the first stage for this contest.</p>
        </div>
      ) : (
        <div className="space-y-4">
          {stages.map((stage) => (
            <div
              key={stage.id}
              className="p-6 rounded-lg bg-gray-800 border border-gray-700 hover:border-gray-600 transition"
            >
              <div className="flex items-start justify-between mb-4">
                <div className="flex-1">
                  <h3 className="text-lg font-semibold text-white">
                    Stage {stage.stage_number}: {stage.stage_name}
                  </h3>
                  {stage.stage_description && (
                    <p className="text-gray-400 text-sm mt-1">{stage.stage_description}</p>
                  )}
                </div>
                <span
                  className={`px-3 py-1 rounded-full text-xs font-semibold whitespace-nowrap ml-4 ${
                    stage.is_active
                      ? 'bg-green-900/20 text-green-300'
                      : 'bg-gray-700/50 text-gray-400'
                  }`}
                >
                  {stage.is_active ? '● Active' : '○ Inactive'}
                </span>
              </div>

              <div className="grid grid-cols-3 gap-4 text-sm mb-4">
                <div className="bg-gray-700/50 p-3 rounded">
                  <p className="text-gray-400 text-xs uppercase tracking-wide">Eviction Rate</p>
                  <p className="text-white font-semibold text-lg">{stage.eviction_percentage}%</p>
                </div>

                <div className="bg-gray-700/50 p-3 rounded">
                  <p className="text-gray-400 text-xs uppercase tracking-wide">Voting Opens</p>
                  <p className="text-white font-semibold">
                    {stage.voting_starts_at ? new Date(stage.voting_starts_at).toLocaleDateString() : '—'}
                  </p>
                </div>

                <div className="bg-gray-700/50 p-3 rounded">
                  <p className="text-gray-400 text-xs uppercase tracking-wide">Voting Closes</p>
                  <p className="text-white font-semibold">
                    {stage.voting_ends_at ? new Date(stage.voting_ends_at).toLocaleDateString() : '—'}
                  </p>
                </div>
              </div>

              <div className="flex gap-2">
                <a
                  href={`/admin/voting/${contestId}/stages/${stage.stage_number}/evictions`}
                  className="flex-1 px-4 py-2 rounded-lg bg-blue-600 text-white hover:bg-blue-700 transition text-center text-sm font-medium"
                >
                  Manage Evictions
                </a>
                <button
                  className="px-4 py-2 rounded-lg border border-gray-600 text-gray-300 hover:bg-gray-700 transition text-sm font-medium disabled:opacity-50"
                  disabled
                  title="Edit functionality coming soon"
                >
                  Edit
                </button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
