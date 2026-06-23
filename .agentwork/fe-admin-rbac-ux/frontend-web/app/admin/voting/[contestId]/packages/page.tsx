'use client';

import { useEffect, useState, useCallback } from 'react';
import { useParams } from 'next/navigation';
import { authHeaders } from '@/src/lib/auth/client';
import { FORMAT_NAIRA, VOTE_PACKAGE_PRESETS } from '@/src/features/voting/constants';
import type { VotePackage } from '@/src/features/voting/types';

const EMPTY_FORM = {
  name: '', description: '', votes: 0, bonusVotes: 0,
  amount: 0, currency: 'NGN', isActive: true, isRecommended: false,
  promoLabel: '', displayOrder: 0, startsAt: '', endsAt: '',
};

export default function VotePackagesPage() {
  const { contestId } = useParams() as { contestId: string };
  const [packages, setPackages] = useState<VotePackage[]>([]);
  const [loading, setLoading] = useState(true);
  const [form, setForm] = useState({ ...EMPTY_FORM });
  const [editing, setEditing] = useState<string | null>(null);
  const [msg, setMsg] = useState('');
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    const headers = await authHeaders();
    const res = await fetch(`/api/admin/voting/packages?contestId=${contestId}`, { headers });
    if (res.ok) {
      const json = await res.json();
      setPackages(json.packages ?? []);
    }
    setLoading(false);
  }, [contestId]);

  useEffect(() => { load(); }, [load]);

  function applyPreset(preset: (typeof VOTE_PACKAGE_PRESETS)[number]) {
    setForm((f) => ({ ...f, name: preset.name, votes: preset.votes, bonusVotes: preset.bonusVotes, amount: preset.amount }));
  }

  function startEdit(pkg: VotePackage) {
    setEditing(pkg.id);
    setForm({
      name: pkg.name, description: pkg.description ?? '', votes: pkg.votes,
      bonusVotes: pkg.bonusVotes, amount: pkg.amount, currency: pkg.currency,
      isActive: pkg.isActive, isRecommended: pkg.isRecommended,
      promoLabel: pkg.promoLabel ?? '', displayOrder: pkg.displayOrder,
      startsAt: pkg.startsAt?.replace('Z', '') ?? '', endsAt: pkg.endsAt?.replace('Z', '') ?? '',
    });
    setMsg('');
  }

  function cancelEdit() {
    setEditing(null);
    setForm({ ...EMPTY_FORM });
    setMsg('');
  }

  async function save() {
    if (!form.name || form.votes <= 0 || form.amount < 0) {
      setMsg('Name, votes (> 0), and amount are required');
      return;
    }
    setSaving(true);
    setMsg('');
    try {
      const headers = await authHeaders(true);
      const body = editing
        ? { id: editing, ...form }
        : { contestId, ...form };
      const res = await fetch('/api/admin/voting/packages', {
        method: editing ? 'PATCH' : 'POST',
        headers,
        body: JSON.stringify(body),
      });
      const json = await res.json();
      if (json.success) {
        setMsg('✅ Saved');
        cancelEdit();
        await load();
      } else {
        setMsg(`❌ ${json.error}`);
      }
    } catch {
      setMsg('❌ Network error');
    } finally {
      setSaving(false);
    }
  }

  async function deactivate(id: string) {
    const headers = await authHeaders();
    await fetch(`/api/admin/voting/packages?id=${id}`, { method: 'DELETE', headers });
    await load();
  }

  if (loading) return <div className="p-8 text-gray-400 animate-pulse">Loading packages…</div>;

  return (
    <div className="p-6 max-w-4xl mx-auto">
      <h1 className="text-xl font-bold text-white mb-6">Vote Packages</h1>

      {/* Existing packages */}
      {packages.length > 0 && (
        <div className="mb-8 space-y-2">
          {packages.map((pkg) => (
            <div
              key={pkg.id}
              className={`flex items-center justify-between gap-3 rounded-2xl px-5 py-4 ${
                pkg.isActive ? 'bg-gray-800' : 'bg-gray-900 opacity-50'
              }`}
            >
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2">
                  <p className="text-white font-semibold">{pkg.name}</p>
                  {pkg.isRecommended && (
                    <span className="text-xs bg-amber-500 text-black px-2 py-0.5 rounded-full font-medium">Popular</span>
                  )}
                  {pkg.promoLabel && (
                    <span className="text-xs bg-green-600 text-white px-2 py-0.5 rounded-full">{pkg.promoLabel}</span>
                  )}
                  {!pkg.isActive && (
                    <span className="text-xs bg-gray-700 text-gray-400 px-2 py-0.5 rounded-full">Inactive</span>
                  )}
                </div>
                <p className="text-gray-400 text-sm">
                  {pkg.votes} votes{pkg.bonusVotes > 0 ? ` + ${pkg.bonusVotes} bonus` : ''} —{' '}
                  <span className="text-amber-400 font-semibold">{FORMAT_NAIRA(pkg.amount)}</span>
                </p>
              </div>
              <div className="flex gap-2 shrink-0">
                <button onClick={() => startEdit(pkg)} className="text-xs text-amber-400 hover:text-amber-300 underline">Edit</button>
                {pkg.isActive && (
                  <button onClick={() => deactivate(pkg.id)} className="text-xs text-red-400 hover:text-red-300 underline">Deactivate</button>
                )}
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Package form */}
      <div className="bg-gray-900 rounded-2xl p-5">
        <h2 className="text-sm font-bold text-white mb-4">
          {editing ? 'Edit Package' : 'Add New Package'}
        </h2>

        {/* Preset buttons */}
        {!editing && (
          <div className="mb-4">
            <p className="text-xs text-gray-500 mb-2">Quick presets</p>
            <div className="flex flex-wrap gap-2">
              {VOTE_PACKAGE_PRESETS.map((p) => (
                <button
                  key={p.name}
                  onClick={() => applyPreset(p)}
                  className="text-xs bg-gray-800 hover:bg-gray-700 text-gray-300 px-3 py-1.5 rounded-lg transition-all"
                >
                  {p.name} — {FORMAT_NAIRA(p.amount)}
                </button>
              ))}
            </div>
          </div>
        )}

        <div className="grid grid-cols-2 gap-3">
          <input
            placeholder="Package name *"
            value={form.name}
            onChange={(e) => setForm({ ...form, name: e.target.value })}
            className="col-span-2 bg-gray-800 border border-gray-700 rounded-xl px-3 py-2.5 text-white text-sm"
          />
          <input
            placeholder="Description"
            value={form.description}
            onChange={(e) => setForm({ ...form, description: e.target.value })}
            className="col-span-2 bg-gray-800 border border-gray-700 rounded-xl px-3 py-2.5 text-white text-sm"
          />
          <div>
            <label className="text-xs text-gray-500 block mb-1">Votes *</label>
            <input type="number" min={1} value={form.votes || ''} onChange={(e) => setForm({ ...form, votes: Number(e.target.value) })}
              className="w-full bg-gray-800 border border-gray-700 rounded-xl px-3 py-2.5 text-white text-sm" />
          </div>
          <div>
            <label className="text-xs text-gray-500 block mb-1">Bonus Votes</label>
            <input type="number" min={0} value={form.bonusVotes || ''} onChange={(e) => setForm({ ...form, bonusVotes: Number(e.target.value) })}
              className="w-full bg-gray-800 border border-gray-700 rounded-xl px-3 py-2.5 text-white text-sm" />
          </div>
          <div>
            <label className="text-xs text-gray-500 block mb-1">Amount (₦) *</label>
            <input type="number" min={0} value={form.amount || ''} onChange={(e) => setForm({ ...form, amount: Number(e.target.value) })}
              className="w-full bg-gray-800 border border-gray-700 rounded-xl px-3 py-2.5 text-white text-sm" />
          </div>
          <div>
            <label className="text-xs text-gray-500 block mb-1">Display Order</label>
            <input type="number" min={0} value={form.displayOrder || 0} onChange={(e) => setForm({ ...form, displayOrder: Number(e.target.value) })}
              className="w-full bg-gray-800 border border-gray-700 rounded-xl px-3 py-2.5 text-white text-sm" />
          </div>
          <input
            placeholder="Promo label (e.g. Weekend Bonus)"
            value={form.promoLabel}
            onChange={(e) => setForm({ ...form, promoLabel: e.target.value })}
            className="col-span-2 bg-gray-800 border border-gray-700 rounded-xl px-3 py-2.5 text-white text-sm"
          />
          <div>
            <label className="text-xs text-gray-500 block mb-1">Available From</label>
            <input type="datetime-local" value={form.startsAt} onChange={(e) => setForm({ ...form, startsAt: e.target.value })}
              className="w-full bg-gray-800 border border-gray-700 rounded-xl px-3 py-2.5 text-white text-sm" />
          </div>
          <div>
            <label className="text-xs text-gray-500 block mb-1">Available Until</label>
            <input type="datetime-local" value={form.endsAt} onChange={(e) => setForm({ ...form, endsAt: e.target.value })}
              className="w-full bg-gray-800 border border-gray-700 rounded-xl px-3 py-2.5 text-white text-sm" />
          </div>
          <div className="flex items-center gap-3">
            <label className="text-sm text-gray-300 flex items-center gap-2 cursor-pointer">
              <input type="checkbox" checked={form.isRecommended} onChange={(e) => setForm({ ...form, isRecommended: e.target.checked })}
                className="w-4 h-4 accent-amber-500" />
              Mark as Popular
            </label>
          </div>
          <div className="flex items-center gap-3">
            <label className="text-sm text-gray-300 flex items-center gap-2 cursor-pointer">
              <input type="checkbox" checked={form.isActive} onChange={(e) => setForm({ ...form, isActive: e.target.checked })}
                className="w-4 h-4 accent-amber-500" />
              Active
            </label>
          </div>
        </div>

        {msg && <p className={`text-sm mt-3 ${msg.startsWith('✅') ? 'text-green-400' : 'text-red-400'}`}>{msg}</p>}

        <div className="flex gap-3 mt-4">
          {editing && (
            <button onClick={cancelEdit} className="flex-1 border border-gray-700 text-gray-300 py-3 rounded-xl text-sm">
              Cancel
            </button>
          )}
          <button
            onClick={save}
            disabled={saving}
            className="flex-1 bg-amber-500 hover:bg-amber-400 disabled:opacity-50 text-black font-bold py-3 rounded-xl text-sm transition-all"
          >
            {saving ? 'Saving…' : editing ? 'Update Package' : 'Add Package'}
          </button>
        </div>
      </div>
    </div>
  );
}
