'use client';

import { useCallback, useEffect, useState } from 'react';
import { adminAuthHeaders } from '@/src/lib/auth/client';
import type { RubricCriterion, JudgeScoreCard, ScoreSummary, Recommendation } from '@/src/server/services/scoring/store';

// ── Types ────────────────────────────────────────────────────────────────────

interface ScoredApplication {
  id: string;
  reference: string;
  contestSlug: string;
  status: string;
  isScored: boolean;
  fullName: string;
  email: string;
  primarySkill: string;
  state: string;
  scoreSummary: ScoreSummary | null;
  rubric: RubricCriterion[];
  formData: Record<string, unknown>;
  createdAt: string;
  updatedAt: string;
}

interface ScoreDetail {
  scorecards: JudgeScoreCard[];
  summary: ScoreSummary | null;
  rubric: RubricCriterion[];
}

// ── Palette ──────────────────────────────────────────────────────────────────

const tok = {
  bg:        'var(--bg-page, #F4F6FB)',
  card:      'var(--bg-card, #FFFFFF)',
  border:    'var(--border, #E2E8F0)',
  text:      '#111827',
  textMid:   '#374151',
  textMuted: '#6B7280',
  primary:   '#F59E0B',
  primaryDk: '#D97706',
  success:   '#059669',
  successBg: '#ECFDF5',
  danger:    '#DC2626',
  dangerBg:  '#FEF2F2',
  warn:      '#D97706',
  warnBg:    '#FFFBEB',
  info:      '#2563EB',
  infoBg:    '#EFF6FF',
  purple:    '#7C3AED',
  purpleBg:  '#F5F3FF',
  shadow:    '0 1px 3px rgba(0,0,0,0.08)',
  shadowMd:  '0 4px 16px rgba(0,0,0,0.10)',
};

// ── Helpers ───────────────────────────────────────────────────────────────────

const CONTEST_LABELS: Record<string, string> = {
  'reality-tv-show':   '🎬 Reality TV Show',
  'stem-contest':      '🔬 STEM Contest',
  'open-mic-competition': '🎤 Open Mic',
  'sme-pitch-contest': '💼 SME Pitch',
  'film-academy':      '🎥 Film Academy',
};

const STATUS_CFG: Record<string, { label: string; bg: string; color: string }> = {
  submitted:       { label: 'Submitted',     bg: tok.infoBg,    color: tok.info },
  under_review:    { label: 'Under Review',  bg: tok.warnBg,    color: tok.warn },
  shortlisted:     { label: 'Shortlisted',   bg: tok.purpleBg,  color: tok.purple },
  callback_invited:{ label: 'Callback',      bg: tok.purpleBg,  color: tok.purple },
  approved:        { label: 'Approved',      bg: tok.successBg, color: tok.success },
};

const REC_CFG: Record<Recommendation, { label: string; bg: string; color: string }> = {
  pending:   { label: 'Pending',    bg: '#F3F4F6',   color: tok.textMuted },
  shortlist: { label: 'Shortlist',  bg: tok.purpleBg, color: tok.purple },
  approve:   { label: 'Approve',    bg: tok.successBg, color: tok.success },
  reject:    { label: 'Reject',     bg: tok.dangerBg,  color: tok.danger },
};

function scoreColor(pct: number) {
  if (pct >= 80) return tok.success;
  if (pct >= 60) return tok.primary;
  if (pct >= 40) return tok.warn;
  return tok.danger;
}

function Card({ children, style }: { children: React.ReactNode; style?: React.CSSProperties }) {
  return <div style={{ background: tok.card, border: `1px solid ${tok.border}`, borderRadius: 12, boxShadow: tok.shadow, ...style }}>{children}</div>;
}

function Badge({ label, bg, color }: { label: string; bg: string; color: string }) {
  return <span style={{ display: 'inline-block', padding: '3px 10px', borderRadius: 20, fontSize: 11, fontWeight: 700, background: bg, color }}>{label}</span>;
}

function ScoreRing({ pct }: { pct: number }) {
  const color = scoreColor(pct);
  const r = 22; const circ = 2 * Math.PI * r;
  return (
    <svg width={56} height={56} viewBox="0 0 56 56" style={{ flexShrink: 0 }}>
      <circle cx={28} cy={28} r={r} fill="none" stroke={tok.border} strokeWidth={5} />
      <circle cx={28} cy={28} r={r} fill="none" stroke={color} strokeWidth={5}
        strokeDasharray={circ} strokeDashoffset={circ - (pct / 100) * circ}
        strokeLinecap="round" transform="rotate(-90 28 28)" />
      <text x={28} y={33} textAnchor="middle" fontSize={12} fontWeight={800} fill={color}>{pct}%</text>
    </svg>
  );
}

// ── Main page ─────────────────────────────────────────────────────────────────

export default function JudgesScoresPage() {
  const [apps, setApps]               = useState<ScoredApplication[]>([]);
  const [stats, setStats]             = useState({ total: 0, scored: 0, pending: 0 });
  const [loading, setLoading]         = useState(true);
  const [contestFilter, setContestFilter] = useState('');
  const [statusFilter, setStatusFilter]   = useState('');
  const [search, setSearch]           = useState('');
  const [activeId, setActiveId]       = useState<string | null>(null);
  const [detail, setDetail]           = useState<ScoreDetail | null>(null);
  const [loadingDetail, setLoadingDetail] = useState(false);
  const [saving, setSaving]           = useState(false);
  const [toast, setToast]             = useState('');

  // Draft scorecard state
  const [draftScores, setDraftScores]     = useState<Record<string, number>>({});
  const [draftRec, setDraftRec]           = useState<Recommendation>('pending');
  const [draftNotes, setDraftNotes]       = useState('');

  function notify(msg: string) {
    setToast(msg);
    setTimeout(() => setToast(''), 3000);
  }

  // ── Fetch list ─────────────────────────────────────────────────────────────

  const fetchApps = useCallback(async () => {
    setLoading(true);
    const params = new URLSearchParams();
    if (contestFilter) params.set('contestSlug', contestFilter);
    if (statusFilter)  params.set('status', statusFilter);
    if (search)        params.set('query', search);

    const res  = await fetch(`/api/admin/judges-scores?${params}`, { headers: await adminAuthHeaders() });
    const json = await res.json().catch(() => ({}));
    setApps(json.applications ?? []);
    setStats(json.stats ?? { total: 0, scored: 0, pending: 0 });
    setLoading(false);
  }, [contestFilter, statusFilter, search]);

  useEffect(() => { void fetchApps(); }, [fetchApps]);

  // ── Open scoring panel ─────────────────────────────────────────────────────

  async function openPanel(app: ScoredApplication) {
    if (activeId === app.id) { setActiveId(null); setDetail(null); return; }
    setActiveId(app.id);
    setDetail(null);
    setLoadingDetail(true);

    const res  = await fetch(`/api/admin/judges-scores/applications/${app.id}/score`, { headers: await adminAuthHeaders() });
    const json = await res.json().catch(() => ({}));
    setDetail(json);
    setLoadingDetail(false);

    // Pre-fill draft from my existing scorecard (if any)
    const mySc = json.scorecards?.[0] as JudgeScoreCard | undefined;
    if (mySc) {
      setDraftScores(mySc.scores);
      setDraftRec(mySc.recommendation);
      setDraftNotes(mySc.notes);
    } else {
      const blank: Record<string, number> = {};
      for (const c of (json.rubric as RubricCriterion[] ?? app.rubric)) blank[c.key] = 5;
      setDraftScores(blank);
      setDraftRec('pending');
      setDraftNotes('');
    }
  }

  // ── Submit score ───────────────────────────────────────────────────────────

  async function submitScore() {
    if (!activeId) return;
    setSaving(true);
    const res  = await fetch(`/api/admin/judges-scores/applications/${activeId}/score`, {
      method: 'POST',
      headers: await adminAuthHeaders(true),
      body: JSON.stringify({ scores: draftScores, recommendation: draftRec, notes: draftNotes }),
    });
    const json = await res.json().catch(() => ({}));
    if (res.ok) {
      notify('Score saved');
      setDetail((d) => d ? { ...d, scorecards: [json.scorecard, ...d.scorecards.filter((s: JudgeScoreCard) => s.judgeId !== json.scorecard.judgeId)], summary: json.summary } : d);
      setApps((prev) => prev.map((a) => a.id === activeId ? { ...a, isScored: true, scoreSummary: json.summary } : a));
    } else {
      notify(json.error ?? 'Failed to save score');
    }
    setSaving(false);
  }

  const activeApp = apps.find((a) => a.id === activeId);
  const rubric    = detail?.rubric ?? activeApp?.rubric ?? [];
  const total     = rubric.reduce((s, c) => s + (draftScores[c.key] ?? 0), 0);
  const maxTotal  = rubric.reduce((s, c) => s + c.maxScore, 0);
  const pct       = maxTotal > 0 ? Math.round((total / maxTotal) * 100) : 0;

  // ── Render ─────────────────────────────────────────────────────────────────

  const inputStyle: React.CSSProperties = {
    padding: '9px 12px', borderRadius: 8, border: `1.5px solid #94A3B8`,
    fontSize: 13, background: '#FFFFFF', color: '#111827',
    WebkitTextFillColor: '#111827', outline: 'none', boxSizing: 'border-box',
  };

  return (
    <div style={{ padding: '28px 32px', maxWidth: 1200, margin: '0 auto' }}>
      {/* Toast */}
      {toast && (
        <div style={{ position: 'fixed', bottom: 24, right: 24, background: '#1F2937', color: '#fff', padding: '12px 20px', borderRadius: 10, fontSize: 14, fontWeight: 600, zIndex: 9999, boxShadow: '0 8px 24px rgba(0,0,0,0.25)' }}>
          {toast}
        </div>
      )}

      {/* Header */}
      <div style={{ marginBottom: 24 }}>
        <h1 style={{ fontSize: 22, fontWeight: 900, color: tok.text, margin: 0 }}>⭐ Judges & Scores</h1>
        <p style={{ color: tok.textMuted, fontSize: 13.5, marginTop: 4 }}>Review applications and submit scoring rubrics across all programmes</p>
      </div>

      {/* Stat cards */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))', gap: 14, marginBottom: 24 }}>
        {[
          { label: 'Total to Score',  value: stats.total,   icon: '📋', color: tok.info },
          { label: 'Scored',          value: stats.scored,  icon: '✅', color: tok.success },
          { label: 'Awaiting Score',  value: stats.pending, icon: '⏳', color: tok.warn },
          { label: 'Completion',      value: stats.total > 0 ? `${Math.round((stats.scored / stats.total) * 100)}%` : '—', icon: '📊', color: tok.purple },
        ].map(({ label, value, icon, color }) => (
          <Card key={label} style={{ padding: '16px 18px', display: 'flex', alignItems: 'center', gap: 12 }}>
            <div style={{ width: 40, height: 40, borderRadius: 10, background: `${color}18`, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 18 }}>{icon}</div>
            <div>
              <p style={{ fontSize: 22, fontWeight: 900, color: tok.text, margin: 0 }}>{value}</p>
              <p style={{ fontSize: 11, color: tok.textMuted, margin: 0, fontWeight: 600 }}>{label}</p>
            </div>
          </Card>
        ))}
      </div>

      {/* Filters */}
      <Card style={{ padding: '14px 18px', marginBottom: 18, display: 'flex', gap: 12, flexWrap: 'wrap', alignItems: 'center' }}>
        <input
          style={{ ...inputStyle, flex: '1 1 200px', minWidth: 180 }}
          placeholder="Search name, email, reference…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
        <select style={{ ...inputStyle, minWidth: 180 }} value={contestFilter} onChange={(e) => setContestFilter(e.target.value)}>
          <option value="">All programmes</option>
          {Object.entries(CONTEST_LABELS).map(([slug, label]) => (
            <option key={slug} value={slug}>{label}</option>
          ))}
        </select>
        <select style={{ ...inputStyle, minWidth: 150 }} value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)}>
          <option value="">All statuses</option>
          {Object.entries(STATUS_CFG).map(([v, { label }]) => <option key={v} value={v}>{label}</option>)}
        </select>
        <button
          onClick={() => { setSearch(''); setContestFilter(''); setStatusFilter(''); }}
          style={{ padding: '9px 16px', borderRadius: 8, border: `1.5px solid ${tok.border}`, background: '#fff', color: tok.textMid, fontWeight: 600, cursor: 'pointer', fontSize: 13 }}>
          Clear
        </button>
      </Card>

      {/* Application list */}
      {loading ? (
        <Card style={{ padding: '40px', textAlign: 'center' }}>
          <div style={{ width: 36, height: 36, border: `3px solid ${tok.border}`, borderTopColor: tok.primary, borderRadius: '50%', animation: 'spin 0.8s linear infinite', margin: '0 auto 12px' }} />
          <style>{`@keyframes spin{to{transform:rotate(360deg)}}`}</style>
          <p style={{ color: tok.textMuted, margin: 0 }}>Loading applications…</p>
        </Card>
      ) : apps.length === 0 ? (
        <Card style={{ padding: '48px', textAlign: 'center' }}>
          <div style={{ fontSize: 48, marginBottom: 12 }}>📋</div>
          <h3 style={{ color: tok.text, fontWeight: 800, marginBottom: 8 }}>No applications to score</h3>
          <p style={{ color: tok.textMuted, fontSize: 14 }}>Submitted applications will appear here once they reach the scoring stage.</p>
        </Card>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          {apps.map((app) => {
            const isOpen    = activeId === app.id;
            const statusCfg = STATUS_CFG[app.status] ?? { label: app.status, bg: '#F3F4F6', color: tok.textMuted };
            const summ      = app.scoreSummary;

            return (
              <Card key={app.id} style={{ border: `1.5px solid ${isOpen ? tok.primary : tok.border}` }}>
                {/* Row */}
                <div style={{ padding: '16px 20px', display: 'flex', alignItems: 'center', gap: 14, flexWrap: 'wrap', cursor: 'pointer' }} onClick={() => openPanel(app)}>
                  {/* Avatar */}
                  <div style={{ width: 44, height: 44, borderRadius: '50%', background: `linear-gradient(135deg,${tok.primary},${tok.primaryDk})`, display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#000', fontWeight: 900, fontSize: 17, flexShrink: 0 }}>
                    {(app.fullName.trim() || '?').charAt(0).toUpperCase()}
                  </div>

                  {/* Info */}
                  <div style={{ flex: 1, minWidth: 140 }}>
                    <p style={{ margin: 0, fontWeight: 800, fontSize: 14.5, color: tok.text }}>{app.fullName.trim() || '—'}</p>
                    <p style={{ margin: 0, fontSize: 12, color: tok.textMuted }}>{app.email} {app.state ? `· ${app.state}` : ''}</p>
                  </div>

                  {/* Contest */}
                  <span style={{ fontSize: 12, color: tok.textMid, fontWeight: 600, minWidth: 120 }}>{CONTEST_LABELS[app.contestSlug] ?? app.contestSlug}</span>

                  {/* Skill */}
                  {app.primarySkill && (
                    <span style={{ fontSize: 12, color: tok.textMuted, minWidth: 80 }}>{String(app.primarySkill).replace(/,/g, ', ').slice(0, 30)}</span>
                  )}

                  {/* Status */}
                  <Badge label={statusCfg.label} bg={statusCfg.bg} color={statusCfg.color} />

                  {/* Score ring or "unscored" */}
                  {summ ? (
                    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 4 }}>
                      <ScoreRing pct={summ.averagePct} />
                      <span style={{ fontSize: 10, color: tok.textMuted, fontWeight: 600 }}>{summ.scoreCount} score{summ.scoreCount !== 1 ? 's' : ''}</span>
                    </div>
                  ) : (
                    <span style={{ fontSize: 11, color: tok.textMuted, fontWeight: 600, background: '#F3F4F6', padding: '4px 10px', borderRadius: 20 }}>Unscored</span>
                  )}

                  {/* Consensus rec */}
                  {summ && summ.consensusRecommendation !== 'pending' && (
                    <Badge label={REC_CFG[summ.consensusRecommendation].label} bg={REC_CFG[summ.consensusRecommendation].bg} color={REC_CFG[summ.consensusRecommendation].color} />
                  )}

                  {/* Chevron */}
                  <span style={{ color: tok.textMuted, fontSize: 16, marginLeft: 4 }}>{isOpen ? '▲' : '▼'}</span>
                </div>

                {/* ── Scoring panel ──────────────────────────────────────── */}
                {isOpen && (
                  <div style={{ borderTop: `1px solid ${tok.border}`, padding: '22px 24px', background: '#FAFBFD' }}>
                    {loadingDetail ? (
                      <p style={{ color: tok.textMuted, textAlign: 'center', padding: '20px 0' }}>Loading scorecards…</p>
                    ) : (
                      <div style={{ display: 'flex', gap: 28, flexWrap: 'wrap', alignItems: 'flex-start' }}>

                        {/* ── Left: rubric scoring form ─────────────────── */}
                        <div style={{ flex: '1 1 360px', display: 'flex', flexDirection: 'column', gap: 18 }}>
                          <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 4 }}>
                            <p style={{ margin: 0, fontWeight: 800, fontSize: 15, color: tok.text }}>Score this Application</p>
                            <ScoreRing pct={pct} />
                            <div>
                              <p style={{ margin: 0, fontSize: 13, fontWeight: 700, color: scoreColor(pct) }}>{total} / {maxTotal} pts</p>
                              <p style={{ margin: 0, fontSize: 11, color: tok.textMuted }}>Your running total</p>
                            </div>
                          </div>

                          {rubric.map((criterion) => {
                            const val = draftScores[criterion.key] ?? 5;
                            return (
                              <div key={criterion.key}>
                                <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 6 }}>
                                  <div>
                                    <span style={{ fontSize: 13.5, fontWeight: 700, color: tok.text }}>{criterion.label}</span>
                                    <span style={{ fontSize: 11, color: tok.textMuted, marginLeft: 8 }}>{criterion.description}</span>
                                  </div>
                                  <span style={{ fontSize: 14, fontWeight: 900, color: scoreColor(Math.round((val / criterion.maxScore) * 100)), minWidth: 36, textAlign: 'right' }}>
                                    {val}<span style={{ fontSize: 10, color: tok.textMuted, fontWeight: 400 }}>/{criterion.maxScore}</span>
                                  </span>
                                </div>
                                <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                                  <span style={{ fontSize: 11, color: tok.textMuted, width: 20, textAlign: 'center' }}>1</span>
                                  <input
                                    type="range" min={1} max={criterion.maxScore} step={1} value={val}
                                    onChange={(e) => setDraftScores((s) => ({ ...s, [criterion.key]: Number(e.target.value) }))}
                                    style={{ flex: 1, accentColor: tok.primary, cursor: 'pointer', height: 6 }}
                                  />
                                  <span style={{ fontSize: 11, color: tok.textMuted, width: 20, textAlign: 'center' }}>{criterion.maxScore}</span>
                                </div>
                                {/* Score labels */}
                                <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 2 }}>
                                  {['Poor', 'Fair', 'Good', 'Great', 'Excellent'].map((lbl, i) => (
                                    <span key={lbl} style={{ fontSize: 9, color: val === i * 2 + 2 ? tok.primary : tok.textMuted, fontWeight: val === i * 2 + 2 ? 700 : 400 }}>{lbl}</span>
                                  ))}
                                </div>
                              </div>
                            );
                          })}

                          {/* Recommendation */}
                          <div>
                            <p style={{ fontSize: 13, fontWeight: 700, color: tok.text, marginBottom: 8 }}>Your Recommendation</p>
                            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                              {(['pending', 'shortlist', 'approve', 'reject'] as Recommendation[]).map((r) => {
                                const cfg = REC_CFG[r];
                                return (
                                  <button key={r} onClick={() => setDraftRec(r)}
                                    style={{ padding: '7px 18px', borderRadius: 20, border: `1.5px solid ${draftRec === r ? cfg.color : tok.border}`, background: draftRec === r ? cfg.bg : '#fff', color: draftRec === r ? cfg.color : tok.textMid, fontWeight: 700, cursor: 'pointer', fontSize: 13, transition: 'all 0.15s' }}>
                                    {cfg.label}
                                  </button>
                                );
                              })}
                            </div>
                          </div>

                          {/* Notes */}
                          <div>
                            <p style={{ fontSize: 13, fontWeight: 700, color: tok.text, marginBottom: 6 }}>Judge Notes <span style={{ color: tok.textMuted, fontWeight: 400 }}>(optional)</span></p>
                            <textarea
                              value={draftNotes}
                              onChange={(e) => setDraftNotes(e.target.value)}
                              rows={3}
                              placeholder="Observations, strengths, areas of concern…"
                              style={{ width: '100%', padding: '10px 12px', borderRadius: 8, border: `1.5px solid #94A3B8`, fontSize: 13, color: '#111827', WebkitTextFillColor: '#111827', background: '#FFFFFF', resize: 'vertical', fontFamily: 'inherit', boxSizing: 'border-box', outline: 'none' }}
                            />
                          </div>

                          <button onClick={submitScore} disabled={saving}
                            style={{ padding: '12px', borderRadius: 10, border: 'none', background: saving ? '#9CA3AF' : `linear-gradient(135deg,${tok.primary},${tok.primaryDk})`, color: saving ? '#fff' : '#000', fontWeight: 800, fontSize: 14, cursor: saving ? 'not-allowed' : 'pointer', boxShadow: saving ? 'none' : '0 4px 14px rgba(245,158,11,0.3)' }}>
                            {saving ? 'Saving…' : '✓ Save Scorecard'}
                          </button>
                        </div>

                        {/* ── Right: existing scorecards + applicant info ─ */}
                        <div style={{ flex: '0 1 300px', display: 'flex', flexDirection: 'column', gap: 16 }}>

                          {/* Applicant snapshot */}
                          <div style={{ padding: '14px 16px', background: tok.card, border: `1px solid ${tok.border}`, borderRadius: 10 }}>
                            <p style={{ fontSize: 11, fontWeight: 800, textTransform: 'uppercase', letterSpacing: '0.08em', color: tok.textMuted, marginBottom: 10 }}>Applicant Info</p>
                            {[
                              ['Name',      app.fullName.trim() || '—'],
                              ['Contest',   CONTEST_LABELS[app.contestSlug] ?? app.contestSlug],
                              ['Talent',    String(app.primarySkill || '—').slice(0, 40)],
                              ['State',     app.state || '—'],
                              ['Reference', app.reference],
                            ].map(([k, v]) => (
                              <div key={k} style={{ display: 'flex', gap: 8, marginBottom: 6 }}>
                                <span style={{ fontSize: 12, color: tok.textMuted, width: 70, flexShrink: 0, fontWeight: 600 }}>{k}</span>
                                <span style={{ fontSize: 12, color: tok.text, fontWeight: 600 }}>{v}</span>
                              </div>
                            ))}
                          </div>

                          {/* All scorecards */}
                          {detail && detail.scorecards.length > 0 && (
                            <div>
                              <p style={{ fontSize: 11, fontWeight: 800, textTransform: 'uppercase', letterSpacing: '0.08em', color: tok.textMuted, marginBottom: 10 }}>
                                All Scorecards ({detail.scorecards.length})
                              </p>
                              <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                                {detail.scorecards.map((sc) => {
                                  const recCfg = REC_CFG[sc.recommendation];
                                  return (
                                    <div key={sc.id} style={{ padding: '12px 14px', background: tok.card, border: `1px solid ${tok.border}`, borderRadius: 10 }}>
                                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 }}>
                                        <span style={{ fontSize: 13, fontWeight: 700, color: tok.text }}>{sc.judgeName}</span>
                                        <span style={{ fontSize: 12, fontWeight: 900, color: scoreColor(sc.percentageScore) }}>{sc.percentageScore}%</span>
                                      </div>
                                      <div style={{ display: 'flex', gap: 6, alignItems: 'center', flexWrap: 'wrap' }}>
                                        <Badge label={recCfg.label} bg={recCfg.bg} color={recCfg.color} />
                                        <span style={{ fontSize: 11, color: tok.textMuted }}>{sc.totalScore}/{sc.maxScore} pts</span>
                                      </div>
                                      {sc.notes && <p style={{ fontSize: 11.5, color: tok.textMuted, marginTop: 6, marginBottom: 0, fontStyle: 'italic' }}>&ldquo;{sc.notes}&rdquo;</p>}
                                      {/* Per-criterion mini bars */}
                                      <div style={{ marginTop: 8, display: 'flex', flexDirection: 'column', gap: 3 }}>
                                        {(detail.rubric ?? []).map((c) => {
                                          const v = sc.scores[c.key] ?? 0;
                                          const p = Math.round((v / c.maxScore) * 100);
                                          return (
                                            <div key={c.key} style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                                              <span style={{ fontSize: 10, color: tok.textMuted, width: 90, flexShrink: 0 }}>{c.label}</span>
                                              <div style={{ flex: 1, height: 4, borderRadius: 4, background: tok.border, overflow: 'hidden' }}>
                                                <div style={{ height: '100%', width: `${p}%`, background: scoreColor(p), transition: 'width 0.3s' }} />
                                              </div>
                                              <span style={{ fontSize: 10, fontWeight: 700, color: scoreColor(p), width: 20, textAlign: 'right' }}>{v}</span>
                                            </div>
                                          );
                                        })}
                                      </div>
                                    </div>
                                  );
                                })}
                              </div>
                            </div>
                          )}

                          {/* Score summary */}
                          {detail?.summary && (
                            <div style={{ padding: '14px 16px', background: tok.card, border: `1px solid ${tok.border}`, borderRadius: 10 }}>
                              <p style={{ fontSize: 11, fontWeight: 800, textTransform: 'uppercase', letterSpacing: '0.08em', color: tok.textMuted, marginBottom: 10 }}>Panel Summary</p>
                              <div style={{ display: 'flex', gap: 12, justifyContent: 'space-around', marginBottom: 10 }}>
                                {[
                                  { label: 'Average', value: `${detail.summary.averagePct}%` },
                                  { label: 'High',    value: `${detail.summary.highestScore}%` },
                                  { label: 'Low',     value: `${detail.summary.lowestScore}%` },
                                ].map(({ label, value }) => (
                                  <div key={label} style={{ textAlign: 'center' }}>
                                    <p style={{ fontSize: 18, fontWeight: 900, color: tok.text, margin: 0 }}>{value}</p>
                                    <p style={{ fontSize: 10, color: tok.textMuted, margin: 0 }}>{label}</p>
                                  </div>
                                ))}
                              </div>
                              <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                                {Object.entries(detail.summary.recommendations).filter(([, n]) => n > 0).map(([rec, n]) => {
                                  const cfg = REC_CFG[rec as Recommendation];
                                  return <Badge key={rec} label={`${cfg.label} ×${n}`} bg={cfg.bg} color={cfg.color} />;
                                })}
                              </div>
                              <div style={{ marginTop: 8 }}>
                                <span style={{ fontSize: 11, color: tok.textMuted }}>Consensus: </span>
                                <Badge label={REC_CFG[detail.summary.consensusRecommendation].label} bg={REC_CFG[detail.summary.consensusRecommendation].bg} color={REC_CFG[detail.summary.consensusRecommendation].color} />
                              </div>
                            </div>
                          )}
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
  );
}
