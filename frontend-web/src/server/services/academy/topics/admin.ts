// Admin authoring, review, publication gates, media production and holds.
//
// Nothing here can bypass the academic rules:
//   - approval and publication are separate permissions/actions;
//   - publish re-evaluates the gate from persisted rows, never a client flag;
//   - a required media asset is only PUBLISHED with cleared rights, passed
//     accessibility and, for AV/image, an actual file URL;
//   - a published topic whose mandatory media regresses is auto-unpublished;
//   - holds block MASTERED independently of the quiz score.

import { createAdminClient } from '@/lib/supabase/server';
import { MEDIA_FILE_TYPES, evaluateTopicPublication, type PublicationBlocker, type PublicationVerdict, type TopicOutcome } from './types';

type Db = ReturnType<typeof createAdminClient>;

export const PRODUCTION_STATES = [
  'PLANNED',
  'SCRIPTED',
  'CAPTURED',
  'EDITED',
  'ACCESSIBILITY_REVIEW',
  'RIGHTS_REVIEW',
  'ACADEMIC_APPROVED',
  'PUBLISHED',
] as const;

export const RIGHTS_STATUSES = [
  'NOT_REVIEWED',
  'PENDING',
  'CLEARED',
  'RESTRICTED',
  'EXPIRED',
] as const;

export const ACCESSIBILITY_STATUSES = [
  'NOT_REVIEWED',
  'IN_PROGRESS',
  'PASSED',
  'FAILED',
  'NOT_APPLICABLE',
] as const;

export const HOLD_TYPES = [
  'PRACTICAL_FAILED',
  'PRACTICAL_PENDING',
  'SAFETY',
  'ATTENDANCE',
  'CONTENT_INCOMPLETE',
  'INSTRUCTOR_REVIEW',
  'ADMIN_REVIEW',
] as const;

export type ProductionState = (typeof PRODUCTION_STATES)[number];
export type RightsStatus = (typeof RIGHTS_STATUSES)[number];
export type AccessibilityStatus = (typeof ACCESSIBILITY_STATUSES)[number];
export type HoldType = (typeof HOLD_TYPES)[number];

export class TopicAdminError extends Error {
  status: number;
  code: string;
  blockers?: PublicationBlocker[];
  constructor(status: number, code: string, message: string, blockers?: PublicationBlocker[]) {
    super(message);
    this.status = status;
    this.code = code;
    this.blockers = blockers;
  }
}

/**
 * The API-key admin path has the synthetic actor `api-key`, which cannot be
 * written to a uuid column. Persist NULL for that path; the audit still records
 * actor_role and the action.
 */
export function asActorId(actorId: string): string | null {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(actorId)
    ? actorId
    : null;
}

interface TopicRow {
  topic_id: string;
  course_id: string;
  stage: string;
  stage_label: string;
  title: string;
  lesson_markdown: string;
  content_status: string;
  quiz_minimum_percent: number;
  quiz_draw_count: number;
  quiz_time_limit_minutes: number;
  media_status: string;
  learning_outcomes: TopicOutcome[];
  required_media: string[];
  prerequisites: string[];
  order_index: number;
  published: boolean;
  published_at: string | null;
  accessible_equivalent_approved: boolean;
  accessible_equivalent_note: string;
  source_hash: string | null;
  updated_at: string;
}

interface MediaRow {
  asset_id: string;
  topic_id: string;
  course_id: string;
  media_type: string;
  required: boolean;
  language: string;
  production_state: string;
  rights_status: string;
  accessibility_status: string;
  instructions: string;
  owner: string;
  media_url: string;
  thumbnail_url: string;
  captions_url: string;
  transcript: string;
  alt_text: string;
  expires_at: string | null;
  replacement_asset_id: string | null;
  updated_at: string;
}

interface QuestionStatusRow {
  film_topic_id: string | null;
  status: string;
}

export interface TopicQuestionCounts {
  draft: number;
  review: number;
  approved: number;
  retired: number;
  total: number;
}

export interface TopicMediaCounts {
  total: number;
  required: number;
  published: number;
  missingFile: number;
}

export interface AdminTopicRow {
  topicId: string;
  courseId: string;
  courseTitle: string;
  stage: string;
  stageLabel: string;
  title: string;
  contentStatus: string;
  published: boolean;
  quizMinimumPercent: number;
  drawCount: number;
  timeLimitMinutes: number;
  approvedQuestions: number;
  questionCounts: TopicQuestionCounts;
  media: TopicMediaCounts;
  ready: boolean;
  blockers: PublicationBlocker[];
  updatedAt: string;
}

export interface AdminTopicListFilter {
  courseId?: string;
  status?: string;
  published?: boolean;
  ready?: boolean;
  q?: string;
  page: number;
  pageSize: number;
}

export interface AdminTopicList {
  rows: AdminTopicRow[];
  total: number;
  summary: {
    total: number;
    ready: number;
    blocked: number;
    published: number;
    approved: number;
    inReview: number;
  };
}

function emptyQuestionCounts(): TopicQuestionCounts {
  return { draft: 0, review: 0, approved: 0, retired: 0, total: 0 };
}

function mediaCounts(rows: MediaRow[]): TopicMediaCounts {
  const required = rows.filter((m) => m.required);
  return {
    total: rows.length,
    required: required.length,
    published: required.filter(
      (m) =>
        m.production_state === 'PUBLISHED' &&
        m.rights_status === 'CLEARED' &&
        m.accessibility_status === 'PASSED',
    ).length,
    missingFile: required.filter((m) => MEDIA_FILE_TYPES.has(m.media_type) && !m.media_url.trim()).length,
  };
}

function verdictFor(topic: TopicRow, questions: TopicQuestionCounts, media: MediaRow[]): PublicationVerdict {
  return evaluateTopicPublication({
    topicId: topic.topic_id,
    contentStatus: topic.content_status,
    lessonMarkdown: topic.lesson_markdown,
    approvedQuestionCount: questions.approved,
    drawCount: topic.quiz_draw_count,
    quizMinimumPercent: topic.quiz_minimum_percent,
    media: media.map((m) => ({
      assetId: m.asset_id,
      mediaType: m.media_type,
      required: m.required,
      productionState: m.production_state,
      rightsStatus: m.rights_status,
      accessibilityStatus: m.accessibility_status,
      mediaUrl: m.media_url,
    })),
    accessibleEquivalentApproved: topic.accessible_equivalent_approved,
    accessibleEquivalentNote: topic.accessible_equivalent_note,
  });
}

interface Snapshot {
  topic: TopicRow;
  courseTitle: string;
  media: MediaRow[];
  questions: TopicQuestionCounts;
  verdict: PublicationVerdict;
}

async function loadSnapshot(db: Db, topicId: string): Promise<Snapshot> {
  const [{ data: topicData, error: topicError }, { data: mediaData, error: mediaError }, { data: questionData, error: questionError }] =
    await Promise.all([
      db
        .from('film_topics')
        .select(
          'topic_id, course_id, stage, stage_label, title, lesson_markdown, content_status, quiz_minimum_percent, quiz_draw_count, quiz_time_limit_minutes, media_status, learning_outcomes, required_media, prerequisites, order_index, published, published_at, accessible_equivalent_approved, accessible_equivalent_note, source_hash, updated_at',
        )
        .eq('topic_id', topicId)
        .maybeSingle(),
      db.from('film_topic_media').select('*').eq('topic_id', topicId),
      db
        .from('academy_question_items')
        .select('film_topic_id, status')
        .eq('academy_scope', 'film')
        .eq('film_topic_id', topicId),
    ]);

  if (topicError) throw new TopicAdminError(500, 'TOPIC_LOAD_FAILED', 'Could not load the topic.');
  if (!topicData) throw new TopicAdminError(404, 'TOPIC_NOT_FOUND', 'Topic not found.');
  if (mediaError) throw new TopicAdminError(500, 'MEDIA_LOAD_FAILED', 'Could not load teaching media.');
  if (questionError) throw new TopicAdminError(500, 'QUESTIONS_LOAD_FAILED', 'Could not load the question pool.');

  const topic = topicData as unknown as TopicRow;
  const { data: courseData } = await db
    .from('film_courses')
    .select('title')
    .eq('course_id', topic.course_id)
    .maybeSingle();
  const courseTitle = (courseData as { title?: string } | null)?.title ?? topic.course_id;

  const questions = emptyQuestionCounts();
  for (const row of (questionData ?? []) as QuestionStatusRow[]) {
    questions.total += 1;
    if (row.status === 'draft') questions.draft += 1;
    else if (row.status === 'review') questions.review += 1;
    else if (row.status === 'approved') questions.approved += 1;
    else if (row.status === 'retired') questions.retired += 1;
  }

  const media = (mediaData ?? []) as unknown as MediaRow[];
  return { topic, courseTitle, media, questions, verdict: verdictFor(topic, questions, media) };
}

function topicRowFrom(snapshot: Snapshot): AdminTopicRow {
  const { topic, courseTitle, media, questions, verdict } = snapshot;
  return {
    topicId: topic.topic_id,
    courseId: topic.course_id,
    courseTitle,
    stage: topic.stage,
    stageLabel: topic.stage_label || topic.stage,
    title: topic.title,
    contentStatus: topic.content_status,
    published: topic.published,
    quizMinimumPercent: Number(topic.quiz_minimum_percent),
    drawCount: Number(topic.quiz_draw_count),
    timeLimitMinutes: Number(topic.quiz_time_limit_minutes),
    approvedQuestions: questions.approved,
    questionCounts: questions,
    media: mediaCounts(media),
    ready: verdict.ready,
    blockers: verdict.blockers,
    updatedAt: topic.updated_at,
  };
}

/**
 * The full topic list, evaluated. 72 topics is small enough to gate in memory,
 * which guarantees the `ready` filter and the summary always agree with the
 * publish endpoint instead of duplicating the rule in SQL.
 */
export async function listAdminTopics(db: Db, filter: AdminTopicListFilter): Promise<AdminTopicList> {
  let topicQuery = db
    .from('film_topics')
    .select(
      'topic_id, course_id, stage, stage_label, title, lesson_markdown, content_status, quiz_minimum_percent, quiz_draw_count, quiz_time_limit_minutes, media_status, learning_outcomes, required_media, prerequisites, order_index, published, published_at, accessible_equivalent_approved, accessible_equivalent_note, source_hash, updated_at',
    )
    .order('course_id')
    .order('order_index');
  if (filter.courseId) topicQuery = topicQuery.eq('course_id', filter.courseId);
  if (filter.status) topicQuery = topicQuery.eq('content_status', filter.status);
  if (filter.published !== undefined) topicQuery = topicQuery.eq('published', filter.published);

  const [{ data: topicData, error: topicError }, { data: courseData }, { data: questionData }, { data: mediaData }] =
    await Promise.all([
      topicQuery,
      db.from('film_courses').select('course_id, title').order('order_index'),
      db
        .from('academy_question_items')
        .select('film_topic_id, status')
        .eq('academy_scope', 'film')
        .not('film_topic_id', 'is', null),
      db
        .from('film_topic_media')
        .select('asset_id, topic_id, media_type, required, production_state, rights_status, accessibility_status, media_url'),
    ]);

  if (topicError) throw new TopicAdminError(500, 'TOPICS_LOAD_FAILED', 'Could not load topics.');
  const courseTitles = new Map(
    ((courseData ?? []) as Array<{ course_id: string; title: string }>).map((c) => [c.course_id, c.title]),
  );

  const questionsByTopic = new Map<string, TopicQuestionCounts>();
  for (const row of (questionData ?? []) as QuestionStatusRow[]) {
    if (!row.film_topic_id) continue;
    const counts = questionsByTopic.get(row.film_topic_id) ?? emptyQuestionCounts();
    counts.total += 1;
    if (row.status === 'draft') counts.draft += 1;
    else if (row.status === 'review') counts.review += 1;
    else if (row.status === 'approved') counts.approved += 1;
    else if (row.status === 'retired') counts.retired += 1;
    questionsByTopic.set(row.film_topic_id, counts);
  }

  const mediaByTopic = new Map<string, MediaRow[]>();
  for (const row of (mediaData ?? []) as unknown as MediaRow[]) {
    const list = mediaByTopic.get(row.topic_id) ?? [];
    list.push(row);
    mediaByTopic.set(row.topic_id, list);
  }

  let rows = ((topicData ?? []) as unknown as TopicRow[]).map((topic) => {
    const snapshot: Snapshot = {
      topic,
      courseTitle: courseTitles.get(topic.course_id) ?? topic.course_id,
      media: mediaByTopic.get(topic.topic_id) ?? [],
      questions: questionsByTopic.get(topic.topic_id) ?? emptyQuestionCounts(),
      verdict: { ready: false, blockers: [], publishedMedia: 0, requiredMedia: 0 },
    };
    snapshot.verdict = verdictFor(topic, snapshot.questions, snapshot.media);
    return topicRowFrom(snapshot);
  });

  const summary = {
    total: rows.length,
    ready: rows.filter((r) => r.ready).length,
    blocked: rows.filter((r) => !r.ready).length,
    published: rows.filter((r) => r.published).length,
    approved: rows.filter((r) => r.contentStatus === 'approved').length,
    inReview: rows.filter((r) => r.contentStatus === 'review').length,
  };

  if (filter.ready !== undefined) rows = rows.filter((r) => r.ready === filter.ready);
  const q = filter.q?.trim().toLowerCase();
  if (q) {
    rows = rows.filter(
      (r) =>
        r.title.toLowerCase().includes(q) ||
        r.topicId.toLowerCase().includes(q) ||
        r.courseTitle.toLowerCase().includes(q),
    );
  }

  const total = rows.length;
  const from = (filter.page - 1) * filter.pageSize;
  return { rows: rows.slice(from, from + filter.pageSize), total, summary };
}

export interface AdminTopicDetail {
  topic: AdminTopicRow;
  article: string;
  outcomes: TopicOutcome[];
  requiredMedia: string[];
  prerequisites: string[];
  media: Array<MediaRow & { published: boolean; blockers: string[] }>;
  accessibleEquivalent: { approved: boolean; note: string };
  holds: Array<{
    id: string;
    holdType: string;
    reason: string;
    status: string;
    createdAt: string;
    clearedAt: string | null;
    clearanceNote: string;
  }>;
  mastery: { passed: number; mastered: number; remediation: number; total: number };
  attempts: { total: number; scored: number; inProgress: number };
  audit: Array<{ action: string; actorRole: string; reason: string; createdAt: string }>;
}

function mediaBlockers(media: MediaRow): string[] {
  const out: string[] = [];
  if (media.production_state !== 'PUBLISHED') out.push('Not published');
  if (media.rights_status !== 'CLEARED') out.push('Rights not cleared');
  if (media.accessibility_status !== 'PASSED') out.push('Accessibility not passed');
  if (MEDIA_FILE_TYPES.has(media.media_type) && !media.media_url.trim()) out.push('File URL missing');
  if (
    (media.media_type === 'teaching_video' || media.media_type === 'comparison_clip') &&
    !media.captions_url.trim() &&
    !media.transcript.trim()
  ) {
    out.push('Captions or transcript missing');
  }
  if (media.media_type === 'narration_audio' && !media.transcript.trim()) out.push('Transcript missing');
  if (media.media_type === 'photo_or_diagram' && !media.alt_text.trim()) out.push('Alt text missing');
  return out;
}

export async function getAdminTopic(db: Db, topicId: string): Promise<AdminTopicDetail> {
  const snapshot = await loadSnapshot(db, topicId);
  const [holdsRes, masteryRes, attemptsRes, auditRes] = await Promise.all([
    db
      .from('film_mastery_holds')
      .select('id, hold_type, reason, status, created_at, cleared_at, clearance_note')
      .eq('topic_id', topicId)
      .order('created_at', { ascending: false })
      .limit(50),
    db.from('film_topic_mastery').select('state').eq('topic_id', topicId),
    db.from('film_topic_attempts').select('attempt_state').eq('topic_id', topicId),
    db
      .from('film_academic_audit')
      .select('action, actor_role, reason, created_at')
      .eq('target_type', 'film_topic')
      .eq('target_id', topicId)
      .order('created_at', { ascending: false })
      .limit(20),
  ]);

  const masteryRows = (masteryRes.data ?? []) as Array<{ state: string }>;
  const attemptRows = (attemptsRes.data ?? []) as Array<{ attempt_state: string }>;

  return {
    topic: topicRowFrom(snapshot),
    article: snapshot.topic.lesson_markdown,
    outcomes: snapshot.topic.learning_outcomes ?? [],
    requiredMedia: snapshot.topic.required_media ?? [],
    prerequisites: snapshot.topic.prerequisites ?? [],
    media: snapshot.media.map((m) => ({ ...m, published: mediaBlockers(m).length === 0, blockers: mediaBlockers(m) })),
    accessibleEquivalent: {
      approved: snapshot.topic.accessible_equivalent_approved,
      note: snapshot.topic.accessible_equivalent_note,
    },
    holds: ((holdsRes.data ?? []) as Array<Record<string, unknown>>).map((h) => ({
      id: String(h.id),
      holdType: String(h.hold_type),
      reason: String(h.reason),
      status: String(h.status),
      createdAt: String(h.created_at),
      clearedAt: h.cleared_at ? String(h.cleared_at) : null,
      clearanceNote: String(h.clearance_note ?? ''),
    })),
    mastery: {
      passed: masteryRows.filter((m) => m.state === 'PASSED' || m.state === 'MASTERED').length,
      mastered: masteryRows.filter((m) => m.state === 'MASTERED').length,
      remediation: masteryRows.filter((m) => m.state === 'REMEDIATION_REQUIRED').length,
      total: masteryRows.length,
    },
    attempts: {
      total: attemptRows.length,
      scored: attemptRows.filter((a) => a.attempt_state === 'scored').length,
      inProgress: attemptRows.filter((a) => a.attempt_state === 'in_progress').length,
    },
    audit: ((auditRes.data ?? []) as Array<Record<string, unknown>>).map((a) => ({
      action: String(a.action),
      actorRole: String(a.actor_role),
      reason: String(a.reason),
      createdAt: String(a.created_at),
    })),
  };
}

export type TopicAdminAction =
  | 'save'
  | 'submit_review'
  | 'approve'
  | 'publish'
  | 'unpublish'
  | 'set_accessible_equivalent';

export interface TopicAdminInput {
  action: TopicAdminAction;
  title?: string;
  stage?: string;
  stageLabel?: string;
  lessonMarkdown?: string;
  learningOutcomes?: TopicOutcome[];
  requiredMedia?: string[];
  prerequisites?: string[];
  quizMinimumPercent?: number;
  quizDrawCount?: number;
  quizTimeLimitMinutes?: number;
  accessibleEquivalentApproved?: boolean;
  accessibleEquivalentNote?: string;
}

export interface TopicAdminMutationResult {
  ok: true;
  action: TopicAdminAction;
  published: boolean;
  contentStatus: string;
  returnedToReview: boolean;
  message: string;
}

const STAGES = new Set(['L0', 'L1', 'L2', 'L3', 'L4', 'L5']);

function assertIntegerInRange(value: number | undefined, min: number, max: number, field: string): number | undefined {
  if (value === undefined) return undefined;
  if (!Number.isInteger(value) || value < min || value > max) {
    throw new TopicAdminError(400, 'INVALID_INPUT', `${field} must be an integer between ${min} and ${max}.`);
  }
  return value;
}

function normalizeStringArray(value: string[] | undefined, field: string): string[] | undefined {
  if (value === undefined) return undefined;
  if (!Array.isArray(value)) {
    throw new TopicAdminError(400, 'INVALID_INPUT', `${field} must be an array of strings.`);
  }
  const out = value.map((v) => String(v).trim()).filter(Boolean);
  if (out.length !== value.length) {
    throw new TopicAdminError(400, 'INVALID_INPUT', `${field} cannot contain blank entries.`);
  }
  return Array.from(new Set(out));
}

function normalizeOutcomes(value: TopicOutcome[] | undefined): TopicOutcome[] | undefined {
  if (value === undefined) return undefined;
  if (!Array.isArray(value)) {
    throw new TopicAdminError(400, 'INVALID_INPUT', 'learningOutcomes must be an array.');
  }
  const seen = new Set<string>();
  return value.map((o) => {
    const id = String(o?.objective_id ?? '').trim();
    const description = String(o?.description ?? '').trim();
    if (!id || !description) {
      throw new TopicAdminError(400, 'INVALID_INPUT', 'Each learning outcome needs an ID and description.');
    }
    if (seen.has(id)) {
      throw new TopicAdminError(400, 'INVALID_INPUT', `Duplicate learning outcome ${id}.`);
    }
    seen.add(id);
    return { objective_id: id, description };
  });
}

async function audit(
  db: Db,
  actorId: string | null,
  action: string,
  topicId: string,
  before: Record<string, unknown>,
  after: Record<string, unknown>,
  reason: string,
) {
  await db.from('film_academic_audit').insert({
    actor_id: actorId,
    actor_role: 'admin',
    action,
    target_type: 'film_topic',
    target_id: topicId,
    before,
    after,
    reason,
  });
}

/**
 * Strict transition rules:
 *   draft → review → approved → published
 * Saving teaching content on an approved/published topic returns it to review.
 * The publish action is the only writer of `published = true`.
 */
export async function mutateAdminTopic(
  db: Db,
  actorId: string | null,
  topicId: string,
  input: TopicAdminInput,
): Promise<TopicAdminMutationResult> {
  const snapshot = await loadSnapshot(db, topicId);
  const { topic } = snapshot;

  if (input.action === 'save') {
    const patch: Record<string, unknown> = {};
    let contentChanged = false;

    if (input.title !== undefined) {
      const title = input.title.trim();
      if (!title) throw new TopicAdminError(400, 'INVALID_INPUT', 'Title cannot be blank.');
      patch.title = title;
      contentChanged = true;
    }
    if (input.stage !== undefined) {
      if (!STAGES.has(input.stage)) {
        throw new TopicAdminError(400, 'INVALID_INPUT', 'Stage must be L0–L5.');
      }
      patch.stage = input.stage;
      contentChanged = true;
    }
    if (input.stageLabel !== undefined) patch.stage_label = input.stageLabel.trim();
    if (input.lessonMarkdown !== undefined) {
      patch.lesson_markdown = input.lessonMarkdown;
      contentChanged = true;
    }
    const outcomes = normalizeOutcomes(input.learningOutcomes);
    if (outcomes !== undefined) {
      patch.learning_outcomes = outcomes;
      contentChanged = true;
    }
    const requiredMedia = normalizeStringArray(input.requiredMedia, 'requiredMedia');
    if (requiredMedia !== undefined) {
      patch.required_media = requiredMedia;
      contentChanged = true;
    }
    const prerequisites = normalizeStringArray(input.prerequisites, 'prerequisites');
    if (prerequisites !== undefined) {
      patch.prerequisites = prerequisites;
      contentChanged = true;
    }
    const min = assertIntegerInRange(input.quizMinimumPercent, 85, 100, 'quizMinimumPercent');
    if (min !== undefined) {
      patch.quiz_minimum_percent = min;
      contentChanged = true;
    }
    const draw = assertIntegerInRange(input.quizDrawCount, 1, 50, 'quizDrawCount');
    if (draw !== undefined) {
      patch.quiz_draw_count = draw;
      contentChanged = true;
    }
    const time = assertIntegerInRange(input.quizTimeLimitMinutes, 1, 180, 'quizTimeLimitMinutes');
    if (time !== undefined) {
      patch.quiz_time_limit_minutes = time;
      contentChanged = true;
    }

    if (Object.keys(patch).length === 0) {
      throw new TopicAdminError(400, 'NOTHING_TO_SAVE', 'No editable fields were supplied.');
    }

    const returnedToReview =
      contentChanged && (topic.content_status === 'approved' || topic.published === true);
    if (returnedToReview) {
      patch.content_status = 'review';
      patch.published = false;
      patch.published_at = null;
      patch.accessible_equivalent_approved = false;
      patch.accessible_equivalent_note = '';
    }
    if (contentChanged) {
      // Manual edits diverge from the bundled pack; a later reimport must see
      // the change and re-enter review rather than silently restoring the pack.
      patch.source_hash = null;
    }
    patch.updated_at = new Date().toISOString();

    const { error } = await db.from('film_topics').update(patch).eq('topic_id', topicId);
    if (error) {
      console.error('[film/topics] save failed', error);
      throw new TopicAdminError(500, 'SAVE_FAILED', 'Could not save the topic.');
    }
    await audit(db, actorId, 'TOPIC_EDITED', topicId, {
      contentStatus: topic.content_status,
      published: topic.published,
    }, patch, 'Admin edited topic content or assessment settings.');

    return {
      ok: true,
      action: 'save',
      published: Boolean(patch.published ?? topic.published),
      contentStatus: String(patch.content_status ?? topic.content_status),
      returnedToReview,
      message: returnedToReview
        ? 'Saved. The topic was returned to review and unpublished because its content changed.'
        : 'Saved.',
    };
  }

  if (input.action === 'submit_review') {
    if (topic.content_status !== 'draft') {
      throw new TopicAdminError(409, 'INVALID_STATE', 'Only a draft topic can be submitted for review.');
    }
    if (topic.lesson_markdown.trim().length < 200) {
      throw new TopicAdminError(422, 'ARTICLE_NOT_TEACHABLE', 'Write a teachable article (at least 200 characters) before review.');
    }
    if ((topic.learning_outcomes ?? []).length === 0) {
      throw new TopicAdminError(422, 'OUTCOMES_MISSING', 'Add at least one learning outcome before review.');
    }
    const { error } = await db
      .from('film_topics')
      .update({ content_status: 'review', updated_at: new Date().toISOString() })
      .eq('topic_id', topicId)
      .eq('content_status', 'draft');
    if (error) throw new TopicAdminError(500, 'SAVE_FAILED', 'Could not submit the topic for review.');
    await audit(db, actorId, 'TOPIC_SUBMITTED_FOR_REVIEW', topicId, { contentStatus: 'draft' }, { contentStatus: 'review' }, 'Submitted for faculty review.');
    return { ok: true, action: 'submit_review', published: false, contentStatus: 'review', returnedToReview: false, message: 'Submitted for review.' };
  }

  if (input.action === 'approve') {
    if (topic.content_status !== 'review') {
      throw new TopicAdminError(409, 'INVALID_STATE', 'Only a topic in review can be approved.');
    }
    if (topic.lesson_markdown.trim().length < 200) {
      throw new TopicAdminError(422, 'ARTICLE_NOT_TEACHABLE', 'The article is a brief; a teachable article is required before approval.');
    }
    if ((topic.learning_outcomes ?? []).length === 0) {
      throw new TopicAdminError(422, 'OUTCOMES_MISSING', 'At least one learning outcome is required before approval.');
    }
    if (Number(topic.quiz_minimum_percent) < 85) {
      throw new TopicAdminError(422, 'PASS_THRESHOLD_BELOW_POLICY', 'The quiz threshold must be at least 85%.');
    }
    const { error } = await db
      .from('film_topics')
      .update({ content_status: 'approved', updated_at: new Date().toISOString() })
      .eq('topic_id', topicId)
      .eq('content_status', 'review');
    if (error) throw new TopicAdminError(500, 'SAVE_FAILED', 'Could not approve the topic.');
    await audit(db, actorId, 'TOPIC_APPROVED', topicId, { contentStatus: 'review' }, { contentStatus: 'approved' }, 'Faculty approved the teaching content.');
    return { ok: true, action: 'approve', published: false, contentStatus: 'approved', returnedToReview: false, message: 'Content approved.' };
  }

  if (input.action === 'set_accessible_equivalent') {
    if (topic.content_status !== 'approved') {
      throw new TopicAdminError(409, 'INVALID_STATE', 'Approve the teaching content before signing an accessible equivalent.');
    }
    const approved = input.accessibleEquivalentApproved === true;
    const note = String(input.accessibleEquivalentNote ?? '').trim();
    if (approved && note.length < 20) {
      throw new TopicAdminError(400, 'NOTE_REQUIRED', 'A written rationale of at least 20 characters is required for an accessible-equivalent waiver.');
    }
    const { error } = await db
      .from('film_topics')
      .update({
        accessible_equivalent_approved: approved,
        accessible_equivalent_note: approved ? note : '',
        updated_at: new Date().toISOString(),
      })
      .eq('topic_id', topicId);
    if (error) throw new TopicAdminError(500, 'SAVE_FAILED', 'Could not record the accessible equivalent.');
    await audit(db, actorId, approved ? 'TOPIC_ACCESSIBLE_EQUIVALENT_APPROVED' : 'TOPIC_ACCESSIBLE_EQUIVALENT_REVOKED', topicId, {
      approved: topic.accessible_equivalent_approved,
      note: topic.accessible_equivalent_note,
    }, { approved, note: approved ? note : '' }, approved ? 'Accessible text equivalent signed off.' : 'Accessible equivalent revoked.');
    return {
      ok: true,
      action: 'set_accessible_equivalent',
      published: topic.published,
      contentStatus: topic.content_status,
      returnedToReview: false,
      message: approved ? 'Accessible equivalent recorded.' : 'Accessible equivalent revoked.',
    };
  }

  if (input.action === 'publish') {
    if (topic.published) {
      return { ok: true, action: 'publish', published: true, contentStatus: topic.content_status, returnedToReview: false, message: 'Already published.' };
    }
    if (!snapshot.verdict.ready) {
      throw new TopicAdminError(
        422,
        'PUBLICATION_BLOCKED',
        'This topic cannot be published until every academic gate is cleared.',
        snapshot.verdict.blockers,
      );
    }
    const now = new Date().toISOString();
    const { error } = await db
      .from('film_topics')
      .update({
        content_status: 'approved',
        published: true,
        published_at: now,
        published_by: actorId,
        updated_at: now,
      })
      .eq('topic_id', topicId)
      .eq('published', false);
    if (error) throw new TopicAdminError(500, 'PUBLISH_FAILED', 'Could not publish the topic.');
    await audit(db, actorId, 'TOPIC_PUBLISHED', topicId, { published: false }, {
      published: true,
      approvedQuestions: snapshot.questions.approved,
      media: mediaCounts(snapshot.media),
      accessibleEquivalent: topic.accessible_equivalent_approved,
    }, 'All publication gates passed.');
    return { ok: true, action: 'publish', published: true, contentStatus: 'approved', returnedToReview: false, message: 'Topic published.' };
  }

  // unpublish
  if (!topic.published) {
    return { ok: true, action: 'unpublish', published: false, contentStatus: topic.content_status, returnedToReview: false, message: 'Already unpublished.' };
  }
  const { error } = await db
    .from('film_topics')
    .update({ published: false, published_at: null, updated_at: new Date().toISOString() })
    .eq('topic_id', topicId)
    .eq('published', true);
  if (error) throw new TopicAdminError(500, 'SAVE_FAILED', 'Could not unpublish the topic.');
  await audit(db, actorId, 'TOPIC_UNPUBLISHED', topicId, { published: true }, { published: false }, 'Admin unpublished the topic.');
  return { ok: true, action: 'unpublish', published: false, contentStatus: topic.content_status, returnedToReview: false, message: 'Topic unpublished.' };
}

export interface MediaListFilter {
  courseId?: string;
  topicId?: string;
  productionState?: string;
  rightsStatus?: string;
  accessibilityStatus?: string;
  q?: string;
  page: number;
  pageSize: number;
}

export interface AdminMediaRow extends MediaRow {
  topicTitle: string;
  courseTitle: string;
  blockers: string[];
}

export async function listAdminMedia(
  db: Db,
  filter: MediaListFilter,
): Promise<{ rows: AdminMediaRow[]; total: number; summary: Record<string, number> }> {
  let query = db
    .from('film_topic_media')
    .select('*, film_topics(title, course_id, film_courses(title))', { count: 'exact' });
  if (filter.courseId) query = query.eq('course_id', filter.courseId);
  if (filter.topicId) query = query.eq('topic_id', filter.topicId);
  if (filter.productionState) query = query.eq('production_state', filter.productionState);
  if (filter.rightsStatus) query = query.eq('rights_status', filter.rightsStatus);
  if (filter.accessibilityStatus) query = query.eq('accessibility_status', filter.accessibilityStatus);
  if (filter.q) query = query.or(`asset_id.ilike.%${filter.q}%,topic_id.ilike.%${filter.q}%`);

  const from = (filter.page - 1) * filter.pageSize;
  const { data, error, count } = await query
    .order('course_id')
    .order('topic_id')
    .order('asset_id')
    .range(from, from + filter.pageSize - 1);
  if (error) {
    console.error('[film/topics] media list failed', error);
    throw new TopicAdminError(500, 'MEDIA_LOAD_FAILED', 'Could not load the media queue.');
  }

  const rows = ((data ?? []) as Array<Record<string, unknown>>).map((raw) => {
    const topic = raw.film_topics as
      | { title?: string; course_id?: string; film_courses?: { title?: string } | Array<{ title?: string }> }
      | null;
    const course = Array.isArray(topic?.film_courses) ? topic?.film_courses[0] : topic?.film_courses;
    const media = raw as unknown as MediaRow;
    return {
      ...media,
      topicTitle: topic?.title ?? media.topic_id,
      courseTitle: course?.title ?? topic?.course_id ?? media.course_id,
      blockers: mediaBlockers(media),
    };
  });

  const { data: allStates } = await db.from('film_topic_media').select('production_state');
  const summary: Record<string, number> = { total: 0 };
  for (const row of (allStates ?? []) as Array<{ production_state: string }>) {
    summary.total += 1;
    summary[row.production_state] = (summary[row.production_state] ?? 0) + 1;
  }

  return { rows, total: count ?? rows.length, summary };
}

export interface MediaUpdateInput {
  productionState?: string;
  rightsStatus?: string;
  accessibilityStatus?: string;
  instructions?: string;
  owner?: string;
  mediaUrl?: string;
  thumbnailUrl?: string;
  captionsUrl?: string;
  transcript?: string;
  altText?: string;
  expiresAt?: string | null;
  replacementAssetId?: string | null;
  language?: string;
  required?: boolean;
}

function assertEnum(value: string | undefined, allowed: readonly string[], field: string): string | undefined {
  if (value === undefined) return undefined;
  if (!allowed.includes(value)) {
    throw new TopicAdminError(400, 'INVALID_INPUT', `${field} must be one of: ${allowed.join(', ')}.`);
  }
  return value;
}

export async function updateAdminMedia(
  db: Db,
  actorId: string | null,
  assetId: string,
  input: MediaUpdateInput,
): Promise<{ ok: true; assetId: string; published: boolean; topicUnpublished: boolean; blockers: string[] }> {
  const { data, error } = await db
    .from('film_topic_media')
    .select('*')
    .eq('asset_id', assetId)
    .maybeSingle();
  if (error) throw new TopicAdminError(500, 'MEDIA_LOAD_FAILED', 'Could not load the asset.');
  if (!data) throw new TopicAdminError(404, 'MEDIA_NOT_FOUND', 'Teaching asset not found.');
  const current = data as unknown as MediaRow;

  const patch: Record<string, unknown> = {};
  const productionState = assertEnum(input.productionState, PRODUCTION_STATES, 'productionState');
  const rightsStatus = assertEnum(input.rightsStatus, RIGHTS_STATUSES, 'rightsStatus');
  const accessibilityStatus = assertEnum(input.accessibilityStatus, ACCESSIBILITY_STATUSES, 'accessibilityStatus');
  if (productionState !== undefined) {
    patch.production_state = productionState;
    patch.status = productionState;
  }
  if (rightsStatus !== undefined) patch.rights_status = rightsStatus;
  if (accessibilityStatus !== undefined) patch.accessibility_status = accessibilityStatus;
  if (input.instructions !== undefined) patch.instructions = input.instructions;
  if (input.owner !== undefined) patch.owner = input.owner.trim();
  if (input.mediaUrl !== undefined) patch.media_url = input.mediaUrl.trim();
  if (input.thumbnailUrl !== undefined) patch.thumbnail_url = input.thumbnailUrl.trim();
  if (input.captionsUrl !== undefined) patch.captions_url = input.captionsUrl.trim();
  if (input.transcript !== undefined) patch.transcript = input.transcript;
  if (input.altText !== undefined) patch.alt_text = input.altText;
  if (input.expiresAt !== undefined) patch.expires_at = input.expiresAt;
  if (input.replacementAssetId !== undefined) patch.replacement_asset_id = input.replacementAssetId;
  if (input.language !== undefined) patch.language = input.language.trim() || 'en-NG';
  if (input.required !== undefined) patch.required = input.required;

  if (Object.keys(patch).length === 0) {
    throw new TopicAdminError(400, 'NOTHING_TO_SAVE', 'No media fields were supplied.');
  }

  const next: MediaRow = {
    ...current,
    production_state: String(patch.production_state ?? current.production_state),
    rights_status: String(patch.rights_status ?? current.rights_status),
    accessibility_status: String(patch.accessibility_status ?? current.accessibility_status),
    media_url: String(patch.media_url ?? current.media_url),
    captions_url: String(patch.captions_url ?? current.captions_url),
    transcript: String(patch.transcript ?? current.transcript),
    alt_text: String(patch.alt_text ?? current.alt_text),
  };
  const nextBlockers = mediaBlockers(next);
  if (next.production_state === 'PUBLISHED' && nextBlockers.length > 0) {
    throw new TopicAdminError(
      422,
      'MEDIA_NOT_PUBLISHABLE',
      `This asset cannot be published yet: ${nextBlockers.join(', ')}.`,
    );
  }

  patch.updated_by = actorId;
  patch.updated_at = new Date().toISOString();

  const { error: updateError } = await db
    .from('film_topic_media')
    .update(patch)
    .eq('asset_id', assetId);
  if (updateError) {
    console.error('[film/topics] media update failed', updateError);
    throw new TopicAdminError(500, 'SAVE_FAILED', 'Could not save the teaching asset.');
  }

  await db.from('film_academic_audit').insert({
    actor_id: actorId,
    actor_role: 'admin',
    action: 'FILM_MEDIA_UPDATED',
    target_type: 'film_topic_media',
    target_id: assetId,
    before: {
      productionState: current.production_state,
      rightsStatus: current.rights_status,
      accessibilityStatus: current.accessibility_status,
      mediaUrl: current.media_url,
    },
    after: patch,
    reason: 'Admin updated a teaching asset production record.',
  });

  // A published topic must not remain live when one of its mandatory assets
  // regresses. Re-evaluate immediately rather than trusting the previous gate.
  let topicUnpublished = false;
  const { data: topicRow } = await db
    .from('film_topics')
    .select('published')
    .eq('topic_id', current.topic_id)
    .maybeSingle();
  if ((topicRow as { published?: boolean } | null)?.published) {
    const snapshot = await loadSnapshot(db, current.topic_id);
    if (!snapshot.verdict.ready) {
      await db
        .from('film_topics')
        .update({ published: false, published_at: null, updated_at: new Date().toISOString() })
        .eq('topic_id', current.topic_id)
        .eq('published', true);
      await db.from('film_academic_audit').insert({
        actor_id: actorId,
        actor_role: 'system',
        action: 'TOPIC_AUTO_UNPUBLISHED',
        target_type: 'film_topic',
        target_id: current.topic_id,
        before: { published: true },
        after: { published: false, blockers: snapshot.verdict.blockers },
        reason: 'A mandatory teaching asset no longer meets the publication gate.',
      });
      topicUnpublished = true;
    }
  }

  return {
    ok: true,
    assetId,
    published: next.production_state === 'PUBLISHED' && nextBlockers.length === 0,
    topicUnpublished,
    blockers: nextBlockers,
  };
}

export interface HoldListFilter {
  status?: string;
  topicId?: string;
  enrollmentId?: string;
  page: number;
  pageSize: number;
}

export interface AdminHoldRow {
  id: string;
  enrollmentId: string;
  topicId: string;
  topicTitle: string;
  holdType: string;
  reason: string;
  status: string;
  createdAt: string;
  clearedAt: string | null;
  clearanceNote: string;
  learnerName: string;
  learnerEmail: string;
}

export async function listAdminHolds(
  db: Db,
  filter: HoldListFilter,
): Promise<{ rows: AdminHoldRow[]; total: number; open: number }> {
  let query = db
    .from('film_mastery_holds')
    .select('*', { count: 'exact' })
    .order('created_at', { ascending: false });
  if (filter.status) query = query.eq('status', filter.status);
  if (filter.topicId) query = query.eq('topic_id', filter.topicId);
  if (filter.enrollmentId) query = query.eq('enrollment_id', filter.enrollmentId);
  const from = (filter.page - 1) * filter.pageSize;
  const { data, error, count } = await query.range(from, from + filter.pageSize - 1);
  if (error) {
    console.error('[film/topics] hold list failed', error);
    throw new TopicAdminError(500, 'HOLDS_LOAD_FAILED', 'Could not load holds.');
  }
  const rawRows = (data ?? []) as Array<Record<string, unknown>>;

  const topicIds = Array.from(new Set(rawRows.map((r) => String(r.topic_id))));
  const enrollmentIds = Array.from(new Set(rawRows.map((r) => String(r.enrollment_id))));

  const [topicRes, enrollmentRes, openRes] = await Promise.all([
    topicIds.length > 0
      ? db.from('film_topics').select('topic_id, title').in('topic_id', topicIds)
      : Promise.resolve({ data: [] as Array<{ topic_id: string; title: string }> }),
    enrollmentIds.length > 0
      ? db
          .from('academy_enrollments')
          .select('id, academy_applications(full_name, email)')
          .in('id', enrollmentIds)
      : Promise.resolve({ data: [] as Array<Record<string, unknown>> }),
    db.from('film_mastery_holds').select('id', { count: 'exact', head: true }).eq('status', 'open'),
  ]);

  const titles = new Map(
    ((topicRes.data ?? []) as Array<{ topic_id: string; title: string }>).map((t) => [t.topic_id, t.title]),
  );
  const learners = new Map<string, { name: string; email: string }>();
  for (const row of (enrollmentRes.data ?? []) as Array<Record<string, unknown>>) {
    const app = row.academy_applications as
      | { full_name?: string; email?: string }
      | Array<{ full_name?: string; email?: string }>
      | null;
    const application = Array.isArray(app) ? app[0] : app;
    learners.set(String(row.id), {
      name: application?.full_name ?? '',
      email: application?.email ?? '',
    });
  }

  return {
    rows: rawRows.map((r) => {
      const learner = learners.get(String(r.enrollment_id));
      return {
        id: String(r.id),
        enrollmentId: String(r.enrollment_id),
        topicId: String(r.topic_id),
        topicTitle: titles.get(String(r.topic_id)) ?? String(r.topic_id),
        holdType: String(r.hold_type),
        reason: String(r.reason),
        status: String(r.status),
        createdAt: String(r.created_at),
        clearedAt: r.cleared_at ? String(r.cleared_at) : null,
        clearanceNote: String(r.clearance_note ?? ''),
        learnerName: learner?.name ?? '',
        learnerEmail: learner?.email ?? '',
      };
    }),
    total: count ?? rawRows.length,
    open: openRes.count ?? 0,
  };
}

export async function createAdminHold(
  db: Db,
  actorId: string | null,
  input: { enrollmentId: string; topicId: string; holdType: string; reason: string },
): Promise<{ ok: true; holdId: string; masteryState: string | null }> {
  const holdType = assertEnum(input.holdType, HOLD_TYPES, 'holdType') as HoldType;
  const reason = input.reason.trim();
  if (!reason) throw new TopicAdminError(400, 'REASON_REQUIRED', 'A reason is required for an academic hold.');

  const [{ data: enrollment }, { data: topic }] = await Promise.all([
    db.from('academy_enrollments').select('id, user_id').eq('id', input.enrollmentId).maybeSingle(),
    db.from('film_topics').select('topic_id').eq('topic_id', input.topicId).maybeSingle(),
  ]);
  if (!enrollment) throw new TopicAdminError(404, 'ENROLLMENT_NOT_FOUND', 'Enrolment not found.');
  if (!topic) throw new TopicAdminError(404, 'TOPIC_NOT_FOUND', 'Topic not found.');

  const { data: created, error } = await db
    .from('film_mastery_holds')
    .insert({
      enrollment_id: input.enrollmentId,
      topic_id: input.topicId,
      hold_type: holdType,
      reason,
      status: 'open',
      created_by: actorId,
    })
    .select('id')
    .single();
  if (error || !created) {
    console.error('[film/topics] hold insert failed', error);
    throw new TopicAdminError(500, 'HOLD_CREATE_FAILED', 'Could not create the hold.');
  }

  const { data: mastery } = await db
    .from('film_topic_mastery')
    .select('state')
    .eq('enrollment_id', input.enrollmentId)
    .eq('topic_id', input.topicId)
    .maybeSingle();
  let masteryState = (mastery as { state?: string } | null)?.state ?? null;
  if (masteryState === 'MASTERED') {
    await db
      .from('film_topic_mastery')
      .update({ state: 'PASSED', updated_at: new Date().toISOString() })
      .eq('enrollment_id', input.enrollmentId)
      .eq('topic_id', input.topicId);
    masteryState = 'PASSED';
  }

  const holdId = (created as { id: string }).id;
  await db.from('film_mastery_events').upsert(
    {
      user_id: (enrollment as { user_id: string }).user_id,
      enrollment_id: input.enrollmentId,
      topic_id: input.topicId,
      event_type: 'TOPIC_HOLD_CREATED',
      dedupe_key: `hold:${holdId}:created`,
      payload: { holdId, holdType, reason, masteryState },
    },
    { onConflict: 'dedupe_key', ignoreDuplicates: true },
  );

  await db.from('film_academic_audit').insert({
    actor_id: actorId,
    actor_role: 'admin',
    action: 'FILM_HOLD_CREATED',
    target_type: 'film_topic',
    target_id: input.topicId,
    before: {},
    after: { holdId, enrollmentId: input.enrollmentId, holdType, reason },
    reason: 'Academic hold opened.',
  });

  return { ok: true, holdId, masteryState };
}

export async function clearAdminHold(
  db: Db,
  actorId: string | null,
  holdId: string,
  note: string,
): Promise<{ ok: true; cleared: boolean; masteryState: string | null }> {
  const { data, error } = await db
    .from('film_mastery_holds')
    .select('id, enrollment_id, topic_id, status')
    .eq('id', holdId)
    .maybeSingle();
  if (error) throw new TopicAdminError(500, 'HOLDS_LOAD_FAILED', 'Could not load the hold.');
  if (!data) throw new TopicAdminError(404, 'HOLD_NOT_FOUND', 'Hold not found.');
  const hold = data as { id: string; enrollment_id: string; topic_id: string; status: string };
  if (hold.status !== 'open') {
    return { ok: true, cleared: false, masteryState: null };
  }

  const now = new Date().toISOString();
  const { error: updateError } = await db
    .from('film_mastery_holds')
    .update({
      status: 'cleared',
      cleared_by: actorId,
      cleared_at: now,
      clearance_note: note.trim(),
    })
    .eq('id', holdId)
    .eq('status', 'open');
  if (updateError) throw new TopicAdminError(500, 'HOLD_CLEAR_FAILED', 'Could not clear the hold.');

  const { count: remaining } = await db
    .from('film_mastery_holds')
    .select('id', { count: 'exact', head: true })
    .eq('enrollment_id', hold.enrollment_id)
    .eq('topic_id', hold.topic_id)
    .eq('status', 'open');

  let masteryState: string | null = null;
  if ((remaining ?? 0) === 0) {
    const { data: mastery } = await db
      .from('film_topic_mastery')
      .select('state, passed_at, mastered_at')
      .eq('enrollment_id', hold.enrollment_id)
      .eq('topic_id', hold.topic_id)
      .maybeSingle();
    const row = mastery as { state?: string; passed_at?: string | null; mastered_at?: string | null } | null;
    if (row?.passed_at) {
      masteryState = 'MASTERED';
      await db
        .from('film_topic_mastery')
        .update({
          state: 'MASTERED',
          mastered_at: row.mastered_at ?? now,
          updated_at: now,
        })
        .eq('enrollment_id', hold.enrollment_id)
        .eq('topic_id', hold.topic_id);
    } else {
      masteryState = row?.state ?? null;
    }
  }

  await db.from('film_academic_audit').insert({
    actor_id: actorId,
    actor_role: 'admin',
    action: 'FILM_HOLD_CLEARED',
    target_type: 'film_topic',
    target_id: hold.topic_id,
    before: { holdId, status: 'open' },
    after: { holdId, status: 'cleared', note: note.trim(), masteryState },
    reason: 'Academic hold cleared.',
  });

  return { ok: true, cleared: true, masteryState };
}

export interface CandidateMasteryRow {
  enrollmentId: string;
  userId: string;
  learnerName: string;
  learnerEmail: string;
  batchName: string;
  currentStage: string;
  topicsTouched: number;
  topicsRequired: number;
  topicsPublished: number;
  mastered: number;
  passedWithHold: number;
  remediation: number;
  openHolds: number;
  certificate: {
    id: string;
    certificateNumber: string;
    status: string;
    revokedAt: string | null;
  } | null;
}

export async function listCandidateMastery(
  db: Db,
  filter: { q?: string; page: number; pageSize: number },
): Promise<{ rows: CandidateMasteryRow[]; total: number }> {
  const from = (filter.page - 1) * filter.pageSize;
  const { data, error, count } = await db
    .from('academy_enrollments')
    .select(
      'id, user_id, current_stage, academy_applications(full_name, email, academy_batches(batch_name))',
      { count: 'exact' },
    )
    .order('created_at', { ascending: false })
    .range(from, from + filter.pageSize - 1);
  if (error) {
    console.error('[film/topics] candidate list failed', error);
    throw new TopicAdminError(500, 'CANDIDATES_LOAD_FAILED', 'Could not load candidates.');
  }

  const rows = (data ?? []) as Array<Record<string, unknown>>;
  const enrollmentIds = rows.map((r) => String(r.id));
  const [masteryRes, holdsRes, topicsRes, publishedRes, certificateRes] = await Promise.all([
    enrollmentIds.length > 0
      ? db.from('film_topic_mastery').select('enrollment_id, state').in('enrollment_id', enrollmentIds)
      : Promise.resolve({ data: [] as Array<{ enrollment_id: string; state: string }> }),
    enrollmentIds.length > 0
      ? db
          .from('film_mastery_holds')
          .select('enrollment_id')
          .eq('status', 'open')
          .in('enrollment_id', enrollmentIds)
      : Promise.resolve({ data: [] as Array<{ enrollment_id: string }> }),
    db.from('film_topics').select('topic_id', { count: 'exact', head: true }),
    db.from('film_topics').select('topic_id', { count: 'exact', head: true }).eq('published', true),
    enrollmentIds.length > 0
      ? db
          .from('academy_certificates')
          .select('id, enrollment_id, certificate_number, status, revoked_at, created_at')
          .in('enrollment_id', enrollmentIds)
          .order('created_at', { ascending: false })
      : Promise.resolve({ data: [] as Array<Record<string, unknown>> }),
  ]);

  const topicsRequired = (topicsRes as { count?: number | null }).count ?? 0;
  const topicsPublished = (publishedRes as { count?: number | null }).count ?? 0;
  const certificateByEnrollment = new Map<
    string,
    { id: string; certificateNumber: string; status: string; revokedAt: string | null }
  >();
  for (const row of (certificateRes.data ?? []) as Array<{
    id: string;
    enrollment_id: string;
    certificate_number: string;
    status: string;
    revoked_at: string | null;
  }>) {
    if (certificateByEnrollment.has(row.enrollment_id)) continue;
    certificateByEnrollment.set(row.enrollment_id, {
      id: row.id,
      certificateNumber: row.certificate_number,
      status: row.status,
      revokedAt: row.revoked_at,
    });
  }

  const masteryByEnrollment = new Map<string, Array<{ state: string }>>();
  for (const row of (masteryRes.data ?? []) as Array<{ enrollment_id: string; state: string }>) {
    const list = masteryByEnrollment.get(row.enrollment_id) ?? [];
    list.push({ state: row.state });
    masteryByEnrollment.set(row.enrollment_id, list);
  }
  const holdsByEnrollment = new Map<string, number>();
  for (const row of (holdsRes.data ?? []) as Array<{ enrollment_id: string }>) {
    holdsByEnrollment.set(row.enrollment_id, (holdsByEnrollment.get(row.enrollment_id) ?? 0) + 1);
  }

  const mapped = rows.map((row) => {
    const app = row.academy_applications as
      | { full_name?: string; email?: string; academy_batches?: { batch_name?: string } | Array<{ batch_name?: string }> }
      | Array<{ full_name?: string; email?: string; academy_batches?: { batch_name?: string } | Array<{ batch_name?: string }> }>
      | null;
    const application = Array.isArray(app) ? app[0] : app;
    const batch = Array.isArray(application?.academy_batches)
      ? application?.academy_batches[0]
      : application?.academy_batches;
    const mastery = masteryByEnrollment.get(String(row.id)) ?? [];
    const learnerName = application?.full_name ?? '';
    const learnerEmail = application?.email ?? '';
    return {
      enrollmentId: String(row.id),
      userId: String(row.user_id),
      learnerName,
      learnerEmail,
      batchName: batch?.batch_name ?? '',
      currentStage: String(row.current_stage),
      topicsTouched: mastery.length,
      topicsRequired,
      topicsPublished,
      mastered: mastery.filter((m) => m.state === 'MASTERED').length,
      passedWithHold: mastery.filter((m) => m.state === 'PASSED').length,
      remediation: mastery.filter((m) => m.state === 'REMEDIATION_REQUIRED').length,
      openHolds: holdsByEnrollment.get(String(row.id)) ?? 0,
      certificate: certificateByEnrollment.get(String(row.id)) ?? null,
    };
  });

  const q = filter.q?.trim().toLowerCase();
  const filtered = q
    ? mapped.filter(
        (r) =>
          r.learnerName.toLowerCase().includes(q) ||
          r.learnerEmail.toLowerCase().includes(q) ||
          r.batchName.toLowerCase().includes(q),
      )
    : mapped;

  return { rows: filtered, total: q ? filtered.length : count ?? mapped.length };
}
