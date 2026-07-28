'use client';

import { useEffect, useState, useCallback } from 'react';
import { useParams } from 'next/navigation';
import { authHeaders } from '@/src/lib/auth/client';

const SEVERITY_COLORS: Record<string, string> = {
  critical: 'bg-red-600/20 text-red-400 border-red-600/40',
  high: 'bg-orange-600/20 text-orange-400 border-orange-600/40',
  medium: 'bg-yellow-600/20 text-yellow-400 border-yellow-600/40',
  low: 'bg-gray-700 text-gray-400 border-gray-600',
};

export default function FraudMonitoringPage() {
  const { contestId } = useParams() as { contestId: string };
  const [flags, setFlags] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [activeStatus, setActiveStatus] = useState('open');
  const [resolveId, setResolveId] = useState('');
  const [actionTaken, setActionTaken] = useState('');
  const [resolveStatus, setResolveStatus] = useState<'resolved' | 'dismissed' | 'actioned'>('resolved');
  const [msg, setMsg] = useState('');

  const load = useCallback(async () => {
    const headers = await authHeaders();
    const res = await fetch(`/api/admin/voting/${contestId}/fraud-alerts?status=${activeStatus}`, { headers });
    if (res.ok) {
      const json = await res.json();
      setFlags(json.flags ?? []);
    }
    setLoading(false);
  }, [contestId, activeStatus]);

  useEffect(() => { load(); }, [load]);

  async function resolve() {
    if (!resolveId || !actionTaken) { setMsg('Flag ID and action are required'); return; }
    const headers = await authHeaders(true);
    const res = await fetch(`/api/admin/voting/${contestId}/fraud-alerts`, {
      method: 'PATCH',
      headers,
      body: JSON.stringify({ flagId: resolveId, status: resolveStatus, actionTaken }),
    });
    const json = await res.json();
    setMsg(json.success ? '✅ Flag resolved' : `❌ ${json.error}`);
    if (json.success) { setResolveId(''); setActionTaken(''); load(); }
  }

  if (loading) return <div className="p-8 text-gray-400 animate-pulse">Loading fraud alerts…</div>;

  return (
    <div className="p-6 max-w-5xl mx-auto">
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-xl font-bold text-white">Fraud Monitoring</h1>
        <div className="flex gap-2">
          {['open', 'under_review', 'resolved', 'dismissed'].map((s) => (
            <button
              key={s}
              onClick={() => { setActiveStatus(s); setLoading(true); }}
              className={`text-xs px-3 py-1.5 rounded-lg capitalize ${
                activeStatus === s ? 'bg-amber-500 text-black font-bold' : 'bg-gray-800 text-gray-400'
              }`}
            >
              {s.replace('_', ' ')}
            </button>
          ))}
        </div>
      </div>

      <div className="space-y-3 mb-8">
        {flags.length === 0 ? (
          <div className="bg-gray-900 rounded-2xl p-8 text-center text-gray-500">No {activeStatus} fraud flags</div>
        ) : flags.map((flag) => (
          <div key={flag.id} className={`border rounded-2xl p-4 ${SEVERITY_COLORS[flag.severity] ?? SEVERITY_COLORS.low}`}>
            <div className="flex items-start justify-between gap-3">
              <div>
                <div className="flex items-center gap-2 mb-1">
                  <span className="text-xs font-bold uppercase">{flag.severity}</span>
                  <span className="text-xs bg-black/20 px-2 py-0.5 rounded font-mono">{flag.flag_type}</span>
                </div>
                <p className="text-sm">{flag.description}</p>
                {flag.contestant_id && <p className="text-xs opacity-70 mt-1">Contestant: {flag.contestant_id}</p>}
                <p className="text-xs opacity-50 mt-1">{new Date(flag.created_at).toLocaleString()}</p>
              </div>
              <button
                onClick={() => setResolveId(flag.id)}
                className="text-xs underline opacity-70 hover:opacity-100 shrink-0"
              >
                Resolve
              </button>
            </div>
          </div>
        ))}
      </div>

      {/* Resolve panel */}
      <div className="bg-gray-900 rounded-2xl p-5">
        <h2 className="text-sm font-bold text-white mb-4">Resolve Flag</h2>
        <div className="space-y-3">
          <input
            placeholder="Flag ID"
            value={resolveId}
            onChange={(e) => setResolveId(e.target.value)}
            className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-white text-sm"
          />
          <select
            value={resolveStatus}
            onChange={(e) => setResolveStatus(e.target.value as any)}
            className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-white text-sm"
          >
            <option value="resolved">Resolved</option>
            <option value="dismissed">Dismissed (false positive)</option>
            <option value="actioned">Actioned (vote reversed, voter banned, etc.)</option>
          </select>
          <input
            placeholder="Action taken / notes"
            value={actionTaken}
            onChange={(e) => setActionTaken(e.target.value)}
            className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-white text-sm"
          />
        </div>
        {msg && <p className={`text-sm mt-2 ${msg.startsWith('✅') ? 'text-green-400' : 'text-red-400'}`}>{msg}</p>}
        <button onClick={resolve} className="mt-3 bg-amber-500 hover:bg-amber-400 text-black font-bold px-5 py-2 rounded-xl text-sm">
          Submit Resolution
        </button>
      </div>
    </div>
  );
}
