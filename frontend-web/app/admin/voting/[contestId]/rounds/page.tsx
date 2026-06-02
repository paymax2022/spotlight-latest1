'use client';

import { useEffect, useState, useCallback } from 'react';
import { useParams } from 'next/navigation';
import { authHeaders } from '@/src/lib/auth/client';
import { ROUND_TYPE_LABELS } from '@/src/features/voting/constants';
import type { VotingRound } from '@/src/features/voting/types';

const EMPTY_FORM = {
  name: '', slug: '', roundNumber: 1, roundType: 'standard', votingType: 'hybrid',
  freeVotesPerDay: '', carryForwardVotes: false, resetVotes: false,
  voteWeight: 1.0, judgeScoreWeight: 0.0, publicVoteWeight: 1.0,
  eliminationCount: '', qualificationCount: '', startsAt: '', endsAt: '',
};

const STATUS_COLORS: Record<string, string> = {
  upcoming: 'text-gray-400', active: 'text-green-400',
  closed: 'text-red-400', results_published: 'text-blue-400',
};

export default function VotingRoundsPage() {
  const { contestId } = useParams() as { contestId: string };
  const [rounds, setRounds] = useState<VotingRound[]>([]);
  const [loading, setLoading] = useState(true);
  const [form, setForm] = useState({ ...EMPTY_FORM });
  const [editing, setEditing] = useState<string | null>(null);
  const [msg, setMsg] = useState('');
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    const headers = await authHeaders();
    const res = await fetch(`/api/admin/voting/rounds?contestId=${contestId}`, { headers });
    if (res.ok) setRounds((await res.json()).rounds ?? []);
    setLoading(false);
  }, [contestId]);

  useEffect(() => { load(); }, [load]);

  function autoSlug(name: string) {
    return name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
  }

  function startEdit(r: VotingRound) {
    setEditing(r.id);
    setForm({
      name: r.name, slug: r.slug, roundNumber: r.roundNumber, roundType: r.roundType,
      votingType: r.votingType, freeVotesPerDay: r.freeVotesPerDay != null ? String(r.freeVotesPerDay) : '',
      carryForwardVotes: r.carryForwardVotes, resetVotes: r.resetVotes,
      voteWeight: r.voteWeight, judgeScoreWeight: r.judgeScoreWeight, publicVoteWeight: r.publicVoteWeight,
      eliminationCount: r.eliminationCount != null ? String(r.eliminationCount) : '',
      qualificationCount: r.qualificationCount != null ? String(r.qualificationCount) : '',
      startsAt: r.startsAt?.replace('Z', '') ?? '', endsAt: r.endsAt?.replace('Z', '') ?? '',
    });
    setMsg('');
  }

  async function save() {
    if (!form.name || !form.slug) { setMsg('Name and slug are required'); return; }
    setSaving(true); setMsg('');
    try {
      const headers = await authHeaders(true);
      const body = {
        ...(editing ? { id: editing } : { contestId }),
        name: form.name, slug: form.slug, roundNumber: form.roundNumber,
        roundType: form.roundType, votingType: form.votingType,
        freeVotesPerDay: form.freeVotesPerDay ? Number(form.freeVotesPerDay) : null,
        carryForwardVotes: form.carryForwardVotes, resetVotes: form.resetVotes,
        voteWeight: form.voteWeight, judgeScoreWeight: form.judgeScoreWeight,
        publicVoteWeight: form.publicVoteWeight,
        eliminationCount: form.eliminationCount ? Number(form.eliminationCount) : null,
        qualificationCount: form.qualificationCount ? Number(form.qualificationCount) : null,
        startsAt: form.startsAt || null, endsAt: form.endsAt || null,
      };
      const res = await fetch('/api/admin/voting/rounds', {
        method: editing ? 'PATCH' : 'POST', headers, body: JSON.stringify(body),
      });
      const json = await res.json();
      setMsg(json.success ? '✅ Saved' : `❌ ${json.error}`);
      if (json.success) { setEditing(null); setForm({ ...EMPTY_FORM }); load(); }
    } catch { setMsg('❌ Network error'); }
    finally { setSaving(false); }
  }

  if (loading) return <div className="p-8 text-gray-400 animate-pulse">Loading rounds…</div>;

  return (
    <div className="p-6 max-w-4xl mx-auto">
      <h1 className="text-xl font-bold text-white mb-6">Voting Rounds</h1>

      {rounds.length > 0 && (
        <div className="mb-8 space-y-2">
          {rounds.sort((a, b) => a.roundNumber - b.roundNumber).map((r) => (
            <div key={r.id} className="bg-gray-800 rounded-2xl px-5 py-4 flex items-center justify-between gap-3">
              <div>
                <div className="flex items-center gap-2">
                  <span className="text-white font-semibold">#{r.roundNumber} — {r.name}</span>
                  <span className={`text-xs font-medium ${STATUS_COLORS[r.status] ?? 'text-gray-400'}`}>● {r.status}</span>
                </div>
                <p className="text-gray-500 text-xs mt-0.5">
                  {ROUND_TYPE_LABELS[r.roundType] ?? r.roundType} · {r.votingType} voting
                  {r.startsAt ? ` · ${new Date(r.startsAt).toLocaleDateString()}` : ''}
                  {r.endsAt ? ` → ${new Date(r.endsAt).toLocaleDateString()}` : ''}
                </p>
              </div>
              <button onClick={() => startEdit(r)} className="text-xs text-amber-400 hover:text-amber-300 underline shrink-0">Edit</button>
            </div>
          ))}
        </div>
      )}

      <div className="bg-gray-900 rounded-2xl p-5">
        <h2 className="text-sm font-bold text-white mb-4">{editing ? 'Edit Round' : 'Add Round'}</h2>

        <div className="grid grid-cols-2 gap-3">
          <input placeholder="Round name *" value={form.name}
            onChange={(e) => setForm({ ...form, name: e.target.value, slug: editing ? form.slug : autoSlug(e.target.value) })}
            className="col-span-2 bg-gray-800 border border-gray-700 rounded-xl px-3 py-2.5 text-white text-sm" />
          <input placeholder="slug (url-safe) *" value={form.slug}
            onChange={(e) => setForm({ ...form, slug: e.target.value })}
            className="bg-gray-800 border border-gray-700 rounded-xl px-3 py-2.5 text-white text-sm" />
          <input type="number" min={1} placeholder="Round number" value={form.roundNumber}
            onChange={(e) => setForm({ ...form, roundNumber: Number(e.target.value) })}
            className="bg-gray-800 border border-gray-700 rounded-xl px-3 py-2.5 text-white text-sm" />

          {(['roundType', 'votingType'] as const).map((key) => (
            <div key={key}>
              <label className="text-xs text-gray-500 block mb-1 capitalize">{key.replace(/([A-Z])/g, ' $1')}</label>
              <select value={String(form[key])} onChange={(e) => setForm({ ...form, [key]: e.target.value })}
                className="w-full bg-gray-800 border border-gray-700 rounded-xl px-3 py-2.5 text-white text-sm">
                {key === 'roundType'
                  ? Object.entries(ROUND_TYPE_LABELS).map(([v, l]) => <option key={v} value={v}>{l}</option>)
                  : ['free', 'paid', 'hybrid'].map((v) => <option key={v} value={v}>{v}</option>)
                }
              </select>
            </div>
          ))}

          <input type="number" placeholder="Free votes/day override" value={form.freeVotesPerDay}
            onChange={(e) => setForm({ ...form, freeVotesPerDay: e.target.value })}
            className="bg-gray-800 border border-gray-700 rounded-xl px-3 py-2.5 text-white text-sm" />
          <input type="number" placeholder="Elimination count" value={form.eliminationCount}
            onChange={(e) => setForm({ ...form, eliminationCount: e.target.value })}
            className="bg-gray-800 border border-gray-700 rounded-xl px-3 py-2.5 text-white text-sm" />

          <div>
            <label className="text-xs text-gray-500 block mb-1">Start</label>
            <input type="datetime-local" value={form.startsAt} onChange={(e) => setForm({ ...form, startsAt: e.target.value })}
              className="w-full bg-gray-800 border border-gray-700 rounded-xl px-3 py-2.5 text-white text-sm" />
          </div>
          <div>
            <label className="text-xs text-gray-500 block mb-1">End</label>
            <input type="datetime-local" value={form.endsAt} onChange={(e) => setForm({ ...form, endsAt: e.target.value })}
              className="w-full bg-gray-800 border border-gray-700 rounded-xl px-3 py-2.5 text-white text-sm" />
          </div>

          <label className="text-sm text-gray-300 flex items-center gap-2 cursor-pointer">
            <input type="checkbox" checked={form.resetVotes} onChange={(e) => setForm({ ...form, resetVotes: e.target.checked })}
              className="w-4 h-4 accent-amber-500" /> Reset votes each round
          </label>
          <label className="text-sm text-gray-300 flex items-center gap-2 cursor-pointer">
            <input type="checkbox" checked={form.carryForwardVotes} onChange={(e) => setForm({ ...form, carryForwardVotes: e.target.checked })}
              className="w-4 h-4 accent-amber-500" /> Carry forward votes
          </label>
        </div>

        {msg && <p className={`text-sm mt-3 ${msg.startsWith('✅') ? 'text-green-400' : 'text-red-400'}`}>{msg}</p>}

        <div className="flex gap-3 mt-4">
          {editing && (
            <button onClick={() => { setEditing(null); setForm({ ...EMPTY_FORM }); setMsg(''); }}
              className="flex-1 border border-gray-700 text-gray-300 py-3 rounded-xl text-sm">Cancel</button>
          )}
          <button onClick={save} disabled={saving}
            className="flex-1 bg-amber-500 hover:bg-amber-400 disabled:opacity-50 text-black font-bold py-3 rounded-xl text-sm">
            {saving ? 'Saving…' : editing ? 'Update Round' : 'Add Round'}
          </button>
        </div>
      </div>
    </div>
  );
}
