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
type SubTab = 'gates' | 'import' | 'pool' | 'media' | 'holds' | 'practical' | 'mastery' | 'pilot';

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
  { key: 'pool', label: 'Question pool', hint: 'Topic-targeted draft import and every topic’s approved gap' },
  { key: 'media', label: 'Media production', hint: 'Files, rights and accessibility — a record is not a produced asset' },
  { key: 'holds', label: 'Academic holds', hint: 'Practical/safety/review holds that block mastery' },
  { key: 'practical', label: 'Practical assessments', hint: 'Author the rubric and grade submitted practical work' },
  { key: 'mastery', label: 'Candidate mastery', hint: 'Mastered, passed-with-hold and remediation counts per learner' },
  { key: 'pilot', label: 'Pilot delivery', hint: 'Open one unreviewed course for real learners — audited, never available in production' },
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
      {sub === 'pool' ? <QuestionPoolPanel onNotice={onNotice} /> : null}
      {sub === 'media' ? <MediaPanel onNotice={onNotice} initialTopicId={mediaTopic} /> : null}
      {sub === 'holds' ? <HoldsPanel onNotice={onNotice} /> : null}
      {sub === 'practical' ? <PracticalPanel onNotice={onNotice} /> : null}
      {sub === 'mastery' ? <MasteryPanel onNotice={onNotice} /> : null}
      {sub === 'pilot' ? <PilotPanel onNotice={onNotice} /> : null}
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
  const [exporting, setExporting] = useState(false);

  const list = useAsync(
    () => svc.listAdminTopics({
      q: q || undefined,
      ready: ready === '' ? undefined : ready === 'true',
      published: published === '' ? undefined : published === 'true',
      page, pageSize: 25,
    }),
    [q, ready, published, page],
  );

  const exportReadiness = async () => {
    setExporting(true);
    try {
      const file = await svc.exportTopicReadiness();
      downloadCsvFile(file.filename, file.csv);
      onNotice('Readiness CSV downloaded — one row per topic with the server-evaluated gate.');
    } catch (e) {
      alert(e instanceof Error ? e.message : String(e));
    } finally {
      setExporting(false);
    }
  };

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
          <button style={btn()} disabled={exporting} onClick={() => void exportReadiness()}>
            {exporting ? 'Exporting…' : 'Download readiness CSV'}
          </button>
        </div>

        {s ? (
          <div style={{ display: 'flex', gap: '0.75rem', flexWrap: 'wrap', marginBottom: '0.75rem' }}>
            <Kpi label="Topics" value={String(s.total)} />
            <Kpi label="Ready" value={String(s.ready)} accent={colors.success} />
            <Kpi label="Blocked" value={String(s.blocked)} accent={s.blocked ? colors.warning : colors.muted} />
            <Kpi label="Published" value={String(s.published)} />
            <Kpi label="Articles at depth" value={`${s.articlesAtDepth}/${s.total}`}
              accent={s.articlesAtDepth === s.total ? colors.success : colors.warning} />
            <Kpi label="Approved questions" value={`${s.approvedQuestionTotal}/${s.requiredQuestionTotal}`}
              accent={s.approvedQuestionTotal >= s.requiredQuestionTotal ? colors.success : colors.warning} />
            <Kpi label="Media ready" value={`${s.publishedMediaTotal}/${s.requiredMediaTotal}`}
              accent={s.publishedMediaTotal >= s.requiredMediaTotal ? colors.success : colors.warning} />
            <Kpi label="Signed waivers" value={String(s.waivedTopics)} />
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
                    <td style={td()}>
                      <Badge status={t.contentStatus} />
                      <div style={{ fontSize: '0.72rem', color: t.article.meetsDepthStandard ? colors.success : colors.danger }}>
                        {t.article.words.toLocaleString()} words · {t.article.meetsDepthStandard ? 'depth met' : 'below depth'}
                      </div>
                    </td>
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
          The import creates drafts only. Approval and publication require an article that meets the article
          depth standard — at least 1,000 words and four sections, including a practical/application heading
          and a self-check/assessment heading — as well as every required asset being PUBLISHED with rights
          CLEARED and accessibility PASSED (or a signed text-equivalent waiver), and at least 20 approved
          questions covering the draw. Saving changes to approved content returns it to review and unpublishes it.
        </AuditNote>
      </Card>

      {selected ? (
        <TopicDetailPanel
          key={selected}
          topicId={selected}
          onNotice={onNotice}
          onOpenMedia={onOpenMedia}
          onChanged={() => void list.reload()}
        />
      ) : null}
    </>
  );
}

type TopicDraft = {
  title: string;
  stage: string;
  stageLabel: string;
  article: string;
  outcomes: Array<{ objective_id: string; description: string }>;
  requiredMedia: string;
  prerequisites: string;
  quizMinimumPercent: string;
  drawCount: string;
  timeLimitMinutes: string;
};

const STAGE_OPTIONS = ['L0', 'L1', 'L2', 'L3', 'L4', 'L5'];

function splitList(value: string): string[] {
  return Array.from(new Set(value.split(/[\n,]/).map((v) => v.trim()).filter(Boolean)));
}

function integerField(raw: string, min: number, max: number, field: string): number {
  const value = Number(raw);
  if (!Number.isInteger(value) || value < min || value > max) {
    throw new Error(`${field} must be a whole number between ${min} and ${max}.`);
  }
  return value;
}

/** Advisory live count only; the server re-measures the saved article. */
function articleWordCount(value: string): number {
  return value
    .replace(/[#>*_`~]/g, ' ')
    .trim()
    .split(/\s+/)
    .filter((token) => /[A-Za-z0-9]/.test(token)).length;
}

function downloadCsvFile(filename: string, csv: string) {
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function readTextFile(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result ?? ''));
    reader.onerror = () => reject(new Error('Could not read that file.'));
    reader.readAsText(file);
  });
}

function TopicDetailPanel({
  topicId, onNotice, onOpenMedia, onChanged,
}: NoticeProp & { topicId: string; onOpenMedia: (topicId: string) => void; onChanged: () => void }) {
  const detail = useAsync(() => svc.getAdminTopic(topicId), [topicId]);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [waiverApproved, setWaiverApproved] = useState(false);
  const [waiverNote, setWaiverNote] = useState('');
  const [draft, setDraft] = useState<TopicDraft | null>(null);

  useEffect(() => {
    setWaiverApproved(detail.data?.accessibleEquivalent.approved ?? false);
    setWaiverNote(detail.data?.accessibleEquivalent.note ?? '');
  }, [detail.data]);

  useEffect(() => {
    if (!detail.data) return;
    setDraft({
      title: detail.data.topic.title,
      stage: detail.data.topic.stage,
      stageLabel: detail.data.topic.stageLabel,
      article: detail.data.article,
      outcomes: detail.data.outcomes.map((o) => ({ ...o })),
      requiredMedia: detail.data.requiredMedia.join('\n'),
      prerequisites: detail.data.prerequisites.join('\n'),
      quizMinimumPercent: String(detail.data.topic.quizMinimumPercent),
      drawCount: String(detail.data.topic.drawCount),
      timeLimitMinutes: String(detail.data.topic.timeLimitMinutes),
    });
  }, [detail.data]);

  const patchDraft = (patch: Partial<TopicDraft>) => {
    setDraft((prev) => (prev ? { ...prev, ...patch } : prev));
  };

  const updateOutcome = (index: number, patch: Partial<TopicDraft['outcomes'][number]>) => {
    setDraft((prev) => (prev
      ? { ...prev, outcomes: prev.outcomes.map((o, i) => (i === index ? { ...o, ...patch } : o)) }
      : prev));
  };

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

  const saveDraft = async () => {
    if (!draft) return;
    setError(null);
    const outcomes = draft.outcomes
      .map((o) => ({ objective_id: o.objective_id.trim(), description: o.description.trim() }))
      .filter((o) => o.objective_id || o.description);
    if (outcomes.some((o) => !o.objective_id || !o.description)) {
      setError('Each learning outcome needs both an ID and a description (or remove the empty row).');
      return;
    }
    try {
      await act('save', {
        title: draft.title.trim(),
        stage: draft.stage,
        stageLabel: draft.stageLabel.trim(),
        lessonMarkdown: draft.article,
        learningOutcomes: outcomes,
        requiredMedia: splitList(draft.requiredMedia),
        prerequisites: splitList(draft.prerequisites),
        quizMinimumPercent: integerField(draft.quizMinimumPercent, 85, 100, 'Pass mark'),
        quizDrawCount: integerField(draft.drawCount, 1, 50, 'Questions to draw'),
        quizTimeLimitMinutes: integerField(draft.timeLimitMinutes, 1, 180, 'Time limit'),
      });
    } catch (e) { setError(e instanceof Error ? e.message : String(e)); }
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
              <Kpi label="Article depth" value={`${t.article.words.toLocaleString()} / 1,000 words`}
                accent={t.article.meetsDepthStandard ? colors.success : colors.danger} />
              <Kpi label="Approved questions" value={`${detail.data.topic.questionCounts.approved} / ${Math.max(20, t.drawCount)}`} />
              <Kpi label="Required media live" value={`${detail.data.topic.media.published} / ${detail.data.topic.media.required}`} />
              <Kpi label="Learners mastered" value={String(detail.data.mastery.mastered)} accent={colors.success} />
              <Kpi label="In remediation" value={String(detail.data.mastery.remediation)} accent={detail.data.mastery.remediation ? colors.warning : colors.muted} />
              <Kpi label="Attempts" value={`${detail.data.attempts.scored} scored / ${detail.data.attempts.inProgress} open`} />
            </div>

            <div style={{ fontSize: '0.75rem', color: t.article.meetsDepthStandard ? colors.success : colors.danger, marginBottom: '0.75rem' }}>
              {t.article.sections} section heading{t.article.sections === 1 ? '' : 's'} · practical{' '}
              {t.article.hasPractical ? 'present' : 'missing'} · self-check {t.article.hasSelfCheck ? 'present' : 'missing'}.
              {' '}The server requires at least 1,000 words, four headings, a practical/application heading and a
              self-check/assessment heading before review or approval.
            </div>

            <div style={{ fontSize: '0.75rem', color: colors.muted, marginBottom: '0.75rem' }}>
              Approve this topic&apos;s pool in <strong>Question Bank</strong>, filtered by topic ID <code>{t.topicId}</code>.
              Publication needs at least <strong>{Math.max(20, t.drawCount)}</strong> approved items.
            </div>

            <details style={{ marginBottom: '0.75rem' }}>
              <summary style={{ cursor: 'pointer', fontSize: '0.85rem', fontWeight: 600 }}>
                Teaching article ({detail.data.article.length.toLocaleString()} characters · {t.article.words.toLocaleString()} words)
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

            {draft ? (
              <details style={{ marginBottom: '0.75rem' }}>
                <summary style={{ cursor: 'pointer', fontSize: '0.85rem', fontWeight: 600 }}>
                  Edit teaching content and quiz settings (programs:manage)
                </summary>
                <div style={{ border: `1px solid ${colors.border}`, borderRadius: '0.5rem', padding: '0.75rem', marginTop: '0.5rem' }}>
                  <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(200px,1fr))', gap: '0.75rem' }}>
                    <div>
                      <label style={label()}>Title</label>
                      <input style={input()} value={draft.title} onChange={(e) => patchDraft({ title: e.target.value })} />
                    </div>
                    <div>
                      <label style={label()}>Stage</label>
                      <select style={select()} value={draft.stage} onChange={(e) => patchDraft({ stage: e.target.value })}>
                        {STAGE_OPTIONS.map((s) => <option key={s} value={s}>{s}</option>)}
                      </select>
                    </div>
                    <div>
                      <label style={label()}>Stage label</label>
                      <input style={input()} value={draft.stageLabel} onChange={(e) => patchDraft({ stageLabel: e.target.value })} />
                    </div>
                  </div>

                  <div style={{ marginTop: '0.6rem' }}>
                    <label style={label()}>Teaching article (markdown)</label>
                    <textarea style={{ ...input(), minHeight: 220, fontFamily: 'monospace' }} value={draft.article}
                      onChange={(e) => patchDraft({ article: e.target.value })} />
                    <div style={{ fontSize: '0.72rem', color: articleWordCount(draft.article) < 1000 ? colors.danger : colors.muted }}>
                      {draft.article.trim().length.toLocaleString()} characters · {articleWordCount(draft.article).toLocaleString()} words (live count).
                      The server requires at least 1,000 words and four headings, including a practical/application
                      heading and a self-check/assessment heading before review or approval. Drafts can be saved below
                      that floor.
                    </div>
                  </div>

                  <div style={{ marginTop: '0.6rem' }}>
                    <label style={label()}>Learning outcomes</label>
                    {draft.outcomes.length === 0 ? (
                      <p style={{ fontSize: '0.78rem', color: colors.muted, margin: '0.2rem 0' }}>
                        No outcomes yet — at least one is required before review.
                      </p>
                    ) : null}
                    {draft.outcomes.map((o, index) => (
                      <div key={index} style={{ display: 'flex', gap: '0.4rem', marginBottom: '0.35rem', flexWrap: 'wrap' }}>
                        <input style={{ ...input(), maxWidth: 150 }} value={o.objective_id} placeholder="OBJ-ID"
                          onChange={(e) => updateOutcome(index, { objective_id: e.target.value })} />
                        <input style={{ ...input(), flex: 1, minWidth: 220 }} value={o.description} placeholder="What the learner can do"
                          onChange={(e) => updateOutcome(index, { description: e.target.value })} />
                        <button style={btn()}
                          onClick={() => patchDraft({ outcomes: draft.outcomes.filter((_, i) => i !== index) })}>
                          Remove
                        </button>
                      </div>
                    ))}
                    <button style={btn()}
                      onClick={() => patchDraft({ outcomes: [...draft.outcomes, { objective_id: '', description: '' }] })}>
                      Add outcome
                    </button>
                  </div>

                  <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(240px,1fr))', gap: '0.75rem', marginTop: '0.6rem' }}>
                    <div>
                      <label style={label()}>Required media (one type per line)</label>
                      <textarea style={{ ...input(), minHeight: 80 }} value={draft.requiredMedia}
                        onChange={(e) => patchDraft({ requiredMedia: e.target.value })}
                        placeholder={'teaching_video\nphoto_or_diagram'} />
                    </div>
                    <div>
                      <label style={label()}>Prerequisites (one topic ID per line)</label>
                      <textarea style={{ ...input(), minHeight: 80 }} value={draft.prerequisites}
                        onChange={(e) => patchDraft({ prerequisites: e.target.value })}
                        placeholder="e.g. A01-T2" />
                    </div>
                  </div>

                  <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(180px,1fr))', gap: '0.75rem', marginTop: '0.6rem' }}>
                    <div>
                      <label style={label()}>Pass mark (%)</label>
                      <input style={input()} type="number" min={85} max={100} value={draft.quizMinimumPercent}
                        onChange={(e) => patchDraft({ quizMinimumPercent: e.target.value })} />
                    </div>
                    <div>
                      <label style={label()}>Questions to draw</label>
                      <input style={input()} type="number" min={1} max={50} value={draft.drawCount}
                        onChange={(e) => patchDraft({ drawCount: e.target.value })} />
                    </div>
                    <div>
                      <label style={label()}>Time limit (minutes)</label>
                      <input style={input()} type="number" min={1} max={180} value={draft.timeLimitMinutes}
                        onChange={(e) => patchDraft({ timeLimitMinutes: e.target.value })} />
                    </div>
                  </div>

                  <div style={{ marginTop: '0.75rem', display: 'flex', gap: '0.5rem', alignItems: 'center', flexWrap: 'wrap' }}>
                    <button style={btnPrimary()} disabled={busy !== null} onClick={() => void saveDraft()}>
                      {busy === 'save' ? 'Saving…' : 'Save topic content'}
                    </button>
                    {t.contentStatus !== 'draft' ? (
                      <span style={{ fontSize: '0.75rem', color: colors.warning }}>
                        Saving content returns this topic to review and unpublishes it.
                      </span>
                    ) : null}
                  </div>
                </div>
              </details>
            ) : null}

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

// ── Topic question authoring ────────────────────────────────────────────────

function QuestionPoolPanel({ onNotice }: NoticeProp) {
  const context = useAsync(() => svc.getTopicQuestionAuthoringContext(), []);
  const [filename, setFilename] = useState('tmfa-topic-questions.csv');
  const [csv, setCsv] = useState('');
  const [preview, setPreview] = useState<svc.TopicQuestionPreview | null>(null);
  const [busy, setBusy] = useState<null | 'preview' | 'commit'>(null);
  const [error, setError] = useState<string | null>(null);

  const topics = context.data?.topics ?? [];
  const approvedTotal = topics.reduce((sum, t) => sum + t.approved, 0);
  const requiredTotal = topics.reduce((sum, t) => sum + t.required, 0);
  const draftTotal = topics.reduce((sum, t) => sum + t.draft, 0);
  const belowGate = topics.filter((t) => t.shortfall > 0).length;
  const impactedTopics = (preview?.topics ?? []).filter((t) => t.submitted > 0);
  const previewBelowGate = (preview?.topics ?? []).filter((t) => t.shortfall > 0).length;

  const onPick = async (file: File | undefined) => {
    if (!file) return;
    setFilename(file.name);
    setError(null);
    try {
      setCsv(await readTextFile(file));
      setPreview(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  };

  const runPreview = async () => {
    if (!csv.trim()) {
      setError('Choose a CSV file (or paste its text) first.');
      return;
    }
    setBusy('preview');
    setError(null);
    try {
      setPreview(await svc.previewTopicQuestionImport(csv));
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setPreview(null);
    } finally {
      setBusy(null);
    }
  };

  const runCommit = async () => {
    if (!csv.trim() || !preview) return;
    if (!window.confirm(
      `Import ${preview.totals.accepted} valid row(s) as DRAFT topic questions?\n\n`
      + 'This never approves a question and never publishes a topic. Reviewed, module-coded or '
      + 'differently-assigned items are left untouched. Every imported row still needs SME approval '
      + 'before it can be drawn.',
    )) return;
    setBusy('commit');
    setError(null);
    try {
      const r = await svc.commitTopicQuestionImport(filename, csv);
      onNotice(
        `Imported ${r.inserted} new draft(s), updated ${r.updated}, unchanged ${r.unchanged}; `
        + `${r.locked} locked and ${r.rejected.length} rejected. Drafts still require SME approval.`,
      );
      setPreview(null);
      await context.reload();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(null);
    }
  };

  const downloadTemplate = () => {
    if (!context.data) return;
    downloadCsvFile(context.data.templateFilename, `${context.data.headers.join(',')}\r\n`);
  };

  return (
    <>
      <Card title="Topic question pool" right={
        <span style={{ fontSize: '0.75rem', color: colors.muted }}>
          A draft is not an approved question; only SME review makes an item drawable.
        </span>
      }>
        <StateBlock loading={context.loading} error={context.error} empty={topics.length === 0}
          emptyText="Import the curriculum pack first — there are no topics to attach questions to.">
          <div style={{ display: 'flex', gap: '0.75rem', flexWrap: 'wrap', marginBottom: '0.75rem' }}>
            <Kpi label="Topics" value={String(topics.length)} />
            <Kpi label="Approved items" value={`${approvedTotal}/${requiredTotal}`}
              accent={approvedTotal >= requiredTotal ? colors.success : colors.warning} />
            <Kpi label="Drafts waiting review" value={String(draftTotal)}
              accent={draftTotal > 0 ? colors.warning : colors.muted} />
            <Kpi label="Topics below gate" value={String(belowGate)}
              accent={belowGate > 0 ? colors.danger : colors.success} />
          </div>

          <details>
            <summary style={{ cursor: 'pointer', fontSize: '0.85rem', fontWeight: 600 }}>
              Per-topic approved gap ({belowGate} below the gate)
            </summary>
            <div style={{ maxHeight: 360, overflow: 'auto', marginTop: '0.4rem' }}>
              <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: 760 }}>
                <thead><tr>
                  <th style={th()}>Topic</th><th style={th()}>Stage</th>
                  <th style={th()}>Approved / required</th><th style={th()}>Draft</th>
                  <th style={th()}>Review</th><th style={th()}>Shortfall</th>
                </tr></thead>
                <tbody>
                  {[...topics]
                    .sort((a, b) => b.shortfall - a.shortfall || a.topicId.localeCompare(b.topicId))
                    .map((t) => (
                      <tr key={t.topicId}>
                        <td style={td()}>
                          {t.title}
                          <div style={{ fontSize: '0.72rem', color: colors.muted }}>{t.topicId}</div>
                        </td>
                        <td style={td()}>{t.stage}</td>
                        <td style={td()}>
                          <strong style={{ color: t.approved >= t.required ? colors.success : colors.danger }}>
                            {t.approved}
                          </strong>
                          {' / '}{t.required}
                        </td>
                        <td style={td()}>{t.draft}</td>
                        <td style={td()}>{t.review}</td>
                        <td style={{ ...td(), color: t.shortfall > 0 ? colors.danger : colors.success }}>
                          {t.shortfall}
                        </td>
                      </tr>
                    ))}
                </tbody>
              </table>
            </div>
          </details>
        </StateBlock>
        <AuditNote>
          The required target is the larger of 20 and the topic&apos;s quiz draw. Imported rows are drafts and
          do not reduce the shortfall until an SME approves them in Question Bank. A topic cannot publish while
          its approved pool is below the target, regardless of how many drafts exist.
        </AuditNote>
      </Card>

      <Card title="Import topic-targeted drafts" right={
        <span style={{ fontSize: '0.75rem', color: colors.muted }}>CSV · drafts only · never auto-approves</span>
      }>
        <div style={{ display: 'flex', gap: '0.75rem', flexWrap: 'wrap', alignItems: 'center', marginBottom: '0.75rem' }}>
          <input type="file" accept=".csv,text/csv" onChange={(e) => void onPick(e.target.files?.[0])} />
          <input style={{ ...input(), maxWidth: 280 }} value={filename} aria-label="filename"
            onChange={(e) => setFilename(e.target.value)} />
          <button style={btn()} disabled={!context.data} onClick={downloadTemplate}>Download headers</button>
        </div>
        {context.data ? (
          <div style={{ fontSize: '0.72rem', color: colors.muted, marginBottom: '0.5rem' }}>
            Required columns: <code>{context.data.headers.join(', ')}</code>
          </div>
        ) : null}
        <textarea
          style={{ ...input(), minHeight: 120, fontFamily: 'ui-monospace, monospace', fontSize: '0.75rem', whiteSpace: 'pre' }}
          value={csv}
          onChange={(e) => { setCsv(e.target.value); setPreview(null); }}
          placeholder="…or paste the CSV text here"
        />
        {error ? <p style={{ color: colors.danger, fontSize: '0.85rem' }}>{error}</p> : null}
        <div style={{ display: 'flex', gap: '0.5rem', marginTop: '0.75rem', flexWrap: 'wrap' }}>
          <button style={btn()} disabled={busy !== null || !csv.trim()} onClick={() => void runPreview()}>
            {busy === 'preview' ? 'Previewing…' : 'Preview'}
          </button>
          <button style={btnPrimary()}
            disabled={busy !== null || !preview || preview.totals.accepted === 0}
            onClick={() => void runCommit()}>
            {busy === 'commit' ? 'Importing…' : 'Commit as drafts'}
          </button>
        </div>
        <AuditNote>
          The preview is read-only. Commit re-validates the CSV on the server: accepted rows are inserted or
          updated as DRAFT with their topic and objective binding. Reviewed items, module-coded items and items
          already bound to another topic are locked and reported, never rewritten. Import cannot approve,
          retire or publish a question.
        </AuditNote>
      </Card>

      {preview ? (
        <Card title="Import preview" right={
          <span style={{ fontSize: '0.75rem', color: colors.muted }}>
            {previewBelowGate} topic(s) remain below the approved gate.
          </span>
        }>
          <div style={{ display: 'flex', gap: '0.9rem', flexWrap: 'wrap', marginBottom: '0.75rem' }}>
            <Kpi label="Rows" value={String(preview.totals.rows)} />
            <Kpi label="Valid" value={String(preview.totals.accepted)} accent={colors.success} />
            <Kpi label="Would insert" value={String(preview.totals.wouldInsert)} accent={colors.success} />
            <Kpi label="Would update" value={String(preview.totals.wouldUpdate)} />
            <Kpi label="Unchanged" value={String(preview.totals.unchanged)} accent={colors.muted} />
            <Kpi label="Locked" value={String(preview.totals.locked)}
              accent={preview.totals.locked ? colors.warning : colors.muted} />
            <Kpi label="Rejected" value={String(preview.totals.rejected)}
              accent={preview.totals.rejected ? colors.danger : colors.muted} />
          </div>

          {impactedTopics.length > 0 ? (
            <div style={{ overflowX: 'auto', marginBottom: '0.75rem' }}>
              <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: 680 }}>
                <thead><tr>
                  <th style={th()}>Topic</th><th style={th()}>Rows in file</th>
                  <th style={th()}>Approved / required</th><th style={th()}>Drafts before → after</th>
                  <th style={th()}>Shortfall after</th>
                </tr></thead>
                <tbody>
                  {impactedTopics.map((t) => (
                    <tr key={t.topicId}>
                      <td style={td()}>
                        {t.title}
                        <div style={{ fontSize: '0.72rem', color: colors.muted }}>{t.topicId}</div>
                      </td>
                      <td style={td()}>{t.submitted}</td>
                      <td style={td()}>
                        <span style={{ color: t.approved >= t.required ? colors.success : colors.danger, fontWeight: 600 }}>
                          {t.approved}
                        </span>
                        {' / '}{t.required}
                      </td>
                      <td style={td()}>{t.draft} → {t.draftAfter}</td>
                      <td style={{ ...td(), color: t.shortfall > 0 ? colors.danger : colors.success }}>
                        {t.shortfall}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : null}

          {preview.rejected.length > 0 ? (
            <>
              <h3 style={{ fontSize: '0.85rem', margin: '0.5rem 0' }}>Rejected rows (fix &amp; re-import)</h3>
              <div style={{ overflowX: 'auto' }}>
                <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: 620 }}>
                  <thead><tr><th style={th()}>Row</th><th style={th()}>Question ID</th><th style={th()}>Problem</th></tr></thead>
                  <tbody>
                    {preview.rejected.map((p, i) => (
                      <tr key={i}>
                        <td style={td()}>{p.row}</td>
                        <td style={td()}>{p.externalCode ?? '—'}</td>
                        <td style={td()}>{p.code} — {p.message}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </>
          ) : null}

          {preview.blocked.length > 0 ? (
            <>
              <h3 style={{ fontSize: '0.85rem', margin: '0.75rem 0 0.5rem' }}>Locked rows (not imported)</h3>
              <div style={{ overflowX: 'auto' }}>
                <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: 620 }}>
                  <thead><tr><th style={th()}>Row</th><th style={th()}>Question ID</th><th style={th()}>Why it is locked</th></tr></thead>
                  <tbody>
                    {preview.blocked.map((p, i) => (
                      <tr key={i}>
                        <td style={td()}>{p.row}</td>
                        <td style={td()}>{p.externalCode ?? '—'}</td>
                        <td style={td()}>{p.code} — {p.message}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </>
          ) : null}

          {preview.warnings.length > 0 ? (
            <details style={{ marginTop: '0.75rem' }}>
              <summary style={{ fontSize: '0.82rem', cursor: 'pointer' }}>{preview.warnings.length} warning(s)</summary>
              <ul style={{ fontSize: '0.78rem', color: colors.muted }}>
                {preview.warnings.map((w, i) => <li key={i}>{w}</li>)}
              </ul>
            </details>
          ) : null}
        </Card>
      ) : null}
    </>
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

// ── Practical assessments ───────────────────────────────────────────────────

type PracticalDraft = {
  title: string;
  briefMarkdown: string;
  submissionInstructions: string;
  rubric: svc.AdminPracticalRubricCriterion[];
  passPercent: number;
  maxAttempts: number;
  active: boolean;
};

function newCriterionId(): string {
  return `criterion-${Math.random().toString(36).slice(2, 8)}`;
}

function emptyPracticalDraft(): PracticalDraft {
  return {
    title: '',
    briefMarkdown: '',
    submissionInstructions: '',
    rubric: [
      { id: newCriterionId(), label: 'Craft and execution', description: '', maxPoints: 50 },
      { id: newCriterionId(), label: 'Story and intent', description: '', maxPoints: 50 },
    ],
    passPercent: 85,
    maxAttempts: 3,
    active: false,
  };
}

function PracticalPanel({ onNotice }: NoticeProp) {
  const [assessments, setAssessments] = useState<svc.AdminPracticalAssessment[]>([]);
  const [totals, setTotals] = useState({ draft: 0, submitted: 0, graded: 0, passed: 0 });
  const [listLoading, setListLoading] = useState(true);
  const [listError, setListError] = useState<string | null>(null);

  const reloadList = useCallback(async () => {
    setListLoading(true);
    setListError(null);
    try {
      const r = await svc.listPracticalAssessments();
      setAssessments(r.assessments);
      setTotals(r.totals);
    } catch (e) {
      setListError(e instanceof Error ? e.message : String(e));
    } finally {
      setListLoading(false);
    }
  }, []);

  useEffect(() => { void reloadList(); }, [reloadList]);

  const [topicLookup, setTopicLookup] = useState('');
  const [context, setContext] = useState<Awaited<ReturnType<typeof svc.getPracticalAssessment>> | null>(null);
  const [form, setForm] = useState<PracticalDraft>(emptyPracticalDraft);
  const [loadingTopic, setLoadingTopic] = useState(false);
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

  const load = useCallback(async (rawId: string) => {
    const topicId = rawId.trim();
    if (!topicId) return;
    setLoadingTopic(true);
    setFormError(null);
    try {
      const r = await svc.getPracticalAssessment(topicId);
      setContext(r);
      setTopicLookup(topicId);
      setForm(r.assessment
        ? {
            title: r.assessment.title,
            briefMarkdown: r.assessment.briefMarkdown,
            submissionInstructions: r.assessment.submissionInstructions,
            rubric: r.assessment.rubric.map((criterion) => ({ ...criterion })),
            passPercent: r.assessment.passPercent,
            maxAttempts: r.assessment.maxAttempts,
            active: r.assessment.active,
          }
        : emptyPracticalDraft());
    } catch (e) {
      setContext(null);
      setFormError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoadingTopic(false);
    }
  }, []);

  const updateCriterion = (index: number, patch: Partial<svc.AdminPracticalRubricCriterion>) => {
    setForm((current) => ({
      ...current,
      rubric: current.rubric.map((criterion, i) => (i === index ? { ...criterion, ...patch } : criterion)),
    }));
  };

  const addCriterion = () => {
    setForm((current) => current.rubric.length >= 10
      ? current
      : {
          ...current,
          rubric: [
            ...current.rubric,
            { id: newCriterionId(), label: '', description: '', maxPoints: 20 },
          ],
        });
  };

  const removeCriterion = (index: number) => {
    setForm((current) => ({
      ...current,
      rubric: current.rubric.filter((_, i) => i !== index),
    }));
  };

  const save = async () => {
    if (!context) return;
    if (form.active && context.assessment?.active !== true) {
      const ok = window.confirm(
        'Opening the practical gate immediately opens a PRACTICAL_PENDING hold for every learner who has passed this quiz but not the practical. Their state moves from MASTERED to PASSED until they pass. Continue?',
      );
      if (!ok) return;
    }
    setSaving(true);
    setFormError(null);
    try {
      const r = await svc.savePracticalAssessment(context.topic.topicId, form);
      const gate = r.gateChanged === 'activated'
        ? ` Gate opened — ${r.holdsOpened} practical hold(s) opened for learners who already passed the quiz.`
        : r.gateChanged === 'deactivated'
          ? ` Gate withdrawn — ${r.holdsCleared} practical hold(s) cleared and earned mastery restored.`
          : '';
      onNotice(`Practical assessment saved.${gate}`);
      setContext({ ...context, assessment: r.assessment });
      setForm((current) => ({ ...current, active: r.assessment.active }));
      await reloadList();
    } catch (e) {
      setFormError(e instanceof Error ? e.message : String(e));
    } finally {
      setSaving(false);
    }
  };

  const [queueStatus, setQueueStatus] = useState('submitted');
  const [queueTopic, setQueueTopic] = useState('');
  const [topicFilterInput, setTopicFilterInput] = useState('');
  const [queuePage, setQueuePage] = useState(1);
  const [reviewId, setReviewId] = useState<string | null>(null);

  const queue = useAsync(
    () => svc.listPracticalQueue({
      status: queueStatus || undefined,
      topicId: queueTopic || undefined,
      page: queuePage,
      pageSize: 20,
    }),
    [queueStatus, queueTopic, queuePage],
  );
  const queueRows = queue.data?.submissions ?? [];

  const focusQueue = (topicId: string) => {
    setQueueStatus('submitted');
    setQueueTopic(topicId);
    setTopicFilterInput(topicId);
    setQueuePage(1);
  };

  const afterGrade = async () => {
    await queue.reload();
    await reloadList();
  };

  const rubricTotal = form.rubric.reduce((sum, criterion) => sum + (Number(criterion.maxPoints) || 0), 0);

  return (
    <>
      <Card title="Configured practical assessments" right={
        <span style={{ fontSize: '0.75rem', color: colors.muted }}>
          {totals.submitted} awaiting review · {totals.passed} passed
        </span>
      }>
        <StateBlock
          loading={listLoading}
          error={listError}
          empty={assessments.length === 0}
          emptyText="No practical assessment is configured yet. Load a topic below to author the first one."
        >
          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: 900 }}>
              <thead><tr>
                <th style={th()}>Topic</th><th style={th()}>Assessment</th><th style={th()}>Gate</th>
                <th style={th()}>Pass</th><th style={th()}>Attempts</th><th style={th()}>Queue</th>
                <th style={th()}>Updated</th><th style={th()} />
              </tr></thead>
              <tbody>
                {assessments.map((assessment) => (
                  <tr key={assessment.id}>
                    <td style={td()}>
                      {assessment.topicTitle}
                      <div style={{ fontSize: '0.72rem', color: colors.muted }}>{assessment.topicId}</div>
                      {!assessment.topicPublished && (
                        <div style={{ fontSize: '0.68rem', color: colors.warning }}>topic not published</div>
                      )}
                    </td>
                    <td style={td()}>{assessment.title}</td>
                    <td style={td()}>
                      <Badge
                        status={assessment.active ? 'active' : 'draft'}
                        label={assessment.active ? 'Open' : 'Draft'}
                      />
                    </td>
                    <td style={td()}>{assessment.passPercent}%</td>
                    <td style={td()}>{assessment.maxAttempts}</td>
                    <td style={td()}>
                      {assessment.counts.submitted} to mark
                      <div style={{ fontSize: '0.72rem', color: colors.muted }}>
                        {assessment.counts.graded} graded · {assessment.counts.passed} passed
                      </div>
                    </td>
                    <td style={td()}>{assessment.updatedAt ? fmtDate(assessment.updatedAt) : '—'}</td>
                    <td style={{ ...td(), whiteSpace: 'nowrap' }}>
                      <button style={btn()} onClick={() => void load(assessment.topicId)}>Configure</button>{' '}
                      <button style={btn()} onClick={() => focusQueue(assessment.topicId)}>Review</button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </StateBlock>
      </Card>

      <Card title="Author an assessment" right={
        <span style={{ fontSize: '0.75rem', color: colors.muted }}>programs:manage</span>
      }>
        <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'flex-end', flexWrap: 'wrap', marginBottom: '0.75rem' }}>
          <div style={{ flex: 1, minWidth: 240 }}>
            <label style={label()}>Topic ID</label>
            <input
              style={input()}
              value={topicLookup}
              onChange={(e) => setTopicLookup(e.target.value)}
              placeholder="e.g. A01-T3"
            />
          </div>
          <button style={btn()} disabled={loadingTopic} onClick={() => void load(topicLookup)}>
            {loadingTopic ? 'Loading…' : 'Load topic'}
          </button>
        </div>

        {!context ? (
          <p style={{ fontSize: '0.85rem', color: colors.muted }}>
            Load a topic to author or edit its practical assessment.
          </p>
        ) : (
          <>
            <p style={{ fontSize: '0.85rem', marginTop: 0 }}>
              <strong>{context.topic.title}</strong> · {context.topic.topicId} ·{' '}
              {context.topic.published ? 'published' : 'not published'}
            </p>
            {!context.topic.published && (
              <p style={{ color: colors.warning, fontSize: '0.82rem' }}>
                The topic is not published. Learners cannot see or submit this practical until the topic
                passes publication review; saving the assessment is still allowed.
              </p>
            )}
            {formError ? <p style={{ color: colors.danger, fontSize: '0.85rem' }}>{formError}</p> : null}

            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(180px,1fr))', gap: '0.75rem' }}>
              <div style={{ gridColumn: '1 / -1' }}>
                <label style={label()}>Title</label>
                <input
                  style={input()}
                  value={form.title}
                  onChange={(e) => setForm({ ...form, title: e.target.value })}
                  placeholder="e.g. Direct a two-minute dialogue scene"
                />
              </div>
              <div>
                <label style={label()}>Pass mark (%)</label>
                <input
                  style={input()}
                  type="number"
                  min={85}
                  max={100}
                  value={form.passPercent}
                  onChange={(e) => setForm({ ...form, passPercent: Number(e.target.value) })}
                />
              </div>
              <div>
                <label style={label()}>Attempts allowed</label>
                <input
                  style={input()}
                  type="number"
                  min={1}
                  max={10}
                  value={form.maxAttempts}
                  onChange={(e) => setForm({ ...form, maxAttempts: Number(e.target.value) })}
                />
              </div>
              <div style={{ display: 'flex', alignItems: 'flex-end', paddingBottom: '0.4rem' }}>
                <label style={{ display: 'flex', gap: '0.45rem', alignItems: 'center', fontSize: '0.85rem' }}>
                  <input
                    type="checkbox"
                    checked={form.active}
                    onChange={(e) => setForm({ ...form, active: e.target.checked })}
                  />
                  Open this practical to learners
                </label>
              </div>
            </div>

            <div style={{ marginTop: '0.75rem' }}>
              <label style={label()}>Brief (markdown, at least 20 characters)</label>
              <textarea
                style={{ ...input(), minHeight: 140, resize: 'vertical' }}
                value={form.briefMarkdown}
                onChange={(e) => setForm({ ...form, briefMarkdown: e.target.value })}
                placeholder="What the learner must produce, the constraints they must work within, and how to submit."
              />
            </div>

            <div style={{ marginTop: '0.75rem' }}>
              <label style={label()}>Submission instructions</label>
              <textarea
                style={{ ...input(), minHeight: 70, resize: 'vertical' }}
                value={form.submissionInstructions}
                onChange={(e) => setForm({ ...form, submissionInstructions: e.target.value })}
                placeholder="e.g. Paste an https link to your uploaded clip and name everyone in the credits."
              />
            </div>

            <div style={{ marginTop: '0.75rem' }}>
              <label style={label()}>Rubric · {form.rubric.length} criteria · {rubricTotal} points possible</label>
              <div style={{ overflowX: 'auto' }}>
                <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: 760 }}>
                  <thead><tr>
                    <th style={th()}>Criterion</th><th style={th()}>What good looks like</th>
                    <th style={th()}>Max points</th><th style={th()} />
                  </tr></thead>
                  <tbody>
                    {form.rubric.map((criterion, index) => (
                      <tr key={criterion.id}>
                        <td style={td()}>
                          <input
                            style={input()}
                            value={criterion.label}
                            onChange={(e) => updateCriterion(index, { label: e.target.value })}
                            placeholder="e.g. Camera coverage"
                          />
                        </td>
                        <td style={td()}>
                          <input
                            style={input()}
                            value={criterion.description}
                            onChange={(e) => updateCriterion(index, { description: e.target.value })}
                            placeholder="What the reviewer should look for"
                          />
                        </td>
                        <td style={td()}>
                          <input
                            style={{ ...input(), width: 90 }}
                            type="number"
                            min={1}
                            max={100}
                            value={criterion.maxPoints}
                            onChange={(e) => updateCriterion(index, { maxPoints: Number(e.target.value) })}
                          />
                        </td>
                        <td style={td()}>
                          <button
                            style={btnDanger()}
                            disabled={form.rubric.length <= 1}
                            onClick={() => removeCriterion(index)}
                          >
                            Remove
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <div style={{ marginTop: '0.5rem' }}>
                <button style={btn()} disabled={form.rubric.length >= 10} onClick={addCriterion}>
                  Add criterion
                </button>
              </div>
            </div>

            <div style={{ marginTop: '0.75rem' }}>
              <button style={btnPrimary()} disabled={saving} onClick={() => void save()}>
                {saving ? 'Saving…' : context.assessment ? 'Save assessment' : 'Create assessment'}
              </button>
            </div>
            <AuditNote>
              The rubric and pass mark are frozen onto each submission at submit time, so editing this
              rubric never re-grades history. Opening the gate is a learner-visible change: it opens
              PRACTICAL_PENDING holds for learners who already passed the quiz. Withdrawing it clears only
              holds created by this workflow and restores mastery that was already earned.
            </AuditNote>
          </>
        )}
      </Card>

      <Card title="Review queue" right={
        <span style={{ fontSize: '0.75rem', color: colors.muted }}>scores:manage</span>
      }>
        <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap', alignItems: 'flex-end', marginBottom: '0.75rem' }}>
          <div>
            <label style={label()}>Status</label>
            <select
              style={select()}
              value={queueStatus}
              onChange={(e) => { setQueuePage(1); setReviewId(null); setQueueStatus(e.target.value); }}
            >
              <option value="submitted">Submitted — awaiting review</option>
              <option value="graded">Graded</option>
              <option value="draft">Drafts (not submitted)</option>
              <option value="all">All</option>
            </select>
          </div>
          <div style={{ flex: 1, minWidth: 220 }}>
            <label style={label()}>Topic filter</label>
            <input
              style={input()}
              value={topicFilterInput}
              onChange={(e) => setTopicFilterInput(e.target.value)}
              placeholder="e.g. A01-T3 (blank = every topic)"
            />
          </div>
          <button
            style={btn()}
            onClick={() => { setQueuePage(1); setQueueTopic(topicFilterInput.trim()); }}
          >
            Apply
          </button>
          {queueTopic ? (
            <button
              style={btn()}
              onClick={() => { setQueuePage(1); setQueueTopic(''); setTopicFilterInput(''); }}
            >
              Clear topic
            </button>
          ) : null}
          <span style={{ fontSize: '0.78rem', color: colors.muted, alignSelf: 'center' }}>
            {queue.data?.pending ?? 0} awaiting review in total
          </span>
        </div>

        <StateBlock
          loading={queue.loading}
          error={queue.error}
          empty={queueRows.length === 0}
          emptyText="Nothing matches this queue filter."
        >
          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: 900 }}>
              <thead><tr>
                <th style={th()}>Learner</th><th style={th()}>Topic</th><th style={th()}>Attempt</th>
                <th style={th()}>Submitted</th><th style={th()}>Status</th><th style={th()}>Score</th>
                <th style={th()} />
              </tr></thead>
              <tbody>
                {queueRows.map((row) => (
                  <tr key={row.id}>
                    <td style={td()}>
                      {row.learnerName || '—'}
                      <div style={{ fontSize: '0.72rem', color: colors.muted }}>{row.learnerEmail}</div>
                    </td>
                    <td style={td()}>
                      {row.topicTitle}
                      <div style={{ fontSize: '0.72rem', color: colors.muted }}>{row.topicId}</div>
                    </td>
                    <td style={td()}>#{row.attemptNumber}</td>
                    <td style={td()}>{row.submittedAt ? fmtDate(row.submittedAt) : '—'}</td>
                    <td style={td()}>
                      <Badge
                        status={row.passed === true ? 'approved' : row.passed === false ? 'blocked' : row.status}
                        label={row.passed === true ? 'passed' : row.passed === false ? 'not passed' : row.status}
                      />
                    </td>
                    <td style={td()}>
                      {row.percentage === null ? '—' : `${Math.round(row.percentage)}%`}
                    </td>
                    <td style={td()}>
                      <button
                        style={row.status === 'submitted' ? btnPrimary() : btn()}
                        onClick={() => setReviewId(row.id)}
                      >
                        {row.status === 'submitted' ? 'Review' : 'Open'}
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div style={{ display: 'flex', gap: '0.5rem', justifyContent: 'flex-end', marginTop: '0.6rem' }}>
            <button style={btn()} disabled={queuePage <= 1} onClick={() => setQueuePage((p) => Math.max(1, p - 1))}>
              Previous
            </button>
            <span style={{ fontSize: '0.78rem', color: colors.muted, alignSelf: 'center' }}>Page {queuePage}</span>
            <button style={btn()} disabled={!queue.data?.hasMore} onClick={() => setQueuePage((p) => p + 1)}>
              Next
            </button>
          </div>
        </StateBlock>

        {reviewId ? (
          <PracticalReview
            submissionId={reviewId}
            onNotice={onNotice}
            onGraded={afterGrade}
          />
        ) : null}
      </Card>
    </>
  );
}

function PracticalReview({
  submissionId,
  onNotice,
  onGraded,
}: {
  submissionId: string;
  onNotice: NoticeProp['onNotice'];
  onGraded: () => Promise<void>;
}) {
  const detail = useAsync(() => svc.getPracticalSubmission(submissionId), [submissionId]);
  const submission = detail.data;
  const [scores, setScores] = useState<Record<string, { points: string; comment: string }>>({});
  const [feedback, setFeedback] = useState('');
  const [hydrated, setHydrated] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!submission || hydrated === submission.id) return;
    setHydrated(submission.id);
    const next: Record<string, { points: string; comment: string }> = {};
    for (const criterion of submission.rubricSnapshot) {
      const committed = submission.rubricScores.find((score) => score.criterionId === criterion.id);
      next[criterion.id] = {
        points: committed ? String(committed.points) : '',
        comment: committed?.comment ?? '',
      };
    }
    setScores(next);
    setFeedback(submission.feedback ?? '');
  }, [submission, hydrated]);

  if (detail.loading) return <p style={{ color: colors.muted }}>Loading submission…</p>;
  if (detail.error) return <p style={{ color: colors.danger }}>{detail.error}</p>;
  if (!submission) return null;

  const rubric = submission.rubricSnapshot;
  const possible = rubric.reduce((sum, criterion) => sum + criterion.maxPoints, 0);
  const earned = rubric.reduce(
    (sum, criterion) => sum + (Number(scores[criterion.id]?.points) || 0),
    0,
  );
  const allScored = rubric.every((criterion) => {
    const value = scores[criterion.id]?.points ?? '';
    return value !== '' && Number.isFinite(Number(value));
  });
  const previewPassed = possible > 0 && earned * 100 >= possible * submission.passThreshold;
  const editable = submission.status === 'submitted';

  const grade = async () => {
    if (!editable) return;
    if (!allScored) {
      setError('Score every rubric criterion before saving the grade.');
      return;
    }
    setSaving(true);
    setError(null);
    try {
      const r = await svc.gradePracticalSubmission(submission.id, {
        scores: rubric.map((criterion) => ({
          criterionId: criterion.id,
          points: Number(scores[criterion.id]?.points ?? 0),
          comment: scores[criterion.id]?.comment ?? '',
        })),
        feedback,
      });
      onNotice(
        `Practical graded as ${r.submission.passed ? 'passed' : 'not passed'}. Mastery: ${r.masteryState ?? 'unchanged'}.`
        + (r.holdEffect === 'skipped_inactive' ? ' The assessment is inactive, so the hold ledger was left untouched.' : ''),
      );
      setError(null);
      await detail.reload();
      await onGraded();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setSaving(false);
    }
  };

  return (
    <div style={{ border: `1px solid ${colors.border}`, borderRadius: '0.5rem', padding: '0.85rem', marginTop: '0.85rem', background: colors.card }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', gap: '0.5rem', flexWrap: 'wrap' }}>
        <div>
          <strong>{submission.learnerName || submission.learnerEmail || 'Learner'}</strong>
          <div style={{ fontSize: '0.78rem', color: colors.muted }}>
            {submission.topicTitle} · {submission.topicId} · attempt #{submission.attemptNumber} ·{' '}
            {submission.submittedAt ? `submitted ${fmtDate(submission.submittedAt)}` : 'not submitted'}
          </div>
        </div>
        <Badge
          status={submission.passed === true ? 'approved' : submission.passed === false ? 'blocked' : submission.status}
          label={submission.passed === true ? 'passed' : submission.passed === false ? 'not passed' : submission.status}
        />
      </div>

      {!submission.assessmentActive && (
        <p style={{ color: colors.warning, fontSize: '0.8rem' }}>
          This assessment is inactive. Grading is kept for the record, but it will not open or clear holds.
        </p>
      )}

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(280px,1fr))', gap: '0.75rem', marginTop: '0.6rem' }}>
        <div>
          <label style={label()}>Written work</label>
          <pre style={{
            whiteSpace: 'pre-wrap', margin: 0, padding: '0.6rem', borderRadius: '0.375rem',
            border: `1px solid ${colors.border}`, background: colors.card, fontSize: '0.82rem',
            maxHeight: 280, overflow: 'auto',
          }}>
            {submission.submissionText || '— none —'}
          </pre>
        </div>
        <div>
          <label style={label()}>Media link</label>
          {submission.mediaUrl && /^https?:\/\//i.test(submission.mediaUrl) ? (
            <p style={{ margin: '0 0 0.5rem', fontSize: '0.82rem' }}>
              <a href={submission.mediaUrl} target="_blank" rel="noopener noreferrer">Open submitted media</a>
            </p>
          ) : (
            <p style={{ margin: '0 0 0.5rem', fontSize: '0.82rem', color: colors.muted }}>No media link.</p>
          )}
          <label style={label()}>Learner's note</label>
          <p style={{ margin: 0, fontSize: '0.82rem' }}>{submission.mediaNote || '— none —'}</p>
        </div>
      </div>

      <div style={{ marginTop: '0.75rem' }}>
        <label style={label()}>
          Rubric · {earned} of {possible} points · pass mark {submission.passThreshold}%
        </label>
        <div style={{ overflowX: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: 720 }}>
            <thead><tr>
              <th style={th()}>Criterion</th><th style={th()}>Max</th><th style={th()}>Points</th>
              <th style={th()}>Comment</th>
            </tr></thead>
            <tbody>
              {rubric.map((criterion) => (
                <tr key={criterion.id}>
                  <td style={td()}>
                    {criterion.label}
                    {!!criterion.description && (
                      <div style={{ fontSize: '0.72rem', color: colors.muted }}>{criterion.description}</div>
                    )}
                  </td>
                  <td style={td()}>{criterion.maxPoints}</td>
                  <td style={td()}>
                    <input
                      style={{ ...input(), width: 90 }}
                      type="number"
                      min={0}
                      max={criterion.maxPoints}
                      disabled={!editable}
                      value={scores[criterion.id]?.points ?? ''}
                      onChange={(e) => setScores((current) => ({
                        ...current,
                        [criterion.id]: {
                          points: e.target.value,
                          comment: current[criterion.id]?.comment ?? '',
                        },
                      }))}
                    />
                  </td>
                  <td style={td()}>
                    <input
                      style={input()}
                      disabled={!editable}
                      value={scores[criterion.id]?.comment ?? ''}
                      onChange={(e) => setScores((current) => ({
                        ...current,
                        [criterion.id]: {
                          points: current[criterion.id]?.points ?? '',
                          comment: e.target.value,
                        },
                      }))}
                      placeholder="Optional note on this criterion"
                    />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p style={{ fontSize: '0.8rem', color: colors.muted, margin: '0.5rem 0 0' }}>
          Preview: {earned}/{possible} points — {previewPassed ? 'meets' : 'is below'} the{' '}
          {submission.passThreshold}% gate. The server recomputes the result from your criterion points.
        </p>
      </div>

      <div style={{ marginTop: '0.75rem' }}>
        <label style={label()}>Feedback to the learner</label>
        <textarea
          style={{ ...input(), minHeight: 90, resize: 'vertical' }}
          disabled={!editable}
          value={feedback}
          onChange={(e) => setFeedback(e.target.value)}
          placeholder="What worked, what to change, and what to do differently on the next attempt."
        />
        <p style={{ fontSize: '0.75rem', color: colors.muted, margin: '0.25rem 0 0' }}>
          A failed practical needs at least 10 characters of actionable feedback.
        </p>
      </div>

      {error ? <p style={{ color: colors.danger, fontSize: '0.85rem' }}>{error}</p> : null}

      {editable ? (
        <div style={{ marginTop: '0.6rem' }}>
          <button style={btnPrimary()} disabled={saving} onClick={() => void grade()}>
            {saving ? 'Saving grade…' : 'Save grade'}
          </button>
        </div>
      ) : (
        <p style={{ fontSize: '0.78rem', color: colors.muted, marginBottom: 0 }}>
          Graded {submission.gradedAt ? fmtDate(submission.gradedAt) : ''} · this record is final;
          a new learner attempt starts a new submission.
        </p>
      )}
    </div>
  );
}

// ── Pilot delivery ───────────────────────────────────────────────────────────
// The one sanctioned way to teach this curriculum before review. It is an audit
// trail, not a publish button: the server keeps every topic unpublished, keeps
// the prerequisite chain, the 85% threshold and holds intact, refuses this
// outright in production, and the learner app labels every such topic as pilot.

function PilotPanel({ onNotice }: NoticeProp) {
  const state = useAsync(() => svc.getPilotState(), []);
  const [target, setTarget] = useState<string | null>(null);
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const courses = state.data?.courses ?? [];
  const available = state.data?.available ?? false;
  const production = state.data?.production ?? false;
  const row = courses.find((c) => c.courseId === target) ?? null;

  const submit = async (action: 'enable' | 'revoke') => {
    if (!target) return;
    if (note.trim().length < 10) {
      setError('Give a reason of at least 10 characters — it is written to the academic audit trail.');
      return;
    }
    if (action === 'enable' && !window.confirm(
      `Open ${target} for pilot delivery?\n\nLearners will be taught from content that has NOT completed faculty or SME review. Nothing is published or approved, every screen says "Pilot delivery", and no certificate can be issued from it.`,
    )) return;

    setBusy(true); setError(null);
    try {
      const result = await svc.setCoursePilot(target, action, note.trim());
      onNotice(result.active
        ? `${result.courseId} is open for pilot delivery — ${result.entryTopicIds.length} entry topic(s) reachable for a new learner, the rest unlock at 85%.`
        : `${result.courseId} is back to its real publication state.`);
      setTarget(null); setNote('');
      await state.reload();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Card title="Pilot delivery" right={<span style={{ fontSize: '0.75rem', color: colors.muted }}>scores:manage</span>}>
      <p style={{ fontSize: '0.85rem', color: colors.muted, marginTop: 0 }}>
        Opens one course for real learners while its content is still unreviewed. It stands in for the
        published and reviewed-pool preconditions ONLY — prerequisites, the exact 85% pass threshold,
        academic holds and remediation keep working, so a learner still advances one topic at a time.
        Topics stay <strong>unpublished and unapproved</strong>, the learner app labels them, and a
        certificate cannot be issued from pilot work.
      </p>

      {!state.loading && !state.error && !available ? (
        <AuditNote>
          {production
            ? 'Disabled: pilot delivery is never available in production. Publish through faculty and SME review instead.'
            : 'Disabled: set FEATURE_FILM_ACADEMY_PILOT_DELIVERY_ENABLED=true on the API server to use it outside production.'}
        </AuditNote>
      ) : null}

      <StateBlock
        loading={state.loading}
        error={state.error}
        empty={courses.length === 0}
        emptyText="No courses yet. Import the curriculum pack first."
      >
        <table style={{ width: '100%', borderCollapse: 'collapse' }}>
          <thead>
            <tr>
              <th style={th()}>Course</th>
              <th style={th()}>Topics</th>
              <th style={th()}>Published</th>
              <th style={th()}>Entry topics</th>
              <th style={th()}>Pilot</th>
              <th style={th()} />
            </tr>
          </thead>
          <tbody>
            {courses.map((c) => (
              <tr key={c.courseId}>
                <td style={td()}>
                  <div style={{ fontWeight: 600 }}>{c.title}</div>
                  <div style={{ fontSize: '0.72rem', color: colors.muted }}>{c.courseId}</div>
                </td>
                <td style={td()}>{c.topicCount}</td>
                <td style={td()}>{c.publishedCount} / {c.topicCount}</td>
                <td style={td()}>
                  <div style={{ fontSize: '0.75rem' }}>{c.entryTopicIds.join(', ') || '—'}</div>
                </td>
                <td style={td()}>
                  {c.active
                    ? <Badge status="pending" label={`open · ${c.note ?? ''}`} />
                    : <Badge status="closed" label="closed" />}
                </td>
                <td style={td()}>
                  <button
                    style={available ? btn() : { ...btn(), opacity: 0.5, cursor: 'not-allowed' }}
                    disabled={!available}
                    onClick={() => { setTarget(c.courseId); setNote(c.note ?? ''); setError(null); }}
                  >
                    {c.active ? 'Close pilot' : 'Open for pilot'}
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </StateBlock>

      {row ? (
        <div style={{ marginTop: '1rem', borderTop: `1px solid ${colors.border}`, paddingTop: '0.75rem' }}>
          <label style={label()}>Reason for {row.courseId} ({row.active ? 'closing' : 'opening'}) the pilot</label>
          <textarea
            style={{ ...input(), minHeight: '4rem' }}
            value={note}
            onChange={(e) => setNote(e.target.value)}
            placeholder="e.g. Cohort 3 rehearsal pilot with two enrolled learners; faculty review scheduled for November."
          />
          {error ? <p style={{ color: colors.danger, fontSize: '0.8rem' }}>{error}</p> : null}
          <div style={{ display: 'flex', gap: '0.5rem', marginTop: '0.5rem' }}>
            <button
              style={row.active ? btnDanger() : btnPrimary()}
              disabled={busy}
              onClick={() => void submit(row.active ? 'revoke' : 'enable')}
            >
              {busy ? 'Saving…' : row.active ? 'Record close' : 'Record open'}
            </button>
            <button style={btn()} disabled={busy} onClick={() => { setTarget(null); setNote(''); setError(null); }}>
              Cancel
            </button>
          </div>
          <AuditNote>
            Both actions write a FILM_PILOT_UNLOCKED / FILM_PILOT_REVOKED row to film_academic_audit with your
            ID and this reason. They change no content status.
          </AuditNote>
        </div>
      ) : null}
    </Card>
  );
}
