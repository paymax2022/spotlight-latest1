'use client';

/**
 * Judges & Scores — the second console reached over PATH A
 * (ADMIN CONSOLIDATION, slice 4; see docs/adr/ADR-047-admin-console-consolidation-path-a.md).
 *
 * Its data has no Go module; it lives in frontend-web's scoring + registration
 * stores and arrives via /api/web-proxy, same as contests (slice 3). Written as
 * a client component calling a service, matching every other console here — the
 * frontend-web original is a 'use client' page that already called frontend-web's
 * own /api/admin/judges-scores routes directly; this swaps that base for the
 * proxy and nothing else needed to change on the frontend-web side.
 */
import { Fragment, useCallback, useEffect, useState } from 'react';
import {
  getScoreDetail,
  listScoreableApplications,
  submitScorecard,
  type Recommendation,
  type ScoreDetail,
  type ScoredApplication,
} from '@/services/scoringAdminService';
import { Page, PageHeader, Card, Button, Input, Badge, colors } from '@/components/ui/vuexy';

const STATUS_BADGE: Record<string, string> = {
  submitted: colors.info,
  under_review: colors.warning,
  shortlisted: colors.primary,
  callback_invited: colors.primary,
  approved: colors.success,
};

const REC_BADGE: Record<Recommendation, string> = {
  pending: colors.muted,
  shortlist: colors.primary,
  approve: colors.success,
  reject: colors.danger,
};

const REC_OPTIONS: Recommendation[] = ['pending', 'shortlist', 'approve', 'reject'];

export default function JudgesScoresAdminPage() {
  const [apps, setApps] = useState<ScoredApplication[]>([]);
  const [stats, setStats] = useState({ total: 0, scored: 0, pending: 0 });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [contestFilter, setContestFilter] = useState('');
  const [statusFilter, setStatusFilter] = useState('');
  const [search, setSearch] = useState('');

  const [activeId, setActiveId] = useState<string | null>(null);
  const [detail, setDetail] = useState<ScoreDetail | null>(null);
  const [loadingDetail, setLoadingDetail] = useState(false);
  const [saving, setSaving] = useState(false);
  const [toast, setToast] = useState('');

  const [draftScores, setDraftScores] = useState<Record<string, number>>({});
  const [draftRec, setDraftRec] = useState<Recommendation>('pending');
  const [draftNotes, setDraftNotes] = useState('');

  function notify(msg: string) {
    setToast(msg);
    setTimeout(() => setToast(''), 3000);
  }

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const result = await listScoreableApplications({
        contestSlug: contestFilter || undefined,
        status: statusFilter || undefined,
        query: search || undefined,
      });
      setApps(result.applications);
      setStats(result.stats);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }, [contestFilter, statusFilter, search]);

  useEffect(() => { void load(); }, [load]);

  async function openPanel(app: ScoredApplication) {
    if (activeId === app.id) { setActiveId(null); setDetail(null); return; }
    setActiveId(app.id);
    setDetail(null);
    setLoadingDetail(true);
    try {
      const d = await getScoreDetail(app.id);
      setDetail(d);
      const mine = d.scorecards[0];
      if (mine) {
        setDraftScores(mine.scores);
        setDraftRec(mine.recommendation);
        setDraftNotes(mine.notes);
      } else {
        const blank: Record<string, number> = {};
        for (const c of d.rubric.length ? d.rubric : app.rubric) blank[c.key] = 5;
        setDraftScores(blank);
        setDraftRec('pending');
        setDraftNotes('');
      }
    } catch (e) {
      notify(e instanceof Error ? e.message : 'Failed to load scorecards');
    } finally {
      setLoadingDetail(false);
    }
  }

  async function onSubmitScore() {
    if (!activeId) return;
    setSaving(true);
    try {
      const { scorecard, summary } = await submitScorecard(activeId, {
        scores: draftScores,
        recommendation: draftRec,
        notes: draftNotes,
      });
      notify('Score saved');
      setDetail((d) => d
        ? { ...d, scorecards: [scorecard, ...d.scorecards.filter((s) => s.judgeId !== scorecard.judgeId)], summary }
        : d);
      setApps((prev) => prev.map((a) => (a.id === activeId ? { ...a, isScored: true, scoreSummary: summary } : a)));
    } catch (e) {
      notify(e instanceof Error ? e.message : 'Failed to save score');
    } finally {
      setSaving(false);
    }
  }

  const activeApp = apps.find((a) => a.id === activeId);
  const rubric = detail?.rubric.length ? detail.rubric : (activeApp?.rubric ?? []);
  const total = rubric.reduce((s, c) => s + (draftScores[c.key] ?? 0), 0);
  const maxTotal = rubric.reduce((s, c) => s + c.maxScore, 0);
  const pct = maxTotal > 0 ? Math.round((total / maxTotal) * 100) : 0;

  return (
    <Page>
      <PageHeader
        title="Judges & Scores"
        subtitle="Review applications and submit scoring rubrics across all programmes. Served from the web app over the admin web proxy."
      />

      {toast && (
        <div style={{ position: 'fixed', bottom: 24, right: 24, background: colors.text, color: '#fff', padding: '12px 20px', borderRadius: 10, fontSize: 14, fontWeight: 600, zIndex: 9999 }}>
          {toast}
        </div>
      )}

      <div style={{ display: 'flex', gap: 12, marginBottom: 16 }}>
        <Card style={{ flex: 1, padding: 16 }}>
          <div style={{ fontSize: 12, color: colors.muted }}>Total applications</div>
          <div style={{ fontSize: 22, fontWeight: 800 }}>{stats.total}</div>
        </Card>
        <Card style={{ flex: 1, padding: 16 }}>
          <div style={{ fontSize: 12, color: colors.muted }}>Scored</div>
          <div style={{ fontSize: 22, fontWeight: 800, color: colors.success }}>{stats.scored}</div>
        </Card>
        <Card style={{ flex: 1, padding: 16 }}>
          <div style={{ fontSize: 12, color: colors.muted }}>Pending</div>
          <div style={{ fontSize: 22, fontWeight: 800, color: colors.warning }}>{stats.pending}</div>
        </Card>
      </div>

      <Card style={{ marginBottom: 16 }}>
        <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
          <Input placeholder="Contest slug" value={contestFilter} onChange={(e) => setContestFilter(e.target.value)} style={{ maxWidth: 220 }} />
          <Input placeholder="Status" value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)} style={{ maxWidth: 180 }} />
          <Input placeholder="Search name, email, reference…" value={search} onChange={(e) => setSearch(e.target.value)} style={{ flex: 1, minWidth: 200 }} />
          <Button variant="outline" onClick={load}>Refresh</Button>
        </div>
      </Card>

      <Card>
        {loading && <p style={{ color: colors.muted }}>Loading applications…</p>}

        {error && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 12, alignItems: 'flex-start' }}>
            <p style={{ color: colors.danger, margin: 0 }}>{error}</p>
            <Button onClick={load}>Retry</Button>
          </div>
        )}

        {!loading && !error && apps.length === 0 && (
          <p style={{ color: colors.muted, margin: 0 }}>No applications match this filter.</p>
        )}

        {!loading && !error && apps.length > 0 && (
          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse' }}>
              <thead>
                <tr>
                  {['Applicant', 'Contest', 'Status', 'Score', 'Recommendation', ''].map((h) => (
                    <th key={h} style={{ textAlign: 'left', padding: '10px 12px', color: colors.muted, fontWeight: 600, fontSize: 13 }}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {apps.map((a) => (
                  <Fragment key={a.id}>
                    <tr style={{ borderTop: `1px solid ${colors.border}` }}>
                      <td style={{ padding: '12px' }}>
                        <div style={{ fontWeight: 600 }}>{a.fullName || a.email || a.reference}</div>
                        <div style={{ fontSize: 12, color: colors.muted }}>{a.email}</div>
                      </td>
                      <td style={{ padding: '12px', color: colors.muted }}>{a.contestSlug}</td>
                      <td style={{ padding: '12px' }}>
                        <Badge text={a.status} color={STATUS_BADGE[a.status] ?? colors.muted} />
                      </td>
                      <td style={{ padding: '12px', color: colors.muted }}>
                        {a.scoreSummary ? `${a.scoreSummary.averagePct}% (${a.scoreSummary.scoreCount})` : '—'}
                      </td>
                      <td style={{ padding: '12px' }}>
                        {a.scoreSummary
                          ? <Badge text={a.scoreSummary.consensusRecommendation} color={REC_BADGE[a.scoreSummary.consensusRecommendation]} />
                          : <span style={{ color: colors.muted }}>—</span>}
                      </td>
                      <td style={{ padding: '12px' }}>
                        <Button variant="outline" onClick={() => openPanel(a)}>
                          {activeId === a.id ? 'Close' : a.isScored ? 'View / rescore' : 'Score'}
                        </Button>
                      </td>
                    </tr>

                    {activeId === a.id && (
                      <tr>
                        <td colSpan={6} style={{ padding: '0 12px 20px', borderTop: 'none' }}>
                          <div style={{ background: colors.bg, border: `1px solid ${colors.border}`, borderRadius: 10, padding: 16 }}>
                            {loadingDetail && <p style={{ color: colors.muted, margin: 0 }}>Loading scorecards…</p>}

                            {!loadingDetail && (
                              <>
                                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
                                  <strong>{total} / {maxTotal} pts</strong>
                                  <span style={{ fontWeight: 700, color: pct >= 60 ? colors.success : colors.warning }}>{pct}%</span>
                                </div>

                                {rubric.map((c) => (
                                  <div key={c.key} style={{ marginBottom: 10 }}>
                                    <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 13 }}>
                                      <span>{c.label}</span>
                                      <span style={{ color: colors.muted }}>{draftScores[c.key] ?? 0} / {c.maxScore}</span>
                                    </div>
                                    <input
                                      type="range"
                                      min={0}
                                      max={c.maxScore}
                                      value={draftScores[c.key] ?? 0}
                                      onChange={(e) => setDraftScores((s) => ({ ...s, [c.key]: Number(e.target.value) }))}
                                      style={{ width: '100%' }}
                                    />
                                  </div>
                                ))}

                                <div style={{ display: 'flex', gap: 8, margin: '12px 0' }}>
                                  {REC_OPTIONS.map((r) => (
                                    <Button
                                      key={r}
                                      variant={draftRec === r ? 'primary' : 'outline'}
                                      onClick={() => setDraftRec(r)}
                                    >
                                      {r}
                                    </Button>
                                  ))}
                                </div>

                                <textarea
                                  placeholder="Notes for other judges…"
                                  value={draftNotes}
                                  onChange={(e) => setDraftNotes(e.target.value)}
                                  rows={3}
                                  style={{ width: '100%', padding: 10, borderRadius: 8, border: `1px solid ${colors.inputBorder}`, fontSize: 13, boxSizing: 'border-box' }}
                                />

                                <div style={{ marginTop: 12 }}>
                                  <Button onClick={onSubmitScore} disabled={saving}>
                                    {saving ? 'Saving…' : 'Save score'}
                                  </Button>
                                </div>

                                {detail && detail.scorecards.length > 0 && (
                                  <div style={{ marginTop: 16, fontSize: 12, color: colors.muted }}>
                                    {detail.scorecards.length} scorecard{detail.scorecards.length === 1 ? '' : 's'} submitted so far
                                    {detail.summary ? ` — consensus: ${detail.summary.consensusRecommendation}` : ''}.
                                  </div>
                                )}
                              </>
                            )}
                          </div>
                        </td>
                      </tr>
                    )}
                  </Fragment>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>
    </Page>
  );
}
