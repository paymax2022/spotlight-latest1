'use client';

// ── Admin — Voting Visibility control ────────────────────────────────────────
// Controls the universal voting engine's PUBLIC visibility: whether a contest (or
// a phase inside it) exposes the leaderboard, vote count and rank to the public.
// Backend (do NOT change) lives at /api/admin/voting/* and requires the
// `votes:manage` permission. Money is NOT involved here — these are display flags.

import { useCallback, useEffect, useMemo, useState } from 'react';
import type { CSSProperties } from 'react';
import { env } from '@/config/env';
import { hasAnyPermission, type AuthUser } from '@/features/auth/rbac';

// ─── Auth / fetch plumbing (mirrors connect/crowdfunding admin services) ──────

function votingBase(): string {
  return env.apiBaseUrl.replace(/\/api\/v1\/?$/, '/api/admin/voting');
}
function authHeaders(): Record<string, string> {
  if (typeof window === 'undefined') return {};
  const token = localStorage.getItem('spotlight_admin_access_token') || '';
  return token
    ? { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }
    : { 'Content-Type': 'application/json' };
}
async function apiGet<T>(path: string): Promise<T> {
  const res = await fetch(`${votingBase()}${path}`, { headers: authHeaders(), cache: 'no-store' });
  if (!res.ok) throw new Error(`Request failed (${res.status})`);
  return (await res.json()) as T;
}
async function apiSend<T>(method: 'POST' | 'DELETE', path: string, body?: unknown): Promise<T> {
  const res = await fetch(`${votingBase()}${path}`, {
    method,
    headers: authHeaders(),
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`Request failed (${res.status})`);
  return (await res.json()) as T;
}

// ─── Types (backend rows are snake_case) ──────────────────────────────────────

interface VotingSettingsRow {
  contest_id: string;
  voting_enabled?: boolean;
  voting_type?: string | null;
  free_voting_enabled?: boolean;
  free_votes_per_day?: number | null;
  paid_voting_enabled?: boolean;
  currency?: string | null;
  status?: string | null;
  active_phase_key?: string | null;
  show_public_vote_count?: boolean;
  show_public_leaderboard?: boolean;
  show_public_rank?: boolean;
  // Other fields may exist; we preserve them on save via passthrough.
  [key: string]: unknown;
}

interface PhaseRow {
  id?: string;
  contest_id: string;
  phase_key: string;
  phase_label: string;
  show_public_vote_count: boolean;
  show_public_leaderboard: boolean;
  show_public_rank: boolean;
  sort_order: number;
}

// snake_case -> camelCase converter for the settings upsert body, preserving the
// full row so we never wipe unrelated settings.
function toCamel(s: string): string {
  return s.replace(/_([a-z])/g, (_, c: string) => c.toUpperCase());
}
function settingsToUpsertBody(row: VotingSettingsRow): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(row)) {
    if (v === undefined) continue;
    out[toCamel(k)] = v;
  }
  out.contestId = row.contest_id;
  return out;
}

// ─── Styles (matches the realtor/connect light-card admin convention) ─────────

const card = (): CSSProperties => ({ border: '1px solid #e5e7eb', borderRadius: '0.5rem', padding: '1rem', background: '#fff', marginBottom: '1.25rem' });
const btn = (primary?: boolean): CSSProperties => ({
  padding: '0.45rem 0.9rem', borderRadius: '0.375rem', fontSize: '0.85rem', fontWeight: 600, cursor: 'pointer',
  border: primary ? '1px solid #340075' : '1px solid #d1d5db', background: primary ? '#340075' : '#fff', color: primary ? '#fff' : '#374151',
});
const dangerBtn = (): CSSProperties => ({ padding: '0.3rem 0.7rem', borderRadius: '0.375rem', fontSize: '0.8rem', cursor: 'pointer', border: '1px solid #fecaca', background: '#fff', color: '#b91c1c' });
const th = (): CSSProperties => ({ padding: '0.4rem 0.5rem', fontWeight: 600, textAlign: 'left', color: '#6b7280', fontSize: '0.72rem', textTransform: 'uppercase', letterSpacing: 0.3 });
const td = (): CSSProperties => ({ padding: '0.55rem 0.5rem', color: '#374151', fontSize: '0.85rem', borderTop: '1px solid #f3f4f6' });
const input = (): CSSProperties => ({ padding: '0.4rem 0.55rem', borderRadius: '0.375rem', border: '1px solid #d1d5db', fontSize: '0.85rem' });
const label = (): CSSProperties => ({ fontSize: '0.72rem', color: '#6b7280', textTransform: 'uppercase', letterSpacing: 0.3, marginBottom: 4, display: 'block' });

function Toggle({ checked, onChange, text }: { checked: boolean; onChange: (v: boolean) => void; text: string }) {
  return (
    <label style={{ display: 'inline-flex', alignItems: 'center', gap: 8, cursor: 'pointer', fontSize: '0.85rem', color: '#374151' }}>
      <input type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)} />
      <span>{text}</span>
    </label>
  );
}

// ─── Page ─────────────────────────────────────────────────────────────────────

const REQUIRED_PERMS = ['votes:manage'];

export default function VotingVisibilityPage() {
  const [authUser, setAuthUser] = useState<AuthUser | null>(null);
  const [permsLoaded, setPermsLoaded] = useState(false);

  const [contestIdInput, setContestIdInput] = useState('');
  const [contestId, setContestId] = useState<string | null>(null);

  const [settings, setSettings] = useState<VotingSettingsRow | null>(null);
  const [phases, setPhases] = useState<PhaseRow[]>([]);

  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  // phase editor form
  const blankPhase: PhaseRow = useMemo(() => ({
    contest_id: contestId ?? '', phase_key: '', phase_label: '',
    show_public_vote_count: true, show_public_leaderboard: true, show_public_rank: true, sort_order: 0,
  }), [contestId]);
  const [phaseForm, setPhaseForm] = useState<PhaseRow>(blankPhase);
  const [editingKey, setEditingKey] = useState<string | null>(null);

  useEffect(() => {
    try {
      const raw = localStorage.getItem('spotlight_admin_user');
      if (raw) setAuthUser(JSON.parse(raw) as AuthUser);
    } catch { /* ignore */ }
    setPermsLoaded(true);
  }, []);

  const canManage = hasAnyPermission(authUser, REQUIRED_PERMS);

  const load = useCallback(async (id: string) => {
    setLoading(true); setError(null); setSuccess(null);
    try {
      const [s, p] = await Promise.all([
        apiGet<{ settings: VotingSettingsRow[] }>(`/settings?contestId=${encodeURIComponent(id)}`),
        apiGet<{ phases: PhaseRow[] }>(`/phases?contestId=${encodeURIComponent(id)}`),
      ]);
      const row = s.settings?.[0] ?? { contest_id: id };
      setSettings(row);
      setPhases([...(p.phases ?? [])].sort((a, b) => a.sort_order - b.sort_order));
      setContestId(id);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setSettings(null);
      setPhases([]);
    } finally {
      setLoading(false);
    }
  }, []);

  function handleLoad() {
    const id = contestIdInput.trim();
    if (!id) { setError('Enter a contest ID.'); return; }
    void load(id);
  }

  // Save contest-level flags (merging the loaded row so we don't wipe other settings).
  async function saveContestFlag(patch: Partial<VotingSettingsRow>) {
    if (!settings || !contestId) return;
    const next: VotingSettingsRow = { ...settings, ...patch, contest_id: contestId };
    setSaving(true); setError(null); setSuccess(null);
    try {
      await apiSend('POST', '/settings', settingsToUpsertBody(next));
      setSettings(next);
      setSuccess('Visibility settings saved.');
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setSaving(false);
    }
  }

  async function setActivePhase(key: string | null) {
    await saveContestFlag({ active_phase_key: key });
  }

  async function savePhase() {
    if (!contestId) return;
    const key = phaseForm.phase_key.trim();
    const phaseLabel = phaseForm.phase_label.trim();
    if (!key) { setError('Phase key is required.'); return; }
    if (!phaseLabel) { setError('Phase label is required.'); return; }
    setSaving(true); setError(null); setSuccess(null);
    try {
      await apiSend('POST', '/phases', {
        contestId,
        phaseKey: key,
        phaseLabel,
        showPublicVoteCount: phaseForm.show_public_vote_count,
        showPublicLeaderboard: phaseForm.show_public_leaderboard,
        showPublicRank: phaseForm.show_public_rank,
        sortOrder: Number.isFinite(phaseForm.sort_order) ? phaseForm.sort_order : 0,
      });
      setSuccess(editingKey ? 'Phase updated.' : 'Phase added.');
      setPhaseForm(blankPhase);
      setEditingKey(null);
      await load(contestId);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setSaving(false);
    }
  }

  async function deletePhase(key: string) {
    if (!contestId) return;
    if (!window.confirm(`Delete phase "${key}"? This cannot be undone.`)) return;
    setSaving(true); setError(null); setSuccess(null);
    try {
      await apiSend('DELETE', `/phases?contestId=${encodeURIComponent(contestId)}&phaseKey=${encodeURIComponent(key)}`);
      // If the deleted phase was active, clear it.
      if (settings?.active_phase_key === key) {
        await saveContestFlag({ active_phase_key: null });
      }
      setSuccess('Phase deleted.');
      await load(contestId);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setSaving(false);
    }
  }

  function startEdit(p: PhaseRow) {
    setEditingKey(p.phase_key);
    setPhaseForm({ ...p, contest_id: contestId ?? '' });
    setSuccess(null); setError(null);
  }
  function cancelEdit() {
    setEditingKey(null);
    setPhaseForm(blankPhase);
  }

  // Effective visibility summary: active phase flags win, otherwise contest-level.
  const effective = useMemo(() => {
    if (!settings) return null;
    const activeKey = settings.active_phase_key ?? null;
    const activePhase = activeKey ? phases.find((p) => p.phase_key === activeKey) ?? null : null;
    const src = activePhase
      ? { count: activePhase.show_public_vote_count, board: activePhase.show_public_leaderboard, rank: activePhase.show_public_rank }
      : { count: !!settings.show_public_vote_count, board: !!settings.show_public_leaderboard, rank: !!settings.show_public_rank };
    return {
      scope: activePhase ? `Active phase: ${activePhase.phase_label}` : 'No active phase (contest-level)',
      ...src,
    };
  }, [settings, phases]);

  // ── Permission gate ─────────────────────────────────────────────────────────
  if (permsLoaded && !canManage) {
    return (
      <div style={{ padding: '0.5rem 0.5rem 2rem' }}>
        <h1 style={{ fontSize: '1.5rem', fontWeight: 700, margin: 0 }}>Voting Visibility</h1>
        <p style={{ color: '#b91c1c', marginTop: '1rem' }}>
          You do not have the <code>votes:manage</code> permission required to access this page.
        </p>
      </div>
    );
  }

  return (
    <div style={{ padding: '0.5rem 0.5rem 2rem' }}>
      <div style={{ marginBottom: '1.25rem' }}>
        <h1 style={{ fontSize: '1.5rem', fontWeight: 700, margin: 0 }}>Voting Visibility</h1>
        <p style={{ color: '#6b7280', margin: '0.25rem 0 0', fontSize: '0.85rem' }}>
          Control whether the universal voting engine exposes the leaderboard, vote count and rank — per contest or per phase.
        </p>
      </div>

      {/* Contest selector */}
      <div style={card()}>
        <span style={label()}>Contest ID</span>
        <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap', alignItems: 'center' }}>
          <input
            style={{ ...input(), minWidth: 320 }}
            placeholder="Enter a contest ID and click Load"
            value={contestIdInput}
            onChange={(e) => setContestIdInput(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter') handleLoad(); }}
          />
          <button style={btn(true)} onClick={handleLoad} disabled={loading}>{loading ? 'Loading…' : 'Load'}</button>
          {contestId ? <button style={btn()} onClick={() => void load(contestId)} disabled={loading}>Refresh</button> : null}
        </div>
      </div>

      {error ? <p style={{ color: '#dc2626', marginBottom: '1rem' }}>{error}</p> : null}
      {success ? <p style={{ color: '#15803d', marginBottom: '1rem' }}>{success}</p> : null}

      {!contestId && !loading ? (
        <p style={{ color: '#6b7280' }}>Load a contest to manage its voting visibility.</p>
      ) : null}

      {loading ? <p style={{ color: '#6b7280' }}>Loading contest settings…</p> : null}

      {contestId && settings && !loading ? (
        <>
          {/* Effective summary */}
          {effective ? (
            <div style={{ ...card(), borderLeft: '3px solid #340075' }}>
              <span style={label()}>Effective public visibility</span>
              <p style={{ margin: '0 0 0.5rem', fontSize: '0.95rem', fontWeight: 600, color: '#111827' }}>{effective.scope}</p>
              <p style={{ margin: 0, fontSize: '0.85rem', color: '#374151' }}>
                Leaderboard <strong>{effective.board ? 'shown' : 'hidden'}</strong>
                {' · '}Vote count <strong>{effective.count ? 'shown' : 'hidden'}</strong>
                {' · '}Rank <strong>{effective.rank ? 'shown' : 'hidden'}</strong>
              </p>
            </div>
          ) : null}

          {/* Contest-level flags */}
          <div style={card()}>
            <h2 style={{ fontSize: '1.05rem', fontWeight: 700, margin: '0 0 0.75rem' }}>Contest-level visibility</h2>
            <p style={{ color: '#6b7280', fontSize: '0.8rem', margin: '0 0 0.75rem' }}>
              Applies when no active phase is set. Saving merges these flags into the existing settings row.
            </p>
            <div style={{ display: 'grid', gap: '0.6rem' }}>
              <Toggle text="Show vote count" checked={!!settings.show_public_vote_count} onChange={(v) => void saveContestFlag({ show_public_vote_count: v })} />
              <Toggle text="Show leaderboard" checked={!!settings.show_public_leaderboard} onChange={(v) => void saveContestFlag({ show_public_leaderboard: v })} />
              <Toggle text="Show rank" checked={!!settings.show_public_rank} onChange={(v) => void saveContestFlag({ show_public_rank: v })} />
            </div>
          </div>

          {/* Active phase */}
          <div style={card()}>
            <h2 style={{ fontSize: '1.05rem', fontWeight: 700, margin: '0 0 0.75rem' }}>Active phase</h2>
            <span style={label()}>Currently active phase</span>
            <select
              style={{ ...input(), minWidth: 260 }}
              value={settings.active_phase_key ?? ''}
              onChange={(e) => void setActivePhase(e.target.value === '' ? null : e.target.value)}
              disabled={saving}
            >
              <option value="">None (use contest-level)</option>
              {phases.map((p) => (
                <option key={p.phase_key} value={p.phase_key}>{p.phase_label} ({p.phase_key})</option>
              ))}
            </select>
          </div>

          {/* Phases list */}
          <div style={card()}>
            <h2 style={{ fontSize: '1.05rem', fontWeight: 700, margin: '0 0 0.75rem' }}>Phases</h2>
            {phases.length === 0 ? (
              <p style={{ color: '#6b7280', fontSize: '0.85rem', margin: 0 }}>No phases yet. Add one below.</p>
            ) : (
              <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                <thead>
                  <tr>
                    <th style={th()}>Label</th>
                    <th style={th()}>Key</th>
                    <th style={th()}>Vote count</th>
                    <th style={th()}>Leaderboard</th>
                    <th style={th()}>Rank</th>
                    <th style={th()}>Order</th>
                    <th style={th()}></th>
                  </tr>
                </thead>
                <tbody>
                  {phases.map((p) => (
                    <tr key={p.phase_key}>
                      <td style={td()}>
                        <strong>{p.phase_label}</strong>
                        {settings.active_phase_key === p.phase_key ? (
                          <span style={{ marginLeft: 6, fontSize: '0.68rem', color: '#340075', fontWeight: 700 }}>ACTIVE</span>
                        ) : null}
                      </td>
                      <td style={td()}><code>{p.phase_key}</code></td>
                      <td style={td()}>{p.show_public_vote_count ? 'Shown' : 'Hidden'}</td>
                      <td style={td()}>{p.show_public_leaderboard ? 'Shown' : 'Hidden'}</td>
                      <td style={td()}>{p.show_public_rank ? 'Shown' : 'Hidden'}</td>
                      <td style={td()}>{p.sort_order}</td>
                      <td style={{ ...td(), whiteSpace: 'nowrap' }}>
                        <button style={{ ...btn(), padding: '0.3rem 0.7rem', fontSize: '0.8rem', marginRight: 6 }} onClick={() => startEdit(p)}>Edit</button>
                        <button style={dangerBtn()} onClick={() => void deletePhase(p.phase_key)} disabled={saving}>Delete</button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}

            {/* Phase editor */}
            <div style={{ marginTop: '1.25rem', borderTop: '1px solid #e5e7eb', paddingTop: '1rem' }}>
              <h3 style={{ fontSize: '0.95rem', fontWeight: 700, margin: '0 0 0.75rem' }}>
                {editingKey ? `Edit phase: ${editingKey}` : 'Add a phase'}
              </h3>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(180px, 1fr))', gap: '0.75rem', marginBottom: '0.75rem' }}>
                <div>
                  <span style={label()}>Phase key</span>
                  <input
                    style={{ ...input(), width: '100%' }}
                    placeholder="e.g. auditions"
                    value={phaseForm.phase_key}
                    disabled={!!editingKey}
                    onChange={(e) => setPhaseForm((f) => ({ ...f, phase_key: e.target.value }))}
                  />
                </div>
                <div>
                  <span style={label()}>Phase label</span>
                  <input
                    style={{ ...input(), width: '100%' }}
                    placeholder="e.g. Auditions"
                    value={phaseForm.phase_label}
                    onChange={(e) => setPhaseForm((f) => ({ ...f, phase_label: e.target.value }))}
                  />
                </div>
                <div>
                  <span style={label()}>Sort order</span>
                  <input
                    style={{ ...input(), width: '100%' }}
                    type="number"
                    value={phaseForm.sort_order}
                    onChange={(e) => setPhaseForm((f) => ({ ...f, sort_order: Number(e.target.value) }))}
                  />
                </div>
              </div>
              <div style={{ display: 'grid', gap: '0.5rem', marginBottom: '0.75rem' }}>
                <Toggle text="Show vote count" checked={phaseForm.show_public_vote_count} onChange={(v) => setPhaseForm((f) => ({ ...f, show_public_vote_count: v }))} />
                <Toggle text="Show leaderboard" checked={phaseForm.show_public_leaderboard} onChange={(v) => setPhaseForm((f) => ({ ...f, show_public_leaderboard: v }))} />
                <Toggle text="Show rank" checked={phaseForm.show_public_rank} onChange={(v) => setPhaseForm((f) => ({ ...f, show_public_rank: v }))} />
              </div>
              <div style={{ display: 'flex', gap: '0.5rem' }}>
                <button style={btn(true)} onClick={() => void savePhase()} disabled={saving}>
                  {saving ? 'Saving…' : editingKey ? 'Update phase' : 'Add phase'}
                </button>
                {editingKey ? <button style={btn()} onClick={cancelEdit} disabled={saving}>Cancel</button> : null}
              </div>
            </div>
          </div>
        </>
      ) : null}
    </div>
  );
}
