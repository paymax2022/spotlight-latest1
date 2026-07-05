'use client';

import { useCallback, useEffect, useState } from 'react';
import { adminAuthHeaders } from '@/src/lib/auth/client';
import type {
  ShowSeason, ShowContestant, EvictionWeek, Eviction,
} from '@/src/server/services/reality-show/store';

// ── Palette ─────────────────────────────────────────────────────────────────

const c = {
  bg: 'var(--bg-page, #F4F6FB)',
  card: 'var(--bg-card, #FFFFFF)',
  border: 'var(--border, #E2E8F0)',
  primary: '#F59E0B',
  primaryDark: '#D97706',
  success: '#059669',
  successBg: '#ECFDF5',
  danger: '#DC2626',
  dangerBg: '#FEF2F2',
  warn: '#D97706',
  warnBg: '#FFFBEB',
  info: '#2563EB',
  infoBg: '#EFF6FF',
  purple: '#7C3AED',
  purpleBg: '#F5F3FF',
  text: 'var(--foreground, #111827)',
  textMid: '#374151',
  textMuted: '#6B7280',
  shadow: '0 1px 3px rgba(0,0,0,0.08)',
  shadowMd: '0 4px 16px rgba(0,0,0,0.08)',
};

// ── Types ────────────────────────────────────────────────────────────────────

type Tab = 'overview' | 'audition' | 'bootcamp' | 'evictions';

interface VoteTally {
  contestantId: string;
  voteCount: number;
  contestant: ShowContestant | null;
}

interface WeekDetail {
  week: EvictionWeek;
  votes: Array<{ id: string; voterId: string; voterName: string; voterRole: string; contestantId: string; reason: string; votedAt: string }>;
  tallies: VoteTally[];
}

// ── Helpers ──────────────────────────────────────────────────────────────────

const phaseLabel: Record<string, string> = {
  pre_audition: 'Pre-Audition',
  audition: 'Phase 1 — Audition',
  bootcamp: 'Phase 2 — Bootcamp',
  finale: 'Finale',
  completed: 'Season Complete',
};

const phaseColor: Record<string, string> = {
  pre_audition: c.textMuted,
  audition: c.info,
  bootcamp: c.primary,
  finale: c.purple,
  completed: c.success,
};

const statusLabel: Record<string, string> = {
  draft: 'Draft', active: 'Active', completed: 'Completed',
};

const weekStatusLabel: Record<string, string> = {
  upcoming: 'Upcoming', open: '🟢 Voting Open', closed: 'Voting Closed', eviction_declared: '🔴 Eviction Declared',
};

const phaseStatusBadge: Record<string, { bg: string; color: string; label: string }> = {
  audition:  { bg: c.infoBg,    color: c.info,    label: 'Audition' },
  bootcamp:  { bg: c.warnBg,    color: c.warn,    label: 'Bootcamp' },
  evicted:   { bg: c.dangerBg,  color: c.danger,  label: 'Evicted' },
  finalist:  { bg: c.purpleBg,  color: c.purple,  label: 'Finalist' },
  winner:    { bg: c.successBg, color: c.success, label: '🏆 Winner' },
};

function Badge({ type, label }: { type: string; label?: string }) {
  const cfg = phaseStatusBadge[type] ?? { bg: '#F3F4F6', color: c.textMuted, label: type };
  return (
    <span style={{ display: 'inline-block', padding: '3px 10px', borderRadius: 20, fontSize: 11, fontWeight: 700, background: cfg.bg, color: cfg.color }}>
      {label ?? cfg.label}
    </span>
  );
}

function btn(variant: 'primary' | 'danger' | 'ghost' | 'success' | 'purple' = 'ghost'): React.CSSProperties {
  const map = {
    primary: { background: `linear-gradient(135deg,${c.primary},${c.primaryDark})`, color: '#000', border: 'none' },
    danger:  { background: c.dangerBg, color: c.danger, border: `1px solid ${c.danger}` },
    success: { background: c.successBg, color: c.success, border: `1px solid ${c.success}` },
    purple:  { background: c.purpleBg, color: c.purple, border: `1px solid ${c.purple}` },
    ghost:   { background: 'transparent', color: c.textMid, border: `1px solid ${c.border}` },
  };
  return { ...map[variant], padding: '7px 16px', borderRadius: 8, fontSize: 13, fontWeight: 700, cursor: 'pointer', transition: 'opacity 0.15s' };
}

function inp(): React.CSSProperties {
  return { width: '100%', padding: '9px 12px', borderRadius: 8, border: '1.5px solid #94A3B8', fontSize: 13, background: '#FFFFFF', color: '#111827', WebkitTextFillColor: '#111827', boxSizing: 'border-box', outline: 'none', fontFamily: 'inherit' };
}

function Card({ children, style }: { children: React.ReactNode; style?: React.CSSProperties }) {
  return <div style={{ background: c.card, border: `1px solid ${c.border}`, borderRadius: 12, padding: '20px 22px', boxShadow: c.shadow, ...style }}>{children}</div>;
}

function SectionTitle({ children }: { children: React.ReactNode }) {
  return <p style={{ fontSize: 11, fontWeight: 800, textTransform: 'uppercase', letterSpacing: '0.1em', color: c.textMuted, marginBottom: 14 }}>{children}</p>;
}

// ── Component ────────────────────────────────────────────────────────────────

export default function StagesEvictionsPage() {
  const [seasons, setSeasons] = useState<ShowSeason[]>([]);
  const [activeSeason, setActiveSeason] = useState<ShowSeason | null>(null);
  const [contestants, setContestants] = useState<ShowContestant[]>([]);
  const [weeks, setWeeks] = useState<EvictionWeek[]>([]);
  const [evictions, setEvictions] = useState<Eviction[]>([]);
  const [activeWeek, setActiveWeek] = useState<WeekDetail | null>(null);
  const [tab, setTab] = useState<Tab>('overview');
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState(false);
  const [toast, setToast] = useState('');

  // Forms
  const [newSeason, setNewSeason] = useState({ seasonName: 'Season 1', seasonNumber: 1, auditionStartDate: '', auditionEndDate: '', bootcampStartDate: '', bootcampEndDate: '' });
  const [newContestant, setNewContestant] = useState({ displayName: '', stageName: '', primaryTalent: '', applicationId: '' });
  const [newWeek, setNewWeek] = useState({ weekNumber: 1, title: '', theme: '', evictionCount: 1 });
  const [evictNote, setEvictNote] = useState('');
  const [showCreateSeason, setShowCreateSeason] = useState(false);
  const [showAddContestant, setShowAddContestant] = useState(false);
  const [showCreateWeek, setShowCreateWeek] = useState(false);

  function notify(msg: string) {
    setToast(msg);
    setTimeout(() => setToast(''), 3500);
  }

  // ── Data fetching ──────────────────────────────────────────────────────────

  const fetchSeasons = useCallback(async () => {
    setLoading(true);
    const res = await fetch('/api/admin/reality-show/seasons', { headers: await adminAuthHeaders() });
    const json = await res.json().catch(() => ({}));
    setSeasons(json.seasons ?? []);
    setLoading(false);
  }, []);

  const fetchSeason = useCallback(async (id: string) => {
    const res = await fetch(`/api/admin/reality-show/seasons/${id}`, { headers: await adminAuthHeaders() });
    const json = await res.json().catch(() => ({}));
    if (json.season) {
      setActiveSeason(json.season);
      setContestants(json.contestants ?? []);
      setWeeks(json.weeks ?? []);
      setEvictions(json.evictions ?? []);
    }
  }, []);

  const fetchWeekDetail = useCallback(async (weekId: string) => {
    const res = await fetch(`/api/admin/reality-show/weeks/${weekId}/vote`, { headers: await adminAuthHeaders() });
    const json = await res.json().catch(() => ({}));
    if (json.week) setActiveWeek(json);
  }, []);

  useEffect(() => { void fetchSeasons(); }, [fetchSeasons]);
  useEffect(() => { if (activeSeason) void fetchSeason(activeSeason.id); }, [activeSeason?.id]);

  // ── Actions ────────────────────────────────────────────────────────────────

  async function createSeason() {
    setBusy(true);
    const res = await fetch('/api/admin/reality-show/seasons', {
      method: 'POST', headers: await adminAuthHeaders(true),
      body: JSON.stringify(newSeason),
    });
    const json = await res.json().catch(() => ({}));
    if (res.ok) {
      setSeasons((s) => [json.season, ...s]);
      setActiveSeason(json.season);
      setShowCreateSeason(false);
      notify('Season created');
    } else {
      notify(json.error ?? 'Failed to create season');
    }
    setBusy(false);
  }

  async function updatePhase(phase: string) {
    if (!activeSeason) return;
    setBusy(true);
    const res = await fetch(`/api/admin/reality-show/seasons/${activeSeason.id}`, {
      method: 'PATCH', headers: await adminAuthHeaders(true),
      body: JSON.stringify({ currentPhase: phase }),
    });
    const json = await res.json().catch(() => ({}));
    if (res.ok) {
      setActiveSeason(json.season);
      setSeasons((s) => s.map((x) => (x.id === json.season.id ? json.season : x)));
      notify(`Phase updated to ${phaseLabel[phase]}`);
    }
    setBusy(false);
  }

  async function addContestantFn() {
    if (!activeSeason || !newContestant.displayName.trim()) return;
    setBusy(true);
    const res = await fetch(`/api/admin/reality-show/seasons/${activeSeason.id}/contestants`, {
      method: 'POST', headers: await adminAuthHeaders(true),
      body: JSON.stringify({ ...newContestant, applicationId: newContestant.applicationId || `manual-${Date.now()}` }),
    });
    const json = await res.json().catch(() => ({}));
    if (res.ok) {
      setContestants((c) => [...c, json.contestant]);
      setNewContestant({ displayName: '', stageName: '', primaryTalent: '', applicationId: '' });
      setShowAddContestant(false);
      notify('Contestant added');
    } else {
      notify(json.error ?? 'Failed');
    }
    setBusy(false);
  }

  async function contestantAction(id: string, action: string) {
    setBusy(true);
    const res = await fetch(`/api/admin/reality-show/contestants/${id}`, {
      method: 'PATCH', headers: await adminAuthHeaders(true),
      body: JSON.stringify({ action }),
    });
    const json = await res.json().catch(() => ({}));
    if (res.ok) {
      setContestants((cs) => cs.map((c) => (c.id === id ? json.contestant : c)));
      notify('Updated');
    }
    setBusy(false);
  }

  async function createWeekFn() {
    if (!activeSeason) return;
    setBusy(true);
    const res = await fetch(`/api/admin/reality-show/seasons/${activeSeason.id}/weeks`, {
      method: 'POST', headers: await adminAuthHeaders(true),
      body: JSON.stringify({ ...newWeek, title: newWeek.title || undefined }),
    });
    const json = await res.json().catch(() => ({}));
    if (res.ok) {
      setWeeks((w) => [...w, json.week].sort((a, b) => a.weekNumber - b.weekNumber));
      setNewWeek({ weekNumber: (newWeek.weekNumber + 1), title: '', theme: '', evictionCount: 1 });
      setShowCreateWeek(false);
      notify('Eviction week created');
    } else {
      notify(json.error ?? 'Failed');
    }
    setBusy(false);
  }

  async function setWeekStatus(weekId: string, status: string) {
    setBusy(true);
    const res = await fetch(`/api/admin/reality-show/weeks/${weekId}/status`, {
      method: 'PATCH', headers: await adminAuthHeaders(true),
      body: JSON.stringify({ status }),
    });
    const json = await res.json().catch(() => ({}));
    if (res.ok) {
      setWeeks((ws) => ws.map((w) => (w.id === weekId ? json.week : w)));
      if (activeWeek?.week.id === weekId) setActiveWeek((d) => d ? { ...d, week: json.week } : d);
      notify(`Voting ${status === 'open' ? 'opened' : 'closed'}`);
    }
    setBusy(false);
  }

  async function castVote(weekId: string, contestantId: string) {
    setBusy(true);
    const res = await fetch(`/api/admin/reality-show/weeks/${weekId}/vote`, {
      method: 'POST', headers: await adminAuthHeaders(true),
      body: JSON.stringify({ contestantId }),
    });
    const json = await res.json().catch(() => ({}));
    if (res.ok) {
      notify('Vote cast');
      await fetchWeekDetail(weekId);
    } else {
      notify(json.error ?? 'Failed');
    }
    setBusy(false);
  }

  async function retractVote(weekId: string, contestantId: string) {
    setBusy(true);
    const res = await fetch(`/api/admin/reality-show/weeks/${weekId}/vote`, {
      method: 'POST', headers: await adminAuthHeaders(true),
      body: JSON.stringify({ contestantId, retract: true }),
    });
    if (res.ok) {
      notify('Vote retracted');
      await fetchWeekDetail(weekId);
    }
    setBusy(false);
  }

  async function finalizeEviction(weekId: string) {
    if (!confirm('Finalize eviction? This will mark the most-voted contestant(s) as evicted. This cannot be undone.')) return;
    setBusy(true);
    const res = await fetch(`/api/admin/reality-show/weeks/${weekId}/evict`, {
      method: 'POST', headers: await adminAuthHeaders(true),
      body: JSON.stringify({ note: evictNote }),
    });
    const json = await res.json().catch(() => ({}));
    if (res.ok) {
      notify(`${json.evictedContestants?.length ?? 0} contestant(s) evicted`);
      if (activeSeason) await fetchSeason(activeSeason.id);
      setActiveWeek(null);
      setEvictNote('');
    } else {
      notify(json.error ?? 'Failed');
    }
    setBusy(false);
  }

  // ── Derived ────────────────────────────────────────────────────────────────

  const auditionContestants = contestants.filter((c) => c.phaseStatus === 'audition');
  const bootcampContestants = contestants.filter((c) => c.phaseStatus === 'bootcamp');
  const evictedContestants  = contestants.filter((c) => c.phaseStatus === 'evicted');
  const finalists           = contestants.filter((c) => c.phaseStatus === 'finalist' || c.phaseStatus === 'winner');

  // ── Render ─────────────────────────────────────────────────────────────────

  const tabStyle = (t: Tab): React.CSSProperties => ({
    padding: '8px 18px', borderRadius: 8, border: 'none', cursor: 'pointer', fontWeight: 700, fontSize: 13,
    background: tab === t ? c.primary : 'transparent',
    color: tab === t ? '#000' : c.textMuted,
    transition: 'all 0.15s',
  });

  return (
    <div style={{ padding: '28px 32px', maxWidth: 1200, margin: '0 auto' }}>
      {/* Toast */}
      {toast && (
        <div style={{ position: 'fixed', bottom: 24, right: 24, background: '#1F2937', color: '#fff', padding: '12px 20px', borderRadius: 10, fontSize: 14, fontWeight: 600, zIndex: 9999, boxShadow: '0 8px 24px rgba(0,0,0,0.3)' }}>
          {toast}
        </div>
      )}

      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 16, marginBottom: 24, flexWrap: 'wrap' }}>
        <div>
          <h1 style={{ fontSize: 22, fontWeight: 900, color: c.text, margin: 0 }}>🎬 Reality TV Show — Stages & Evictions</h1>
          <p style={{ color: c.textMuted, fontSize: 13.5, marginTop: 4 }}>Manage audition phase, bootcamp contestants, and weekly evictions</p>
        </div>
        <button style={btn('primary')} onClick={() => setShowCreateSeason(true)}>+ New Season</button>
      </div>

      {/* Season selector */}
      {seasons.length > 0 && (
        <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', marginBottom: 24 }}>
          {seasons.map((s) => (
            <button key={s.id} onClick={() => { setActiveSeason(s); setTab('overview'); }}
              style={{ padding: '8px 18px', borderRadius: 20, border: `2px solid ${activeSeason?.id === s.id ? c.primary : c.border}`, background: activeSeason?.id === s.id ? 'rgba(245,158,11,0.08)' : c.card, fontWeight: 700, fontSize: 13, cursor: 'pointer', color: activeSeason?.id === s.id ? c.text : c.textMuted }}>
              {s.seasonName}
              <span style={{ marginLeft: 6, fontSize: 10, fontWeight: 600, opacity: 0.7 }}>{statusLabel[s.status]}</span>
            </button>
          ))}
        </div>
      )}

      {/* Create season modal */}
      {showCreateSeason && (
        <Card style={{ marginBottom: 20, border: `2px solid ${c.primary}` }}>
          <SectionTitle>Create New Season</SectionTitle>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: 12, marginBottom: 14 }}>
            {[
              { label: 'Season Name', key: 'seasonName', type: 'text' },
              { label: 'Season Number', key: 'seasonNumber', type: 'number' },
              { label: 'Audition Start', key: 'auditionStartDate', type: 'date' },
              { label: 'Audition End', key: 'auditionEndDate', type: 'date' },
              { label: 'Bootcamp Start', key: 'bootcampStartDate', type: 'date' },
              { label: 'Bootcamp End', key: 'bootcampEndDate', type: 'date' },
            ].map(({ label, key, type }) => (
              <div key={key}>
                <label style={{ fontSize: 11, fontWeight: 700, color: c.textMid, display: 'block', marginBottom: 4 }}>{label}</label>
                <input style={inp()} type={type}
                  value={String(newSeason[key as keyof typeof newSeason])}
                  onChange={(e) => setNewSeason((s) => ({ ...s, [key]: type === 'number' ? Number(e.target.value) : e.target.value }))} />
              </div>
            ))}
          </div>
          <div style={{ display: 'flex', gap: 10 }}>
            <button style={btn('primary')} onClick={createSeason} disabled={busy}>Create Season</button>
            <button style={btn()} onClick={() => setShowCreateSeason(false)}>Cancel</button>
          </div>
        </Card>
      )}

      {/* No season selected */}
      {!activeSeason && !loading && (
        <Card style={{ textAlign: 'center', padding: '40px 24px' }}>
          <div style={{ fontSize: 48, marginBottom: 12 }}>🎬</div>
          <h3 style={{ color: c.text, fontWeight: 800, marginBottom: 8 }}>No Season Selected</h3>
          <p style={{ color: c.textMuted, fontSize: 14 }}>Create a new season or select one above to get started.</p>
        </Card>
      )}

      {/* Main season workspace */}
      {activeSeason && (
        <>
          {/* Phase banner */}
          <Card style={{ marginBottom: 20, background: 'linear-gradient(135deg,#1F2937 0%,#111827 100%)', border: 'none' }}>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 24, alignItems: 'center', justifyContent: 'space-between' }}>
              <div>
                <p style={{ color: 'rgba(255,255,255,0.5)', fontSize: 11, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.1em', margin: '0 0 6px' }}>Current Phase</p>
                <h2 style={{ color: '#fff', fontWeight: 900, fontSize: 20, margin: 0 }}>
                  <span style={{ color: phaseColor[activeSeason.currentPhase] }}>{phaseLabel[activeSeason.currentPhase]}</span>
                </h2>
              </div>
              <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
                {['pre_audition','audition','bootcamp','finale','completed'].map((phase) => (
                  <button key={phase} disabled={busy || activeSeason.currentPhase === phase}
                    onClick={() => updatePhase(phase)}
                    style={{ padding: '7px 14px', borderRadius: 8, border: `1.5px solid ${activeSeason.currentPhase === phase ? phaseColor[phase] : 'rgba(255,255,255,0.15)'}`, background: activeSeason.currentPhase === phase ? 'rgba(255,255,255,0.1)' : 'transparent', color: activeSeason.currentPhase === phase ? phaseColor[phase] : 'rgba(255,255,255,0.55)', fontWeight: 700, fontSize: 12, cursor: activeSeason.currentPhase === phase ? 'default' : 'pointer' }}>
                    {phaseLabel[phase]}
                  </button>
                ))}
              </div>
              <div style={{ display: 'flex', gap: 20 }}>
                {[
                  { label: 'Audition', count: auditionContestants.length, color: c.info },
                  { label: 'Bootcamp', count: bootcampContestants.length, color: c.primary },
                  { label: 'Evicted', count: evictedContestants.length, color: c.danger },
                ].map(({ label, count, color }) => (
                  <div key={label} style={{ textAlign: 'center' }}>
                    <p style={{ color: '#fff', fontSize: 22, fontWeight: 900, margin: 0 }}>{count}</p>
                    <p style={{ color: 'rgba(255,255,255,0.45)', fontSize: 11, margin: 0, fontWeight: 600 }}>{label}</p>
                  </div>
                ))}
              </div>
            </div>
          </Card>

          {/* Tabs */}
          <div style={{ display: 'flex', gap: 4, background: 'rgba(0,0,0,0.04)', borderRadius: 10, padding: 4, marginBottom: 20, width: 'fit-content' }}>
            {(['overview','audition','bootcamp','evictions'] as Tab[]).map((t) => (
              <button key={t} style={tabStyle(t)} onClick={() => setTab(t)}>
                {t === 'overview' ? '📊 Overview' : t === 'audition' ? `👤 Audition (${auditionContestants.length})` : t === 'bootcamp' ? `🏠 Bootcamp (${bootcampContestants.length})` : `🗳 Evictions (${weeks.length})`}
              </button>
            ))}
          </div>

          {/* ── TAB: Overview ────────────────────────────────────────────── */}
          {tab === 'overview' && (
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(260px, 1fr))', gap: 16 }}>
              {[
                { label: 'Total Applicants', value: auditionContestants.length + bootcampContestants.length + evictedContestants.length + finalists.length, icon: '👥', color: c.info },
                { label: 'In Audition Phase', value: auditionContestants.length, icon: '🎤', color: c.info },
                { label: 'In Bootcamp', value: bootcampContestants.length, icon: '🏠', color: c.primary },
                { label: 'Total Evicted', value: evictedContestants.length, icon: '🚪', color: c.danger },
                { label: 'Eviction Rounds', value: weeks.filter((w) => w.evictionFinalized).length, icon: '🗳', color: c.warn },
                { label: 'Remaining in House', value: bootcampContestants.length, icon: '🏆', color: c.success },
              ].map(({ label, value, icon, color }) => (
                <Card key={label}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                    <div style={{ width: 44, height: 44, borderRadius: 12, background: `${color}18`, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 20 }}>{icon}</div>
                    <div>
                      <p style={{ fontSize: 24, fontWeight: 900, color: c.text, margin: 0 }}>{value}</p>
                      <p style={{ fontSize: 12, color: c.textMuted, margin: 0 }}>{label}</p>
                    </div>
                  </div>
                </Card>
              ))}

              {/* Eviction history */}
              {evictions.length > 0 && (
                <Card style={{ gridColumn: '1 / -1' }}>
                  <SectionTitle>Eviction History</SectionTitle>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                    {evictions.map((ev) => {
                      const cont = contestants.find((c) => c.id === ev.contestantId);
                      const wk = weeks.find((w) => w.id === ev.weekId);
                      return (
                        <div key={ev.id} style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '10px 14px', borderRadius: 8, background: c.dangerBg, border: `1px solid ${c.danger}20` }}>
                          <span style={{ fontSize: 18 }}>🚪</span>
                          <div style={{ flex: 1 }}>
                            <span style={{ fontWeight: 800, color: c.text, fontSize: 14 }}>{cont?.displayName ?? ev.contestantId}</span>
                            {cont?.stageName && <span style={{ color: c.textMuted, fontSize: 12, marginLeft: 6 }}>({cont.stageName})</span>}
                          </div>
                          <span style={{ fontSize: 12, color: c.textMuted }}>{wk?.title ?? `Week ${wk?.weekNumber}`} · {ev.voteCount} vote{ev.voteCount !== 1 ? 's' : ''}</span>
                          <span style={{ fontSize: 12, color: c.danger, fontWeight: 700 }}>{new Date(ev.evictedAt).toLocaleDateString()}</span>
                        </div>
                      );
                    })}
                  </div>
                </Card>
              )}
            </div>
          )}

          {/* ── TAB: Audition ────────────────────────────────────────────── */}
          {tab === 'audition' && (
            <div>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 14 }}>
                <h3 style={{ fontWeight: 800, fontSize: 16, color: c.text, margin: 0 }}>Phase 1 — Audition Contestants</h3>
                <button style={btn('primary')} onClick={() => setShowAddContestant(true)}>+ Add Contestant</button>
              </div>

              {showAddContestant && (
                <Card style={{ marginBottom: 16, border: `2px solid ${c.primary}` }}>
                  <SectionTitle>Add Contestant to Audition</SectionTitle>
                  <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: 12, marginBottom: 14 }}>
                    {[
                      { label: 'Full Name *', key: 'displayName', placeholder: 'e.g. Chisom Obi' },
                      { label: 'Stage Name', key: 'stageName', placeholder: 'e.g. Chi-Chi' },
                      { label: 'Primary Talent', key: 'primaryTalent', placeholder: 'e.g. Singing' },
                      { label: 'Application ID (optional)', key: 'applicationId', placeholder: 'Leave blank for manual entry' },
                    ].map(({ label, key, placeholder }) => (
                      <div key={key}>
                        <label style={{ fontSize: 11, fontWeight: 700, color: c.textMid, display: 'block', marginBottom: 4 }}>{label}</label>
                        <input style={inp()} placeholder={placeholder}
                          value={newContestant[key as keyof typeof newContestant]}
                          onChange={(e) => setNewContestant((nc) => ({ ...nc, [key]: e.target.value }))} />
                      </div>
                    ))}
                  </div>
                  <div style={{ display: 'flex', gap: 10 }}>
                    <button style={btn('primary')} onClick={addContestantFn} disabled={busy || !newContestant.displayName.trim()}>Add Contestant</button>
                    <button style={btn()} onClick={() => setShowAddContestant(false)}>Cancel</button>
                  </div>
                </Card>
              )}

              {auditionContestants.length === 0 ? (
                <Card style={{ textAlign: 'center', padding: 32 }}>
                  <p style={{ color: c.textMuted }}>No contestants in the audition phase yet. Add contestants to get started.</p>
                </Card>
              ) : (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                  {auditionContestants.map((c) => (
                    <Card key={c.id} style={{ display: 'flex', alignItems: 'center', gap: 14, flexWrap: 'wrap' }}>
                      <div style={{ width: 40, height: 40, borderRadius: '50%', background: 'linear-gradient(135deg,#6366F1,#8B5CF6)', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#fff', fontWeight: 800, fontSize: 15, flexShrink: 0 }}>
                        {c.displayName.charAt(0).toUpperCase()}
                      </div>
                      <div style={{ flex: 1, minWidth: 140 }}>
                        <p style={{ fontWeight: 800, fontSize: 14, margin: 0, color: '#111827' }}>{c.displayName}</p>
                        <p style={{ fontSize: 12, color: '#6B7280', margin: 0 }}>{c.stageName ? `"${c.stageName}"` : ''} {c.primaryTalent ? `· ${c.primaryTalent}` : ''}</p>
                      </div>
                      <Badge type={c.auditionResult === 'passed' ? 'bootcamp' : 'audition'} label={c.auditionResult === 'pending' ? 'Pending' : c.auditionResult === 'passed' ? 'Passed ✓' : 'Did Not Pass'} />
                      <div style={{ display: 'flex', gap: 8 }}>
                        <button style={btn('success')} disabled={busy || c.auditionResult === 'passed'} onClick={() => contestantAction(c.id, 'promote_to_bootcamp')}>
                          ✓ Pass to Bootcamp
                        </button>
                        <button style={btn('danger')} disabled={busy || c.auditionResult === 'failed'} onClick={() => contestantAction(c.id, 'fail_audition')}>
                          ✗ Not Selected
                        </button>
                      </div>
                    </Card>
                  ))}
                </div>
              )}
            </div>
          )}

          {/* ── TAB: Bootcamp ────────────────────────────────────────────── */}
          {tab === 'bootcamp' && (
            <div>
              <h3 style={{ fontWeight: 800, fontSize: 16, color: c.text, marginBottom: 14 }}>Phase 2 — Bootcamp Housemates</h3>
              {bootcampContestants.length === 0 ? (
                <Card style={{ textAlign: 'center', padding: 32 }}>
                  <p style={{ color: c.textMuted }}>No contestants have been promoted to bootcamp yet. Go to the Audition tab to advance contestants.</p>
                </Card>
              ) : (
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(240px, 1fr))', gap: 14 }}>
                  {bootcampContestants.map((ct) => (
                    <Card key={ct.id} style={{ position: 'relative' }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 12 }}>
                        <div style={{ width: 48, height: 48, borderRadius: '50%', background: 'linear-gradient(135deg,#F59E0B,#D97706)', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#000', fontWeight: 900, fontSize: 18, flexShrink: 0 }}>
                          {ct.displayName.charAt(0).toUpperCase()}
                        </div>
                        <div>
                          <p style={{ fontWeight: 800, fontSize: 14, margin: 0, color: '#111827' }}>{ct.displayName}</p>
                          {ct.stageName && <p style={{ fontSize: 12, color: '#6B7280', margin: 0 }}>&ldquo;{ct.stageName}&rdquo;</p>}
                        </div>
                      </div>
                      <p style={{ fontSize: 12, color: '#6B7280', marginBottom: 12 }}>
                        {ct.primaryTalent && <><strong>Talent:</strong> {ct.primaryTalent} · </>}
                        <strong>In house since:</strong> {ct.enteredBootcampAt ? new Date(ct.enteredBootcampAt).toLocaleDateString() : '—'}
                      </p>
                      <Badge type="bootcamp" />
                      <div style={{ display: 'flex', gap: 8, marginTop: 12 }}>
                        <button style={{ ...btn('purple'), fontSize: 11 }} disabled={busy} onClick={() => contestantAction(ct.id, 'declare_finalist')}>🏅 Finalist</button>
                        <button style={{ ...btn('success'), fontSize: 11 }} disabled={busy} onClick={() => contestantAction(ct.id, 'declare_winner')}>🏆 Winner</button>
                      </div>
                    </Card>
                  ))}
                </div>
              )}

              {/* Finalists & winner */}
              {finalists.length > 0 && (
                <div style={{ marginTop: 24 }}>
                  <SectionTitle>Finalists & Winner</SectionTitle>
                  <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
                    {finalists.map((ct) => (
                      <Card key={ct.id} style={{ minWidth: 180, textAlign: 'center', border: `2px solid ${ct.phaseStatus === 'winner' ? '#F59E0B' : '#7C3AED'}` }}>
                        <div style={{ fontSize: 28 }}>{ct.phaseStatus === 'winner' ? '🏆' : '🏅'}</div>
                        <p style={{ fontWeight: 800, fontSize: 14, margin: '8px 0 4px' }}>{ct.displayName}</p>
                        <Badge type={ct.phaseStatus} />
                      </Card>
                    ))}
                  </div>
                </div>
              )}
            </div>
          )}

          {/* ── TAB: Evictions ───────────────────────────────────────────── */}
          {tab === 'evictions' && (
            <div>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 14 }}>
                <h3 style={{ fontWeight: 800, fontSize: 16, color: c.text, margin: 0 }}>Weekly Eviction Rounds</h3>
                <button style={btn('primary')} onClick={() => setShowCreateWeek(true)}>+ Create Eviction Week</button>
              </div>

              {showCreateWeek && (
                <Card style={{ marginBottom: 16, border: `2px solid ${c.primary}` }}>
                  <SectionTitle>New Eviction Week</SectionTitle>
                  <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: 12, marginBottom: 14 }}>
                    <div>
                      <label style={{ fontSize: 11, fontWeight: 700, color: c.textMid, display: 'block', marginBottom: 4 }}>Week Number *</label>
                      <input style={inp()} type="number" min={1} value={newWeek.weekNumber} onChange={(e) => setNewWeek((w) => ({ ...w, weekNumber: Number(e.target.value) }))} />
                    </div>
                    <div>
                      <label style={{ fontSize: 11, fontWeight: 700, color: c.textMid, display: 'block', marginBottom: 4 }}>Title (optional)</label>
                      <input style={inp()} placeholder={`Week ${newWeek.weekNumber} Eviction Night`} value={newWeek.title} onChange={(e) => setNewWeek((w) => ({ ...w, title: e.target.value }))} />
                    </div>
                    <div>
                      <label style={{ fontSize: 11, fontWeight: 700, color: c.textMid, display: 'block', marginBottom: 4 }}>Theme (optional)</label>
                      <input style={inp()} placeholder="e.g. Talent Showdown" value={newWeek.theme} onChange={(e) => setNewWeek((w) => ({ ...w, theme: e.target.value }))} />
                    </div>
                    <div>
                      <label style={{ fontSize: 11, fontWeight: 700, color: c.textMid, display: 'block', marginBottom: 4 }}>Evictions This Week</label>
                      <input style={inp()} type="number" min={1} max={bootcampContestants.length || 10} value={newWeek.evictionCount} onChange={(e) => setNewWeek((w) => ({ ...w, evictionCount: Number(e.target.value) }))} />
                    </div>
                  </div>
                  <div style={{ display: 'flex', gap: 10 }}>
                    <button style={btn('primary')} onClick={createWeekFn} disabled={busy}>Create Week</button>
                    <button style={btn()} onClick={() => setShowCreateWeek(false)}>Cancel</button>
                  </div>
                </Card>
              )}

              {weeks.length === 0 ? (
                <Card style={{ textAlign: 'center', padding: 32 }}>
                  <p style={{ color: c.textMuted }}>No eviction weeks created yet. Create a week to start the eviction process.</p>
                </Card>
              ) : (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
                  {weeks.map((wk) => {
                    const isActive = activeWeek?.week.id === wk.id;
                    const weekEvictions = evictions.filter((e) => e.weekId === wk.id);

                    return (
                      <Card key={wk.id} style={{ border: `2px solid ${isActive ? c.primary : wk.evictionFinalized ? c.success + '40' : c.border}` }}>
                        {/* Week header */}
                        <div style={{ display: 'flex', alignItems: 'center', gap: 14, flexWrap: 'wrap' }}>
                          <div style={{ width: 44, height: 44, borderRadius: 12, background: wk.evictionFinalized ? c.successBg : c.warnBg, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 20, flexShrink: 0 }}>
                            {wk.evictionFinalized ? '✅' : '🗳'}
                          </div>
                          <div style={{ flex: 1 }}>
                            <p style={{ fontWeight: 900, fontSize: 15, margin: 0, color: c.text }}>{wk.title}</p>
                            {wk.theme && <p style={{ fontSize: 12, color: c.textMuted, margin: 0 }}>Theme: {wk.theme}</p>}
                          </div>
                          <span style={{ fontSize: 12, padding: '4px 12px', borderRadius: 20, fontWeight: 700, background: wk.status === 'open' ? c.successBg : wk.status === 'eviction_declared' ? c.dangerBg : '#F3F4F6', color: wk.status === 'open' ? c.success : wk.status === 'eviction_declared' ? c.danger : c.textMuted }}>
                            {weekStatusLabel[wk.status]}
                          </span>
                          <span style={{ fontSize: 12, color: c.textMuted }}>{wk.evictionCount} eviction{wk.evictionCount !== 1 ? 's' : ''} this week</span>

                          {/* Week controls */}
                          <div style={{ display: 'flex', gap: 8 }}>
                            {!wk.evictionFinalized && wk.status === 'upcoming' && (
                              <button style={btn('success')} disabled={busy} onClick={() => setWeekStatus(wk.id, 'open')}>Open Voting</button>
                            )}
                            {!wk.evictionFinalized && wk.status === 'open' && (
                              <button style={btn('danger')} disabled={busy} onClick={() => setWeekStatus(wk.id, 'closed')}>Close Voting</button>
                            )}
                            <button style={btn(isActive ? 'primary' : 'ghost')} onClick={async () => {
                              if (isActive) { setActiveWeek(null); } else {
                                await fetchWeekDetail(wk.id);
                                setTab('evictions');
                              }
                            }}>
                              {isActive ? 'Hide Panel' : 'Manage Votes'}
                            </button>
                          </div>
                        </div>

                        {/* Evicted list */}
                        {weekEvictions.length > 0 && (
                          <div style={{ marginTop: 12, paddingTop: 12, borderTop: `1px solid ${c.border}` }}>
                            <p style={{ fontSize: 11, fontWeight: 700, color: c.danger, textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: 8 }}>Evicted This Week</p>
                            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                              {weekEvictions.map((ev) => {
                                const cont = contestants.find((x) => x.id === ev.contestantId);
                                return (
                                  <span key={ev.id} style={{ padding: '5px 14px', borderRadius: 20, background: c.dangerBg, color: c.danger, fontSize: 13, fontWeight: 700 }}>
                                    🚪 {cont?.displayName ?? '?'} ({ev.voteCount} vote{ev.voteCount !== 1 ? 's' : ''})
                                  </span>
                                );
                              })}
                            </div>
                          </div>
                        )}

                        {/* Voting panel */}
                        {isActive && activeWeek && (
                          <div style={{ marginTop: 16, paddingTop: 16, borderTop: `1px solid ${c.border}` }}>
                            <SectionTitle>Vote Tally — {activeWeek.week.title}</SectionTitle>

                            {/* Tally table */}
                            {activeWeek.tallies.length > 0 ? (
                              <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginBottom: 16 }}>
                                {activeWeek.tallies.map((tally, idx) => {
                                  const cont = tally.contestant ?? contestants.find((x) => x.id === tally.contestantId);
                                  const maxVotes = activeWeek.tallies[0]?.voteCount ?? 1;
                                  const pct = Math.round((tally.voteCount / maxVotes) * 100);
                                  const isTopN = idx < wk.evictionCount;
                                  return (
                                    <div key={tally.contestantId} style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '10px 14px', borderRadius: 10, background: isTopN ? c.dangerBg : '#F9FAFB', border: `1px solid ${isTopN ? c.danger + '30' : c.border}` }}>
                                      <span style={{ fontSize: 14, fontWeight: 900, color: isTopN ? c.danger : c.textMuted, width: 24, textAlign: 'center' }}>{idx + 1}</span>
                                      <div style={{ flex: 1 }}>
                                        <p style={{ margin: 0, fontWeight: 700, fontSize: 14, color: c.text }}>{cont?.displayName ?? tally.contestantId}</p>
                                        {cont?.primaryTalent && <p style={{ margin: 0, fontSize: 11, color: c.textMuted }}>{cont.primaryTalent}</p>}
                                        <div style={{ marginTop: 4, height: 4, borderRadius: 4, background: c.border, overflow: 'hidden' }}>
                                          <div style={{ height: '100%', width: `${pct}%`, background: isTopN ? c.danger : c.primary, transition: 'width 0.3s' }} />
                                        </div>
                                      </div>
                                      <span style={{ fontWeight: 900, fontSize: 16, color: isTopN ? c.danger : c.text }}>{tally.voteCount}</span>
                                      <span style={{ fontSize: 11, color: c.textMuted }}>vote{tally.voteCount !== 1 ? 's' : ''}</span>
                                      {isTopN && <span style={{ fontSize: 10, fontWeight: 800, color: c.danger, background: c.dangerBg, padding: '2px 8px', borderRadius: 20, border: `1px solid ${c.danger}30` }}>NOMINATED</span>}
                                    </div>
                                  );
                                })}
                              </div>
                            ) : (
                              <p style={{ color: c.textMuted, fontSize: 13, marginBottom: 16 }}>No votes cast yet.</p>
                            )}

                            {/* Cast vote */}
                            {!wk.evictionFinalized && wk.status === 'open' && (
                              <div style={{ marginBottom: 16 }}>
                                <SectionTitle>Cast Your Eviction Vote</SectionTitle>
                                <p style={{ fontSize: 12, color: c.textMuted, marginBottom: 10 }}>Select the contestant(s) you are nominating for eviction. You can vote for multiple contestants.</p>
                                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
                                  {bootcampContestants.map((ct) => {
                                    const myVote = activeWeek.votes.find((v) => v.contestantId === ct.id);
                                    return (
                                      <button key={ct.id} disabled={busy}
                                        onClick={() => myVote ? retractVote(wk.id, ct.id) : castVote(wk.id, ct.id)}
                                        style={{ padding: '8px 16px', borderRadius: 20, border: `1.5px solid ${myVote ? c.danger : c.border}`, background: myVote ? c.dangerBg : c.card, color: myVote ? c.danger : c.textMid, fontWeight: 700, cursor: 'pointer', fontSize: 13 }}>
                                        {myVote ? '✓ ' : ''}{ct.displayName}{myVote ? ' (tap to retract)' : ''}
                                      </button>
                                    );
                                  })}
                                </div>
                              </div>
                            )}

                            {/* Finalize eviction */}
                            {!wk.evictionFinalized && wk.status === 'closed' && activeWeek.tallies.length > 0 && (
                              <div style={{ padding: '16px', background: c.dangerBg, borderRadius: 10, border: `1.5px solid ${c.danger}30` }}>
                                <p style={{ fontWeight: 800, fontSize: 14, color: c.danger, marginBottom: 8 }}>
                                  🚪 Ready to Declare Eviction — Top {wk.evictionCount} will be evicted
                                </p>
                                <div style={{ marginBottom: 10 }}>
                                  {activeWeek.tallies.slice(0, wk.evictionCount).map((t) => {
                                    const cont = contestants.find((x) => x.id === t.contestantId);
                                    return <p key={t.contestantId} style={{ margin: '4px 0', fontSize: 13, color: c.text }}>• <strong>{cont?.displayName}</strong> ({t.voteCount} votes)</p>;
                                  })}
                                </div>
                                <div style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap' }}>
                                  <input style={{ ...inp(), maxWidth: 280, flex: 1 }} placeholder="Optional eviction note…" value={evictNote} onChange={(e) => setEvictNote(e.target.value)} />
                                  <button style={{ ...btn('danger'), padding: '10px 20px' }} disabled={busy} onClick={() => finalizeEviction(wk.id)}>
                                    🚪 Declare Eviction
                                  </button>
                                </div>
                              </div>
                            )}

                            {/* All votes log */}
                            {activeWeek.votes.length > 0 && (
                              <div style={{ marginTop: 16 }}>
                                <SectionTitle>Voting Log ({activeWeek.votes.length} votes)</SectionTitle>
                                <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                                  {activeWeek.votes.map((v) => {
                                    const cont = contestants.find((x) => x.id === v.contestantId);
                                    return (
                                      <div key={v.id} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '8px 12px', borderRadius: 8, background: '#F9FAFB', border: `1px solid ${c.border}`, fontSize: 13 }}>
                                        <span style={{ fontWeight: 700, color: c.text }}>{v.voterName}</span>
                                        <span style={{ color: c.textMuted, fontSize: 11 }}>({v.voterRole})</span>
                                        <span style={{ color: c.textMuted }}>→</span>
                                        <span style={{ fontWeight: 700, color: c.danger }}>{cont?.displayName ?? v.contestantId}</span>
                                        {v.reason && <span style={{ color: c.textMuted, fontSize: 12 }}>· &ldquo;{v.reason}&rdquo;</span>}
                                        <span style={{ marginLeft: 'auto', fontSize: 11, color: c.textMuted }}>{new Date(v.votedAt).toLocaleTimeString()}</span>
                                      </div>
                                    );
                                  })}
                                </div>
                              </div>
                            )}
                          </div>
                        )}
                      </Card>
                    );
                  })}
                </div>
              )}
            </div>
          )}
        </>
      )}
    </div>
  );
}
