// TMFA topic mastery — pure-logic release gates.
//
// These lock the three rules that decide whether a learner may move on:
//   1. the exact integer gate (earned * 100 >= possible * 85),
//   2. the academic publication gate (article, question pool, produced media),
//   3. the server-side learner state machine.
// They also prove what the bundled curriculum pack actually contains, so the
// import can never be mistaken for "content ready": every row lands as a draft,
// no question is approved and no media is produced.
//
// Supabase is mocked because import/progress modules import the admin client.
// Nothing here touches a database.

import { describe, it, expect, vi } from 'vitest';

vi.mock('@/lib/supabase/server', () => ({
  createAdminClient: () => {
    throw new Error('Pure tests must not open a Supabase client.');
  },
}));

import {
  passesTopicQuiz,
  displayPercent,
  buildTopicQuizResult,
  evaluateArticleDepth,
  evaluateTopicPublication,
  ARTICLE_DEPTH_STANDARD,
  MEDIA_FILE_TYPES,
  MANDATORY_TOPIC_PASS_PERCENT,
  MIN_APPROVED_ITEMS_PER_TOPIC,
  type MediaPublicationInput,
  type PublicationInput,
} from '@/server/services/academy/topics/types';
import { deriveTopicState } from '@/server/services/academy/topics/progress';
import { evaluateCertificateEligibility } from '@/server/services/academy/topics/certificates';
import {
  buildImportPlan,
  buildBundledImportPlan,
  mediaStateFromManifest,
  type TmfaCurriculumPack,
  type TmfaMediaSource,
  type TmfaQuestionSource,
} from '@/server/services/academy/topics/import';

describe('exact topic mastery gate', () => {
  it('fails 8/10 and passes 9/10', () => {
    expect(passesTopicQuiz(8, 10)).toBe(false);
    expect(passesTopicQuiz(9, 10)).toBe(true);
  });

  it('fails 16/20 and passes 17/20', () => {
    expect(passesTopicQuiz(16, 20)).toBe(false);
    expect(passesTopicQuiz(17, 20)).toBe(true);
  });

  it('treats 85/100 as a pass and 84/100 as a fail', () => {
    expect(passesTopicQuiz(85, 100)).toBe(true);
    expect(passesTopicQuiz(84, 100)).toBe(false);
  });

  it('does not round a sub-85 percentage up', () => {
    // 169/200 is exactly 84.5% — a display percentage rounds it to 85, the gate must not.
    expect(displayPercent(169, 200)).toBe(84.5);
    expect(passesTopicQuiz(169, 200)).toBe(false);
  });

  it('refuses impossible or non-integer inputs instead of treating them as passes', () => {
    expect(passesTopicQuiz(0, 0)).toBe(false);
    expect(passesTopicQuiz(-1, 10)).toBe(false);
    expect(passesTopicQuiz(11, 10)).toBe(false);
    expect(passesTopicQuiz(8.5, 10)).toBe(false);
    expect(passesTopicQuiz(9, 10.5)).toBe(false);
    expect(passesTopicQuiz(9, 10, 85.5)).toBe(false);
    expect(passesTopicQuiz(9, 10, 101)).toBe(false);
  });

  it('builds a result whose display value and gate can disagree without unsafe rounding', () => {
    const failed = buildTopicQuizResult(16, 20);
    expect(failed.percentage).toBe(80);
    expect(failed.passed).toBe(false);
    expect(failed.threshold).toBe(MANDATORY_TOPIC_PASS_PERCENT);

    const passed = buildTopicQuizResult(17, 20);
    expect(passed.percentage).toBe(85);
    expect(passed.passed).toBe(true);
  });

  it('keeps the 85% policy and 20-item pool as named constants', () => {
    expect(MANDATORY_TOPIC_PASS_PERCENT).toBe(85);
    expect(MIN_APPROVED_ITEMS_PER_TOPIC).toBe(20);
  });
});

function media(over: Partial<MediaPublicationInput> = {}): MediaPublicationInput {
  return {
    assetId: 'AST-1',
    mediaType: 'teaching_video',
    required: true,
    productionState: 'PUBLISHED',
    rightsStatus: 'CLEARED',
    accessibilityStatus: 'PASSED',
    mediaUrl: 'https://cdn.example.test/lesson.mp4',
    ...over,
  };
}

/**
 * Synthetic text that clears the mechanical depth floor. It is not curriculum
 * content; it exists so gate tests isolate the rule under test.
 */
function deepArticle(): string {
  return [
    '# Synthetic topic',
    '## Foundations',
    'word '.repeat(300),
    '## Worked example',
    'word '.repeat(250),
    '## Practical exercise',
    'word '.repeat(250),
    '## Self-check before the quiz',
    'word '.repeat(250),
  ].join('\n\n');
}

function publication(over: Partial<PublicationInput> = {}): PublicationInput {
  return {
    topicId: 'A01',
    contentStatus: 'approved',
    lessonMarkdown: deepArticle(),
    approvedQuestionCount: 20,
    drawCount: 10,
    quizMinimumPercent: 85,
    media: [],
    accessibleEquivalentApproved: false,
    accessibleEquivalentNote: '',
    ...over,
  };
}

function codes(input: PublicationInput): string[] {
  return evaluateTopicPublication(input).blockers.map((b) => b.code);
}

describe('topic publication gate', () => {
  it('publishes an approved, well-formed topic', () => {
    const verdict = evaluateTopicPublication(publication());
    expect(verdict.ready).toBe(true);
    expect(verdict.blockers).toEqual([]);
    expect(verdict.requiredMedia).toBe(0);
  });

  it('requires an approved article of teachable length', () => {
    expect(codes(publication({ contentStatus: 'in_review' }))).toContain('CONTENT_NOT_APPROVED');
    expect(codes(publication({ lessonMarkdown: 'x'.repeat(199) }))).toContain('ARTICLE_NOT_TEACHABLE');
    expect(codes(publication({ lessonMarkdown: '   ' }))).toContain('ARTICLE_NOT_TEACHABLE');
  });

  it('requires the article depth standard, not merely 200 characters', () => {
    const shallow = 'The lesson is here. '.repeat(20);
    expect(shallow.trim().length).toBeGreaterThan(200);
    const depth = evaluateArticleDepth(shallow);
    expect(depth.words).toBe(80);
    expect(depth.meetsStandard).toBe(false);
    expect(depth.blockers.map((b) => b.code)).toEqual(expect.arrayContaining([
      'ARTICLE_TOO_SHORT',
      'ARTICLE_NOT_STRUCTURED',
      'ARTICLE_PRACTICAL_MISSING',
      'ARTICLE_SELF_CHECK_MISSING',
    ]));

    const verdictCodes = codes(publication({ lessonMarkdown: 'x'.repeat(200) }));
    expect(verdictCodes).toEqual(expect.arrayContaining([
      'ARTICLE_TOO_SHORT',
      'ARTICLE_NOT_STRUCTURED',
      'ARTICLE_PRACTICAL_MISSING',
      'ARTICLE_SELF_CHECK_MISSING',
    ]));
  });

  it('requires a practical/application heading and a self-check/assessment heading', () => {
    expect(evaluateArticleDepth(deepArticle()).meetsStandard).toBe(true);

    const noPractical = evaluateArticleDepth(deepArticle().replace('## Practical exercise', '## Additional notes'));
    expect(noPractical.blockers.map((b) => b.code)).toContain('ARTICLE_PRACTICAL_MISSING');

    const noSelfCheck = evaluateArticleDepth(deepArticle().replace('## Self-check before the quiz', '## Closing'));
    expect(noSelfCheck.blockers.map((b) => b.code)).toContain('ARTICLE_SELF_CHECK_MISSING');

    const threeSections = [
      '# Synthetic topic',
      '## Foundations',
      'word '.repeat(600),
      '## Practical exercise',
      'word '.repeat(250),
      '## Self-check before the quiz',
      'word '.repeat(250),
    ].join('\n\n');
    const unstructured = evaluateArticleDepth(threeSections);
    expect(unstructured.words).toBeGreaterThanOrEqual(ARTICLE_DEPTH_STANDARD.minWords);
    expect(unstructured.sections).toBe(3);
    expect(unstructured.blockers.map((b) => b.code)).toContain('ARTICLE_NOT_STRUCTURED');
  });

  it('requires at least 20 approved questions, or the draw count if larger', () => {
    expect(codes(publication({ approvedQuestionCount: 19 }))).toContain('QUESTION_POOL_INSUFFICIENT');
    const largerDraw = evaluateTopicPublication(publication({ drawCount: 25 }));
    expect(largerDraw.ready).toBe(false);
    expect(largerDraw.blockers[0].message).toContain('at least 25');
  });

  it('refuses a threshold below the 85% policy floor', () => {
    expect(codes(publication({ quizMinimumPercent: 84 }))).toContain('PASS_THRESHOLD_BELOW_POLICY');
  });

  it('blocks mandatory media that is not published, rights-cleared and accessible', () => {
    expect(codes(publication({ media: [media({ productionState: 'EDITING' })] })))
      .toContain('MANDATORY_MEDIA_NOT_READY');
    expect(codes(publication({ media: [media({ rightsStatus: 'PENDING' })] })))
      .toContain('MANDATORY_MEDIA_NOT_READY');
    expect(codes(publication({ media: [media({ accessibilityStatus: 'FAILED' })] })))
      .toContain('MANDATORY_MEDIA_NOT_READY');
  });

  it('blocks a produced asset with no file URL even when its workflow state says published', () => {
    expect(codes(publication({ media: [media({ mediaUrl: '' })] }))).toContain('MEDIA_FILE_MISSING');
    expect(MEDIA_FILE_TYPES.has('teaching_video')).toBe(true);
    expect(MEDIA_FILE_TYPES.has('transcript')).toBe(false);
  });

  it('does not let optional media block publication', () => {
    const verdict = evaluateTopicPublication(publication({
      media: [media({ required: false, productionState: 'PLANNED', mediaUrl: '' })],
    }));
    expect(verdict.ready).toBe(true);
    expect(verdict.requiredMedia).toBe(0);
  });

  it('honours an authorised accessible equivalent only with a written rationale', () => {
    const weak = codes(publication({
      media: [media({ productionState: 'PLANNED' })],
      accessibleEquivalentApproved: true,
      accessibleEquivalentNote: 'too short',
    }));
    expect(weak).toContain('MANDATORY_MEDIA_NOT_READY');

    const signed = evaluateTopicPublication(publication({
      media: [media({ productionState: 'PLANNED', mediaUrl: '' })],
      accessibleEquivalentApproved: true,
      accessibleEquivalentNote: 'Faculty-approved transcript supplied as the accessible equivalent.',
    }));
    expect(signed.ready).toBe(true);
  });

  it('does not accept a rationale without the approval flag', () => {
    expect(codes(publication({
      media: [media({ productionState: 'PLANNED' })],
      accessibleEquivalentApproved: false,
      accessibleEquivalentNote: 'Faculty-approved transcript supplied as the accessible equivalent.',
    }))).toContain('MANDATORY_MEDIA_NOT_READY');
  });
});

const readyContext = {
  published: true,
  poolReady: true,
  prerequisitesMastered: true,
  masteryState: null as string | null,
  passed: false,
  hasOpenHold: false,
  hasOpenAttempt: false,
  lastAttemptFailed: false,
};

describe('server-owned learner state machine', () => {
  it('marks a passed, hold-free topic MASTERED and not re-startable', () => {
    const d = deriveTopicState({ ...readyContext, passed: true });
    expect(d.state).toBe('MASTERED');
    expect(d.canStartQuiz).toBe(false);
  });

  it('keeps a passed topic at PASSED while a hold is open', () => {
    const d = deriveTopicState({ ...readyContext, passed: true, hasOpenHold: true });
    expect(d.state).toBe('PASSED');
    expect(d.blockerCode).toBe('HOLD_OPEN');
    expect(d.canStartQuiz).toBe(false);
  });

  it('resumes an open attempt', () => {
    const d = deriveTopicState({ ...readyContext, hasOpenAttempt: true });
    expect(d.state).toBe('IN_PROGRESS');
    expect(d.canStartQuiz).toBe(true);
  });

  it('requires remediation after a failed attempt but allows a retake once the pool exists', () => {
    const d = deriveTopicState({ ...readyContext, lastAttemptFailed: true });
    expect(d.state).toBe('REMEDIATION_REQUIRED');
    expect(d.canStartQuiz).toBe(true);

    const noPool = deriveTopicState({ ...readyContext, lastAttemptFailed: true, poolReady: false });
    expect(noPool.state).toBe('REMEDIATION_REQUIRED');
    expect(noPool.canStartQuiz).toBe(false);
    expect(noPool.blockerCode).toBe('QUIZ_POOL_INSUFFICIENT');
  });

  it('locks an unpublished topic regardless of personal progress', () => {
    const d = deriveTopicState({ ...readyContext, published: false });
    expect(d.state).toBe('LOCKED');
    expect(d.blockerCode).toBe('TOPIC_NOT_PUBLISHED');
  });

  it('locks a topic whose earlier topic is not mastered', () => {
    const d = deriveTopicState({ ...readyContext, prerequisitesMastered: false });
    expect(d.state).toBe('LOCKED');
    expect(d.blockerCode).toBe('PREREQUISITE_INCOMPLETE');
  });

  it('locks a topic while a hold is open', () => {
    const d = deriveTopicState({ ...readyContext, hasOpenHold: true });
    expect(d.state).toBe('LOCKED');
    expect(d.blockerCode).toBe('HOLD_OPEN');
  });

  it('locks a topic without a reviewed question pool', () => {
    const d = deriveTopicState({ ...readyContext, poolReady: false });
    expect(d.state).toBe('LOCKED');
    expect(d.blockerCode).toBe('QUIZ_POOL_INSUFFICIENT');
  });

  it('opens a published, prerequisite-complete topic', () => {
    const d = deriveTopicState(readyContext);
    expect(d.state).toBe('AVAILABLE');
    expect(d.canStartQuiz).toBe(true);
    expect(d.blockerCode).toBeNull();
  });
});

describe('certificate eligibility', () => {
  const earned = {
    topicsRequired: 72,
    topicsPublished: 72,
    topicsMastered: 72,
    openHolds: 0,
  };

  it('issues only when every topic is published, mastered and hold-free', () => {
    const r = evaluateCertificateEligibility(earned);
    expect(r.eligible).toBe(true);
    expect(r.blockers).toEqual([]);
  });

  it('withholds the credential while the curriculum is incomplete or withdrawn', () => {
    const r = evaluateCertificateEligibility({ ...earned, topicsPublished: 1, topicsMastered: 1 });
    expect(r.eligible).toBe(false);
    expect(r.blockers.map((b) => b.code)).toContain('CURRICULUM_INCOMPLETE');
    expect(r.blockers.map((b) => b.code)).toContain('TOPICS_INCOMPLETE');
  });

  it('withholds the credential when one topic is unmastered', () => {
    const r = evaluateCertificateEligibility({ ...earned, topicsMastered: 71 });
    expect(r.eligible).toBe(false);
    expect(r.blockers.map((b) => b.code)).toEqual(['TOPICS_INCOMPLETE']);
  });

  it('withholds the credential while a practical hold is open', () => {
    const r = evaluateCertificateEligibility({ ...earned, openHolds: 1 });
    expect(r.eligible).toBe(false);
    expect(r.blockers.map((b) => b.code)).toEqual(['HOLDS_OPEN']);
  });

  it('cannot certify an empty curriculum', () => {
    const r = evaluateCertificateEligibility({
      topicsRequired: 0, topicsPublished: 0, topicsMastered: 0, openHolds: 0,
    });
    expect(r.eligible).toBe(false);
    expect(r.blockers[0].code).toBe('CURRICULUM_EMPTY');
  });

  it('does not let negative or fractional counts satisfy the gate', () => {
    const r = evaluateCertificateEligibility({
      topicsRequired: 10, topicsPublished: -1, topicsMastered: 9.5, openHolds: -3,
    });
    expect(r.eligible).toBe(false);
    expect(r.topicsPublished).toBe(0);
    expect(r.topicsMastered).toBe(9);
  });
});

describe('media workflow mapping', () => {  it('maps manifest notes to production states', () => {
    expect(mediaStateFromManifest('NOT PRODUCED')).toBe('PLANNED');
    expect(mediaStateFromManifest('TEXT DRAFT EXISTS')).toBe('SCRIPTED');
    expect(mediaStateFromManifest('TO PRODUCE')).toBe('PLANNED');
    expect(mediaStateFromManifest('SHOT ON LOCATION')).toBe('CAPTURED');
    expect(mediaStateFromManifest('EDITED')).toBe('EDITED');
    expect(mediaStateFromManifest('PUBLISHED')).toBe('PUBLISHED');
  });
});

function topicSource(over: Partial<TmfaCurriculumPack['topics'][number]> = {}) {
  return {
    topic_id: 'T01',
    course_id: 'ACT',
    course_name: 'Acting',
    stage: 'L1',
    title: 'Synthetic topic',
    lesson_markdown: 'A synthetic article used only by this test. '.repeat(10),
    content_status: 'DRAFT',
    quiz_minimum_percent: 85,
    required_media: [],
    media_status: 'TO PRODUCE',
    learning_outcomes: [{ objective_id: 'OBJ-1', description: 'Synthetic outcome' }],
    ...over,
  };
}

function packOf(topics: ReturnType<typeof topicSource>[]): TmfaCurriculumPack {
  return {
    schema_version: 'test',
    product: 'TMFA',
    minimum_topic_pass_percent: 85,
    question_bank_status: 'synthetic',
    course_count: 1,
    topics,
  };
}

function questionSource(over: Partial<TmfaQuestionSource> = {}): TmfaQuestionSource {
  return {
    question_id: 'Q-1',
    topic_id: 'T01',
    course_id: 'ACT',
    stage: 'L1',
    objective_id: 'OBJ-1',
    question_type: 'single_select',
    cognitive_level: 'remember',
    difficulty: 'easy',
    stem: 'Synthetic question?',
    option_a: 'Alpha',
    option_b: 'Bravo',
    option_c: 'Charlie',
    option_d: 'Delta',
    correct_option: 'A',
    correct_answer: 'Alpha',
    rationale: 'Alpha is the synthetic key.',
    points: '1',
    language: 'en-NG',
    status: 'DRAFT',
    version: '1.0',
    reviewer: '',
    source_note: '',
    ...over,
  };
}

describe('curriculum import plan', () => {
  it('chains topics into prerequisites and defaults every topic to draft', () => {
    const plan = buildImportPlan(
      packOf([topicSource(), topicSource({ topic_id: 'T02', title: 'Second' })]),
      [],
      [],
    );
    expect(plan.topics[0].prerequisites).toEqual([]);
    expect(plan.topics[1].prerequisites).toEqual(['T01']);
    expect(plan.topics.every((t) => t.contentStatus === 'draft')).toBe(true);
  });

  it('raises every declared threshold to the 85% policy floor', () => {
    const plan = buildImportPlan(
      packOf([topicSource({ quiz_minimum_percent: 70 })]),
      [],
      [],
    );
    expect(plan.topics[0].quizMinimumPercent).toBe(85);

    const conflicting = buildImportPlan(
      { ...packOf([topicSource()]), minimum_topic_pass_percent: 70 },
      [],
      [],
    );
    expect(conflicting.warnings.join(' ')).toContain('85%');
  });

  it('skips duplicate topic IDs and media that point at unknown topics', () => {
    const media = [{
      asset_id: 'M-1', topic_id: 'MISSING', course_id: 'ACT', media_type: 'teaching_video',
      required: true, language: 'en-NG', status: 'TO PRODUCE', rights_status: 'NOT REVIEWED',
      accessibility_status: 'NOT REVIEWED', instructions: '',
    }] satisfies TmfaMediaSource[];
    const plan = buildImportPlan(
      packOf([topicSource(), topicSource({ title: 'Duplicate' })]),
      media,
      [],
    );
    expect(plan.topics).toHaveLength(1);
    expect(plan.media).toHaveLength(0);
    expect(plan.warnings.join(' ')).toMatch(/duplicate topic/i);
    expect(plan.warnings.join(' ')).toMatch(/unknown topic/i);
  });

  it('rejects a question whose answer text disagrees with its key', () => {
    const plan = buildImportPlan(packOf([topicSource()]), [], [questionSource({ correct_answer: 'Bravo' })]);
    expect(plan.questions).toHaveLength(0);
    expect(plan.rejectedQuestions[0].code).toBe('KEY_MISMATCH');
  });

  it('rejects a question referencing an undeclared objective', () => {
    const plan = buildImportPlan(packOf([topicSource()]), [], [questionSource({ objective_id: 'OBJ-9' })]);
    expect(plan.rejectedQuestions[0].code).toBe('UNKNOWN_OBJECTIVE');
  });

  it('normalises manifest review states instead of guessing approval', () => {
    const media = [{
      asset_id: 'M-1', topic_id: 'T01', course_id: 'ACT', media_type: 'teaching_video',
      required: true, language: 'en-NG', status: 'NOT PRODUCED', rights_status: 'NOT REVIEWED',
      accessibility_status: 'NOT REVIEWED', instructions: '',
    }] satisfies TmfaMediaSource[];
    const plan = buildImportPlan(packOf([topicSource()]), media, []);
    expect(plan.media[0].productionState).toBe('PLANNED');
    expect(plan.media[0].rightsStatus).toBe('NOT_REVIEWED');
    expect(plan.media[0].accessibilityStatus).toBe('NOT_REVIEWED');
  });

  it('is deterministic for identical input', () => {
    const pack = packOf([topicSource()]);
    const a = buildImportPlan(pack, [], [questionSource()]);
    const b = buildImportPlan(pack, [], [questionSource()]);
    expect(a.sourceHash).toBe(b.sourceHash);
    expect(a.questions[0].sourceHash).toBe(b.questions[0].sourceHash);
  });

  it('imports the bundled TMFA pack as drafts only — no approval, no production', () => {
    const plan = buildBundledImportPlan();
    expect(plan.courses).toHaveLength(13);
    expect(plan.topics).toHaveLength(72);
    expect(plan.media).toHaveLength(864);
    expect(plan.questions).toHaveLength(336);
    expect(plan.rejectedQuestions).toEqual([]);

    // Software readiness must never be reported as content readiness.
    expect(plan.topics.every((t) => t.contentStatus === 'draft')).toBe(true);
    expect(plan.topics.every((t) => t.prerequisites.length <= 1)).toBe(true);
    expect(plan.media.every((m) => m.productionState !== 'PUBLISHED')).toBe(true);
    expect(plan.media.every((m) => m.rightsStatus !== 'CLEARED')).toBe(true);
    expect(plan.media.every((m) => m.accessibilityStatus !== 'PASSED')).toBe(true);
    expect(plan.warnings.join(' ')).toContain('20-approved-item publication gate');
    expect(plan.warnings.join(' ')).toContain('No topic is auto-published');

    // Content depth is not software readiness: only the model A04 lesson meets
    // the enforced floor, and none of the 72 is approved.
    const atDepth = plan.topics.filter((t) => evaluateArticleDepth(t.lessonMarkdown).meetsStandard);
    expect(atDepth.map((t) => t.topicId)).toEqual(['A04']);
    expect(evaluateArticleDepth(plan.topics.find((t) => t.topicId === 'A04')!.lessonMarkdown).meetsStandard)
      .toBe(true);
  });

  it('uses the supplied A04 lesson article and leaves every other topic on its pack copy', () => {
    const a04 = '# Full A04 lesson\n\n' + 'Detailed teaching content. '.repeat(100);
    const plan = buildImportPlan(
      packOf([
        topicSource({ topic_id: 'A04', title: 'A04' }),
        topicSource({ topic_id: 'A05', title: 'A05' }),
      ]),
      [],
      [],
      a04,
    );
    const imported = plan.topics.find((t) => t.topicId === 'A04')!;
    const other = plan.topics.find((t) => t.topicId === 'A05')!;
    expect(imported.lessonMarkdown).toBe(a04);
    expect(other.lessonMarkdown).not.toBe(a04);
  });
});
