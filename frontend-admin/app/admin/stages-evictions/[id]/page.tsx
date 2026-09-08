'use client';

/**
 * Stages & Evictions — season detail console (admin consolidation slice 4;
 * see docs/adr/ADR-047-admin-console-consolidation-path-a.md).
 *
 * One page for the season's full lifecycle: contestants (add, promote to
 * bootcamp, fail audition, declare finalist/winner), weeks (create, open/
 * close voting) and per-week eviction voting (tallies, cast a vote, finalize
 * eviction). See realityShowAdminService.ts for exactly which endpoints back
 * each action — all of them exist server-side already, this is the first UI
 * reaching them.
 */
import { Fragment, useCallback, useEffect, useState, type CSSProperties } from 'react';
import { useParams } from 'next/navigation';
import Link from 'next/link';
import {
  getSeasonDetail, updateSeason, addContestant, actOnContestant,
  createWeek, setWeekStatus, getWeekVotes, castVote, finalizeEviction,
  type ShowSeason, type ShowContestant, type EvictionWeek, type Eviction,
  type WeekVotes, type PhaseStatus,
} from '@/services/realityShowAdminService';
import { Page, PageHeader, Card, Button, Input, Badge, colors, thCell, tdCell } from '@/components/ui/vuexy';

const PHASE_STATUS_BADGE: Record<PhaseStatus, string> = {
  audition: colors.info,
  bootcamp: colors.primary,
  evicted: colors.danger,
  finalist: colors.warning,
  winner: colors.success,
};

const WEEK_STATUS_BADGE: Record<string, string> = {
  upcoming: colors.muted,
  open: colors.success,
  closed: colors.warning,
  eviction_declared: colors.danger,
};

const selectStyle: CSSProperties = { padding: '8px 10px', borderRadius: 6, border: `1px solid ${colors.inputBorder}`, fontSize: 13 };
const labelStyle: CSSProperties = { display: 'block', fontSize: 12, color: colors.muted, marginBottom: 4 };

function fmt(d: string | null): string {
  return d ? new Date(d).toLocaleString() : '—';
}

export default function StagesEvictionsSeasonPage() {
  const params = useParams();
  const seasonId = params?.id as string;

  const [season, setSeason] = useState<ShowSeason | null>(null);
  const [contestants, setContestants] = useState<ShowContestant[]>([]);
  const [weeks, setWeeks] = useState<EvictionWeek[]>([]);
  const [evictions, setEvictions] = useState<Eviction[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [toast, setToast] = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const detail = await getSeasonDetail(seasonId);
      setSeason(detail.season);
      setContestants(detail.contestants);
      setWeeks(detail.weeks);
      setEvictions(detail.evictions);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load season');
    } finally {
      setLoading(false);
    }
  }, [seasonId]);

  useEffect(() => { if (seasonId) void load(); }, [seasonId, load]);

  const flash = useCallback((msg: string) => {
    setToast(msg);
    setTimeout(() => setToast(''), 2500);
  }, []);

  // ── Season status/phase ─────────────────────────────────────────────────
  const patchSeason = useCallback(async (patch: Parameters<typeof updateSeason>[1]) => {
    if (!season) return;
    try {
      setSeason(await updateSeason(season.id, patch));
      flash('Season updated');
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to update season');
    }
  }, [season, flash]);

  // ── Contestants ──────────────────────────────────────────────────────────
  const [showAddContestant, setShowAddContestant] = useState(false);
  const [savingContestant, setSavingContestant] = useState(false);
  const [contestantForm, setContestantForm] = useState({
    displayName: '', applicationId: '', stageName: '', primaryTalent: '',
  });

  const submitContestant = useCallback(async () => {
    if (!contestantForm.displayName.trim() || !contestantForm.applicationId.trim()) {
      setError('Display name and application ID are required');
      return;
    }
    setSavingContestant(true);
    try {
      await addContestant(seasonId, {
        displayName: contestantForm.displayName.trim(),
        applicationId: contestantForm.applicationId.trim(),
        stageName: contestantForm.stageName.trim() || undefined,
        primaryTalent: contestantForm.primaryTalent.trim() || undefined,
      });
      setContestantForm({ displayName: '', applicationId: '', stageName: '', primaryTalent: '' });
      setShowAddContestant(false);
      await load();
      flash('Contestant added');
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to add contestant');
    } finally {
      setSavingContestant(false);
    }
  }, [contestantForm, seasonId, load, flash]);

  const runContestantAction = useCallback(async (id: string, action: Parameters<typeof actOnContestant>[1]) => {
    try {
      await actOnContestant(id, action);
      await load();
      flash('Contestant updated');
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to update contestant');
    }
  }, [load, flash]);

  // ── Weeks ────────────────────────────────────────────────────────────────
  const [showAddWeek, setShowAddWeek] = useState(false);
  const [savingWeek, setSavingWeek] = useState(false);
  const [weekForm, setWeekForm] = useState({ weekNumber: String(weeks.length + 1), title: '', theme: '', evictionCount: '1' });

  useEffect(() => {
    setWeekForm((f) => ({ ...f, weekNumber: String(weeks.length + 1) }));
  }, [weeks.length]);

  const submitWeek = useCallback(async () => {
    const n = Number(weekForm.weekNumber);
    if (!n || n < 1) { setError('Week number must be >= 1'); return; }
    setSavingWeek(true);
    try {
      await createWeek(seasonId, {
        weekNumber: n,
        title: weekForm.title.trim() || undefined,
        theme: weekForm.theme.trim() || undefined,
        evictionCount: Number(weekForm.evictionCount) || 1,
      });
      setWeekForm({ weekNumber: '', title: '', theme: '', evictionCount: '1' });
      setShowAddWeek(false);
      await load();
      flash('Week created');
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to create week');
    } finally {
      setSavingWeek(false);
    }
  }, [weekForm, seasonId, load, flash]);

  const changeWeekStatus = useCallback(async (weekId: string, status: 'upcoming' | 'open' | 'closed') => {
    try {
      await setWeekStatus(weekId, status);
      await load();
      flash(`Voting ${status === 'open' ? 'opened' : status === 'closed' ? 'closed' : 'reset'}`);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to update week status');
    }
  }, [load, flash]);

  // ── Vote panel (expand one week at a time) ──────────────────────────────
  const [openWeekId, setOpenWeekId] = useState<string | null>(null);
  const [weekVotes, setWeekVotes] = useState<WeekVotes | null>(null);
  const [loadingVotes, setLoadingVotes] = useState(false);
  const [voteContestantId, setVoteContestantId] = useState('');
  const [voteReason, setVoteReason] = useState('');
  const [finalizeNote, setFinalizeNote] = useState('');
  const [finalizing, setFinalizing] = useState(false);

  const toggleWeek = useCallback(async (weekId: string) => {
    if (openWeekId === weekId) { setOpenWeekId(null); setWeekVotes(null); return; }
    setOpenWeekId(weekId);
    setLoadingVotes(true);
    try {
      setWeekVotes(await getWeekVotes(weekId));
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load votes');
    } finally {
      setLoadingVotes(false);
    }
  }, [openWeekId]);

  const submitVote = useCallback(async (weekId: string) => {
    if (!voteContestantId) return;
    try {
      await castVote(weekId, voteContestantId, voteReason.trim() || undefined);
      setVoteContestantId('');
      setVoteReason('');
      setWeekVotes(await getWeekVotes(weekId));
      flash('Vote cast');
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to cast vote');
    }
  }, [voteContestantId, voteReason, flash]);

  const runFinalize = useCallback(async (weekId: string) => {
    setFinalizing(true);
    try {
      const result = await finalizeEviction(weekId, finalizeNote.trim() || undefined);
      setFinalizeNote('');
      await load();
      setWeekVotes(await getWeekVotes(weekId));
      flash(`Eviction finalized — ${result.evictedContestants.length} contestant(s) evicted`);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to finalize eviction');
    } finally {
      setFinalizing(false);
    }
  }, [finalizeNote, load, flash]);

  const contestantById = new Map(contestants.map((c) => [c.id, c]));

  if (loading && !season) {
    return <Page><p style={{ color: colors.muted }}>Loading season…</p></Page>;
  }
  if (!season) {
    return <Page><p style={{ color: colors.danger }}>{error || 'Season not found'}</p></Page>;
  }

  return (
    <Page>
      <Link href="/admin/stages-evictions" style={{ fontSize: 13, color: colors.primary, textDecoration: 'none' }}>
        ← All seasons
      </Link>
      <PageHeader
        title={`${season.seasonName} (Season ${season.seasonNumber})`}
        subtitle={`${season.contestSlug} · updated ${fmt(season.updatedAt)}`}
      />

      {toast && <div style={{ marginBottom: 12, color: colors.success, fontSize: 13 }}>{toast}</div>}
      {error && <p style={{ color: colors.danger }}>{error}</p>}

      <Card title="Season" style={{ marginBottom: 16 }}>
        <div style={{ display: 'flex', gap: 24, flexWrap: 'wrap' }}>
          <div>
            <label style={labelStyle}>Phase</label>
            <select style={selectStyle} value={season.currentPhase}
              onChange={(e) => void patchSeason({ currentPhase: e.target.value as ShowSeason['currentPhase'] })}>
              {(['pre_audition', 'audition', 'bootcamp', 'finale', 'completed'] as const).map((p) => (
                <option key={p} value={p}>{p}</option>
              ))}
            </select>
          </div>
          <div>
            <label style={labelStyle}>Status</label>
            <select style={selectStyle} value={season.status}
              onChange={(e) => void patchSeason({ status: e.target.value as ShowSeason['status'] })}>
              {(['draft', 'active', 'completed'] as const).map((s) => (
                <option key={s} value={s}>{s}</option>
              ))}
            </select>
          </div>
        </div>
      </Card>

      <Card
        title={`Contestants (${contestants.length})`}
        style={{ marginBottom: 16 }}
      >
        <div style={{ marginBottom: 12 }}>
          <Button variant="primary" sm onClick={() => setShowAddContestant((v) => !v)}>
            {showAddContestant ? 'Cancel' : 'Add contestant'}
          </Button>
        </div>
        {showAddContestant && (
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr 1fr', gap: 10, marginBottom: 14 }}>
            <div>
              <label style={labelStyle}>Display name</label>
              <Input style={{ width: '100%' }} value={contestantForm.displayName}
                onChange={(e) => setContestantForm((f) => ({ ...f, displayName: e.target.value }))} />
            </div>
            <div>
              <label style={labelStyle}>Application ID</label>
              <Input style={{ width: '100%' }} value={contestantForm.applicationId}
                onChange={(e) => setContestantForm((f) => ({ ...f, applicationId: e.target.value }))} />
            </div>
            <div>
              <label style={labelStyle}>Stage name</label>
              <Input style={{ width: '100%' }} value={contestantForm.stageName}
                onChange={(e) => setContestantForm((f) => ({ ...f, stageName: e.target.value }))} />
            </div>
            <div>
              <label style={labelStyle}>Primary talent</label>
              <Input style={{ width: '100%' }} value={contestantForm.primaryTalent}
                onChange={(e) => setContestantForm((f) => ({ ...f, primaryTalent: e.target.value }))} />
            </div>
            <div style={{ gridColumn: '1 / -1' }}>
              <Button variant="primary" disabled={savingContestant} onClick={() => void submitContestant()}>
                {savingContestant ? 'Adding…' : 'Add contestant'}
              </Button>
            </div>
          </div>
        )}

        {contestants.length === 0 ? (
          <p style={{ color: colors.muted, margin: 0 }}>No contestants yet.</p>
        ) : (
          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse' }}>
              <thead>
                <tr>
                  <th style={thCell}>Name</th>
                  <th style={thCell}>Talent</th>
                  <th style={thCell}>Phase</th>
                  <th style={thCell}>Audition</th>
                  <th style={thCell}>Active</th>
                  <th style={thCell}>Actions</th>
                </tr>
              </thead>
              <tbody>
                {contestants.map((c) => (
                  <tr key={c.id}>
                    <td style={tdCell}>
                      <strong>{c.displayName}</strong>
                      {c.stageName ? <div style={{ fontSize: 12, color: colors.muted }}>“{c.stageName}”</div> : null}
                    </td>
                    <td style={tdCell}>{c.primaryTalent || '—'}</td>
                    <td style={tdCell}>
                      <Badge text={c.phaseStatus} color={PHASE_STATUS_BADGE[c.phaseStatus] ?? colors.muted} />
                      {c.finalistPosition ? <span style={{ fontSize: 12, color: colors.muted, marginLeft: 6 }}>#{c.finalistPosition}</span> : null}
                    </td>
                    <td style={tdCell}>{c.auditionResult}</td>
                    <td style={tdCell}>{c.isActive ? 'Yes' : 'No'}</td>
                    <td style={tdCell}>
                      <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                        {c.phaseStatus === 'audition' && (
                          <>
                            <Button sm onClick={() => void runContestantAction(c.id, 'promote_to_bootcamp')}>To bootcamp</Button>
                            <Button sm variant="danger" onClick={() => void runContestantAction(c.id, 'fail_audition')}>Fail</Button>
                          </>
                        )}
                        {c.phaseStatus === 'bootcamp' && (
                          <Button sm onClick={() => void runContestantAction(c.id, 'declare_finalist')}>Finalist</Button>
                        )}
                        {c.phaseStatus === 'finalist' && (
                          <Button sm variant="primary" onClick={() => void runContestantAction(c.id, 'declare_winner')}>Winner</Button>
                        )}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      <Card title={`Weeks (${weeks.length})`}>
        <div style={{ marginBottom: 12 }}>
          <Button variant="primary" sm onClick={() => setShowAddWeek((v) => !v)}>
            {showAddWeek ? 'Cancel' : 'New week'}
          </Button>
        </div>
        {showAddWeek && (
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 2fr 2fr 1fr', gap: 10, marginBottom: 14 }}>
            <div>
              <label style={labelStyle}>Week #</label>
              <Input style={{ width: '100%' }} type="number" min={1} value={weekForm.weekNumber}
                onChange={(e) => setWeekForm((f) => ({ ...f, weekNumber: e.target.value }))} />
            </div>
            <div>
              <label style={labelStyle}>Title</label>
              <Input style={{ width: '100%' }} value={weekForm.title}
                onChange={(e) => setWeekForm((f) => ({ ...f, title: e.target.value }))} />
            </div>
            <div>
              <label style={labelStyle}>Theme</label>
              <Input style={{ width: '100%' }} value={weekForm.theme}
                onChange={(e) => setWeekForm((f) => ({ ...f, theme: e.target.value }))} />
            </div>
            <div>
              <label style={labelStyle}>Evictions</label>
              <Input style={{ width: '100%' }} type="number" min={1} value={weekForm.evictionCount}
                onChange={(e) => setWeekForm((f) => ({ ...f, evictionCount: e.target.value }))} />
            </div>
            <div style={{ gridColumn: '1 / -1' }}>
              <Button variant="primary" disabled={savingWeek} onClick={() => void submitWeek()}>
                {savingWeek ? 'Creating…' : 'Create week'}
              </Button>
            </div>
          </div>
        )}

        {weeks.length === 0 ? (
          <p style={{ color: colors.muted, margin: 0 }}>No weeks yet.</p>
        ) : (
          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse' }}>
              <thead>
                <tr>
                  <th style={thCell}>Week</th>
                  <th style={thCell}>Title / Theme</th>
                  <th style={thCell}>Status</th>
                  <th style={thCell}>Evictions</th>
                  <th style={thCell} />
                </tr>
              </thead>
              <tbody>
                {weeks.map((w) => (
                  <Fragment key={w.id}>
                    <tr>
                      <td style={tdCell}>Week {w.weekNumber}</td>
                      <td style={tdCell}>{w.title || '—'}{w.theme ? ` · ${w.theme}` : ''}</td>
                      <td style={tdCell}>
                        <Badge text={w.status} color={WEEK_STATUS_BADGE[w.status] ?? colors.muted} />
                        {w.evictionFinalized ? <span style={{ fontSize: 12, color: colors.muted, marginLeft: 6 }}>finalized</span> : null}
                      </td>
                      <td style={tdCell}>{w.evictionCount}</td>
                      <td style={tdCell}>
                        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                          {w.status === 'upcoming' && <Button sm onClick={() => void changeWeekStatus(w.id, 'open')}>Open voting</Button>}
                          {w.status === 'open' && <Button sm variant="danger" onClick={() => void changeWeekStatus(w.id, 'closed')}>Close voting</Button>}
                          <Button sm onClick={() => void toggleWeek(w.id)}>{openWeekId === w.id ? 'Hide' : 'Votes'}</Button>
                        </div>
                      </td>
                    </tr>
                    {openWeekId === w.id && (
                      <tr>
                        <td style={{ ...tdCell, background: colors.bg }} colSpan={5}>
                          {loadingVotes ? (
                            <p style={{ color: colors.muted, margin: 0 }}>Loading votes…</p>
                          ) : weekVotes ? (
                            <div>
                              <div style={{ marginBottom: 10 }}>
                                <strong style={{ fontSize: 13 }}>Tallies</strong>
                                {weekVotes.tallies.length === 0 ? (
                                  <p style={{ color: colors.muted, margin: '4px 0 0' }}>No votes cast yet.</p>
                                ) : (
                                  <ul style={{ margin: '6px 0 0', paddingLeft: 18 }}>
                                    {weekVotes.tallies.map((t) => (
                                      <li key={t.contestantId} style={{ fontSize: 13 }}>
                                        {(t.contestant?.displayName ?? contestantById.get(t.contestantId)?.displayName) ?? t.contestantId}
                                        {' — '}{t.voteCount} vote{t.voteCount === 1 ? '' : 's'}
                                      </li>
                                    ))}
                                  </ul>
                                )}
                              </div>

                              {w.status === 'open' && (
                                <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginBottom: 10, flexWrap: 'wrap' }}>
                                  <select style={selectStyle} value={voteContestantId}
                                    onChange={(e) => setVoteContestantId(e.target.value)}>
                                    <option value="">Vote to evict…</option>
                                    {contestants.filter((c) => c.isActive).map((c) => (
                                      <option key={c.id} value={c.id}>{c.displayName}</option>
                                    ))}
                                  </select>
                                  <Input placeholder="Reason (optional)" value={voteReason}
                                    onChange={(e) => setVoteReason(e.target.value)} style={{ width: 220 }} />
                                  <Button sm variant="primary" disabled={!voteContestantId} onClick={() => void submitVote(w.id)}>
                                    Cast vote
                                  </Button>
                                </div>
                              )}

                              {w.status === 'closed' && !w.evictionFinalized && (
                                <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
                                  <Input placeholder="Eviction note (optional)" value={finalizeNote}
                                    onChange={(e) => setFinalizeNote(e.target.value)} style={{ width: 260 }} />
                                  <Button sm variant="danger" disabled={finalizing || weekVotes.tallies.length === 0}
                                    onClick={() => void runFinalize(w.id)}>
                                    {finalizing ? 'Finalizing…' : `Finalize eviction (top ${w.evictionCount})`}
                                  </Button>
                                </div>
                              )}
                            </div>
                          ) : null}
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

      {evictions.length > 0 && (
        <Card title="Eviction history" style={{ marginTop: 16 }}>
          <ul style={{ margin: 0, paddingLeft: 18 }}>
            {evictions.map((ev) => (
              <li key={ev.id} style={{ fontSize: 13, marginBottom: 4 }}>
                {contestantById.get(ev.contestantId)?.displayName ?? ev.contestantId} — {ev.voteCount} votes — {fmt(ev.evictedAt)}
                {ev.evictionNote ? ` — "${ev.evictionNote}"` : ''}
              </li>
            ))}
          </ul>
        </Card>
      )}
    </Page>
  );
}
