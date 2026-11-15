// Film Academy pilot delivery — one audited exception, deliberately narrow.
//
// Publication is a faculty/SME act and cannot be faked: the curriculum is
// unreviewed, so every topic is honestly Locked. A pilot unlock lets an
// administrator run one course for real learners ANYWAY, but only by standing in
// for two preconditions — "the topic is published" and "the question pool is
// reviewed". Everything else keeps working: the prerequisite sequence, the exact
// 85% threshold, holds, remediation and the server-owned attempt lifecycle.
//
// What it can never do:
//   • write film_topics.published, content_status or any question's status;
//   • issue a credential — certificates count PUBLISHED topics, so a pilot
//     completion is invisible to them by construction;
//   • operate in production. The flag is ignored under NODE_ENV=production, and
//     a learner path that cannot read this table falls back to fully locked
//     rather than erroring, because a pilot is an opt-in exception, not a
//     dependency.

import { createAdminClient } from '@/lib/supabase/server';
import { featureFlags } from '@/src/lib/feature-flags';

import { asActorId, TopicAdminError } from './admin';

type Db = ReturnType<typeof createAdminClient>;

/** A reason shorter than this is not a reason. Mirrors the database CHECK. */
export const PILOT_NOTE_MIN_LENGTH = 10;

/** True only when an operator asked for it AND this is not a production server. */
export function pilotDeliveryEnabled(): boolean {
  if (process.env.NODE_ENV === 'production') return false;
  return featureFlags.filmAcademyPilotDelivery();
}

/** Courses whose pilot unlock is currently active. Empty when pilot delivery is off. */
export async function loadActivePilotCourseIds(db: Db): Promise<Set<string>> {
  if (!pilotDeliveryEnabled()) return new Set();
  const { data, error } = await db
    .from('film_pilot_unlocks')
    .select('course_id')
    .is('revoked_at', null);
  if (error) {
    console.error('[film/pilot] pilot unlock load failed; treating every course as locked', error);
    return new Set();
  }
  return new Set((data as Array<{ course_id: string }> | null ?? []).map((row) => row.course_id));
}

export interface PilotUnlockView {
  courseId: string;
  active: boolean;
  note: string;
  enabledAt: string;
  revokedAt: string | null;
  topicCount: number;
  entryTopicIds: string[];
}

function requireNote(note: string): string {
  const trimmed = (note ?? '').trim();
  if (trimmed.length < PILOT_NOTE_MIN_LENGTH) {
    throw new TopicAdminError(
      400,
      'PILOT_NOTE_REQUIRED',
      `Pilot delivery needs a written reason of at least ${PILOT_NOTE_MIN_LENGTH} characters; it is recorded in the academic audit trail.`,
    );
  }
  return trimmed;
}

async function requirePilotEnabled(): Promise<void> {
  if (pilotDeliveryEnabled()) return;
  throw new TopicAdminError(
    503,
    'PILOT_UNAVAILABLE',
    process.env.NODE_ENV === 'production'
      ? 'Pilot delivery is never available in production. Publish the curriculum through faculty and SME review instead.'
      : 'Pilot delivery is disabled. Set FEATURE_FILM_ACADEMY_PILOT_DELIVERY_ENABLED to use it outside production.',
  );
}

async function loadCourseShape(db: Db, courseId: string) {
  const { data: course, error: courseError } = await db
    .from('film_courses')
    .select('course_id, title')
    .eq('course_id', courseId)
    .maybeSingle();
  if (courseError) {
    console.error('[film/pilot] course lookup failed', courseError);
    throw new TopicAdminError(500, 'PILOT_LOAD_FAILED', 'Could not check the course. Please try again.');
  }
  if (!course) {
    throw new TopicAdminError(404, 'COURSE_NOT_FOUND', 'Course not found.');
  }

  const { data: topics, error: topicsError } = await db
    .from('film_topics')
    .select('topic_id, prerequisites, published')
    .eq('course_id', courseId);
  if (topicsError) {
    console.error('[film/pilot] topic lookup failed', topicsError);
    throw new TopicAdminError(500, 'PILOT_LOAD_FAILED', 'Could not check the course topics. Please try again.');
  }
  const rows = (topics ?? []) as unknown as Array<{
    topic_id: string;
    prerequisites: string[] | null;
    published: boolean;
  }>;
  const publishedAlready = rows.filter((row) => row.published).map((row) => row.topic_id);
  const entryTopicIds = rows
    .filter((row) => (row.prerequisites ?? []).length === 0)
    .map((row) => row.topic_id);
  return {
    title: (course as { title: string }).title,
    topicCount: rows.length,
    publishedAlready,
    entryTopicIds,
  };
}

async function writeAudit(
  db: Db,
  actorId: string,
  action: string,
  courseId: string,
  before: Record<string, unknown>,
  after: Record<string, unknown>,
  reason: string,
): Promise<void> {
  const { error } = await db.from('film_academic_audit').insert({
    actor_id: asActorId(actorId),
    actor_role: 'admin',
    action,
    target_type: 'film_course',
    target_id: courseId,
    before,
    after,
    reason,
  });
  if (error) console.error('[film/pilot] audit insert failed', action, error);
}

/**
 * Open one course for pilot delivery. Records the exception and its reason;
 * touches no content, status or approval anywhere else.
 */
export async function setCoursePilotUnlock(
  db: Db,
  input: { courseId: string; actorId: string; note: string },
): Promise<PilotUnlockView> {
  await requirePilotEnabled();
  const note = requireNote(input.note);
  const course = await loadCourseShape(db, input.courseId);

  if (course.topicCount === 0) {
    throw new TopicAdminError(
      409,
      'PILOT_COURSE_EMPTY',
      'This course has no topics yet, so a pilot unlock would open nothing. Import the curriculum first.',
    );
  }

  const now = new Date().toISOString();
  const { data: written, error } = await db
    .from('film_pilot_unlocks')
    .upsert(
      {
        course_id: input.courseId,
        note,
        enabled_by: asActorId(input.actorId),
        enabled_at: now,
        revoked_by: null,
        revoked_at: null,
        updated_at: now,
      },
      { onConflict: 'course_id' },
    )
    .select()
    .maybeSingle();
  if (error || !written) {
    console.error('[film/pilot] pilot unlock write failed', error);
    throw new TopicAdminError(500, 'PILOT_WRITE_FAILED', 'Could not record the pilot unlock. Please try again.');
  }

  await writeAudit(
    db,
    input.actorId,
    'FILM_PILOT_UNLOCKED',
    input.courseId,
    { pilotActive: false, publishedTopics: course.publishedAlready.length },
    {
      pilotActive: true,
      note,
      topicCount: course.topicCount,
      entryTopicIds: course.entryTopicIds,
      // The point of the exception: these topics stay UNPUBLISHED and are simply
      // delivered unreviewed. Nothing here pretends they were approved.
      publishedTopicsAfter: course.publishedAlready.length,
    },
    note,
  );

  return {
    courseId: input.courseId,
    active: true,
    note,
    enabledAt: now,
    revokedAt: null,
    topicCount: course.topicCount,
    entryTopicIds: course.entryTopicIds,
  };
}

/** Close the exception. Topics fall back to whatever their real state is. */
export async function revokeCoursePilotUnlock(
  db: Db,
  input: { courseId: string; actorId: string; note: string },
): Promise<PilotUnlockView> {
  await requirePilotEnabled();
  const note = requireNote(input.note);
  const course = await loadCourseShape(db, input.courseId);

  const { data: existing, error: readError } = await db
    .from('film_pilot_unlocks')
    .select('course_id, note, enabled_at, revoked_at')
    .eq('course_id', input.courseId)
    .is('revoked_at', null)
    .maybeSingle();
  if (readError) {
    console.error('[film/pilot] pilot state read failed', readError);
    throw new TopicAdminError(500, 'PILOT_LOAD_FAILED', 'Could not check the pilot state. Please try again.');
  }
  if (!existing) {
    throw new TopicAdminError(409, 'PILOT_NOT_ACTIVE', 'This course is not open for pilot delivery.');
  }

  const now = new Date().toISOString();
  const { error } = await db
    .from('film_pilot_unlocks')
    .update({ revoked_by: asActorId(input.actorId), revoked_at: now, updated_at: now })
    .eq('course_id', input.courseId);
  if (error) {
    console.error('[film/pilot] pilot revoke failed', error);
    throw new TopicAdminError(500, 'PILOT_WRITE_FAILED', 'Could not close the pilot unlock. Please try again.');
  }

  await writeAudit(
    db,
    input.actorId,
    'FILM_PILOT_REVOKED',
    input.courseId,
    { pilotActive: true, note: (existing as { note: string }).note },
    { pilotActive: false, topicCount: course.topicCount },
    note,
  );

  return {
    courseId: input.courseId,
    active: false,
    note,
    enabledAt: new Date((existing as { enabled_at: string }).enabled_at).toISOString(),
    revokedAt: now,
    topicCount: course.topicCount,
    entryTopicIds: course.entryTopicIds,
  };
}

/**
 * How many draw-usable items each topic has when unreviewed ones are allowed in.
 * Empty whenever pilot delivery is off, so the normal approved-only pool rule is
 * never influenced by a disabled exception.
 */
export async function loadPilotUsableQuestionCounts(db: Db): Promise<Map<string, number>> {
  if (!pilotDeliveryEnabled()) return new Map();
  const { data, error } = await db
    .from('academy_question_items')
    .select('film_topic_id')
    .eq('academy_scope', 'film')
    .neq('status', 'retired');
  if (error) {
    console.error('[film/pilot] usable question count load failed; pilot topics stay pool-locked', error);
    return new Map();
  }
  const counts = new Map<string, number>();
  for (const row of (data as Array<{ film_topic_id: string | null }> | null ?? [])) {
    if (!row.film_topic_id) continue;
    counts.set(row.film_topic_id, (counts.get(row.film_topic_id) ?? 0) + 1);
  }
  return counts;
}

/** Everything the console needs to show and change pilot state, in one call. */
export interface PilotCourseState {
  courseId: string;
  title: string;
  topicCount: number;
  publishedCount: number;
  entryTopicIds: string[];
  active: boolean;
  note: string | null;
  enabledAt: string | null;
}

export interface PilotConsoleState {
  available: boolean;
  production: boolean;
  courses: PilotCourseState[];
}

export async function loadPilotConsoleState(db: Db): Promise<PilotConsoleState> {
  const available = pilotDeliveryEnabled();
  const [coursesRes, topicsRes, unlocksRes] = await Promise.all([
    db.from('film_courses').select('course_id, title').order('order_index'),
    db.from('film_topics').select('topic_id, course_id, prerequisites, published'),
    available
      ? db.from('film_pilot_unlocks').select('course_id, note, enabled_at, revoked_at')
      : Promise.resolve({ data: [] as Array<Record<string, unknown>>, error: null }),
  ]);

  const courseError = (coursesRes as { error: unknown }).error;
  const topicError = (topicsRes as { error: unknown }).error;
  if (courseError || topicError) {
    console.error('[film/pilot] console state failed', courseError ?? topicError);
    throw new TopicAdminError(500, 'PILOT_LOAD_FAILED', 'Could not load the pilot delivery state.');
  }

  type UnlockRow = { course_id: string; note: string; enabled_at: string; revoked_at: string | null };
  const unlocks = new Map(
    available
      ? ((unlocksRes as { data: UnlockRow[] | null }).data ?? [])
          .filter((row) => row.revoked_at == null)
          .map((row) => [row.course_id, row] as const)
      : [],
  );

  const topicRows = ((topicsRes as { data: Array<Record<string, unknown>> | null }).data ?? []) as unknown as Array<{
    topic_id: string;
    course_id: string;
    prerequisites: string[] | null;
    published: boolean;
  }>;

  const courses = ((coursesRes as { data: Array<{ course_id: string; title: string }> | null }).data ?? []).map(
    (course) => {
      const rows = topicRows.filter((topic) => topic.course_id === course.course_id);
      const unlock = unlocks.get(course.course_id);
      return {
        courseId: course.course_id,
        title: course.title,
        topicCount: rows.length,
        publishedCount: rows.filter((topic) => topic.published).length,
        entryTopicIds: rows.filter((topic) => (topic.prerequisites ?? []).length === 0).map((topic) => topic.topic_id),
        active: unlock != null,
        note: unlock?.note ?? null,
        enabledAt: unlock ? new Date(unlock.enabled_at).toISOString() : null,
      };
    },
  );

  return { available, production: process.env.NODE_ENV === 'production', courses };
}
