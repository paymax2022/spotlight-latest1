'use client';

import { useState } from 'react';
import { adminAuthHeaders } from '@/src/lib/auth/client';

interface VotingConfig {
  enabled: boolean;
  freeVoting: boolean;
  freeVotesPerDay: number;
  paidVoting: boolean;
  votePrice: number;
  leaderboardVisible: boolean;
  voteCountPublic: boolean;
  votingStartAt?: string;
  votingEndAt?: string;
}

interface Props {
  contestId: string;
  initial: VotingConfig;
}

const fieldStyle: React.CSSProperties = {
  width: '100%', height: 40, padding: '0 12px', boxSizing: 'border-box',
  background: 'var(--bg)', border: '1px solid var(--border)',
  borderRadius: 8, color: 'var(--foreground)', fontSize: 13, outline: 'none',
};

const labelStyle: React.CSSProperties = {
  fontSize: 12, fontWeight: 600, color: 'var(--foreground-muted)',
  textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 4, display: 'block',
};

export default function VotingSettingsForm({ contestId, initial }: Props) {
  const [cfg, setCfg] = useState<VotingConfig>(initial);
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState<{ type: 'ok' | 'err'; text: string } | null>(null);

  function set<K extends keyof VotingConfig>(key: K, value: VotingConfig[K]) {
    setCfg((prev) => ({ ...prev, [key]: value }));
  }

  async function save() {
    setSaving(true);
    setMsg(null);
    try {
      const res = await fetch(`/api/admin/open-mic/contests/${contestId}`, {
        method: 'PATCH',
        headers: await adminAuthHeaders(true),
        body: JSON.stringify({ votingConfig: cfg }),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok || !json.success) throw new Error(json?.error || 'Save failed');
      setMsg({ type: 'ok', text: 'Voting settings saved successfully.' });
    } catch (err) {
      setMsg({ type: 'err', text: err instanceof Error ? err.message : 'Failed to save.' });
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="glass-card rounded-md p-5 mt-4">
      <h3 className="text-foreground font-semibold text-lg mb-1">Voting Configuration</h3>
      <p className="text-foreground/50 text-xs mb-5">Control how public voting works for this contest.</p>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-5">

        {/* ── Enable voting ───────────────────────────── */}
        <div className="md:col-span-2">
          <ToggleRow
            label="Voting Enabled"
            description="Turn public voting on or off for this contest"
            checked={cfg.enabled}
            onChange={(v) => set('enabled', v)}
          />
        </div>

        {/* ── Free voting ─────────────────────────────── */}
        <div className="md:col-span-2" style={{ borderTop: '1px solid var(--border)', paddingTop: 16 }}>
          <ToggleRow
            label="Free Voting"
            description="Allow voters to cast free votes each day"
            checked={cfg.freeVoting}
            onChange={(v) => set('freeVoting', v)}
          />
        </div>

        {cfg.freeVoting && (
          <div>
            <label style={labelStyle}>Free Votes Per Day</label>
            <input
              type="number"
              min={1}
              max={100}
              value={cfg.freeVotesPerDay}
              onChange={(e) => set('freeVotesPerDay', Math.max(1, Number(e.target.value)))}
              style={fieldStyle}
            />
            <p style={{ fontSize: 11, color: 'var(--foreground-muted)', marginTop: 4 }}>
              Max free votes each user can cast per day (resets at midnight).
            </p>
          </div>
        )}

        {/* ── Paid voting ─────────────────────────────── */}
        <div className="md:col-span-2" style={{ borderTop: '1px solid var(--border)', paddingTop: 16 }}>
          <ToggleRow
            label="Paid Voting"
            description="Allow voters to buy additional votes via Paystack"
            checked={cfg.paidVoting}
            onChange={(v) => set('paidVoting', v)}
          />
        </div>

        {cfg.paidVoting && (
          <div>
            <label style={labelStyle}>Price Per Vote (₦)</label>
            <input
              type="number"
              min={0}
              step={50}
              value={cfg.votePrice}
              onChange={(e) => set('votePrice', Math.max(0, Number(e.target.value)))}
              style={fieldStyle}
            />
            <p style={{ fontSize: 11, color: 'var(--foreground-muted)', marginTop: 4 }}>
              Amount in Naira charged per paid vote.
            </p>
          </div>
        )}

        {/* ── Voting window ───────────────────────────── */}
        <div style={{ borderTop: '1px solid var(--border)', paddingTop: 16 }}>
          <label style={labelStyle}>Voting Starts At</label>
          <input
            type="datetime-local"
            value={cfg.votingStartAt ? cfg.votingStartAt.slice(0, 16) : ''}
            onChange={(e) => set('votingStartAt', e.target.value ? new Date(e.target.value).toISOString() : undefined)}
            style={fieldStyle}
          />
        </div>

        <div style={{ borderTop: '1px solid var(--border)', paddingTop: 16 }}>
          <label style={labelStyle}>Voting Ends At</label>
          <input
            type="datetime-local"
            value={cfg.votingEndAt ? cfg.votingEndAt.slice(0, 16) : ''}
            onChange={(e) => set('votingEndAt', e.target.value ? new Date(e.target.value).toISOString() : undefined)}
            style={fieldStyle}
          />
        </div>

        {/* ── Visibility ──────────────────────────────── */}
        <div className="md:col-span-2" style={{ borderTop: '1px solid var(--border)', paddingTop: 16, display: 'flex', gap: 24, flexWrap: 'wrap' }}>
          <ToggleRow
            label="Show Vote Count"
            description="Display public vote totals on entries"
            checked={cfg.voteCountPublic}
            onChange={(v) => set('voteCountPublic', v)}
            compact
          />
          <ToggleRow
            label="Show Leaderboard"
            description="Show public ranking on entries page"
            checked={cfg.leaderboardVisible}
            onChange={(v) => set('leaderboardVisible', v)}
            compact
          />
        </div>
      </div>

      {/* ── Status message ─────────────────────────────────── */}
      {msg && (
        <div style={{
          marginTop: 16, padding: '10px 14px', borderRadius: 8, fontSize: 13,
          background: msg.type === 'ok' ? 'rgba(16,185,129,0.12)' : 'rgba(239,68,68,0.12)',
          border: `1px solid ${msg.type === 'ok' ? 'rgba(16,185,129,0.35)' : 'rgba(239,68,68,0.35)'}`,
          color: msg.type === 'ok' ? '#10b981' : '#ef4444',
        }}>
          {msg.type === 'ok' ? '✓' : '⚠'} {msg.text}
        </div>
      )}

      <div className="mt-5 flex gap-3">
        <button
          onClick={save}
          disabled={saving}
          className="btn-primary py-2 px-5 text-sm"
          style={{ opacity: saving ? 0.6 : 1 }}
        >
          {saving ? 'Saving…' : 'Save Settings'}
        </button>
      </div>
    </div>
  );
}

function ToggleRow({
  label, description, checked, onChange, compact = false,
}: {
  label: string; description: string; checked: boolean;
  onChange: (v: boolean) => void; compact?: boolean;
}) {
  return (
    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: compact ? 'center' : 'flex-start', gap: 12, flex: compact ? '1 1 200px' : undefined }}>
      <div>
        <p style={{ fontWeight: 600, fontSize: 13, color: 'var(--foreground)', marginBottom: 2 }}>{label}</p>
        {!compact && <p style={{ fontSize: 12, color: 'var(--foreground-muted)' }}>{description}</p>}
      </div>
      <button
        onClick={() => onChange(!checked)}
        style={{
          width: 44, height: 24, borderRadius: 12, border: 'none', cursor: 'pointer',
          background: checked ? '#f59e0b' : 'var(--border)',
          position: 'relative', flexShrink: 0, transition: 'background 0.2s',
        }}
        role="switch"
        aria-checked={checked}
      >
        <span style={{
          position: 'absolute', top: 3, left: checked ? 22 : 2,
          width: 18, height: 18, borderRadius: '50%', background: '#fff',
          transition: 'left 0.2s', boxShadow: '0 1px 4px rgba(0,0,0,0.2)',
        }} />
      </button>
    </div>
  );
}
