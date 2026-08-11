'use client';

// ── Admin — Voting Visibility control ────────────────────────────────────────
// Controls the universal voting engine's PUBLIC visibility: whether a contest (or
// a phase inside it) exposes the leaderboard, vote count and rank to the public.
// Backend (do NOT change) lives at /api/admin/voting/* and requires the
// `votes:manage` permission. Money is NOT involved here — these are display flags.

import { useCallback, useEffect, useMemo, useState } from 'react';
import { env } from '@/config/env';
import { hasAnyPermission, type AuthUser } from '@/features/auth/rbac';
import { Page, PageHeader, Card, Button, Input, colors, thCell, tdCell } from '@/components/ui/vuexy';

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

function fieldLabel(): React.CSSProperties {
  return { fontSize: '0.72rem', color: colors.muted, textTransform: 'uppercase', letterSpacing: 0.3, marginBottom: 4, display: 'block' };
}

function Toggle({ checked, onChange, text }: { checked: boolean; onChange: (v: boolean) => void; text: string }) {
  return (
    <label style={{ display: 'inline-flex', alignItems: 'center', gap: 8, cursor: 'pointer', fontSize: '0.85rem', color: colors.text }}>
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
      <Page>
        <PageHeader title="Voting Visibility" />
        <p style={{ color: colors.danger, marginTop: '1rem' }}>
          You do not have the <code>votes:manage</code> permission required to access this page.
        </p>
      </Page>
    );
  }

  return (
    <Page>
      <PageHeader
        title="Voting Visibility"
        subtitle="Control whether the universal voting engine exposes the leaderboard, vote count and rank — per contest or per phase."
      />

      {/* Contest selector */}
      <Card>
        <span style={fieldLabel()}>Contest ID</span>
        <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap', alignItems: 'center' }}>
          <Input
            style={{ minWidth: 320 }}
            placeholder="Enter a contest ID and click Load"
            value={contestIdInput}
            onChange={(e) => setContestIdInput(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter') handleLoad(); }}
          />
          <Button variant="primary" onClick={handleLoad} disabled={loading}>{loading ? 'Loading…' : 'Load'}</Button>
          {contestId ? <Button onClick={() => void load(contestId)} disabled={loading}>Refresh</Button> : null}
        </div>
      </Card>

      {error ? <p style={{ color: colors.danger, marginBottom: '1rem' }}>{error}</p> : null}
      {success ? <p style={{ color: colors.success, marginBottom: '1rem' }}>{success}</p> : null}

      {!contestId && !loading ? (
        <p style={{ color: colors.muted }}>Load a contest to manage its voting visibility.</p>
      ) : null}

      {loading ? <p style={{ color: colors.muted }}>Loading contest settings…</p> : null}

      {contestId && settings && !loading ? (
        <>
          {/* Effective summary */}
          {effective ? (
            <Card style={{ borderLeft: `3px solid ${colors.primary}` }}>
              <span style={fieldLabel()}>Effective public visibility</span>
              <p style={{ margin: '0 0 0.5rem', fontSize: '0.95rem', fontWeight: 600, color: colors.text }}>{effective.scope}</p>
              <p style={{ margin: 0, fontSize: '0.85rem', color: colors.text }}>
                Leaderboard <strong>{effective.board ? 'shown' : 'hidden'}</strong>
                {' · '}Vote count <strong>{effective.count ? 'shown' : 'hidden'}</strong>
                {' · '}Rank <strong>{effective.rank ? 'shown' : 'hidden'}</strong>
              </p>
            </Card>
          ) : null}

          {/* Contest-level flags */}
          <Card>
            <h2 style={{ fontSize: '1.05rem', fontWeight: 700, margin: '0 0 0.75rem' }}>Contest-level visibility</h2>
            <p style={{ color: colors.muted, fontSize: '0.8rem', margin: '0 0 0.75rem' }}>
              Applies when no active phase is set. Saving merges these flags into the existing settings row.
            </p>
            <div style={{ display: 'grid', gap: '0.6rem' }}>
              <Toggle text="Show vote count" checked={!!settings.show_public_vote_count} onChange={(v) => void saveContestFlag({ show_public_vote_count: v })} />
              <Toggle text="Show leaderboard" checked={!!settings.show_public_leaderboard} onChange={(v) => void saveContestFlag({ show_public_leaderboard: v })} />
              <Toggle text="Show rank" checked={!!settings.show_public_rank} onChange={(v) => void saveContestFlag({ show_public_rank: v })} />
            </div>
          </Card>

          {/* Active phase */}
          <Card>
            <h2 style={{ fontSize: '1.05rem', fontWeight: 700, margin: '0 0 0.75rem' }}>Active phase</h2>
            <span style={fieldLabel()}>Currently active phase</span>
            <select
              style={{ minWidth: 260 }}
              value={settings.active_phase_key ?? ''}
              onChange={(e) => void setActivePhase(e.target.value === '' ? null : e.target.value)}
              disabled={saving}
            >
              <option value="">None (use contest-level)</option>
              {phases.map((p) => (
                <option key={p.phase_key} value={p.phase_key}>{p.phase_label} ({p.phase_key})</option>
              ))}
            </select>
          </Card>

          {/* Phases list */}
          <Card>
            <h2 style={{ fontSize: '1.05rem', fontWeight: 700, margin: '0 0 0.75rem' }}>Phases</h2>
            {phases.length === 0 ? (
              <p style={{ color: colors.muted, fontSize: '0.85rem', margin: 0 }}>No phases yet. Add one below.</p>
            ) : (
              <div style={{ overflowX: 'auto' }}>
                <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                  <thead>
                    <tr>
                      <th style={thCell}>Label</th>
                      <th style={thCell}>Key</th>
                      <th style={thCell}>Vote count</th>
                      <th style={thCell}>Leaderboard</th>
                      <th style={thCell}>Rank</th>
                      <th style={thCell}>Order</th>
                      <th style={thCell}></th>
                    </tr>
                  </thead>
                  <tbody>
                    {phases.map((p) => (
                      <tr key={p.phase_key}>
                        <td style={tdCell}>
                          <strong>{p.phase_label}</strong>
                          {settings.active_phase_key === p.phase_key ? (
                            <span style={{ marginLeft: 6, fontSize: '0.68rem', color: colors.primary, fontWeight: 700 }}>ACTIVE</span>
                          ) : null}
                        </td>
                        <td style={tdCell}><code>{p.phase_key}</code></td>
                        <td style={tdCell}>{p.show_public_vote_count ? 'Shown' : 'Hidden'}</td>
                        <td style={tdCell}>{p.show_public_leaderboard ? 'Shown' : 'Hidden'}</td>
                        <td style={tdCell}>{p.show_public_rank ? 'Shown' : 'Hidden'}</td>
                        <td style={tdCell}>{p.sort_order}</td>
                        <td style={{ ...tdCell, whiteSpace: 'nowrap' }}>
                          <Button sm onClick={() => startEdit(p)} style={{ marginRight: 6 }}>Edit</Button>
                          <Button sm variant="danger" onClick={() => void deletePhase(p.phase_key)} disabled={saving}>Delete</Button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}

            {/* Phase editor */}
            <div style={{ marginTop: '1.25rem', borderTop: `1px solid ${colors.border}`, paddingTop: '1rem' }}>
              <h3 style={{ fontSize: '0.95rem', fontWeight: 700, margin: '0 0 0.75rem' }}>
                {editingKey ? `Edit phase: ${editingKey}` : 'Add a phase'}
              </h3>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(180px, 1fr))', gap: '0.75rem', marginBottom: '0.75rem' }}>
                <div>
                  <span style={fieldLabel()}>Phase key</span>
                  <Input
                    style={{ width: '100%' }}
                    placeholder="e.g. auditions"
                    value={phaseForm.phase_key}
                    disabled={!!editingKey}
                    onChange={(e) => setPhaseForm((f) => ({ ...f, phase_key: e.target.value }))}
                  />
                </div>
                <div>
                  <span style={fieldLabel()}>Phase label</span>
                  <Input
                    style={{ width: '100%' }}
                    placeholder="e.g. Auditions"
                    value={phaseForm.phase_label}
                    onChange={(e) => setPhaseForm((f) => ({ ...f, phase_label: e.target.value }))}
                  />
                </div>
                <div>
                  <span style={fieldLabel()}>Sort order</span>
                  <Input
                    style={{ width: '100%' }}
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
                <Button variant="primary" onClick={() => void savePhase()} disabled={saving}>
                  {saving ? 'Saving…' : editingKey ? 'Update phase' : 'Add phase'}
                </Button>
                {editingKey ? <Button onClick={cancelEdit} disabled={saving}>Cancel</Button> : null}
              </div>
            </div>
          </Card>
        </>
      ) : null}
    </Page>
  );
}
