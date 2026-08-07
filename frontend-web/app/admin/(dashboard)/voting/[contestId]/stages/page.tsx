'use client';

import { useEffect, useState } from 'react';
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

export default function StagesDashboard() {
  const params = useParams();
  const contestId = params.contestId as string;

  const [stages, setStages] = useState<Stage[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [showForm, setShowForm] = useState(false);
  const [formData, setFormData] = useState({
    stage_number: '',
    stage_name: '',
    stage_description: '',
    eviction_percentage: '20',
  });

  useEffect(() => {
    loadStages();
  }, [contestId]);

  const loadStages = async () => {
    try {
      const headers = await authHeaders();
      const res = await fetch(`/api/v1/connect/contests/${contestId}/stages`, { headers });
      if (!res.ok) throw new Error(`Failed to load stages: ${res.status}`);
      const json: StagesResponse = await res.json();
      setStages(json.data || []);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unknown error');
    } finally {
      setLoading(false);
    }
  };

  const handleCreateStage = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!formData.stage_number || !formData.stage_name) {
      alert('Please fill in required fields');
      return;
    }

    try {
      const headers = await authHeaders();
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

      if (!res.ok) throw new Error('Failed to create stage');

      await loadStages();
      setShowForm(false);
      setFormData({
        stage_number: '',
        stage_name: '',
        stage_description: '',
        eviction_percentage: '20',
      });
    } catch (err) {
      alert(err instanceof Error ? err.message : 'Failed to create stage');
    }
  };

  return (
    <div className="p-6 max-w-6xl mx-auto">
      <div className="flex items-center justify-between mb-8">
        <div>
          <h1 className="text-2xl font-bold text-white">Contest Stages</h1>
          <p className="text-gray-400 text-sm mt-1">Configure stages and eviction rules</p>
        </div>
        <button
          onClick={() => setShowForm(!showForm)}
          className="px-6 py-2 rounded-lg bg-blue-600 text-white hover:bg-blue-700 transition"
        >
          {showForm ? 'Cancel' : 'Create Stage'}
        </button>
      </div>

      {error && (
        <div className="mb-6 p-4 rounded-lg bg-red-900/20 border border-red-700 text-red-300">
          {error}
        </div>
      )}

      {showForm && (
        <form onSubmit={handleCreateStage} className="mb-8 p-6 rounded-lg bg-gray-800 border border-gray-700">
          <h3 className="text-lg font-semibold text-white mb-4">Create New Stage</h3>

          <div className="grid grid-cols-2 gap-4 mb-4">
            <div>
              <label className="block text-sm font-medium text-gray-300 mb-2">Stage Number *</label>
              <input
                type="number"
                min="1"
                value={formData.stage_number}
                onChange={(e) => setFormData({ ...formData, stage_number: e.target.value })}
                className="w-full px-3 py-2 rounded bg-gray-700 border border-gray-600 text-white"
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
                className="w-full px-3 py-2 rounded bg-gray-700 border border-gray-600 text-white"
              />
              <p className="text-xs text-gray-400 mt-1">Bottom % to evict (default: 20%)</p>
            </div>
          </div>

          <div className="mb-4">
            <label className="block text-sm font-medium text-gray-300 mb-2">Stage Name *</label>
            <input
              type="text"
              value={formData.stage_name}
              onChange={(e) => setFormData({ ...formData, stage_name: e.target.value })}
              className="w-full px-3 py-2 rounded bg-gray-700 border border-gray-600 text-white"
              placeholder="e.g., Auditions, Semi-Finals, Finals"
              required
            />
          </div>

          <div className="mb-4">
            <label className="block text-sm font-medium text-gray-300 mb-2">Description</label>
            <textarea
              value={formData.stage_description}
              onChange={(e) => setFormData({ ...formData, stage_description: e.target.value })}
              className="w-full px-3 py-2 rounded bg-gray-700 border border-gray-600 text-white"
              placeholder="Optional description for this stage"
              rows={3}
            />
          </div>

          <button
            type="submit"
            className="px-6 py-2 rounded-lg bg-green-600 text-white hover:bg-green-700 transition"
          >
            Create Stage
          </button>
        </form>
      )}

      {loading ? (
        <div className="p-8 text-gray-400 animate-pulse">Loading stages…</div>
      ) : stages.length === 0 ? (
        <div className="bg-gray-800 rounded-lg p-12 text-center border border-gray-700">
          <p className="text-gray-400">No stages created yet.</p>
          <p className="text-gray-500 text-sm mt-2">Click "Create Stage" to add the first stage.</p>
        </div>
      ) : (
        <div className="space-y-4">
          {stages.map((stage) => (
            <div
              key={stage.id}
              className="p-6 rounded-lg bg-gray-800 border border-gray-700 hover:border-gray-600 transition"
            >
              <div className="flex items-start justify-between mb-4">
                <div>
                  <h3 className="text-lg font-semibold text-white">
                    Stage {stage.stage_number}: {stage.stage_name}
                  </h3>
                  {stage.stage_description && (
                    <p className="text-gray-400 text-sm mt-1">{stage.stage_description}</p>
                  )}
                </div>
                <span
                  className={`px-3 py-1 rounded-full text-xs font-semibold ${
                    stage.is_active
                      ? 'bg-green-900/20 text-green-300'
                      : 'bg-gray-700/50 text-gray-400'
                  }`}
                >
                  {stage.is_active ? 'Active' : 'Inactive'}
                </span>
              </div>

              <div className="grid grid-cols-3 gap-4 text-sm">
                <div className="bg-gray-700/50 p-3 rounded">
                  <p className="text-gray-400">Eviction %</p>
                  <p className="text-white font-semibold">{stage.eviction_percentage}%</p>
                </div>

                <div className="bg-gray-700/50 p-3 rounded">
                  <p className="text-gray-400">Voting Opens</p>
                  <p className="text-white font-semibold">
                    {stage.voting_starts_at ? new Date(stage.voting_starts_at).toLocaleDateString() : 'Not set'}
                  </p>
                </div>

                <div className="bg-gray-700/50 p-3 rounded">
                  <p className="text-gray-400">Voting Closes</p>
                  <p className="text-white font-semibold">
                    {stage.voting_ends_at ? new Date(stage.voting_ends_at).toLocaleDateString() : 'Not set'}
                  </p>
                </div>
              </div>

              <div className="flex gap-2 mt-4">
                <a
                  href={`/admin/voting/${contestId}/stages/${stage.stage_number}/evictions`}
                  className="flex-1 px-4 py-2 rounded-lg bg-blue-600 text-white hover:bg-blue-700 transition text-center text-sm font-medium"
                >
                  Manage Evictions
                </a>
                <button
                  onClick={() => {}}
                  className="px-4 py-2 rounded-lg border border-gray-600 text-gray-300 hover:bg-gray-700 transition text-sm"
                >
                  Edit Settings
                </button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
