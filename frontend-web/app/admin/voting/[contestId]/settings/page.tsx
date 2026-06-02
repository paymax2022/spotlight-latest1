'use client';

import { useEffect, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { authHeaders } from '@/src/lib/auth/client';

export default function VotingSettingsPage() {
  const { contestId } = useParams() as { contestId: string };
  const router = useRouter();
  const [form, setForm] = useState<Record<string, unknown>>({
    contestId,
    votingEnabled: false,
    votingType: 'hybrid',
    freeVotingEnabled: true,
    freeVotesPerDay: 3,
    freeVoteLimitScope: 'user',
    requireLoginForFreeVote: true,
    requireCaptcha: false,
    voteCooldownSeconds: 0,
    paidVotingEnabled: false,
    currency: 'NGN',
    paymentProvider: 'paystack',
    paymentRefPrefix: 'SPT-VOTE',
    showPublicVoteCount: true,
    showPublicLeaderboard: true,
    showPublicRank: true,
    allowVoteSharing: true,
    votingStartsAt: '',
    votingEndsAt: '',
    timezone: 'Africa/Lagos',
    leaderboardFreezeEnabled: false,
    leaderboardFreezeAt: '',
    fraudDetectionEnabled: true,
    status: 'draft',
  });
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState('');

  useEffect(() => {
    (async () => {
      const headers = await authHeaders();
      const res = await fetch(`/api/admin/voting/settings?contestId=${contestId}`, { headers });
      if (res.ok) {
        const json = await res.json();
        if (json.settings?.[0]) {
          const s = json.settings[0];
          setForm({
            contestId,
            votingEnabled: s.voting_enabled,
            votingType: s.voting_type,
            freeVotingEnabled: s.free_voting_enabled,
            freeVotesPerDay: s.free_votes_per_day,
            freeVoteLimitScope: s.free_vote_limit_scope,
            requireLoginForFreeVote: s.require_login_for_free_vote,
            requireCaptcha: s.require_captcha,
            voteCooldownSeconds: s.vote_cooldown_seconds,
            paidVotingEnabled: s.paid_voting_enabled,
            currency: s.currency,
            paymentProvider: s.payment_provider,
            paymentRefPrefix: s.payment_ref_prefix,
            showPublicVoteCount: s.show_public_vote_count,
            showPublicLeaderboard: s.show_public_leaderboard,
            showPublicRank: s.show_public_rank,
            allowVoteSharing: s.allow_vote_sharing,
            votingStartsAt: s.voting_starts_at ? s.voting_starts_at.replace('Z', '') : '',
            votingEndsAt: s.voting_ends_at ? s.voting_ends_at.replace('Z', '') : '',
            timezone: s.timezone,
            leaderboardFreezeEnabled: s.leaderboard_freeze_enabled,
            leaderboardFreezeAt: s.leaderboard_freeze_at ? s.leaderboard_freeze_at.replace('Z', '') : '',
            fraudDetectionEnabled: s.fraud_detection_enabled,
            status: s.status,
          });
        }
      }
      setLoading(false);
    })();
  }, [contestId]);

  async function save() {
    setSaving(true);
    setMessage('');
    try {
      const headers = await authHeaders(true);
      const res = await fetch('/api/admin/voting/settings', {
        method: 'POST',
        headers,
        body: JSON.stringify(form),
      });
      const json = await res.json();
      setMessage(json.success ? '✅ Settings saved' : `❌ ${json.error}`);
    } catch {
      setMessage('❌ Network error');
    } finally {
      setSaving(false);
    }
  }

  const field = (key: string, label: string, type: 'text' | 'number' | 'checkbox' | 'select' | 'datetime-local', options?: string[]) => (
    <div className="grid grid-cols-2 gap-4 items-center py-3 border-b border-gray-800">
      <label className="text-sm text-gray-300">{label}</label>
      {type === 'checkbox' ? (
        <input
          type="checkbox"
          checked={Boolean(form[key])}
          onChange={(e) => setForm({ ...form, [key]: e.target.checked })}
          className="w-5 h-5 accent-amber-500"
        />
      ) : type === 'select' ? (
        <select
          value={String(form[key] ?? '')}
          onChange={(e) => setForm({ ...form, [key]: e.target.value })}
          className="bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-white text-sm"
        >
          {(options ?? []).map((o) => <option key={o} value={o}>{o}</option>)}
        </select>
      ) : (
        <input
          type={type}
          value={String(form[key] ?? '')}
          onChange={(e) => setForm({ ...form, [key]: type === 'number' ? Number(e.target.value) : e.target.value })}
          className="bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-white text-sm"
        />
      )}
    </div>
  );

  if (loading) return <div className="p-8 text-gray-400 animate-pulse">Loading…</div>;

  return (
    <div className="p-6 max-w-2xl mx-auto">
      <h1 className="text-xl font-bold text-white mb-6">Voting Settings</h1>

      <div className="bg-gray-900 rounded-2xl p-5 mb-4">
        <h2 className="text-sm font-semibold text-gray-400 uppercase tracking-wider mb-2">Voting Status</h2>
        {field('status', 'Status', 'select', ['draft', 'active', 'paused', 'closed'])}
        {field('votingEnabled', 'Enable Voting', 'checkbox')}
        {field('votingType', 'Voting Type', 'select', ['free', 'paid', 'hybrid'])}
        {field('votingStartsAt', 'Voting Starts', 'datetime-local')}
        {field('votingEndsAt', 'Voting Ends', 'datetime-local')}
        {field('timezone', 'Timezone', 'select', ['Africa/Lagos', 'UTC', 'Africa/Abidjan'])}
      </div>

      <div className="bg-gray-900 rounded-2xl p-5 mb-4">
        <h2 className="text-sm font-semibold text-gray-400 uppercase tracking-wider mb-2">Free Voting</h2>
        {field('freeVotingEnabled', 'Enable Free Voting', 'checkbox')}
        {field('freeVotesPerDay', 'Free Votes Per Day', 'number')}
        {field('freeVoteLimitScope', 'Limit By', 'select', ['user', 'email', 'phone', 'device', 'ip', 'session'])}
        {field('requireLoginForFreeVote', 'Require Login', 'checkbox')}
        {field('requireCaptcha', 'Require CAPTCHA', 'checkbox')}
        {field('voteCooldownSeconds', 'Cooldown (seconds)', 'number')}
      </div>

      <div className="bg-gray-900 rounded-2xl p-5 mb-4">
        <h2 className="text-sm font-semibold text-gray-400 uppercase tracking-wider mb-2">Paid Voting</h2>
        {field('paidVotingEnabled', 'Enable Paid Voting', 'checkbox')}
        {field('currency', 'Currency', 'select', ['NGN', 'USD', 'GBP'])}
        {field('paymentProvider', 'Payment Provider', 'select', ['paystack', 'flutterwave', 'monnify', 'squad'])}
        {field('paymentRefPrefix', 'Reference Prefix', 'text')}
      </div>

      <div className="bg-gray-900 rounded-2xl p-5 mb-4">
        <h2 className="text-sm font-semibold text-gray-400 uppercase tracking-wider mb-2">Visibility</h2>
        {field('showPublicVoteCount', 'Show Vote Count Publicly', 'checkbox')}
        {field('showPublicLeaderboard', 'Show Leaderboard Publicly', 'checkbox')}
        {field('showPublicRank', 'Show Rank Publicly', 'checkbox')}
        {field('allowVoteSharing', 'Allow Vote Sharing', 'checkbox')}
      </div>

      <div className="bg-gray-900 rounded-2xl p-5 mb-4">
        <h2 className="text-sm font-semibold text-gray-400 uppercase tracking-wider mb-2">Leaderboard</h2>
        {field('leaderboardFreezeEnabled', 'Freeze Leaderboard', 'checkbox')}
        {field('leaderboardFreezeAt', 'Freeze At', 'datetime-local')}
      </div>

      <div className="bg-gray-900 rounded-2xl p-5 mb-6">
        <h2 className="text-sm font-semibold text-gray-400 uppercase tracking-wider mb-2">Fraud Control</h2>
        {field('fraudDetectionEnabled', 'Enable Fraud Detection', 'checkbox')}
      </div>

      {message && (
        <p className={`text-sm mb-4 ${message.startsWith('✅') ? 'text-green-400' : 'text-red-400'}`}>{message}</p>
      )}

      <button
        onClick={save}
        disabled={saving}
        className="w-full bg-amber-500 hover:bg-amber-400 disabled:opacity-50 text-black font-bold py-3 rounded-xl transition-all"
      >
        {saving ? 'Saving…' : 'Save Settings'}
      </button>
    </div>
  );
}
