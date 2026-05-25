'use client';

import { useState } from 'react';

export default function VoteRiskControls({
  contestId,
  suspiciousVoteThreshold,
  suspiciousVoteHighThreshold,
}: {
  contestId: string;
  suspiciousVoteThreshold: number;
  suspiciousVoteHighThreshold: number;
}) {
  const [low, setLow] = useState(String(suspiciousVoteThreshold || 100));
  const [high, setHigh] = useState(String(suspiciousVoteHighThreshold || 300));
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState('');

  async function save() {
    setSaving(true);
    setMessage('');
    const res = await fetch(`/api/admin/open-mic/contests/${contestId}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json', 'x-spotlight-role': 'admin' },
      body: JSON.stringify({
        votingConfig: {
          suspiciousVoteThreshold: Number(low),
          suspiciousVoteHighThreshold: Number(high),
        },
      }),
    });
    const payload = await res.json().catch(() => ({}));
    setSaving(false);
    setMessage(res.ok && payload?.success ? 'Risk thresholds saved.' : payload?.error || 'Failed to save.');
    if (res.ok && payload?.success) window.location.reload();
  }

  return (
    <div className="glass-card rounded-md p-4 mt-4">
      <h3 className="text-foreground font-semibold mb-2">Suspicious Voting Thresholds</h3>
      <div className="grid md:grid-cols-3 gap-2">
        <input className="form-input h-[38px] px-3 text-sm" value={low} onChange={(e) => setLow(e.target.value)} placeholder="Medium threshold" />
        <input className="form-input h-[38px] px-3 text-sm" value={high} onChange={(e) => setHigh(e.target.value)} placeholder="High threshold" />
        <button type="button" className="btn-outline py-2 px-3 text-xs" disabled={saving} onClick={() => void save()}>
          {saving ? 'Saving...' : 'Save Thresholds'}
        </button>
      </div>
      {message ? <p className="text-xs text-foreground/70 mt-2">{message}</p> : null}
    </div>
  );
}
