// TMFA practical assessment — administration invariants.
//
// These pin the actions that touch learners:
//   - opening the gate backfills PRACTICAL_PENDING holds for learners who
//     already passed the quiz, caps MASTERED at PASSED, and skips learners who
//     already passed the practical or already hold a workflow hold;
//   - withdrawing the gate clears only workflow holds and restores earned mastery;
//   - grading uses the frozen rubric snapshot and the frozen pass mark, never the
//     current draft rubric; the server computes the score;
//   - a failed practical requires actionable feedback;
//   - regrading is idempotent only when the result is identical;
//   - grading after withdrawal changes no holds.
//
// No database is touched. Supabase is mocked because the service modules import
// the admin client type.

import { describe, it, expect, vi } from 'vitest';

vi.mock('@/lib/supabase/server', () => ({
  createAdminClient: () => {
    throw new Error('These tests use an in-memory client.');
  },
}));

import { TopicAdminError } from '@/src/server/services/academy/topics/admin';
import {
  gradePracticalSubmission,
  listPracticalQueue,
  upsertPracticalAssessment,
} from '@/src/server/services/academy/topics/practical-admin';
import {
  RUBRIC,
  assessmentInput,
  assessmentRow,
  asDb,
  makeDb,
  submissionRow,
  type FakeDb,
  type Row,
} from './practical-db';

function scores(story: number, craft: number, sound: number) {
  return [
    { criterionId: 'story', points: story, comment: '' },
    { criterionId: 'craft', points: craft, comment: '' },
    { criterionId: 'sound', points: sound, comment: '' },
  ];
}

async function expectAdminError(
  promise: Promise<unknown>,
  status: number,
  code: string,
): Promise<void> {
  const error = await promise.then(
    () => null,
    (reason: unknown) => reason,
  );
  expect(error).toBeInstanceOf(TopicAdminError);
  expect((error as TopicAdminError).status).toBe(status);
  expect((error as TopicAdminError).code).toBe(code);
}

function mastery(over: Row = {}): Row {
  return {
    id: 'm1',
    enrollment_id: 'enr-1',
    user_id: 'user-1',
    topic_id: 'A01',
    state: 'MASTERED',
    passed_at: '2026-10-10T10:00:00.000Z',
    mastered_at: '2026-10-10T10:00:00.000Z',
    ...over,
  };
}

function workflowHold(over: Row = {}): Row {
  return {
    id: 'hold-1',
    enrollment_id: 'enr-1',
    topic_id: 'A01',
    hold_type: 'PRACTICAL_PENDING',
    reason: 'Complete the practical assessment before this topic can be mastered.',
    status: 'open',
    source: 'practical_assessment',
    source_ref: 'pa-1',
    created_at: '2026-10-01T09:00:00.000Z',
    ...over,
  };
}

function eventPayloads(db: FakeDb, table: string): Row[] {
  return db
    .upsertsFor(table)
    .flatMap((entry) => (Array.isArray(entry.payload) ? entry.payload : [entry.payload]));
}

describe('opening the practical gate', () => {
  it('backfills holds for quiz-passed learners and caps MASTERED at PASSED', async () => {
    const db = makeDb({
      assessments: [assessmentRow({ active: false })],
      mastery: [
        mastery({ enrollment_id: 'enr-1', user_id: 'user-1', state: 'MASTERED' }),
        mastery({ id: 'm2', enrollment_id: 'enr-2', user_id: 'user-2', state: 'MASTERED' }),
        mastery({ id: 'm3', enrollment_id: 'enr-3', user_id: 'user-3', state: 'PASSED' }),
        // A quiz pass is required before the gate applies to this learner.
        mastery({ id: 'm4', enrollment_id: 'enr-4', user_id: 'user-4', state: 'PASSED', passed_at: null }),
      ],
      submissions: [
        submissionRow({
          id: 'ps-3',
          enrollment_id: 'enr-3',
          user_id: 'user-3',
          status: 'graded',
          passed: true,
          earned_points: 90,
          possible_points: 100,
          percentage: 90,
        }),
      ],
      holds: [workflowHold({ id: 'hold-2', enrollment_id: 'enr-2' })],
    });

    const result = await upsertPracticalAssessment(asDb(db), 'admin-1', 'A01', assessmentInput({ active: true }));

    expect(result).toMatchObject({
      created: false,
      gateChanged: 'activated',
      holdsOpened: 1,
      holdsCleared: 0,
    });

    const opened = db.insertsFor('film_mastery_holds');
    expect(opened).toHaveLength(1);
    expect(opened[0]).toMatchObject({
      enrollment_id: 'enr-1',
      topic_id: 'A01',
      hold_type: 'PRACTICAL_PENDING',
      status: 'open',
      source: 'practical_assessment',
      source_ref: 'pa-1',
    });

    const states = new Map(db.rows('film_topic_mastery').map((row) => [row.enrollment_id, row.state]));
    expect(states.get('enr-1')).toBe('PASSED');
    expect(states.get('enr-2')).toBe('MASTERED');
    expect(states.get('enr-3')).toBe('PASSED');
    expect(states.get('enr-4')).toBe('PASSED');

    const events = eventPayloads(db, 'film_mastery_events');
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({
      enrollment_id: 'enr-1',
      topic_id: 'A01',
      event_type: 'TOPIC_HOLD_CREATED',
    });

    const audit = db.insertsFor('film_academic_audit');
    expect(audit).toHaveLength(1);
    expect(audit[0]).toMatchObject({
      action: 'FILM_PRACTICAL_ASSESSMENT_UPDATED',
      target_id: 'A01',
      after: expect.objectContaining({ gateChanged: 'activated', holdsOpened: 1 }),
    });
  });

  it('re-saving an open assessment repairs a missing workflow hold', async () => {
    const db = makeDb({ assessments: [assessmentRow({ active: true })] });

    const result = await upsertPracticalAssessment(asDb(db), 'admin-1', 'A01', assessmentInput({ active: true }));

    expect(result.gateChanged).toBe('unchanged');
    expect(result.holdsOpened).toBe(1);
    expect(db.rows('film_mastery_holds')).toHaveLength(1);
    expect(db.rows('film_topic_mastery')[0].state).toBe('PASSED');
  });
});

describe('withdrawing the practical gate', () => {
  it('clears only workflow holds and restores mastery that was already earned', async () => {
    const db = makeDb({
      assessments: [assessmentRow({ active: true })],
      mastery: [
        mastery({ enrollment_id: 'enr-1', user_id: 'user-1', state: 'PASSED' }),
        mastery({ id: 'm2', enrollment_id: 'enr-2', user_id: 'user-2', state: 'PASSED' }),
      ],
      holds: [
        workflowHold({ id: 'hold-1', enrollment_id: 'enr-1' }),
        workflowHold({ id: 'hold-2', enrollment_id: 'enr-2' }),
        {
          id: 'hold-3',
          enrollment_id: 'enr-2',
          topic_id: 'A01',
          hold_type: 'ACADEMIC_INTEGRITY',
          reason: 'Open integrity review.',
          status: 'open',
          source: 'manual',
        },
      ],
    });

    const result = await upsertPracticalAssessment(asDb(db), 'admin-1', 'A01', assessmentInput({ active: false }));

    expect(result).toMatchObject({
      gateChanged: 'deactivated',
      holdsOpened: 0,
      holdsCleared: 2,
    });

    const holds = new Map(db.rows('film_mastery_holds').map((row) => [row.id, row]));
    expect(holds.get('hold-1')).toMatchObject({
      status: 'cleared',
      clearance_note: 'Practical assessment withdrawn by the academy.',
    });
    expect(holds.get('hold-2')).toMatchObject({ status: 'cleared' });
    expect(holds.get('hold-3')).toMatchObject({ status: 'open', source: 'manual' });

    const states = new Map(db.rows('film_topic_mastery').map((row) => [row.enrollment_id, row.state]));
    expect(states.get('enr-1')).toBe('MASTERED');
    expect(states.get('enr-2')).toBe('PASSED');
    expect(eventPayloads(db, 'film_mastery_events')).toHaveLength(2);
  });

  it('re-saving a withdrawn assessment clears any leftover workflow hold', async () => {
    const db = makeDb({
      assessments: [assessmentRow({ active: false })],
      mastery: [mastery({ state: 'PASSED' })],
      holds: [workflowHold()],
    });

    const result = await upsertPracticalAssessment(asDb(db), 'admin-1', 'A01', assessmentInput({ active: false }));

    expect(result.gateChanged).toBe('unchanged');
    expect(result.holdsCleared).toBe(1);
    expect(db.rows('film_mastery_holds')[0]).toMatchObject({ status: 'cleared' });
    expect(db.rows('film_topic_mastery')[0].state).toBe('MASTERED');
  });
});

describe('grading practical work', () => {
  it('grades a pass, clears the workflow hold and restores MASTERED', async () => {
    const db = makeDb({
      mastery: [mastery({ state: 'PASSED' })],
      holds: [workflowHold()],
      submissions: [submissionRow({ status: 'submitted' })],
    });

    const result = await gradePracticalSubmission(asDb(db), 'admin-1', 'ps-1', {
      scores: scores(40, 30, 30),
      feedback: 'Excellent control of blocking and sound.',
    });

    expect(result).toMatchObject({
      reconciled: false,
      holdEffect: 'applied',
      masteryState: 'MASTERED',
    });
    expect(result.submission).toMatchObject({
      status: 'graded',
      passed: true,
      earnedPoints: 100,
      possiblePoints: 100,
      percentage: 100,
      gradedBy: 'admin-1',
    });
    expect(result.submission.rubricSnapshot).toEqual(RUBRIC);

    expect(db.rows('film_practical_submissions')[0]).toMatchObject({
      status: 'graded',
      passed: true,
      earned_points: 100,
      possible_points: 100,
    });
    expect(db.rows('film_mastery_holds')[0]).toMatchObject({
      status: 'cleared',
      clearance_note: 'Practical assessment passed.',
    });
    expect(db.rows('film_topic_mastery')[0].state).toBe('MASTERED');

    const events = eventPayloads(db, 'film_mastery_events');
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({
      event_type: 'PRACTICAL_PASSED',
      topic_id: 'A01',
      payload: expect.objectContaining({ passed: true, holdEffect: 'applied' }),
    });
    expect(db.insertsFor('film_academic_audit')).toHaveLength(1);
  });

  it('treats an identical replay as reconciled and refuses a conflicting regrade', async () => {
    const db = makeDb({
      mastery: [mastery({ state: 'PASSED' })],
      holds: [workflowHold()],
      submissions: [submissionRow({ status: 'submitted' })],
    });
    const grade = { scores: scores(40, 30, 30), feedback: 'Excellent control of blocking and sound.' };

    await gradePracticalSubmission(asDb(db), 'admin-1', 'ps-1', grade);

    const replay = await gradePracticalSubmission(asDb(db), 'admin-1', 'ps-1', grade);
    expect(replay.reconciled).toBe(true);
    expect(replay.submission.passed).toBe(true);
    expect(db.insertsFor('film_academic_audit')).toHaveLength(1);
    expect(eventPayloads(db, 'film_mastery_events')).toHaveLength(1);

    await expectAdminError(
      gradePracticalSubmission(asDb(db), 'admin-1', 'ps-1', {
        scores: scores(20, 20, 20),
        feedback: 'Changing my mind after the fact.',
      }),
      409,
      'PRACTICAL_ALREADY_GRADED',
    );
  });

  it('requires actionable feedback for a failure and caps MASTERED at PASSED', async () => {
    const db = makeDb({
      mastery: [mastery({ state: 'MASTERED' })],
      holds: [workflowHold()],
      submissions: [submissionRow({ status: 'submitted' })],
    });

    await expectAdminError(
      gradePracticalSubmission(asDb(db), 'admin-1', 'ps-1', {
        scores: scores(10, 10, 10),
        feedback: 'Too short',
      }),
      400,
      'PRACTICAL_FEEDBACK_REQUIRED',
    );
    expect(db.rows('film_practical_submissions')[0].status).toBe('submitted');

    const result = await gradePracticalSubmission(asDb(db), 'admin-1', 'ps-1', {
      scores: scores(10, 10, 10),
      feedback: 'The sound mix obscures dialogue and the cut loses continuity.',
    });

    expect(result.submission).toMatchObject({ passed: false, percentage: 30 });
    expect(result.masteryState).toBe('PASSED');
    expect(db.rows('film_mastery_holds')[0]).toMatchObject({
      hold_type: 'PRACTICAL_FAILED',
      status: 'open',
      source: 'practical_assessment',
    });
    expect(db.rows('film_topic_mastery')[0].state).toBe('PASSED');
    expect(eventPayloads(db, 'film_mastery_events')[0]).toMatchObject({
      event_type: 'PRACTICAL_FAILED',
    });
  });

  it('refuses a draft and a submission with no frozen rubric', async () => {
    const draftDb = makeDb({ submissions: [submissionRow({ status: 'draft' })] });
    await expectAdminError(
      gradePracticalSubmission(asDb(draftDb), 'admin-1', 'ps-1', {
        scores: scores(40, 30, 30),
        feedback: 'Excellent.',
      }),
      409,
      'PRACTICAL_NOT_SUBMITTED',
    );

    const noSnapshotDb = makeDb({
      submissions: [submissionRow({ status: 'submitted', rubric_snapshot: [] })],
    });
    await expectAdminError(
      gradePracticalSubmission(asDb(noSnapshotDb), 'admin-1', 'ps-1', {
        scores: scores(40, 30, 30),
        feedback: 'Excellent.',
      }),
      409,
      'PRACTICAL_RUBRIC_SNAPSHOT_MISSING',
    );
  });

  it('grades against the rubric frozen at submit, not the current draft rubric', async () => {
    const db = makeDb({
      assessments: [
        assessmentRow({
          active: true,
          rubric: [
            { id: 'overall', label: 'Overall', description: 'A single holistic mark.', maxPoints: 10 },
          ],
        }),
      ],
      submissions: [submissionRow({ status: 'submitted' })],
    });

    const result = await gradePracticalSubmission(asDb(db), 'admin-1', 'ps-1', {
      scores: scores(40, 30, 30),
      feedback: 'Measured against the rubric in force at submission.',
    });

    expect(result.submission).toMatchObject({
      possiblePoints: 100,
      earnedPoints: 100,
      percentage: 100,
      passed: true,
    });
  });

  it('does not touch holds when the assessment has been withdrawn', async () => {
    const db = makeDb({
      assessments: [assessmentRow({ active: false })],
      mastery: [mastery({ state: 'PASSED' })],
      holds: [workflowHold()],
      submissions: [submissionRow({ status: 'submitted' })],
    });

    const result = await gradePracticalSubmission(asDb(db), 'admin-1', 'ps-1', {
      scores: scores(40, 30, 30),
      feedback: 'Excellent control of blocking and sound.',
    });

    expect(result.holdEffect).toBe('skipped_inactive');
    expect(result.masteryState).toBe('PASSED');
    expect(db.rows('film_mastery_holds')[0]).toMatchObject({
      status: 'open',
      hold_type: 'PRACTICAL_PENDING',
    });
    expect(db.updatesFor('film_mastery_holds')).toHaveLength(0);
  });
});

describe('practical review queue', () => {
  const submitted = submissionRow({
    id: 'ps-submitted',
    status: 'submitted',
    submitted_at: '2026-10-20T10:00:00.000Z',
    created_at: '2026-10-20T10:00:00.000Z',
  });
  const graded = submissionRow({
    id: 'ps-graded',
    attempt_number: 2,
    status: 'graded',
    submitted_at: '2026-10-18T10:00:00.000Z',
    graded_at: '2026-10-19T10:00:00.000Z',
    created_at: '2026-10-18T10:00:00.000Z',
    earned_points: 90,
    possible_points: 100,
    percentage: 90,
    passed: true,
  });
  const draft = submissionRow({
    id: 'ps-draft',
    attempt_number: 3,
    status: 'draft',
    submitted_at: null,
    created_at: '2026-10-21T10:00:00.000Z',
  });

  it('defaults to submitted work with learner, topic and assessment names', async () => {
    const db = makeDb({ submissions: [submitted, graded, draft] });

    const result = await listPracticalQueue(asDb(db), { page: 1, pageSize: 20 });

    expect(result.total).toBe(1);
    expect(result.pending).toBe(1);
    expect(result.rows).toHaveLength(1);
    expect(result.rows[0]).toMatchObject({
      id: 'ps-submitted',
      status: 'submitted',
      learnerName: 'Ada Obi',
      learnerEmail: 'ada@example.test',
      topicTitle: 'Directing fundamentals',
      assessmentTitle: 'Direct a one-minute scene',
      hasText: true,
      hasMediaUrl: true,
    });
  });

  it('filters a specific status and can list every status for audit', async () => {
    const db = makeDb({ submissions: [submitted, graded, draft] });

    const gradedOnly = await listPracticalQueue(asDb(db), { status: 'graded', page: 1, pageSize: 20 });
    expect(gradedOnly.rows.map((row) => row.id)).toEqual(['ps-graded']);

    const all = await listPracticalQueue(asDb(db), { status: 'all', page: 1, pageSize: 20 });
    expect(all.total).toBe(3);
    expect(all.pending).toBe(1);
    expect(all.rows).toHaveLength(3);

    const paged = await listPracticalQueue(asDb(db), { status: 'all', page: 2, pageSize: 2 });
    expect(paged.total).toBe(3);
    expect(paged.rows).toHaveLength(1);
  });

  it('filters by topic', async () => {
    const db = makeDb({
      submissions: [
        submitted,
        submissionRow({
          id: 'ps-other',
          assessment_id: 'pa-2',
          topic_id: 'A02',
          status: 'submitted',
          submitted_at: '2026-10-22T10:00:00.000Z',
        }),
      ],
    });

    const result = await listPracticalQueue(asDb(db), { topicId: 'A02', page: 1, pageSize: 20 });

    expect(result.total).toBe(1);
    expect(result.rows[0].topicId).toBe('A02');
  });
});
