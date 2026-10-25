// TMFA practical assessment — learner flow and scoring invariants.
//
// These lock the rules that make practical work a real mastery gate:
//   - the same exact integer 85% gate as the quiz, computed only from criteria,
//   - rubric and evidence validation at the boundary,
//   - one editable draft, attempts counted only after submit,
//   - the rubric and pass mark frozen at submit so later edits cannot re-grade,
//   - a practical hold that survives manual-hold clearing and restores mastery,
//   - history remains readable after an assessment is withdrawn.
//
// No database is touched. Supabase is mocked because the service module imports
// the admin client type.

import { describe, it, expect, vi } from 'vitest';

vi.mock('@/lib/supabase/server', () => ({
  createAdminClient: () => {
    throw new Error('These tests use an in-memory client.');
  },
}));

import {
  PRACTICAL_MIN_FAILURE_FEEDBACK,
  PracticalError,
  applyPracticalGradeToHolds,
  ensurePracticalPendingHold,
  loadPracticalForLearner,
  normalizePracticalAssessmentInput,
  normalizePracticalEvidence,
  normalizePracticalGradeInput,
  savePracticalDraft,
  scorePracticalSubmission,
  submitPracticalSubmission,
  validatePracticalRubric,
} from '@/src/server/services/academy/topics/practical';
import {
  LEARNER,
  RUBRIC,
  assessmentRow,
  asDb,
  makeDb,
  submissionRow,
  type Row,
} from './practical-db';

function scores(story: number, craft: number, sound: number) {
  return [
    { criterionId: 'story', points: story, comment: '' },
    { criterionId: 'craft', points: craft, comment: '' },
    { criterionId: 'sound', points: sound, comment: '' },
  ];
}

async function expectPracticalError(
  promise: Promise<unknown>,
  status: number,
  code: string,
): Promise<void> {
  const error = await promise.then(
    () => null,
    (reason: unknown) => reason,
  );
  expect(error).toBeInstanceOf(PracticalError);
  expect((error as PracticalError).status).toBe(status);
  expect((error as PracticalError).code).toBe(code);
}

function hold(over: Row = {}): Row {
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

describe('practical scoring gate', () => {
  it('passes exactly 85/100 and fails 84/100', () => {
    const passed = scorePracticalSubmission(RUBRIC, scores(34, 25, 26), 85);
    expect(passed).toMatchObject({
      earnedPoints: 85,
      possiblePoints: 100,
      percentage: 85,
      passed: true,
      threshold: 85,
    });

    const failed = scorePracticalSubmission(RUBRIC, scores(34, 25, 25), 85);
    expect(failed.earnedPoints).toBe(84);
    expect(failed.percentage).toBe(84);
    expect(failed.passed).toBe(false);
  });

  it('honours a stricter academy pass mark without rounding', () => {
    expect(scorePracticalSubmission(RUBRIC, scores(40, 30, 30), 100).passed).toBe(true);
    expect(scorePracticalSubmission(RUBRIC, scores(39, 30, 30), 100).passed).toBe(false);
  });

  it('ignores any percentage a reviewer might attach to a score row', () => {
    const withClaimedPercentage = [
      { criterionId: 'story', points: 0, comment: '', percentage: 100 },
      { criterionId: 'craft', points: 0, comment: '', percentage: 100 },
      { criterionId: 'sound', points: 0, comment: '', percentage: 100 },
    ] as unknown as ReturnType<typeof scores>;

    const result = scorePracticalSubmission(RUBRIC, withClaimedPercentage, 85);
    expect(result.earnedPoints).toBe(0);
    expect(result.percentage).toBe(0);
    expect(result.passed).toBe(false);
  });

  it('fails closed on a rubric with no possible points', () => {
    expect(scorePracticalSubmission([], [], 85).passed).toBe(false);
  });
});

describe('assessment authoring validation', () => {
  const base = {
    title: 'Direct a one-minute scene',
    briefMarkdown: 'Produce a scene that demonstrates blocking and continuity.',
    submissionInstructions: 'Upload a viewable link.',
    rubric: RUBRIC,
  };

  it('defaults the pass mark to 85, attempts to 3, and leaves the gate closed', () => {
    const input = normalizePracticalAssessmentInput(base);
    expect(input.passPercent).toBe(85);
    expect(input.maxAttempts).toBe(3);
    expect(input.active).toBe(false);
    expect(input.submissionInstructions).toBe('Upload a viewable link.');
  });

  it('only treats an explicit boolean true as an open gate', () => {
    expect(normalizePracticalAssessmentInput({ ...base, active: true }).active).toBe(true);
    expect(normalizePracticalAssessmentInput({ ...base, active: 'true' }).active).toBe(false);
    expect(normalizePracticalAssessmentInput({ ...base, active: 1 }).active).toBe(false);
  });

  it('refuses a title or brief that would leave a learner guessing', async () => {
    await expectPracticalError(
      Promise.resolve().then(() => normalizePracticalAssessmentInput({ ...base, title: 'AB' })),
      400,
      'PRACTICAL_TITLE_REQUIRED',
    );
    await expectPracticalError(
      Promise.resolve().then(() => normalizePracticalAssessmentInput({ ...base, briefMarkdown: 'Too short' })),
      400,
      'PRACTICAL_BRIEF_REQUIRED',
    );
  });

  it('enforces the academy pass-mark floor and the attempt range', async () => {
    for (const passPercent of [84, 85.5, 101]) {
      await expectPracticalError(
        Promise.resolve().then(() => normalizePracticalAssessmentInput({ ...base, passPercent })),
        400,
        'PRACTICAL_PASS_THRESHOLD_BELOW_POLICY',
      );
    }
    for (const maxAttempts of [0, 11, 2.5]) {
      await expectPracticalError(
        Promise.resolve().then(() => normalizePracticalAssessmentInput({ ...base, maxAttempts })),
        400,
        'PRACTICAL_ATTEMPTS_INVALID',
      );
    }
  });

  it('requires at least one rubric criterion and no more than ten', async () => {
    await expectPracticalError(
      Promise.resolve().then(() => validatePracticalRubric([])),
      400,
      'PRACTICAL_RUBRIC_REQUIRED',
    );
    const eleven = Array.from({ length: 11 }, (_, index) => ({
      id: `criterion-${index}`,
      label: `Criterion ${index}`,
      description: '',
      maxPoints: 10,
    }));
    await expectPracticalError(
      Promise.resolve().then(() => validatePracticalRubric(eleven)),
      400,
      'PRACTICAL_RUBRIC_TOO_LARGE',
    );
  });

  it('normalises ids and rejects duplicates, bad ids and impossible points', async () => {
    expect(
      validatePracticalRubric([{ id: ' Story ', label: 'Story', description: '', maxPoints: 40 }])[0].id,
    ).toBe('story');

    await expectPracticalError(
      Promise.resolve().then(() =>
        validatePracticalRubric([
          { id: 'story', label: 'Story', description: '', maxPoints: 40 },
          { id: 'Story', label: 'Story again', description: '', maxPoints: 40 },
        ]),
      ),
      400,
      'PRACTICAL_RUBRIC_ID_DUPLICATE',
    );

    await expectPracticalError(
      Promise.resolve().then(() =>
        validatePracticalRubric([{ id: 'not valid!', label: 'Story', description: '', maxPoints: 40 }]),
      ),
      400,
      'PRACTICAL_RUBRIC_ID_INVALID',
    );

    for (const maxPoints of [0, 101, 4.5]) {
      await expectPracticalError(
        Promise.resolve().then(() =>
          validatePracticalRubric([{ id: 'story', label: 'Story', description: '', maxPoints }]),
        ),
        400,
        'PRACTICAL_RUBRIC_POINTS_INVALID',
      );
    }
  });
});

describe('submission evidence validation', () => {
  it('allows an empty draft so a learner can save partial notes', () => {
    expect(normalizePracticalEvidence({})).toEqual({
      submissionText: '',
      mediaUrl: '',
      mediaNote: '',
    });
  });

  it('accepts only http(s) media links', async () => {
    expect(normalizePracticalEvidence({ mediaUrl: 'https://example.test/cut.mp4' }).mediaUrl)
      .toBe('https://example.test/cut.mp4');
    await expectPracticalError(
      Promise.resolve().then(() => normalizePracticalEvidence({ mediaUrl: 'ftp://example.test/cut.mp4' })),
      400,
      'PRACTICAL_URL_INVALID',
    );
    await expectPracticalError(
      Promise.resolve().then(() => normalizePracticalEvidence({ mediaUrl: 'javascript:alert(1)' })),
      400,
      'PRACTICAL_URL_INVALID',
    );
  });

  it('enforces the written, link and note limits', async () => {
    await expectPracticalError(
      Promise.resolve().then(() => normalizePracticalEvidence({ submissionText: 'x'.repeat(20_001) })),
      400,
      'PRACTICAL_INPUT_TOO_LONG',
    );
    await expectPracticalError(
      Promise.resolve().then(() =>
        normalizePracticalEvidence({ mediaUrl: `https://example.test/${'x'.repeat(2_000)}` }),
      ),
      400,
      'PRACTICAL_INPUT_TOO_LONG',
    );
    await expectPracticalError(
      Promise.resolve().then(() => normalizePracticalEvidence({ mediaNote: 'x'.repeat(2_001) })),
      400,
      'PRACTICAL_INPUT_TOO_LONG',
    );
  });

  it('requires a complete score set against the frozen rubric', async () => {
    await expectPracticalError(
      Promise.resolve().then(() => normalizePracticalGradeInput(RUBRIC, { scores: scores(40, 30, 0).slice(0, 2) })),
      400,
      'PRACTICAL_SCORES_INCOMPLETE',
    );
    await expectPracticalError(
      Promise.resolve().then(() =>
        normalizePracticalGradeInput(RUBRIC, {
          scores: [
            { criterionId: 'story', points: 40, comment: '' },
            { criterionId: 'story', points: 30, comment: '' },
            { criterionId: 'sound', points: 30, comment: '' },
          ],
        }),
      ),
      400,
      'PRACTICAL_SCORE_DUPLICATE',
    );
    await expectPracticalError(
      Promise.resolve().then(() =>
        normalizePracticalGradeInput(RUBRIC, { scores: scores(41, 30, 30) }),
      ),
      400,
      'PRACTICAL_SCORE_OUT_OF_RANGE',
    );
  });

  it('trims reviewer feedback and keeps it inside the stored limit', () => {
    const input = normalizePracticalGradeInput(RUBRIC, {
      scores: scores(40, 30, 30),
      feedback: '  Clear, controlled work.  ',
    });
    expect(input.feedback).toBe('Clear, controlled work.');
  });
});

describe('learner practical state', () => {
  it('offers the practical once the topic is published and no prerequisite blocks it', async () => {
    const db = makeDb();

    const view = await loadPracticalForLearner(asDb(db), LEARNER, 'A01');

    expect(view.assessment?.title).toBe('Direct a one-minute scene');
    expect(view.eligibility).toMatchObject({
      canSubmit: true,
      reason: null,
      attemptsUsed: 0,
      maxAttempts: 3,
      passed: false,
      inReview: false,
      draftSubmissionId: null,
    });
  });

  it('does not let an open hold on this topic block its own practical', async () => {
    const db = makeDb({ holds: [hold()] });

    const view = await loadPracticalForLearner(asDb(db), LEARNER, 'A01');

    expect(view.eligibility.canSubmit).toBe(true);
  });

  it('blocks the practical until every prerequisite is passed without an open hold', async () => {
    const topic = {
      topic_id: 'A01',
      title: 'Directing fundamentals',
      published: true,
      prerequisites: ['A00'],
    };
    const mastery = [
      {
        enrollment_id: 'enr-1',
        user_id: 'user-1',
        topic_id: 'A00',
        state: 'PASSED',
        passed_at: '2026-10-01T09:00:00.000Z',
      },
    ];

    const clear = await loadPracticalForLearner(
      asDb(makeDb({ topic, mastery })),
      LEARNER,
      'A01',
    );
    expect(clear.eligibility.canSubmit).toBe(true);

    const held = await loadPracticalForLearner(
      asDb(
        makeDb({
          topic,
          mastery,
          holds: [{ id: 'h0', enrollment_id: 'enr-1', topic_id: 'A00', status: 'open', source: 'manual' }],
        }),
      ),
      LEARNER,
      'A01',
    );
    expect(held.eligibility.canSubmit).toBe(false);
    expect(held.eligibility.reason).toBe(
      'Pass every required earlier topic at 85% or higher before opening this practical.',
    );
  });

  it('hides a withdrawn assessment that has no history for the learner', async () => {
    const db = makeDb({ assessments: [assessmentRow({ active: false })] });

    const view = await loadPracticalForLearner(asDb(db), LEARNER, 'A01');

    expect(view.assessment).toBeNull();
    expect(view.eligibility.canSubmit).toBe(false);
    expect(view.eligibility.reason).toBe('The practical assessment is not open yet.');
  });

  it('keeps a graded result and feedback readable after withdrawal', async () => {
    const graded = submissionRow({
      status: 'graded',
      submitted_at: '2026-10-20T10:00:00.000Z',
      graded_at: '2026-10-21T09:00:00.000Z',
      earned_points: 90,
      possible_points: 100,
      percentage: 90,
      passed: true,
      rubric_scores: scores(37, 28, 25),
      feedback: 'Strong blocking; tighten the ending.',
    });
    const db = makeDb({
      assessments: [assessmentRow({ active: false })],
      submissions: [graded],
    });

    const view = await loadPracticalForLearner(asDb(db), LEARNER, 'A01');

    expect(view.assessment).not.toBeNull();
    expect(view.submissions).toHaveLength(1);
    expect(view.submissions[0]).toMatchObject({
      status: 'graded',
      passed: true,
      percentage: 90,
      feedback: 'Strong blocking; tighten the ending.',
    });
    expect(view.submissions[0].rubricSnapshot).toHaveLength(3);
    expect(view.eligibility.passed).toBe(true);
    expect(view.eligibility.canSubmit).toBe(false);
  });
});

describe('draft and submission lifecycle', () => {
  it('creates one draft, then updates it without spending an attempt', async () => {
    const db = makeDb();

    const created = await savePracticalDraft(asDb(db), LEARNER, 'A01', {
      submissionText: 'First pass at the blocking plan.',
      mediaUrl: '',
      mediaNote: '',
    });
    expect(created).toMatchObject({ status: 'draft', attemptNumber: 1 });
    expect(created.submissionText).toBe('First pass at the blocking plan.');
    expect(db.rows('film_practical_submissions')).toHaveLength(1);

    const updated = await savePracticalDraft(asDb(db), LEARNER, 'A01', {
      submissionText: 'Final blocking plan attached.',
      mediaUrl: 'https://example.test/cut.mp4',
      mediaNote: 'One-minute cut.',
    });
    expect(updated.id).toBe(created.id);
    expect(updated.submissionText).toBe('Final blocking plan attached.');
    expect(updated.mediaUrl).toBe('https://example.test/cut.mp4');
    expect(updated.attemptNumber).toBe(1);
    expect(db.rows('film_practical_submissions')).toHaveLength(1);
  });

  it('refuses a new draft after the practical has been passed', async () => {
    const db = makeDb({
      submissions: [
        submissionRow({ status: 'graded', passed: true, earned_points: 90, possible_points: 100, percentage: 90 }),
      ],
    });

    await expectPracticalError(
      savePracticalDraft(asDb(db), LEARNER, 'A01', { submissionText: 'Another attempt.' }),
      409,
      'PRACTICAL_ALREADY_PASSED',
    );
    expect(db.insertsFor('film_practical_submissions')).toHaveLength(0);
  });

  it('refuses a draft once every attempt has been used', async () => {
    const db = makeDb({
      submissions: [1, 2, 3].map((attempt) =>
        submissionRow({
          id: `ps-${attempt}`,
          attempt_number: attempt,
          status: 'graded',
          passed: false,
          earned_points: 50,
          possible_points: 100,
          percentage: 50,
        }),
      ),
    });

    await expectPracticalError(
      savePracticalDraft(asDb(db), LEARNER, 'A01', { submissionText: 'One more go.' }),
      409,
      'PRACTICAL_ATTEMPTS_EXHAUSTED',
    );
  });

  it('refuses to save while an earlier submission is still with a reviewer', async () => {
    const db = makeDb({ submissions: [submissionRow({ status: 'submitted' })] });

    await expectPracticalError(
      savePracticalDraft(asDb(db), LEARNER, 'A01', { submissionText: 'Changed my mind.' }),
      409,
      'PRACTICAL_IN_REVIEW',
    );
  });

  it('freezes the rubric and pass mark at submit and is idempotent on replay', async () => {
    const draft = submissionRow({
      status: 'draft',
      submission_text: 'I directed the scene and operated the camera.',
      media_url: '',
      media_note: '',
      rubric_snapshot: [],
      submitted_at: null,
      created_at: '2026-10-20T09:00:00.000Z',
    });
    const db = makeDb({ submissions: [draft] });

    const submitted = await submitPracticalSubmission(asDb(db), LEARNER, 'A01', 'ps-1');

    expect(submitted.status).toBe('submitted');
    expect(submitted.submittedAt).not.toBeNull();
    expect(submitted.rubricSnapshot).toEqual(RUBRIC);
    expect(db.rows('film_practical_submissions')).toHaveLength(1);
    expect(db.rows('film_practical_submissions')[0].attempt_number).toBe(1);
    expect(db.upsertsFor('film_mastery_events')).toHaveLength(1);
    expect(db.insertsFor('film_academic_audit')).toHaveLength(1);

    const replayed = await submitPracticalSubmission(asDb(db), LEARNER, 'A01', 'ps-1');
    expect(replayed.id).toBe(submitted.id);
    expect(replayed.submittedAt).toBe(submitted.submittedAt);
    expect(db.rows('film_practical_submissions')).toHaveLength(1);
    // A replay must not emit a second event or audit row.
    expect(db.upsertsFor('film_mastery_events')).toHaveLength(1);
    expect(db.insertsFor('film_academic_audit')).toHaveLength(1);
  });

  it('refuses to submit an empty draft', async () => {
    const db = makeDb({
      submissions: [
        submissionRow({
          status: 'draft',
          submission_text: '',
          media_url: '',
          media_note: '',
          rubric_snapshot: [],
          submitted_at: null,
        }),
      ],
    });

    await expectPracticalError(
      submitPracticalSubmission(asDb(db), LEARNER, 'A01', 'ps-1'),
      400,
      'PRACTICAL_EVIDENCE_REQUIRED',
    );
    expect(db.rows('film_practical_submissions')[0].status).toBe('draft');
  });

  it('refuses another submission after a pass', async () => {
    const db = makeDb({
      submissions: [
        submissionRow({ id: 'ps-pass', status: 'graded', passed: true, earned_points: 90, possible_points: 100, percentage: 90 }),
        submissionRow({
          id: 'ps-draft',
          attempt_number: 2,
          status: 'draft',
          rubric_snapshot: [],
          submitted_at: null,
        }),
      ],
    });

    await expectPracticalError(
      submitPracticalSubmission(asDb(db), LEARNER, 'A01', 'ps-draft'),
      409,
      'PRACTICAL_ALREADY_PASSED',
    );
  });
});

describe('practical holds', () => {
  it('does nothing when the topic has no active assessment', async () => {
    const db = makeDb({ assessments: [assessmentRow({ active: false })] });

    await expect(ensurePracticalPendingHold(asDb(db), LEARNER, 'A01')).resolves.toBe(false);
    expect(db.insertsFor('film_mastery_holds')).toHaveLength(0);
  });

  it('opens one workflow hold for a passed quiz with no practical pass', async () => {
    const db = makeDb();

    await expect(ensurePracticalPendingHold(asDb(db), LEARNER, 'A01')).resolves.toBe(true);

    const inserted = db.insertsFor('film_mastery_holds');
    expect(inserted).toHaveLength(1);
    expect(inserted[0]).toMatchObject({
      enrollment_id: 'enr-1',
      topic_id: 'A01',
      hold_type: 'PRACTICAL_PENDING',
      status: 'open',
      source: 'practical_assessment',
      source_ref: 'pa-1',
    });
  });

  it('is idempotent when the workflow hold is already open', async () => {
    const db = makeDb({ holds: [hold()] });

    await expect(ensurePracticalPendingHold(asDb(db), LEARNER, 'A01')).resolves.toBe(true);
    expect(db.insertsFor('film_mastery_holds')).toHaveLength(0);
  });

  it('does not hold a learner who already passed the practical', async () => {
    const db = makeDb({
      submissions: [submissionRow({ status: 'graded', passed: true, earned_points: 90, possible_points: 100, percentage: 90 })],
    });

    await expect(ensurePracticalPendingHold(asDb(db), LEARNER, 'A01')).resolves.toBe(false);
    expect(db.insertsFor('film_mastery_holds')).toHaveLength(0);
  });

  it('clears only the workflow hold on a pass and restores MASTERED', async () => {
    const db = makeDb({
      holds: [hold()],
      mastery: [
        {
          id: 'm1',
          enrollment_id: 'enr-1',
          user_id: 'user-1',
          topic_id: 'A01',
          state: 'PASSED',
          passed_at: '2026-10-10T10:00:00.000Z',
          mastered_at: null,
        },
      ],
    });

    const state = await applyPracticalGradeToHolds(
      asDb(db),
      'admin-1',
      LEARNER,
      'A01',
      { id: 'pa-1', title: 'Direct a one-minute scene' },
      true,
      'Excellent work.',
    );

    expect(state).toBe('MASTERED');
    expect(db.rows('film_mastery_holds')[0]).toMatchObject({
      status: 'cleared',
      clearance_note: 'Practical assessment passed.',
    });
    expect(db.rows('film_topic_mastery')[0]).toMatchObject({ state: 'MASTERED' });
  });

  it('does not clear a manual hold or restore mastery while it remains open', async () => {
    const db = makeDb({
      holds: [hold(), hold({ id: 'manual-1', source: 'manual', hold_type: 'ACADEMIC_INTEGRITY' })],
      mastery: [
        {
          id: 'm1',
          enrollment_id: 'enr-1',
          user_id: 'user-1',
          topic_id: 'A01',
          state: 'PASSED',
          passed_at: '2026-10-10T10:00:00.000Z',
        },
      ],
    });

    const state = await applyPracticalGradeToHolds(
      asDb(db),
      'admin-1',
      LEARNER,
      'A01',
      { id: 'pa-1', title: 'Direct a one-minute scene' },
      true,
      'Excellent work.',
    );

    expect(state).toBeNull();
    const manual = db.rows('film_mastery_holds').find((row) => row.id === 'manual-1');
    expect(manual).toMatchObject({ status: 'open', source: 'manual' });
    expect(db.rows('film_topic_mastery')[0].state).toBe('PASSED');
  });

  it('converts the pending hold to PRACTICAL_FAILED and caps MASTERED at PASSED', async () => {
    const db = makeDb({
      holds: [hold()],
      mastery: [
        {
          id: 'm1',
          enrollment_id: 'enr-1',
          user_id: 'user-1',
          topic_id: 'A01',
          state: 'MASTERED',
          passed_at: '2026-10-10T10:00:00.000Z',
        },
      ],
    });

    const state = await applyPracticalGradeToHolds(
      asDb(db),
      'admin-1',
      LEARNER,
      'A01',
      { id: 'pa-1', title: 'Direct a one-minute scene' },
      false,
      'The sound mix obscures the dialogue.',
    );

    expect(state).toBe('PASSED');
    expect(db.rows('film_mastery_holds')[0]).toMatchObject({
      status: 'open',
      hold_type: 'PRACTICAL_FAILED',
      source: 'practical_assessment',
    });
    expect(String(db.rows('film_mastery_holds')[0].reason)).toContain(
      'The sound mix obscures the dialogue.',
    );
    expect(db.rows('film_topic_mastery')[0].state).toBe('PASSED');
  });

  it('records a failure hold when none was open', async () => {
    const db = makeDb();

    await applyPracticalGradeToHolds(
      asDb(db),
      'admin-1',
      LEARNER,
      'A01',
      { id: 'pa-1', title: 'Direct a one-minute scene' },
      false,
      'The sound mix obscures the dialogue.',
    );

    const inserted = db.insertsFor('film_mastery_holds');
    expect(inserted).toHaveLength(1);
    expect(inserted[0]).toMatchObject({
      hold_type: 'PRACTICAL_FAILED',
      status: 'open',
      source: 'practical_assessment',
      source_ref: 'pa-1',
    });
  });
});

describe('reviewer feedback floor', () => {
  it('states the minimum feedback length for a failed practical', () => {
    expect(PRACTICAL_MIN_FAILURE_FEEDBACK).toBe(10);
  });
});
