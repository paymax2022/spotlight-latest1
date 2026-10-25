'use client';

// Topic-mastery console for the TMFA curriculum pack.
//
// Three honest boundaries are visible on this screen:
//   1. IMPORT lands everything as a DRAFT. It never approves a question, never
//      publishes a topic, and never touches an approved/retired question. The
//      preview is the exact server-built plan, not a browser-side guess.
//   2. PUBLISH is a separate server-evaluated gate: approved article + reviewed
//      media (rights cleared, accessibility passed, real file URLs) + at least
//      20 approved questions. The blockers shown here are the same blockers the
//      server returns, so the console cannot offer a publish that would fail.
//   3. HOLDS block mastery independently of the quiz score. Creating or clearing
//      one is scores:manage, and clearing the last hold restores MASTERED only
//      when the learner actually passed.
//
// Money convention does not apply here; these tables carry no amounts.

import React, { useCallback, useEffect, useState } from 'react';
import { colors } from '@/components/ui/vuexy';
import {
  Card, Badge, StateBlock, Kpi, btn, btnPrimary, btnDanger, th, td, input, label, select,
  fmtDate, AuditNote,
} from '../_ui';
import * as svc from '@/services/filmAcademyAdminService';

type NoticeProp = { onNotice: (s: string | null) => void };
type SubTab = 'gates' | 'import' | 'media' | 'holds' | 'mastery';

const PRODUCTION_STATES = [
  'PLANNED', 'SCRIPTED', 'CAPTURED', 'EDITED',
  'ACCESSIBILITY_REVIEW', 'RIGHTS_REVIEW', 'ACADEMIC_APPROVED', 'PUBLISHED',
];
const RIGHTS_STATUSES = ['NOT_REVIEWED', 'PENDING', 'CLEARED', 'RESTRICTED', 'EXPIRED'];
const ACCESSIBILITY_STATUSES = ['NOT_REVIEWED', 'IN_PROGRESS', 'PASSED', 'FAILED', 'NOT_APPLICABLE'];
const HOLD_TYPES = [
  'PRACTICAL_FAILED', 'PRACTICAL_PENDING', 'SAFETY', 'ATTENDANCE',
  'CONTENT_INCOMPLETE', 'INSTRUCTOR_REVIEW', 'ADMIN_REVIEW',
];

/** Same generic loader the page uses; kept local so this file is self-contained. */
function useAsync<T>(fn: () => Promise<T>, deps: unknown[], enabled = true) {
  const [data, setData] = useState<T | null>(null);
  const [loading, setLoading] = useState(enabled);
  const [error, setError] = useState<string | null>(null);
  const run = useCallback(async () => {
    if (!enabled) return;
    setLoading(true); setError(null);
    try { setData(await fn()); }
    catch (e) { setError(e instanceof Error ? e.message : String(e)); }
    finally { setLoading(false); }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enabled, ...deps]);
  useEffect(() => { void run(); }, [run]);
  return { data, loading, error, reload: run };
}

const SUB_TABS: Array<{ key: SubTab; label: string; hint: string }> = [
  { key: 'gates', label: 'Publication gates', hint: 'Every topic with the gates the server evaluates' },
  { key: 'import', label: 'Curriculum import', hint: 'Preview and apply the bundled TMFA pack as drafts' },
  { key: 'media', label: 'Media production', hint: 'Files, rights and accessibility — a record is not a produced asset' },
  { key: 'holds', label: 'Academic holds', hint: 'Practical/safety/review holds that block mastery' },
  { key: 'mastery', label: 'Candidate mastery', hint: 'Mastered, passed-with-hold and remediation counts per learner' },
];

export function TopicsTab({ onNotice }: NoticeProp) {
  const [sub, setSub] = useState<SubTab>('gates');
  const [mediaTopic, setMediaTopic] = useState<string | null>(null);
  return (
    <>
      <div style={{ display: 'flex', gap: '0.4rem', flexWrap: 'wrap', marginBottom: '1rem' }}>
        {SUB_TABS.map((t) => (
          <button key={t.key} title={t.hint} style={sub === t.key ? btnPrimary() : btn()}
            onClick={() => setSub(t.key)}>{t.label}</button>
        ))}
      </div>
      {sub === 'gates' ? <GatesPanel onNotice={onNotice} onOpenMedia={(id) => { setMediaTopic(id); setSub('media'); }} /> : null}
      {sub === 'import' ? <ImportPanel onNotice={onNotice} /> : null}
      {sub === 'media' ? <MediaPanel onNotice={onNotice} initialTopicId={mediaTopic} /> : null}
      {sub === 'holds' ? <HoldsPanel onNotice={onNotice} /> : null}
      {sub === 'mastery' ? <MasteryPanel onNotice={onNotice} /> : null}
    </>
  );
}

// ── Publication gates ───────────────────────────────────────────────────────

function GatesPanel({ onNotice, onOpenMedia }: NoticeProp & { onOpenMedia: (topicId: string) => void }) {
  const [qInput, setQInput] = useState('');
  const [q, setQ] = useState('');
  const [ready, setReady] = useState('');
  const [published, setPublished] = useState('');
  const [page, setPage] = useState(1);
  const [selected, setSelected] = useState<string | null>(null);

  const list = useAsync(
    () => svc.listAdminTopics({
      q: q || undefined,
      ready: ready === '' ? undefined : ready === 'true',
      published: published === '' ? undefined : published === 'true',
      page, pageSize: 25,
    }),
    [q, ready, published, page],
  );

  const rows = list.data?.topics ?? [];
  const s = list.data?.summary;

  return (
    <>
      <Card title="Publication gates" right={
        <span style={{ fontSize: '0.75rem', color: colors.muted }}>
          The Publish button only appears when every gate has passed on the server.
        </span>
      }>
        <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap', alignItems: 'flex-end', marginBottom: '0.75rem' }}>
          <div style={{ minWidth: 260, flex: 1 }}>
            <label style={label()}>Search title or topic ID</label>
            <input style={input()} value={qInput} onChange={(e) => setQInput(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter') { setPage(1); setQ(qInput.trim()); } }}
              placeholder="e.g. A01 or lighting" />
          </div>
          <div>
            <label style={label()}>Ready</label>
            <select style={select()} value={ready} onChange={(e) => { setPage(1); setReady(e.target.value); }}>
              <option value="">Any</option><option value="true">Ready</option><option value="false">Blocked</option>
            </select>
          </div>
          <div>
            <label style={label()}>Published</label>
            <select style={select()} value={published} onChange={(e) => { setPage(1); setPublished(e.target.value); }}>
              <option value="">Any</option><option value="true">Published</option><option value="false">Unpublished</option>
            </select>
          </div>
          <button style={btnPrimary()} onClick={() => { setPage(1); setQ(qInput.trim()); }}>Search</button>
          <button style={btn()} onClick={() => { setQInput(''); setQ(''); setReady(''); setPublished(''); setPage(1); }}>Clear</button>
        </div>

        {s ? (
          <div style={{ display: 'flex', gap: '0.75rem', flexWrap: 'wrap', marginBottom: '0.75rem' }}>
            <Kpi label="Topics" value={String(s.total)} />
            <Kpi label="Ready" value={String(s.ready)} accent={colors.success} />
            <Kpi label="Blocked" value={String(s.blocked)} accent={s.blocked ? colors.warning : colors.muted} />
            <Kpi label="Published" value={String(s.published)} />
            <Kpi label="Approved articles" value={String(s.approved)} />
            <Kpi label="In review" value={String(s.inReview)} />
          </div>
        ) : null}

        <StateBlock loading={list.loading} error={list.error} empty={rows.length === 0}
          emptyText="No topics found. Import the bundled curriculum pack first.">
          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: 960 }}>
              <thead><tr>
                <th style={th()}>Topic</th><th style={th()}>Stage</th><th style={th()}>Content</th>
                <th style={th()}>Questions</th><th style={th()}>Media</th><th style={th()}>Gate</th>
                <th style={th()}>Published</th><th style={th()} />
              </tr></thead>
              <tbody>
                {rows.map((t) => (
                  <tr key={t.topicId} style={{ background: selected === t.topicId ? 'rgba(115,103,240,0.06)' : undefined }}>
                    <td style={td()}>
                      <strong>{t.title}</strong>
                      <div style={{ fontSize: '0.72rem', color: colors.muted }}>
                        {t.topicId} · {t.courseTitle}
                      </div>
                    </td>
                    <td style={td()}>{t.stage}</td>
                    <td style={td()}><Badge status={t.contentStatus} /></td>
                    <td style={td()}>
                      <span style={{ color: t.questionCounts.approved >= Math.max(20, t.drawCount) ? colors.success : colors.danger, fontWeight: 600 }}>
                        {t.questionCounts.approved}
                      </span>
                      {' / '}{Math.max(20, t.drawCount)}
                      <div style={{ fontSize: '0.72rem', color: colors.muted }}>
                        {t.questionCounts.draft} draft · {t.questionCounts.review} review
                      </div>
                    </td>
                    <td style={td()}>
                      {t.media.published}/{t.media.required} required
                      {t.media.missingFile > 0 ? (
                        <div style={{ fontSize: '0.72rem', color: colors.danger }}>{t.media.missingFile} missing file</div>
                      ) : null}
                    </td>
                    <td style={td()}><Badge status={t.ready ? 'ready' : 'blocked'} label={t.ready ? 'ready' : 'blocked'} /></td>
                    <td style={td()}><Badge status={t.published ? 'published' : 'draft'} label={t.published ? 'live' : 'off'} /></td>
                    <td style={{ ...td(), whiteSpace: 'nowrap' }}>
                      <button style={btn()} onClick={() => setSelected(selected === t.topicId ? null : t.topicId)}>
                        {selected === t.topicId ? 'Hide' : 'Open'}
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div style={{ display: 'flex', gap: '0.5rem', justifyContent: 'flex-end', marginTop: '0.6rem' }}>
            <button style={btn()} disabled={page <= 1} onClick={() => setPage((p) => Math.max(1, p - 1))}>Previous</button>
            <span style={{ fontSize: '0.78rem', color: colors.muted, alignSelf: 'center' }}>Page {page}</span>
            <button style={btn()} disabled={!list.data?.hasMore} onClick={() => setPage((p) => p + 1)}>Next</button>
          </div>
        </StateBlock>

        <AuditNote>
          The import creates drafts only. A topic becomes publishable when its article is approved, every required
          asset is PUBLISHED with rights CLEARED and accessibility PASSED (or a signed text-equivalent waiver
          exists), and at least 20 approved questions cover the draw. Saving changes to approved content returns
          it to review and unpublishes it.
        </AuditNote>
      </Card>

      {selected ? (
        <TopicDetailPanel
          topicId={selected}
          onNotice={onNotice}
          onOpenMedia={onOpenMedia}
          onChanged={() => void list.reload()}
        />
      ) : null}
    </>
  );
}

function TopicDetailPanel({
  topicId, onNotice, onOpenMedia, onChanged,
}: NoticeProp & { topicId: string; onOpenMedia: (topicId: string) => void; onChanged: () => void }) {
  const detail = useAsync(() => svc.getAdminTopic(topicId), [topicId]);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [waiverApproved, setWaiverApproved] = useState(false);
  const [waiverNote, setWaiverNote] = useState('');

  useEffect(() => {
    setWaiverApproved(detail.data?.accessibleEquivalent.approved ?? false);
    setWaiverNote(detail.data?.accessibleEquivalent.note ?? '');
  }, [detail.data]);

  const act = async (action: svc.AdminTopicAction, extra?: Record<string, unknown>) => {
    setBusy(action); setError(null);
    try {
      const result = await svc.mutateAdminTopic(topicId, { action, ...extra });
      onNotice(result.message);
      await detail.reload();
      onChanged();
    } catch (e) { setError(e instanceof Error ? e.message : String(e)); }
    finally { setBusy(null); }
  };

  const t = detail.data?.topic;

  return (
    <Card title={t ? `Topic detail — ${t.title}` : 'Topic detail'} right={
      <button style={btn()} onClick={() => onOpenMedia(topicId)}>Open its media queue</button>
    }>
      <StateBlock loading={detail.loading} error={detail.error} empty={!detail.data}
        emptyText="This topic could not be loaded.">
        {detail.data && t ? (
          <>
            <div style={{ display: 'flex', gap: '0.6rem', flexWrap: 'wrap', alignItems: 'center', marginBottom: '0.75rem' }}>
              <Badge status={t.contentStatus} />
              <Badge status={t.ready ? 'ready' : 'blocked'} label={t.ready ? 'ready to publish' : 'blocked'} />
              <Badge status={t.published ? 'published' : 'draft'} label={t.published ? 'published' : 'unpublished'} />
              <span style={{ fontSize: '0.78rem', color: colors.muted }}>
                {t.stage} · {t.courseTitle} · <code>{t.topicId}</code>
              </span>
            </div>

            {error ? <p style={{ color: colors.danger, fontSize: '0.85rem' }}>{error}</p> : null}

            <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap', marginBottom: '0.75rem' }}>
              {t.contentStatus === 'draft' ? (
                <button style={btnPrimary()} disabled={busy !== null} onClick={() => void act('submit_review')}>
                  {busy === 'submit_review' ? 'Submitting…' : 'Submit for review'}
                </button>
              ) : null}
              {t.contentStatus === 'review' ? (
                <button style={btnPrimary()} disabled={busy !== null} onClick={() => void act('approve')}>
                  {busy === 'approve' ? 'Approving…' : 'Approve article (scores:manage)'}
                </button>
              ) : null}
              {t.ready && !t.published ? (
                <button style={btnPrimary()} disabled={busy !== null} onClick={() => void act('publish')}>
                  {busy === 'publish' ? 'Publishing…' : 'Publish topic (scores:manage)'}
                </button>
              ) : null}
              {t.published ? (
                <button style={btnDanger()} disabled={busy !== null} onClick={() => void act('unpublish')}>
                  {busy === 'unpublish' ? 'Unpublishing…' : 'Unpublish'}
                </button>
              ) : null}
            </div>

            {t.blockers.length > 0 ? (
              <div style={{ border: `1px solid ${colors.warning}`, borderRadius: '0.5rem', padding: '0.6rem 0.8rem', marginBottom: '0.75rem' }}>
                <strong style={{ fontSize: '0.8rem' }}>Publication blockers ({t.blockers.length})</strong>
                <ul style={{ margin: '0.3rem 0 0', paddingLeft: '1.1rem', fontSize: '0.8rem', color: colors.text }}>
                  {t.blockers.map((b) => <li key={b.code}>{b.message}</li>)}
                </ul>
              </div>
            ) : null}

            <div style={{ display: 'flex', gap: '0.75rem', flexWrap: 'wrap', marginBottom: '0.75rem' }}>
              <Kpi label="Approved questions" value={`${detail.data.topic.questionCounts.approved} / ${Math.max(20, t.drawCount)}`} />
              <Kpi label="Required media live" value={`${detail.data.topic.media.published} / ${detail.data.topic.media.required}`} />
              <Kpi label="Learners mastered" value={String(detail.data.mastery.mastered)} accent={colors.success} />
              <Kpi label="In remediation" value={String(detail.data.mastery.remediation)} accent={detail.data.mastery.remediation ? colors.warning : colors.muted} />
              <Kpi label="Attempts" value={`${detail.data.attempts.scored} scored / ${detail.data.attempts.inProgress} open`} />
            </div>

            <details style={{ marginBottom: '0.75rem' }}>
              <summary style={{ cursor: 'pointer', fontSize: '0.85rem', fontWeight: 600 }}>
                Teaching article ({detail.data.article.length.toLocaleString()} characters)
              </summary>
              <div style={{ whiteSpace: 'pre-wrap', fontSize: '0.82rem', background: colors.bg,
                borderRadius: '0.5rem', padding: '0.75rem', marginTop: '0.4rem', maxHeight: 320, overflow: 'auto' }}>
                {detail.data.article || 'No article has been written.'}
              </div>
            </details>

            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(280px,1fr))', gap: '0.75rem', marginBottom: '0.75rem' }}>
              <div>
                <strong style={{ fontSize: '0.82rem' }}>Learning outcomes</strong>
                {detail.data.outcomes.length === 0 ? <p style={{ fontSize: '0.8rem', color: colors.muted }}>None recorded.</p> : (
                  <ul style={{ margin: '0.3rem 0 0', paddingLeft: '1.1rem', fontSize: '0.8rem' }}>
                    {detail.data.outcomes.map((o) => <li key={o.objective_id}><code>{o.objective_id}</code> — {o.description}</li>)}
                  </ul>
                )}
              </div>
              <div>
                <strong style={{ fontSize: '0.82rem' }}>Prerequisites</strong>
                {detail.data.prerequisites.length === 0 ? <p style={{ fontSize: '0.8rem', color: colors.muted }}>None — this is an entry topic.</p> : (
                  <p style={{ fontSize: '0.8rem' }}>{detail.data.prerequisites.join(', ')}</p>
                )}
              </div>
            </div>

            {t.contentStatus === 'approved' ? (
              <div style={{ border: `1px solid ${colors.border}`, borderRadius: '0.5rem', padding: '0.75rem', marginBottom: '0.75rem' }}>
                <strong style={{ fontSize: '0.82rem' }}>Accessible-equivalent waiver (scores:manage)</strong>
                <p style={{ fontSize: '0.78rem', color: colors.muted, margin: '0.2rem 0 0.5rem' }}>
                  Use only when a required audiovisual asset has a genuinely equivalent accessible substitute.
                  The rationale becomes part of the academic audit trail.
                </p>
                <label style={{ fontSize: '0.8rem', display: 'flex', gap: '0.4rem', alignItems: 'center', marginBottom: '0.4rem' }}>
                  <input type="checkbox" checked={waiverApproved} onChange={(e) => setWaiverApproved(e.target.checked)} />
                  Signed accessible equivalent in place
                </label>
                <textarea style={{ ...input(), minHeight: 60 }} value={waiverNote}
                  onChange={(e) => setWaiverNote(e.target.value)}
                  placeholder="Rationale (at least 20 characters) — what the accessible equivalent is and why it is equivalent" />
                <div style={{ marginTop: '0.4rem' }}>
                  <button style={btn()} disabled={busy !== null}
                    onClick={() => void act('set_accessible_equivalent', {
                      accessibleEquivalentApproved: waiverApproved,
                      accessibleEquivalentNote: waiverNote,
                    })}>
                    {busy === 'set_accessible_equivalent' ? 'Saving…' : 'Save waiver'}
                  </button>
                </div>
              </div>
            ) : null}

            <strong style={{ fontSize: '0.82rem' }}>Teaching media</strong>
            {detail.data.media.length === 0 ? <p style={{ fontSize: '0.8rem', color: colors.muted }}>No assets recorded.</p> : (
              <div style={{ overflowX: 'auto', marginTop: '0.3rem' }}>
                <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: 760 }}>
                  <thead><tr>
                    <th style={th()}>Asset</th><th style={th()}>Type</th><th style={th()}>Required</th>
                    <th style={th()}>State</th><th style={th()}>Rights</th><th style={th()}>Accessibility</th>
                    <th style={th()}>Blockers</th>
                  </tr></thead>
                  <tbody>
                    {detail.data.media.map((m) => (
                      <tr key={m.asset_id}>
                        <td style={td()}><code>{m.asset_id}</code>{m.instructions ? <div style={{ fontSize: '0.72rem', color: colors.muted }}>{m.instructions}</div> : null}</td>
                        <td style={td()}>{m.media_type}</td>
                        <td style={td()}>{m.required ? 'yes' : 'no'}</td>
                        <td style={td()}>{m.production_state}</td>
                        <td style={td()}>{m.rights_status}</td>
                        <td style={td()}>{m.accessibility_status}</td>
                        <td style={{ ...td(), color: m.blockers.length ? colors.danger : colors.success }}>
                          {m.blockers.length ? m.blockers.join(' · ') : 'ready'}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}

            {detail.data.holds.length > 0 ? (
              <div style={{ marginTop: '0.75rem' }}>
                <strong style={{ fontSize: '0.82rem' }}>Holds</strong>
                <ul style={{ margin: '0.3rem 0 0', paddingLeft: '1.1rem', fontSize: '0.8rem' }}>
                  {detail.data.holds.map((h) => (
                    <li key={h.id}>
                      {h.holdType} · {h.status} · {h.reason}
                    </li>
                  ))}
                </ul>
              </div>
            ) : null}

            <details style={{ marginTop: '0.75rem' }}>
              <summary style={{ cursor: 'pointer', fontSize: '0.82rem', fontWeight: 600 }}>Academic audit trail</summary>
              <ul style={{ margin: '0.3rem 0 0', paddingLeft: '1.1rem', fontSize: '0.78rem', color: colors.muted }}>
                {detail.data.audit.length === 0 ? <li>No actions recorded yet.</li> : detail.data.audit.map((a, i) => (
                  <li key={i}>{fmtDate(a.createdAt)} · {a.action} · {a.actorRole} — {a.reason}</li>
                ))}
              </ul>
            </details>
          </>
        ) : null}
      </StateBlock>
    </Card>
  );
}

// ── Curriculum import ───────────────────────────────────────────────────────

function ImportPanel({ onNotice }: NoticeProp) {
  const [preview, setPreview] = useState<svc.CurriculumImportPreview | null>(null);
  const [busy, setBusy] = useState<null | 'preview' | 'commit'>(null);
  const [error, setError] = useState<string | null>(null);

  const runPreview = async () => {
    setBusy('preview'); setError(null);
    try { setPreview(await svc.previewCurriculumPack()); }
    catch (e) { setError(e instanceof Error ? e.message : String(e)); setPreview(null); }
    finally { setBusy(null); }
  };

  const runCommit = async () => {
    if (!window.confirm(
      'Import the bundled TMFA curriculum pack as DRAFTS?\n\nThis never approves a question and never publishes a topic. Re-running is idempotent; approved or retired questions are left untouched.',
    )) return;
    setBusy('commit'); setError(null);
    try {
      const r = await svc.importCurriculumPack();
      onNotice(
        `Imported ${r.topics.inserted} new topic(s), ${r.topics.updated} updated` +
        `${r.topics.returnedToReview ? `, ${r.topics.returnedToReview} returned to review` : ''}; ` +
        `${r.questions.inserted} question(s) inserted, ${r.questions.updated} updated, ` +
        `${r.questions.locked} locked (already reviewed).`,
      );
      setPreview(null);
    } catch (e) { setError(e instanceof Error ? e.message : String(e)); }
    finally { setBusy(null); }
  };

  return (
    <Card title="Bundled TMFA curriculum pack" right={
      <span style={{ fontSize: '0.75rem', color: colors.muted }}>13 courses · 72 topics · 336 draft questions</span>
    }>
      {error ? <p style={{ color: colors.danger, fontSize: '0.85rem' }}>{error}</p> : null}
      <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap' }}>
        <button style={btn()} disabled={busy !== null} onClick={() => void runPreview()}>
          {busy === 'preview' ? 'Building preview…' : 'Preview import plan'}
        </button>
        <button style={btnPrimary()} disabled={busy !== null} onClick={() => void runCommit()}>
          {busy === 'commit' ? 'Importing…' : 'Import as drafts'}
        </button>
      </div>

      {preview ? (
        <div style={{ marginTop: '0.9rem' }}>
          <div style={{ display: 'flex', gap: '0.75rem', flexWrap: 'wrap', marginBottom: '0.75rem' }}>
            <Kpi label="Courses" value={String(preview.courseCount)} />
            <Kpi label="Topics" value={String(preview.topicCount)} />
            <Kpi label="Media records" value={String(preview.mediaCount)} />
            <Kpi label="Questions" value={String(preview.questionCount)} accent={colors.success} />
            <Kpi label="Rejected rows" value={String(preview.rejectedQuestionCount)}
              accent={preview.rejectedQuestionCount ? colors.danger : colors.muted} />
          </div>
          <div style={{ fontSize: '0.75rem', color: colors.muted, marginBottom: '0.6rem' }}>
            Version <code>{preview.version}</code> · source hash <code>{preview.sourceHash.slice(0, 12)}…</code>
          </div>

          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: 620 }}>
              <thead><tr><th style={th()}>Course</th><th style={th()}>Kind</th><th style={th()}>Stage</th><th style={th()}>Topics</th></tr></thead>
              <tbody>
                {preview.courses.map((c) => (
                  <tr key={c.courseId}>
                    <td style={td()}>{c.title} <span style={{ color: colors.muted }}>({c.courseId})</span></td>
                    <td style={td()}>{c.kind}</td>
                    <td style={td()}>{c.stageLabel}</td>
                    <td style={td()}>{c.topicCount}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {preview.rejectedQuestions.length > 0 ? (
            <details style={{ marginTop: '0.6rem' }}>
              <summary style={{ cursor: 'pointer', fontSize: '0.82rem' }}>
                {preview.rejectedQuestionCount} rejected question row(s) — first {preview.rejectedQuestions.length}
              </summary>
              <ul style={{ fontSize: '0.78rem', color: colors.danger }}>
                {preview.rejectedQuestions.map((p, i) => <li key={i}>Row {p.row}: {p.code} — {p.message}</li>)}
              </ul>
            </details>
          ) : null}
          {preview.warnings.length > 0 ? (
            <details style={{ marginTop: '0.6rem' }}>
              <summary style={{ cursor: 'pointer', fontSize: '0.82rem' }}>{preview.warnings.length} warning(s)</summary>
              <ul style={{ fontSize: '0.78rem', color: colors.muted }}>
                {preview.warnings.map((w, i) => <li key={i}>{w}</li>)}
              </ul>
            </details>
          ) : null}
        </div>
      ) : null}

      <AuditNote>
        The preview is built by the server from the bundled pack and writes nothing. Commit re-builds the same plan
        and is idempotent on stable IDs: identical content is unchanged, changed drafts are updated, and a topic
        that was already approved or published is returned to review (and unpublished) rather than silently altered.
        Media records import as PLANNED with rights NOT_REVIEWED — a row is not evidence that a file exists.
      </AuditNote>
    </Card>
  );
}

// ── Media production queue ──────────────────────────────────────────────────

function MediaPanel({ onNotice, initialTopicId }: NoticeProp & { initialTopicId: string | null }) {
  const [topicId, setTopicId] = useState(initialTopicId ?? '');
  const [productionState, setProductionState] = useState('');
  const [rightsStatus, setRightsStatus] = useState('');
  const [accessibilityStatus, setAccessibilityStatus] = useState('');
  const [page, setPage] = useState(1);
  const [selected, setSelected] = useState<svc.AdminMediaRow | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const list = useAsync(
    () => svc.listAdminMedia({
      topicId: topicId || undefined,
      productionState: productionState || undefined,
      rightsStatus: rightsStatus || undefined,
      accessibilityStatus: accessibilityStatus || undefined,
      page, pageSize: 25,
    }),
    [topicId, productionState, rightsStatus, accessibilityStatus, page],
  );

  const rows = list.data?.media ?? [];
  const summary = list.data?.summary ?? {};

  const save = async () => {
    if (!selected) return;
    setBusy(true); setError(null);
    try {
      const r = await svc.updateAdminMedia(selected.asset_id, {
        productionState: selected.production_state,
        rightsStatus: selected.rights_status,
        accessibilityStatus: selected.accessibility_status,
        instructions: selected.instructions,
        owner: selected.owner,
        mediaUrl: selected.media_url,
        thumbnailUrl: selected.thumbnail_url,
        captionsUrl: selected.captions_url,
        transcript: selected.transcript,
        altText: selected.alt_text,
      });
      onNotice(
        r.published
          ? `Asset ${selected.asset_id} is publishable.`
          : `Saved. Remaining blockers: ${r.blockers.join(' · ') || 'none'}.`,
      );
      if (r.topicUnpublished) onNotice(`Saved — the topic was auto-unpublished because a required asset regressed.`);
      setSelected({ ...selected, blockers: r.blockers });
      await list.reload();
    } catch (e) { setError(e instanceof Error ? e.message : String(e)); }
    finally { setBusy(false); }
  };

  return (
    <>
      <Card title="Media production queue" right={
        <span style={{ fontSize: '0.75rem', color: colors.muted }}>
          {Object.entries(summary).filter(([k]) => k !== 'total').map(([k, v]) => `${k}: ${v}`).join(' · ') || 'no assets yet'}
        </span>
      }>
        <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap', alignItems: 'flex-end', marginBottom: '0.75rem' }}>
          <div style={{ minWidth: 220 }}>
            <label style={label()}>Topic ID</label>
            <input style={input()} value={topicId} onChange={(e) => { setPage(1); setTopicId(e.target.value.trim()); }} placeholder="e.g. A01-T3" />
          </div>
          <div>
            <label style={label()}>Production</label>
            <select style={select()} value={productionState} onChange={(e) => { setPage(1); setProductionState(e.target.value); }}>
              <option value="">Any</option>
              {PRODUCTION_STATES.map((s) => <option key={s} value={s}>{s}</option>)}
            </select>
          </div>
          <div>
            <label style={label()}>Rights</label>
            <select style={select()} value={rightsStatus} onChange={(e) => { setPage(1); setRightsStatus(e.target.value); }}>
              <option value="">Any</option>
              {RIGHTS_STATUSES.map((s) => <option key={s} value={s}>{s}</option>)}
            </select>
          </div>
          <div>
            <label style={label()}>Accessibility</label>
            <select style={select()} value={accessibilityStatus} onChange={(e) => { setPage(1); setAccessibilityStatus(e.target.value); }}>
              <option value="">Any</option>
              {ACCESSIBILITY_STATUSES.map((s) => <option key={s} value={s}>{s}</option>)}
            </select>
          </div>
        </div>

        <StateBlock loading={list.loading} error={list.error} empty={rows.length === 0}
          emptyText="No teaching assets match. Import the curriculum pack to create the planned records.">
          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: 920 }}>
              <thead><tr>
                <th style={th()}>Asset</th><th style={th()}>Topic</th><th style={th()}>Type</th>
                <th style={th()}>Required</th><th style={th()}>Production</th><th style={th()}>Rights</th>
                <th style={th()}>Accessibility</th><th style={th()}>Blockers</th><th style={th()} />
              </tr></thead>
              <tbody>
                {rows.map((m) => (
                  <tr key={m.asset_id}>
                    <td style={td()}><code>{m.asset_id}</code></td>
                    <td style={td()}>{m.topicTitle}<div style={{ fontSize: '0.72rem', color: colors.muted }}>{m.topic_id}</div></td>
                    <td style={td()}>{m.media_type}</td>
                    <td style={td()}>{m.required ? 'yes' : 'no'}</td>
                    <td style={td()}>{m.production_state}</td>
                    <td style={td()}>{m.rights_status}</td>
                    <td style={td()}>{m.accessibility_status}</td>
                    <td style={{ ...td(), color: m.blockers.length ? colors.danger : colors.success }}>
                      {m.blockers.length ? m.blockers.join(' · ') : 'ready'}
                    </td>
                    <td style={td()}>
                      <button style={btn()} onClick={() => { setSelected(m); setError(null); }}>Edit</button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div style={{ display: 'flex', gap: '0.5rem', justifyContent: 'flex-end', marginTop: '0.6rem' }}>
            <button style={btn()} disabled={page <= 1} onClick={() => setPage((p) => Math.max(1, p - 1))}>Previous</button>
            <span style={{ fontSize: '0.78rem', color: colors.muted, alignSelf: 'center' }}>Page {page}</span>
            <button style={btn()} disabled={!list.data?.hasMore} onClick={() => setPage((p) => p + 1)}>Next</button>
          </div>
        </StateBlock>
      </Card>

      {selected ? (
        <Card title={`Edit asset — ${selected.asset_id}`} right={
          <button style={btn()} onClick={() => setSelected(null)}>Close</button>
        }>
          {error ? <p style={{ color: colors.danger, fontSize: '0.85rem' }}>{error}</p> : null}
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(220px,1fr))', gap: '0.75rem' }}>
            <div>
              <label style={label()}>Production state</label>
              <select style={select()} value={selected.production_state}
                onChange={(e) => setSelected({ ...selected, production_state: e.target.value })}>
                {PRODUCTION_STATES.map((s) => <option key={s} value={s}>{s}</option>)}
              </select>
            </div>
            <div>
              <label style={label()}>Rights</label>
              <select style={select()} value={selected.rights_status}
                onChange={(e) => setSelected({ ...selected, rights_status: e.target.value })}>
                {RIGHTS_STATUSES.map((s) => <option key={s} value={s}>{s}</option>)}
              </select>
            </div>
            <div>
              <label style={label()}>Accessibility</label>
              <select style={select()} value={selected.accessibility_status}
                onChange={(e) => setSelected({ ...selected, accessibility_status: e.target.value })}>
                {ACCESSIBILITY_STATUSES.map((s) => <option key={s} value={s}>{s}</option>)}
              </select>
            </div>
            <div>
              <label style={label()}>File URL (required for AV/image)</label>
              <input style={input()} value={selected.media_url}
                onChange={(e) => setSelected({ ...selected, media_url: e.target.value })} placeholder="https://…" />
            </div>
            <div>
              <label style={label()}>Thumbnail URL</label>
              <input style={input()} value={selected.thumbnail_url}
                onChange={(e) => setSelected({ ...selected, thumbnail_url: e.target.value })} />
            </div>
            <div>
              <label style={label()}>Captions URL</label>
              <input style={input()} value={selected.captions_url}
                onChange={(e) => setSelected({ ...selected, captions_url: e.target.value })} />
            </div>
            <div>
              <label style={label()}>Owner</label>
              <input style={input()} value={selected.owner}
                onChange={(e) => setSelected({ ...selected, owner: e.target.value })} />
            </div>
            <div style={{ gridColumn: '1 / -1' }}>
              <label style={label()}>Instructions</label>
              <input style={input()} value={selected.instructions}
                onChange={(e) => setSelected({ ...selected, instructions: e.target.value })} />
            </div>
            <div style={{ gridColumn: '1 / -1' }}>
              <label style={label()}>Transcript (required for audio; captions substitute for video)</label>
              <textarea style={{ ...input(), minHeight: 70 }} value={selected.transcript}
                onChange={(e) => setSelected({ ...selected, transcript: e.target.value })} />
            </div>
            <div style={{ gridColumn: '1 / -1' }}>
              <label style={label()}>Alt text (required for photo/diagram)</label>
              <textarea style={{ ...input(), minHeight: 50 }} value={selected.alt_text}
                onChange={(e) => setSelected({ ...selected, alt_text: e.target.value })} />
            </div>
          </div>
          <div style={{ marginTop: '0.75rem', display: 'flex', gap: '0.5rem', alignItems: 'center' }}>
            <button style={btnPrimary()} disabled={busy} onClick={() => void save()}>
              {busy ? 'Saving…' : 'Save asset'}
            </button>
            <span style={{ fontSize: '0.78rem', color: selected.blockers.length ? colors.danger : colors.success }}>
              {selected.blockers.length ? `Blockers: ${selected.blockers.join(' · ')}` : 'Publishable'}
            </span>
          </div>
          <AuditNote>
            Publishing an asset requires production PUBLISHED, rights CLEARED, accessibility PASSED, a real file
            URL for audiovisual/image assets, and the type-specific accessibility field (captions or transcript
            for video, transcript for audio, alt text for images). If a mandatory asset regresses, the topic is
            automatically unpublished so learners are never sent to a broken lesson.
          </AuditNote>
        </Card>
      ) : null}
    </>
  );
}

// ── Holds ───────────────────────────────────────────────────────────────────

function HoldsPanel({ onNotice }: NoticeProp) {
  const [status, setStatus] = useState('open');
  const [page, setPage] = useState(1);
  const [note, setNote] = useState('');
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [newHold, setNewHold] = useState({ enrollmentId: '', topicId: '', holdType: 'PRACTICAL_FAILED', reason: '' });
  const [creating, setCreating] = useState(false);

  const list = useAsync(
    () => svc.listAdminHolds({ status: status || undefined, page, pageSize: 25 }),
    [status, page],
  );
  const rows = list.data?.holds ?? [];

  const clear = async (id: string) => {
    if (!window.confirm('Clear this academic hold? If it was the last open hold and the quiz was passed, the learner becomes MASTERED and the next topic unlocks.')) return;
    setBusyId(id); setError(null);
    try {
      const r = await svc.clearAdminHold(id, note);
      onNotice(`Hold cleared. Mastery state: ${r.masteryState || 'unchanged'}.`);
      setNote('');
      await list.reload();
    } catch (e) { setError(e instanceof Error ? e.message : String(e)); }
    finally { setBusyId(null); }
  };

  const create = async () => {
    if (!newHold.enrollmentId.trim() || !newHold.topicId.trim() || !newHold.reason.trim()) {
      setError('Enrollment ID, topic ID and a reason are required.');
      return;
    }
    setCreating(true); setError(null);
    try {
      await svc.createAdminHold({
        enrollmentId: newHold.enrollmentId.trim(),
        topicId: newHold.topicId.trim(),
        holdType: newHold.holdType,
        reason: newHold.reason.trim(),
      });
      onNotice('Hold created. A passing quiz on this topic is now capped at PASSED until the hold is cleared.');
      setNewHold({ enrollmentId: '', topicId: '', holdType: 'PRACTICAL_FAILED', reason: '' });
      await list.reload();
    } catch (e) { setError(e instanceof Error ? e.message : String(e)); }
    finally { setCreating(false); }
  };

  return (
    <>
      <Card title="Create an academic hold" right={
        <span style={{ fontSize: '0.75rem', color: colors.muted }}>scores:manage</span>
      }>
        {error ? <p style={{ color: colors.danger, fontSize: '0.85rem' }}>{error}</p> : null}
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(200px,1fr))', gap: '0.75rem' }}>
          <div>
            <label style={label()}>Enrollment ID</label>
            <input style={input()} value={newHold.enrollmentId}
              onChange={(e) => setNewHold({ ...newHold, enrollmentId: e.target.value })} placeholder="UUID" />
          </div>
          <div>
            <label style={label()}>Topic ID</label>
            <input style={input()} value={newHold.topicId}
              onChange={(e) => setNewHold({ ...newHold, topicId: e.target.value })} placeholder="e.g. A01-T3" />
          </div>
          <div>
            <label style={label()}>Hold type</label>
            <select style={select()} value={newHold.holdType}
              onChange={(e) => setNewHold({ ...newHold, holdType: e.target.value })}>
              {HOLD_TYPES.map((h) => <option key={h} value={h}>{h}</option>)}
            </select>
          </div>
          <div style={{ gridColumn: '1 / -1' }}>
            <label style={label()}>Reason (visible to the learner)</label>
            <input style={input()} value={newHold.reason}
              onChange={(e) => setNewHold({ ...newHold, reason: e.target.value })}
              placeholder="e.g. Practical assessment not yet submitted" />
          </div>
        </div>
        <div style={{ marginTop: '0.75rem' }}>
          <button style={btnPrimary()} disabled={creating} onClick={() => void create()}>
            {creating ? 'Creating…' : 'Create hold'}
          </button>
        </div>
        <AuditNote>
          A hold is independent of the quiz score: it caps a passing result at PASSED and keeps the next topic
          locked until every open hold on the topic is cleared. Every creation and clearance is written to the
          academic audit trail.
        </AuditNote>
      </Card>

      <Card title="Holds">
        <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap', alignItems: 'flex-end', marginBottom: '0.75rem' }}>
          <div>
            <label style={label()}>Status</label>
            <select style={select()} value={status} onChange={(e) => { setPage(1); setStatus(e.target.value); }}>
              <option value="">All</option><option value="open">Open</option><option value="cleared">Cleared</option>
            </select>
          </div>
          <div style={{ flex: 1, minWidth: 240 }}>
            <label style={label()}>Clearance note (applied to the hold you clear)</label>
            <input style={input()} value={note} onChange={(e) => setNote(e.target.value)}
              placeholder="e.g. Practical re-submitted and marked" />
          </div>
        </div>

        <StateBlock loading={list.loading} error={list.error} empty={rows.length === 0}
          emptyText="No holds match this filter.">
          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: 920 }}>
              <thead><tr>
                <th style={th()}>Learner</th><th style={th()}>Topic</th><th style={th()}>Type</th>
                <th style={th()}>Reason</th><th style={th()}>Opened</th><th style={th()}>Status</th><th style={th()} />
              </tr></thead>
              <tbody>
                {rows.map((h) => (
                  <tr key={h.id}>
                    <td style={td()}>
                      {h.learnerName || '—'}<div style={{ fontSize: '0.72rem', color: colors.muted }}>{h.learnerEmail}</div>
                      <div style={{ fontSize: '0.68rem', color: colors.muted }}>enrolment {h.enrollmentId.slice(0, 8)}…</div>
                    </td>
                    <td style={td()}>{h.topicTitle}<div style={{ fontSize: '0.72rem', color: colors.muted }}>{h.topicId}</div></td>
                    <td style={td()}>{h.holdType}</td>
                    <td style={td()}>{h.reason}</td>
                    <td style={td()}>{fmtDate(h.createdAt)}</td>
                    <td style={td()}><Badge status={h.status === 'open' ? 'blocked' : 'resolved'} label={h.status} /></td>
                    <td style={td()}>
                      {h.status === 'open' ? (
                        <button style={btnDanger()} disabled={busyId === h.id} onClick={() => void clear(h.id)}>
                          {busyId === h.id ? 'Clearing…' : 'Clear'}
                        </button>
                      ) : (
                        <span style={{ fontSize: '0.75rem', color: colors.muted }}>{h.clearanceNote || 'cleared'}</span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div style={{ display: 'flex', gap: '0.5rem', justifyContent: 'flex-end', marginTop: '0.6rem' }}>
            <button style={btn()} disabled={page <= 1} onClick={() => setPage((p) => Math.max(1, p - 1))}>Previous</button>
            <span style={{ fontSize: '0.78rem', color: colors.muted, alignSelf: 'center' }}>Page {page}</span>
            <button style={btn()} disabled={!list.data?.hasMore} onClick={() => setPage((p) => p + 1)}>Next</button>
          </div>
        </StateBlock>
      </Card>
    </>
  );
}

// ── Candidate mastery ───────────────────────────────────────────────────────

function MasteryPanel({ onNotice }: NoticeProp) {
  const [qInput, setQInput] = useState('');
  const [q, setQ] = useState('');
  const [page, setPage] = useState(1);
  const [busy, setBusy] = useState<string | null>(null);
  const list = useAsync(() => svc.listCandidateMastery({ q: q || undefined, page, pageSize: 25 }), [q, page]);
  const rows = list.data?.candidates ?? [];

  const issue = async (enrollmentId: string) => {
    setBusy(enrollmentId);
    try {
      const r = await svc.mutateCertificate({ action: 'issue', enrollmentId });
      onNotice(
        r.created === false
          ? `Credential ${r.certificate.certificateNumber} was already issued.`
          : `Credential ${r.certificate.certificateNumber} issued after re-checking every topic and hold.`,
      );
      await list.reload();
    } catch (e) { alert(e instanceof Error ? e.message : String(e)); }
    finally { setBusy(null); }
  };

  const revoke = async (certificateId: string) => {
    const reason = window.prompt(
      'Reason for revoking this credential. It is written to the academic audit trail and shown to verifiers:',
    );
    if (!reason || reason.trim().length < 5) return;
    setBusy(certificateId);
    try {
      await svc.mutateCertificate({ action: 'revoke', certificateId, reason: reason.trim() });
      onNotice('Credential revoked. The registry now reports it as revoked rather than missing.');
      await list.reload();
    } catch (e) { alert(e instanceof Error ? e.message : String(e)); }
    finally { setBusy(null); }
  };

  return (
    <Card title="Candidate mastery and credentials" right={
      <span style={{ fontSize: '0.75rem', color: colors.muted }}>
        Reads the film_topic_mastery ledger — the same source the learner path uses.
      </span>
    }>
      <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap', alignItems: 'flex-end', marginBottom: '0.75rem' }}>
        <div style={{ minWidth: 260, flex: 1 }}>
          <label style={label()}>Search candidate</label>
          <input style={input()} value={qInput} onChange={(e) => setQInput(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter') { setPage(1); setQ(qInput.trim()); } }}
            placeholder="Name or email" />
        </div>
        <button style={btnPrimary()} onClick={() => { setPage(1); setQ(qInput.trim()); }}>Search</button>
      </div>

      <StateBlock loading={list.loading} error={list.error} empty={rows.length === 0}
        emptyText="No enrolled candidates yet.">
        <div style={{ overflowX: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: 1120 }}>
            <thead><tr>
              <th style={th()}>Learner</th><th style={th()}>Cohort</th><th style={th()}>Stage</th>
              <th style={th()}>Topics touched</th><th style={th()}>Mastered</th>
              <th style={th()}>Published</th>
              <th style={th()}>Passed with hold</th><th style={th()}>Remediation</th><th style={th()}>Open holds</th>
              <th style={th()}>Credential</th><th style={th()} />
            </tr></thead>
            <tbody>
              {rows.map((c) => {
                const eligible = c.topicsRequired > 0
                  && c.topicsPublished >= c.topicsRequired
                  && c.mastered >= c.topicsRequired
                  && c.openHolds === 0;
                const cert = c.certificate;
                const active = cert && cert.status === 'issued' && !cert.revokedAt;
                return (
                  <tr key={c.enrollmentId}>
                    <td style={td()}>
                      {c.learnerName || '—'}
                      <div style={{ fontSize: '0.72rem', color: colors.muted }}>{c.learnerEmail}</div>
                    </td>
                    <td style={td()}>{c.batchName || '—'}</td>
                    <td style={td()}>{c.currentStage}</td>
                    <td style={td()}>{c.topicsTouched}</td>
                    <td style={{ ...td(), color: colors.success, fontWeight: 600 }}>
                      {c.mastered} / {c.topicsRequired}
                    </td>
                    <td style={{ ...td(), color: c.topicsPublished < c.topicsRequired ? colors.warning : undefined }}>
                      {c.topicsPublished} / {c.topicsRequired}
                    </td>
                    <td style={{ ...td(), color: c.passedWithHold ? colors.warning : undefined }}>{c.passedWithHold}</td>
                    <td style={{ ...td(), color: c.remediation ? colors.danger : undefined }}>{c.remediation}</td>
                    <td style={{ ...td(), color: c.openHolds ? colors.danger : undefined }}>{c.openHolds}</td>
                    <td style={td()}>
                      {active ? (
                        <>
                          <Badge status="approved" label="issued" />
                          <div style={{ fontSize: '0.72rem', color: colors.muted }}>{cert.certificateNumber}</div>
                        </>
                      ) : cert?.revokedAt ? (
                        <>
                          <Badge status="failed" label="revoked" />
                          <div style={{ fontSize: '0.72rem', color: colors.muted }}>{cert.certificateNumber}</div>
                        </>
                      ) : eligible ? (
                        <Badge status="ready" label="eligible" />
                      ) : (
                        <Badge status="blocked" label="not eligible" />
                      )}
                    </td>
                    <td style={{ ...td(), whiteSpace: 'nowrap' }}>
                      {active ? (
                        <button style={btnDanger()} disabled={busy === cert.id}
                          onClick={() => void revoke(cert.id)}>
                          {busy === cert.id ? 'Revoking…' : 'Revoke'}
                        </button>
                      ) : eligible ? (
                        <button style={btnPrimary()} disabled={busy === c.enrollmentId}
                          onClick={() => void issue(c.enrollmentId)}>
                          {busy === c.enrollmentId ? 'Issuing…' : cert ? 'Reissue' : 'Issue'}
                        </button>
                      ) : (
                        <span style={{ fontSize: '0.72rem', color: colors.muted }}>
                          Every topic must be published and mastered, with no open holds.
                        </span>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        <div style={{ display: 'flex', gap: '0.5rem', justifyContent: 'flex-end', marginTop: '0.6rem' }}>
          <button style={btn()} disabled={page <= 1} onClick={() => setPage((p) => Math.max(1, p - 1))}>Previous</button>
          <span style={{ fontSize: '0.78rem', color: colors.muted, alignSelf: 'center' }}>Page {page}</span>
          <button style={btn()} disabled={!list.data?.hasMore} onClick={() => setPage((p) => p + 1)}>Next</button>
        </div>
      </StateBlock>
      <AuditNote>
        A credential is issued only when every curriculum topic is published, MASTERED at the exact 85% gate
        and free of open holds — the issue button re-derives all three on the server. With the bundled pack
        imported as drafts, no candidate can be eligible until faculty publish and learners complete the curriculum.
        Revocation keeps the registry entry resolvable and is fully audited.
      </AuditNote>
    </Card>
  );
}
