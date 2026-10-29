// Learner-facing topic path and detail.
//
// Everything here is derived from persisted records: publication gates, the
// mastery ledger, holds, and the approved question pool. Nothing is inferred
// from a client flag. A locked topic reveals its title and outcomes only; the
// teaching article is withheld until the server says the topic is published.
//
// One exception is honoured, and it is server-side and audited: a course opened
// for pilot delivery stands in for "published" and "reviewed pool" so the
// sequence can be taught before review. Prerequisites, the 85% rule and holds
// still apply unchanged, and every such topic reports pilot: true so no screen
// can present it as published curriculum.

import { createAdminClient } from '@/lib/supabase/server';
import {
  MIN_APPROVED_ITEMS_PER_TOPIC,
  evaluateTopicPublication,
  type MediaPublicationInput,
  type TopicLearnerState,
  type TopicOutcome,
  type PublicationBlocker,
} from './types';
import { loadActivePilotCourseIds, loadPilotUsableQuestionCounts } from './pilot';

type Db = ReturnType<typeof createAdminClient>;

interface CourseRow {
  course_id: string;
  title: string;
  kind: 'acting' | 'craft';
  stage_label: string;
  order_index: number;
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
  accessible_equivalent_approved: boolean;
  accessible_equivalent_note: string;
}

interface MasteryRow {
  topic_id: string;
  state: string;
  best_score: number | string | null;
  best_attempt_id: string | null;
  attempts_count: number;
  passed_at: string | null;
  mastered_at: string | null;
  last_attempt_at: string | null;
}

interface HoldRow {
  topic_id: string;
  hold_type: string;
  reason: string;
}

interface AttemptRow {
  id: string;
  topic_id: string;
  attempt_state: string;
  attempt_number: number;
  percentage: number | string | null;
  passed: boolean | null;
  earned_points: number | null;
  max_points: number | null;
  pass_threshold: number;
  started_at: string;
  submitted_at: string | null;
  server_deadline: string;
}

interface MediaRow {
  asset_id: string;
  topic_id: string;
  media_type: string;
  required: boolean;
  language: string;
  production_state: string;
  rights_status: string;
  accessibility_status: string;
  instructions: string;
  media_url: string;
  thumbnail_url: string;
  captions_url: string;
  transcript: string;
  alt_text: string;
}

export interface LearnerIdentity {
  userId: string;
  enrollmentId: string;
}

export interface TopicResultSummary {
  attemptId: string;
  percentage: number;
  earnedPoints: number;
  possiblePoints: number;
  passed: boolean;
  threshold: number;
  submittedAt: string | null;
}

export interface TopicMediaView {
  assetId: string;
  mediaType: string;
  required: boolean;
  language: string;
  productionState: string;
  rightsStatus: string;
  accessibilityStatus: string;
  published: boolean;
  instructions: string;
  url: string;
  thumbnailUrl: string;
  captionsUrl: string;
  transcript: string;
  altText: string;
}

export interface TopicPathItem {
  topicId: string;
  courseId: string;
  courseTitle: string;
  stage: string;
  stageLabel: string;
  title: string;
  outcomes: TopicOutcome[];
  orderIndex: number;
  prerequisites: string[];
  state: TopicLearnerState;
  published: boolean;
  /** True when this topic is only reachable because its course is in pilot delivery. */
  pilot: boolean;
  contentStatus: string;
  quizMinimumPercent: number;
  drawCount: number;
  approvedQuestionCount: number;
  poolReady: boolean;
  canStartQuiz: boolean;
  blockerCode: string | null;
  blockerMessage: string | null;
  bestScore: number | null;
  attemptsCount: number;
  passedAt: string | null;
  masteredAt: string | null;
  lastResult: TopicResultSummary | null;
  openHolds: Array<{ type: string; reason: string }>;
  media: {
    total: number;
    required: number;
    published: number;
    pending: number;
  };
}

export interface TopicPathCourse {
  courseId: string;
  title: string;
  kind: 'acting' | 'craft';
  stageLabel: string;
  topics: TopicPathItem[];
}

export interface TopicPath {
  courses: TopicPathCourse[];
  summary: {
    totalTopics: number;
    publishedTopics: number;
    masteredTopics: number;
    inProgressTopics: number;
    remediationTopics: number;
    percentMastered: number;
  };
  eventsCursor: number;
}

export interface TopicDetail extends TopicPathItem {
  article: string | null;
  articleLocked: boolean;
  mediaAssets: TopicMediaView[];
  publicationBlockers: PublicationBlocker[];
  holds: Array<{ type: string; reason: string }>;
  attempts: TopicResultSummary[];
  nextTopicId: string | null;
  previousTopicId: string | null;
}

interface TopicStateContext {
  published: boolean;
  poolReady: boolean;
  /** The topic's course is open for audited pilot delivery. Never true in production. */
  pilotDelivery: boolean;
  /** Under pilot, enough unreviewed items exist to build a form of quiz_draw_count. */
  pilotPoolReady: boolean;
  prerequisitesMastered: boolean;
  masteryState: string | null;
  passed: boolean;
  hasOpenHold: boolean;
  hasOpenAttempt: boolean;
  lastAttemptFailed: boolean;
}

export interface TopicStateDecision {
  state: TopicLearnerState;
  canStartQuiz: boolean;
  blockerCode: string | null;
  blockerMessage: string | null;
}

/**
 * Pure progression rule. The server — not the mobile navigation — decides
 * whether a topic is reachable. A PASSED topic with an open hold is deliberately
 * not MASTERED, so the next topic stays locked until the hold is cleared.
 *
 * `pilotDelivery` relaxes only the delivery preconditions (published, reviewed
 * pool). The prerequisite chain, holds, remediation and the pass threshold are
 * identical either way, so a pilot course still unlocks topic by topic.
 */
export function deriveTopicState(ctx: TopicStateContext): TopicStateDecision {
  const openForDelivery = ctx.published || ctx.pilotDelivery;
  const poolForDelivery = ctx.poolReady || (ctx.pilotDelivery && ctx.pilotPoolReady);
  if (ctx.masteryState === 'MASTERED' && !ctx.hasOpenHold) {
    return { state: 'MASTERED', canStartQuiz: false, blockerCode: null, blockerMessage: null };
  }
  if (ctx.passed) {
    if (ctx.hasOpenHold) {
      return {
        state: 'PASSED',
        canStartQuiz: false,
        blockerCode: 'HOLD_OPEN',
        blockerMessage: 'The quiz is passed, but a practical or review hold must be cleared before the next topic unlocks.',
      };
    }
    return { state: 'MASTERED', canStartQuiz: false, blockerCode: null, blockerMessage: null };
  }
  if (ctx.hasOpenAttempt) {
    return { state: 'IN_PROGRESS', canStartQuiz: true, blockerCode: null, blockerMessage: null };
  }
  if (ctx.lastAttemptFailed) {
    return {
      state: 'REMEDIATION_REQUIRED',
      canStartQuiz: openForDelivery && poolForDelivery,
      blockerCode: poolForDelivery ? null : 'QUIZ_POOL_INSUFFICIENT',
      blockerMessage: poolForDelivery ? null : poolMessage(ctx),
    };
  }
  if (!openForDelivery) {
    return {
      state: 'LOCKED',
      canStartQuiz: false,
      blockerCode: 'TOPIC_NOT_PUBLISHED',
      blockerMessage: 'This topic has not completed academic publication review.',
    };
  }
  if (!ctx.prerequisitesMastered) {
    return {
      state: 'LOCKED',
      canStartQuiz: false,
      blockerCode: 'PREREQUISITE_INCOMPLETE',
      blockerMessage: 'Pass every required earlier topic at 85% or higher before opening this one.',
    };
  }
  if (ctx.hasOpenHold) {
    return {
      state: 'LOCKED',
      canStartQuiz: false,
      blockerCode: 'HOLD_OPEN',
      blockerMessage: 'A practical, safety or review hold must be cleared before this topic opens.',
    };
  }
  if (!poolForDelivery) {
    return {
      state: 'LOCKED',
      canStartQuiz: false,
      blockerCode: 'QUIZ_POOL_INSUFFICIENT',
      blockerMessage: poolMessage(ctx),
    };
  }
  return { state: 'AVAILABLE', canStartQuiz: true, blockerCode: null, blockerMessage: null };
}

/** The pool shortfall, described as it actually is under a pilot exception. */
function poolMessage(ctx: TopicStateContext): string {
  return ctx.pilotDelivery
    ? 'This pilot topic does not have enough questions to build a quiz form yet.'
    : `At least ${MIN_APPROVED_ITEMS_PER_TOPIC} approved questions are required before this topic quiz can run.`;
}

function numeric(value: number | string | null | undefined): number | null {
  if (value === null || value === undefined) return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function summarize(attempt: AttemptRow): TopicResultSummary {
  return {
    attemptId: attempt.id,
    percentage: numeric(attempt.percentage) ?? 0,
    earnedPoints: Number(attempt.earned_points ?? 0),
    possiblePoints: Number(attempt.max_points ?? 0),
    passed: attempt.passed === true,
    threshold: Number(attempt.pass_threshold ?? 85),
    submittedAt: attempt.submitted_at,
  };
}

function mediaGateInput(rows: MediaRow[]): MediaPublicationInput[] {
  return rows.map((m) => ({
    assetId: m.asset_id,
    mediaType: m.media_type,
    required: m.required,
    productionState: m.production_state,
    rightsStatus: m.rights_status,
    accessibilityStatus: m.accessibility_status,
    mediaUrl: m.media_url,
  }));
}

function isFuture(iso: string, now: number): boolean {
  return new Date(iso).getTime() > now;
}

export async function loadTopicPath(db: Db, learner: LearnerIdentity): Promise<TopicPath> {
  const [
    coursesRes,
    topicsRes,
    masteryRes,
    holdsRes,
    attemptsRes,
    questionsRes,
    mediaRes,
    cursorRes,
    pilotCourseIds,
    pilotPoolCounts,
  ] = await Promise.all([
      db.from('film_courses').select('course_id, title, kind, stage_label, order_index').order('order_index'),
      db
        .from('film_topics')
        .select(
          'topic_id, course_id, stage, stage_label, title, lesson_markdown, content_status, quiz_minimum_percent, quiz_draw_count, quiz_time_limit_minutes, media_status, learning_outcomes, required_media, prerequisites, order_index, published, accessible_equivalent_approved, accessible_equivalent_note',
        )
        .order('order_index'),
      db
        .from('film_topic_mastery')
        .select('topic_id, state, best_score, best_attempt_id, attempts_count, passed_at, mastered_at, last_attempt_at')
        .eq('enrollment_id', learner.enrollmentId),
      db
        .from('film_mastery_holds')
        .select('topic_id, hold_type, reason')
        .eq('enrollment_id', learner.enrollmentId)
        .eq('status', 'open'),
      db
        .from('film_topic_attempts')
        .select(
          'id, topic_id, attempt_state, attempt_number, percentage, passed, earned_points, max_points, pass_threshold, started_at, submitted_at, server_deadline',
        )
        .eq('enrollment_id', learner.enrollmentId)
        .order('started_at', { ascending: false })
        .limit(500),
      db
        .from('academy_question_items')
        .select('id, film_topic_id')
        .eq('academy_scope', 'film')
        .eq('status', 'approved'),
      db
        .from('film_topic_media')
        .select('asset_id, topic_id, media_type, required, language, production_state, rights_status, accessibility_status, instructions, media_url, thumbnail_url, captions_url, transcript, alt_text'),
      db
        .from('film_mastery_events')
        .select('id')
        .eq('user_id', learner.userId)
        .order('id', { ascending: false })
        .limit(1)
        .maybeSingle(),
      loadActivePilotCourseIds(db),
      loadPilotUsableQuestionCounts(db),
    ]);

  if (coursesRes.error) throw new Error('Could not load the academy courses.');
  if (topicsRes.error) throw new Error('Could not load the academy topics.');
  if (masteryRes.error) throw new Error('Could not load topic mastery.');
  if (holdsRes.error) throw new Error('Could not load academic holds.');
  if (attemptsRes.error) throw new Error('Could not load quiz attempts.');
  if (questionsRes.error) throw new Error('Could not load the approved question pool.');
  if (mediaRes.error) throw new Error('Could not load teaching media status.');

  const courses = (coursesRes.data ?? []) as unknown as CourseRow[];
  const topics = (topicsRes.data ?? []) as unknown as TopicRow[];
  const mastery = (masteryRes.data ?? []) as unknown as MasteryRow[];
  const holds = (holdsRes.data ?? []) as unknown as HoldRow[];
  const attempts = (attemptsRes.data ?? []) as unknown as AttemptRow[];
  const questionRows = (questionsRes.data ?? []) as unknown as Array<{ id: string; film_topic_id: string | null }>;
  const media = (mediaRes.data ?? []) as unknown as MediaRow[];
  const cursor = Number((cursorRes.data as { id?: number } | null)?.id ?? 0);

  const approvedByTopic = new Map<string, number>();
  for (const q of questionRows) {
    if (!q.film_topic_id) continue;
    approvedByTopic.set(q.film_topic_id, (approvedByTopic.get(q.film_topic_id) ?? 0) + 1);
  }

  const masteryByTopic = new Map(mastery.map((m) => [m.topic_id, m]));
  const holdsByTopic = new Map<string, HoldRow[]>();
  for (const hold of holds) {
    const list = holdsByTopic.get(hold.topic_id) ?? [];
    list.push(hold);
    holdsByTopic.set(hold.topic_id, list);
  }
  const mediaByTopic = new Map<string, MediaRow[]>();
  for (const asset of media) {
    const list = mediaByTopic.get(asset.topic_id) ?? [];
    list.push(asset);
    mediaByTopic.set(asset.topic_id, list);
  }

  const now = Date.now();
  const latestAttemptByTopic = new Map<string, AttemptRow>();
  const openAttemptByTopic = new Map<string, AttemptRow>();
  for (const attempt of attempts) {
    if (!latestAttemptByTopic.has(attempt.topic_id)) latestAttemptByTopic.set(attempt.topic_id, attempt);
    if (
      attempt.attempt_state === 'in_progress' &&
      !openAttemptByTopic.has(attempt.topic_id) &&
      isFuture(attempt.server_deadline, now)
    ) {
      openAttemptByTopic.set(attempt.topic_id, attempt);
    }
  }

  const topicsByCourse = new Map<string, TopicRow[]>();
  for (const topic of topics) {
    const list = topicsByCourse.get(topic.course_id) ?? [];
    list.push(topic);
    topicsByCourse.set(topic.course_id, list);
  }

  const stateByTopic = new Map<string, TopicStateDecision>();
  const pathCourses: TopicPathCourse[] = [];
  let masteredTopics = 0;
  let publishedTopics = 0;
  let inProgressTopics = 0;
  let remediationTopics = 0;

  for (const course of courses) {
    const courseTopics = (topicsByCourse.get(course.course_id) ?? []).slice().sort((a, b) => a.order_index - b.order_index);
    const items: TopicPathItem[] = [];

    for (const topic of courseTopics) {
      const topicMedia = mediaByTopic.get(topic.topic_id) ?? [];
      const approvedQuestionCount = approvedByTopic.get(topic.topic_id) ?? 0;
      const poolReady = approvedQuestionCount >= Math.max(MIN_APPROVED_ITEMS_PER_TOPIC, topic.quiz_draw_count);
      // A pilot stands in for publication and for a reviewed pool — nothing else.
      const pilotDelivery = pilotCourseIds.has(topic.course_id);
      const pilotPoolReady =
        pilotDelivery && (pilotPoolCounts.get(topic.topic_id) ?? 0) >= Math.max(1, topic.quiz_draw_count);
      // A prerequisite is satisfied only when its own resolved state is MASTERED.
      // Checking against the mastery row alone would let a hold-blocked PASSED
      // topic unlock the next one.
      const prerequisitesMastered = topic.prerequisites.every(
        (id) => stateByTopic.get(id)?.state === 'MASTERED',
      );
      const topicHolds = holdsByTopic.get(topic.topic_id) ?? [];
      const rowMastery = masteryByTopic.get(topic.topic_id);
      const openAttempt = openAttemptByTopic.get(topic.topic_id);
      const latest = latestAttemptByTopic.get(topic.topic_id);
      const passed = rowMastery?.passed_at != null || rowMastery?.state === 'PASSED' || rowMastery?.state === 'MASTERED';

      const decision = deriveTopicState({
        published: topic.published,
        poolReady,
        pilotDelivery,
        pilotPoolReady,
        prerequisitesMastered,
        masteryState: rowMastery?.state ?? null,
        passed,
        hasOpenHold: topicHolds.length > 0,
        hasOpenAttempt: Boolean(openAttempt),
        lastAttemptFailed: latest?.attempt_state === 'scored' && latest.passed === false,
      });
      stateByTopic.set(topic.topic_id, decision);

      if (decision.state === 'MASTERED') masteredTopics += 1;
      if (decision.state === 'IN_PROGRESS') inProgressTopics += 1;
      if (decision.state === 'REMEDIATION_REQUIRED') remediationTopics += 1;
      if (topic.published) publishedTopics += 1;

      const publishedMedia = topicMedia.filter(
        (m) => m.required && m.production_state === 'PUBLISHED' && m.rights_status === 'CLEARED' && m.accessibility_status === 'PASSED',
      ).length;
      const requiredMedia = topicMedia.filter((m) => m.required).length;

      items.push({
        topicId: topic.topic_id,
        courseId: course.course_id,
        courseTitle: course.title,
        stage: topic.stage,
        stageLabel: topic.stage_label || topic.stage,
        title: topic.title,
        outcomes: topic.learning_outcomes ?? [],
        orderIndex: topic.order_index,
        prerequisites: topic.prerequisites ?? [],
        state: decision.state,
        published: topic.published,
        pilot: pilotDelivery && !topic.published,
        contentStatus: topic.content_status,
        quizMinimumPercent: Math.max(85, Number(topic.quiz_minimum_percent ?? 85)),
        drawCount: Number(topic.quiz_draw_count ?? 10),
        approvedQuestionCount,
        poolReady,
        canStartQuiz: decision.canStartQuiz,
        blockerCode: decision.blockerCode,
        blockerMessage: decision.blockerMessage,
        bestScore: numeric(rowMastery?.best_score),
        attemptsCount: Number(rowMastery?.attempts_count ?? 0),
        passedAt: rowMastery?.passed_at ?? null,
        masteredAt: rowMastery?.mastered_at ?? null,
        lastResult: latest?.attempt_state === 'scored' ? summarize(latest) : null,
        openHolds: topicHolds.map((h) => ({ type: h.hold_type, reason: h.reason })),
        media: { total: topicMedia.length, required: requiredMedia, published: publishedMedia, pending: requiredMedia - publishedMedia },
      });
    }

    pathCourses.push({
      courseId: course.course_id,
      title: course.title,
      kind: course.kind,
      stageLabel: course.stage_label,
      topics: items,
    });
  }

  const totalTopics = topics.length;
  return {
    courses: pathCourses,
    summary: {
      totalTopics,
      publishedTopics,
      masteredTopics,
      inProgressTopics,
      remediationTopics,
      percentMastered: totalTopics > 0 ? Math.round((masteredTopics * 10000) / totalTopics) / 100 : 0,
    },
    eventsCursor: cursor,
  };
}

export interface TopicLookup {
  topic: TopicRow;
  course: CourseRow;
}

export async function loadTopicForLearner(
  db: Db,
  learner: LearnerIdentity,
  topicId: string,
): Promise<TopicDetail | null> {
  const { data: topicData, error: topicError } = await db
    .from('film_topics')
    .select(
      'topic_id, course_id, stage, stage_label, title, lesson_markdown, content_status, quiz_minimum_percent, quiz_draw_count, quiz_time_limit_minutes, media_status, learning_outcomes, required_media, prerequisites, order_index, published, accessible_equivalent_approved, accessible_equivalent_note',
    )
    .eq('topic_id', topicId)
    .maybeSingle();
  if (topicError) throw new Error('Could not load the topic.');
  if (!topicData) return null;
  const topic = topicData as unknown as TopicRow;

  const [courseRes, masteryRes, holdsRes, attemptsRes, questionsRes, mediaRes, pathRes] = await Promise.all([
    db.from('film_courses').select('course_id, title, kind, stage_label, order_index').eq('course_id', topic.course_id).maybeSingle(),
    db
      .from('film_topic_mastery')
      .select('topic_id, state, best_score, best_attempt_id, attempts_count, passed_at, mastered_at, last_attempt_at')
      .eq('enrollment_id', learner.enrollmentId)
      .eq('topic_id', topicId)
      .maybeSingle(),
    db
      .from('film_mastery_holds')
      .select('topic_id, hold_type, reason')
      .eq('enrollment_id', learner.enrollmentId)
      .eq('topic_id', topicId)
      .eq('status', 'open'),
    db
      .from('film_topic_attempts')
      .select(
        'id, topic_id, attempt_state, attempt_number, percentage, passed, earned_points, max_points, pass_threshold, started_at, submitted_at, server_deadline',
      )
      .eq('enrollment_id', learner.enrollmentId)
      .eq('topic_id', topicId)
      .order('started_at', { ascending: false })
      .limit(20),
    db
      .from('academy_question_items')
      .select('id', { count: 'exact', head: true })
      .eq('academy_scope', 'film')
      .eq('status', 'approved')
      .eq('film_topic_id', topicId),
    db
      .from('film_topic_media')
      .select('asset_id, topic_id, media_type, required, language, production_state, rights_status, accessibility_status, instructions, media_url, thumbnail_url, captions_url, transcript, alt_text')
      .eq('topic_id', topicId),
    // Reuse the path builder so detail and path can never disagree about lock state.
    loadTopicPath(db, learner),
  ]);

  if (courseRes.error || !courseRes.data) throw new Error('Could not load the topic course.');
  const course = courseRes.data as unknown as CourseRow;
  const rowMastery = (masteryRes.data ?? null) as unknown as MasteryRow | null;
  const holds = (holdsRes.data ?? []) as unknown as HoldRow[];
  const attempts = (attemptsRes.data ?? []) as unknown as AttemptRow[];
  const approvedQuestionCount = questionsRes.count ?? 0;
  const mediaRows = (mediaRes.data ?? []) as unknown as MediaRow[];

  const pathItem = pathRes.courses.flatMap((c) => c.topics).find((t) => t.topicId === topicId);
  if (!pathItem) throw new Error('Could not resolve the topic state.');

  const latest = attempts[0];
  const publication = evaluateTopicPublication({
    topicId,
    contentStatus: topic.content_status,
    lessonMarkdown: topic.lesson_markdown,
    approvedQuestionCount,
    drawCount: topic.quiz_draw_count,
    quizMinimumPercent: topic.quiz_minimum_percent,
    media: mediaGateInput(mediaRows),
    accessibleEquivalentApproved: topic.accessible_equivalent_approved,
    accessibleEquivalentNote: topic.accessible_equivalent_note,
  });

  const ordered = pathRes.courses.flatMap((c) => c.topics);
  const index = ordered.findIndex((t) => t.topicId === topicId);
  const next = ordered.slice(index + 1).find((t) => t.courseId === topic.course_id) ?? null;
  const previous = [...ordered].slice(0, index).reverse().find((t) => t.courseId === topic.course_id) ?? null;

  // A pilot topic is taught from unreviewed material by design; the screen says
  // so via `pilot`, and the publication blockers below stay visible so nobody
  // can mistake the exception for a signed-off lesson.
  const articleUnlocked = topic.published || pathItem.pilot;
  return {
    ...pathItem,
    article: articleUnlocked ? topic.lesson_markdown : null,
    articleLocked: !articleUnlocked,
    mediaAssets: mediaRows.map((m) => ({
      assetId: m.asset_id,
      mediaType: m.media_type,
      required: m.required,
      language: m.language,
      productionState: m.production_state,
      rightsStatus: m.rights_status,
      accessibilityStatus: m.accessibility_status,
      published:
        m.production_state === 'PUBLISHED' &&
        m.rights_status === 'CLEARED' &&
        m.accessibility_status === 'PASSED',
      instructions: articleUnlocked ? m.instructions : '',
      // Never leak a file URL for an asset that has not passed the gate.
      url: articleUnlocked && m.production_state === 'PUBLISHED' ? m.media_url : '',
      thumbnailUrl: articleUnlocked && m.production_state === 'PUBLISHED' ? m.thumbnail_url : '',
      captionsUrl: articleUnlocked && m.production_state === 'PUBLISHED' ? m.captions_url : '',
      transcript: articleUnlocked && m.production_state === 'PUBLISHED' ? m.transcript : '',
      altText: articleUnlocked && m.production_state === 'PUBLISHED' ? m.alt_text : '',
    })),
    publicationBlockers: publication.blockers,
    holds: holds.map((h) => ({ type: h.hold_type, reason: h.reason })),
    attempts: attempts.filter((a) => a.attempt_state === 'scored').map(summarize),
    nextTopicId: next?.topicId ?? null,
    previousTopicId: previous?.topicId ?? null,
    lastResult: latest?.attempt_state === 'scored' ? summarize(latest) : pathItem.lastResult,
    bestScore: numeric(rowMastery?.best_score),
    attemptsCount: Number(rowMastery?.attempts_count ?? 0),
  };
}

export interface MasteryEvent {
  id: number;
  topicId: string | null;
  eventType: string;
  payload: Record<string, unknown>;
  createdAt: string;
}

export async function listMasteryEvents(
  db: Db,
  userId: string,
  sinceId: number,
  limit = 50,
): Promise<{ events: MasteryEvent[]; cursor: number }> {
  const { data, error } = await db
    .from('film_mastery_events')
    .select('id, topic_id, event_type, payload, created_at')
    .eq('user_id', userId)
    .gt('id', sinceId)
    .order('id', { ascending: true })
    .limit(Math.min(Math.max(limit, 1), 100));
  if (error) throw new Error('Could not load progression events.');
  const rows = (data ?? []) as unknown as Array<{
    id: number | string;
    topic_id: string | null;
    event_type: string;
    payload: Record<string, unknown>;
    created_at: string;
  }>;
  const events = rows.map((row) => ({
    id: Number(row.id),
    topicId: row.topic_id,
    eventType: row.event_type,
    payload: row.payload ?? {},
    createdAt: row.created_at,
  }));
  return { events, cursor: events.length > 0 ? events[events.length - 1].id : sinceId };
}
