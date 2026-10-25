// Idempotent import of the TMFA curriculum pack.
//
// Source of truth: the v1.0 pack supplied with the MASTER IMPLEMENTATION
// DIRECTIVE (curriculum JSON, media manifest, 336-item draft question bank and
// the expanded A04 lesson). The data is bundled so a fresh environment can be
// seeded without an out-of-band file upload; the same functions accept a parsed
// pack for future API/CLI imports.
//
// HARD RULES
//   - The import NEVER publishes a topic and NEVER approves a question.
//   - Existing approved content is not silently overwritten. A changed teaching
//     hash moves an approved/published topic back to review.
//   - Media workflow state (production/rights/accessibility) is preserved on
//     re-import; only the descriptive manifest fields are refreshed.
//   - Stable IDs (course_id, topic_id, asset_id, external_code) make a repeat
//     import a no-op.

import { createHash } from 'node:crypto';

import { createAdminClient } from '@/lib/supabase/server';
import curriculumJson from './data/curriculum.json';
import mediaManifestJson from './data/media-manifest.json';
import questionBankJson from './data/question-bank.json';
import a04LessonJson from './data/a04-lesson.json';
import type { TopicOutcome } from './types';

type Db = ReturnType<typeof createAdminClient>;

export interface TmfaTopicSource {
  topic_id: string;
  course_id: string;
  course_name: string;
  stage: string;
  title: string;
  lesson_markdown: string;
  content_status: string;
  quiz_minimum_percent: number;
  required_media: string[];
  media_status: string;
  learning_outcomes: TopicOutcome[];
}

export interface TmfaCurriculumPack {
  schema_version: string;
  product: string;
  minimum_topic_pass_percent: number;
  question_bank_status: string;
  course_count: number;
  topics: TmfaTopicSource[];
}

export interface TmfaMediaSource {
  asset_id: string;
  topic_id: string;
  course_id: string;
  media_type: string;
  required: boolean;
  language: string;
  status: string;
  rights_status: string;
  accessibility_status: string;
  instructions: string;
}

export interface TmfaQuestionSource {
  question_id: string;
  topic_id: string;
  course_id: string;
  stage: string;
  objective_id: string;
  question_type: string;
  cognitive_level: string;
  difficulty: string;
  stem: string;
  option_a: string;
  option_b: string;
  option_c: string;
  option_d: string;
  correct_option: string;
  correct_answer: string;
  rationale: string;
  points: string;
  language: string;
  status: string;
  version: string;
  reviewer: string;
  source_note: string;
}

export interface PlannedCourse {
  courseId: string;
  title: string;
  kind: 'acting' | 'craft';
  stageLabel: string;
  stageDefault: string;
  orderIndex: number;
  topicCount: number;
}

export interface PlannedTopic {
  topicId: string;
  courseId: string;
  stage: string;
  stageLabel: string;
  title: string;
  lessonMarkdown: string;
  contentStatus: 'draft';
  quizMinimumPercent: number;
  quizDrawCount: number;
  quizTimeLimitMinutes: number;
  mediaStatus: string;
  outcomes: TopicOutcome[];
  requiredMedia: string[];
  prerequisites: string[];
  orderIndex: number;
  sourceHash: string;
}

export interface PlannedMedia {
  assetId: string;
  topicId: string;
  courseId: string;
  mediaType: string;
  required: boolean;
  language: string;
  productionState: string;
  rightsStatus: string;
  accessibilityStatus: string;
  instructions: string;
}

export interface PlannedQuestion {
  externalCode: string;
  topicId: string;
  courseId: string;
  stage: string;
  objectiveId: string;
  stem: string;
  options: Array<{ id: string; text: string }>;
  correctOptionId: string;
  explanation: string;
  cognitive: string;
  difficulty: string;
  points: number;
  sourceVersion: string;
  reviewNotes: string;
  sourceHash: string;
}

export interface ImportPlanProblem {
  row: number;
  code: string;
  message: string;
}

export interface ImportPlan {
  version: string;
  sourceHash: string;
  courses: PlannedCourse[];
  topics: PlannedTopic[];
  media: PlannedMedia[];
  questions: PlannedQuestion[];
  rejectedQuestions: ImportPlanProblem[];
  warnings: string[];
}

const STAGE_VALUES = new Set(['L0', 'L1', 'L2', 'L3', 'L4', 'L5']);

/** Map the manifest's human production note to the workflow state it proves. */
export function mediaStateFromManifest(status: string): string {
  const s = status.toUpperCase();
  if (/PUBLISH/.test(s)) return 'PUBLISHED';
  if (/EDIT/.test(s)) return 'EDITED';
  if (/CAPTUR|SHOT|FILMED/.test(s)) return 'CAPTURED';
  if (/SCRIPT|TEXT DRAFT|BRIEF WRITTEN/.test(s)) return 'SCRIPTED';
  return 'PLANNED';
}

/** "NOT REVIEWED" and "NOT_REVIEWED" are the same workflow state. */
function normalizeReviewStatus(value: string | undefined, fallback: string): string {
  const normalized = String(value ?? '').trim().toUpperCase().replace(/\s+/g, '_');
  return normalized || fallback;
}

function stableHash(value: unknown): string {
  return createHash('sha256').update(JSON.stringify(value)).digest('hex');
}

function normalizeStage(raw: string): { stage: string; stageLabel: string } {
  const value = (raw || '').trim();
  if (STAGE_VALUES.has(value)) return { stage: value, stageLabel: value };
  // The 48 craft topics are labelled "L1–L4 survey / specialization". Keep that
  // label verbatim and anchor the unit at L1 so the path has a valid stage.
  return { stage: 'L1', stageLabel: value };
}

function courseKind(courseId: string): 'acting' | 'craft' {
  return courseId === 'ACT' ? 'acting' : 'craft';
}

/**
 * Build the complete write plan without touching the database. Pure so the
 * import gates can be tested and audited without a live Supabase instance.
 */
export function buildImportPlan(
  pack: TmfaCurriculumPack,
  mediaSource: TmfaMediaSource[],
  questionSource: TmfaQuestionSource[],
  a04Markdown?: string,
): ImportPlan {
  const warnings: string[] = [];
  const problems: ImportPlanProblem[] = [];

  if (pack.minimum_topic_pass_percent !== 85) {
    warnings.push(
      `Pack declares a ${pack.minimum_topic_pass_percent}% topic threshold; the academy policy floor of 85% is enforced.`,
    );
  }

  const courseMap = new Map<string, PlannedCourse>();
  const topicIds = new Set<string>();
  const topics: PlannedTopic[] = [];
  const previousByCourse = new Map<string, string>();

  pack.topics.forEach((source, index) => {
    const topicId = String(source.topic_id || '').trim();
    const courseId = String(source.course_id || '').trim();
    if (!topicId || !courseId) {
      warnings.push(`Skipped curriculum row ${index + 1}: missing topic_id or course_id.`);
      return;
    }
    if (topicIds.has(topicId)) {
      warnings.push(`Skipped duplicate topic ${topicId}; stable IDs must be unique.`);
      return;
    }
    topicIds.add(topicId);

    if (!courseMap.has(courseId)) {
      courseMap.set(courseId, {
        courseId,
        title: source.course_name,
        kind: courseKind(courseId),
        stageLabel: '',
        stageDefault: '',
        orderIndex: courseMap.size,
        topicCount: 0,
      });
    }
    const course = courseMap.get(courseId)!;
    course.topicCount += 1;

    const { stage, stageLabel } = normalizeStage(source.stage);
    const orderIndex = course.topicCount - 1;
    const prerequisite = previousByCourse.get(courseId);
    previousByCourse.set(courseId, topicId);

    const outcomes = Array.isArray(source.learning_outcomes) ? source.learning_outcomes : [];
    const requiredMedia = Array.isArray(source.required_media) ? source.required_media : [];
    const markdown =
      topicId === 'A04' && a04Markdown && a04Markdown.trim().length > 0
        ? a04Markdown
        : source.lesson_markdown;

    topics.push({
      topicId,
      courseId,
      stage,
      stageLabel: source.stage || stageLabel,
      title: source.title,
      lessonMarkdown: markdown,
      contentStatus: 'draft',
      quizMinimumPercent: Math.max(85, Number(source.quiz_minimum_percent) || 85),
      quizDrawCount: 10,
      quizTimeLimitMinutes: 20,
      mediaStatus: source.media_status || '',
      outcomes,
      requiredMedia,
      prerequisites: prerequisite ? [prerequisite] : [],
      orderIndex,
      sourceHash: stableHash({
        title: source.title,
        markdown,
        outcomes,
        requiredMedia,
        quizMinimumPercent: Math.max(85, Number(source.quiz_minimum_percent) || 85),
      }),
    });

    if (course.stageLabel.length === 0) course.stageLabel = source.stage || stageLabel;
    else if (!course.stageLabel.includes(source.stage || stageLabel)) {
      course.stageLabel = `${course.stageLabel} / ${source.stage || stageLabel}`;
    }
    if (!course.stageDefault) course.stageDefault = stage;
  });

  const courses = Array.from(courseMap.values()).map((course) => ({
    ...course,
    stageDefault: course.kind === 'acting' ? course.stageDefault : 'L1',
  }));

  const media: PlannedMedia[] = [];
  const seenAssets = new Set<string>();
  for (const asset of mediaSource) {
    const assetId = String(asset.asset_id || '').trim();
    if (!assetId || seenAssets.has(assetId)) continue;
    if (!topicIds.has(asset.topic_id)) {
      warnings.push(`Media ${assetId} references unknown topic ${asset.topic_id}; skipped.`);
      continue;
    }
    seenAssets.add(assetId);
    media.push({
      assetId,
      topicId: asset.topic_id,
      courseId: asset.course_id,
      mediaType: asset.media_type,
      required: asset.required !== false,
      language: asset.language || 'en-NG',
      productionState: mediaStateFromManifest(asset.status || ''),
      rightsStatus: normalizeReviewStatus(asset.rights_status, 'NOT_REVIEWED'),
      accessibilityStatus: normalizeReviewStatus(asset.accessibility_status, 'NOT_REVIEWED'),
      instructions: asset.instructions || '',
    });
  }

  const topicById = new Map(topics.map((t) => [t.topicId, t]));
  const questions: PlannedQuestion[] = [];
  const seenQuestionIds = new Set<string>();

  questionSource.forEach((row, index) => {
    const rowNumber = index + 2; // CSV header is row 1
    const id = String(row.question_id || '').trim();
    const topicId = String(row.topic_id || '').trim();
    if (!id) {
      problems.push({ row: rowNumber, code: 'MISSING_ID', message: 'Question ID is blank.' });
      return;
    }
    if (seenQuestionIds.has(id)) {
      problems.push({ row: rowNumber, code: 'DUPLICATE_ID', message: `Duplicate Question ID ${id}.` });
      return;
    }
    seenQuestionIds.add(id);

    const topic = topicById.get(topicId);
    if (!topic) {
      problems.push({
        row: rowNumber,
        code: 'UNKNOWN_TOPIC',
        message: `Question ${id} references unknown topic ${topicId || '(blank)'}.`,
      });
      return;
    }
    const objectiveId = String(row.objective_id || '').trim();
    if (objectiveId && !topic.outcomes.some((o) => o.objective_id === objectiveId)) {
      problems.push({
        row: rowNumber,
        code: 'UNKNOWN_OBJECTIVE',
        message: `Question ${id} references objective ${objectiveId}, which is not declared for ${topicId}.`,
      });
      return;
    }

    const optionValues = [
      String(row.option_a || '').trim(),
      String(row.option_b || '').trim(),
      String(row.option_c || '').trim(),
      String(row.option_d || '').trim(),
    ];
    if (optionValues.some((o) => o.length === 0)) {
      problems.push({ row: rowNumber, code: 'BLANK_OPTION', message: `Question ${id} has a blank option.` });
      return;
    }
    if (new Set(optionValues.map((o) => o.toLowerCase())).size !== 4) {
      problems.push({ row: rowNumber, code: 'DUPLICATE_OPTION', message: `Question ${id} options are not distinct.` });
      return;
    }

    const letter = String(row.correct_option || '').trim().toUpperCase();
    const letters = ['A', 'B', 'C', 'D'];
    const correctIndex = letters.indexOf(letter);
    if (correctIndex < 0) {
      problems.push({
        row: rowNumber,
        code: 'INVALID_KEY',
        message: `Question ${id} key must be A, B, C or D (received "${row.correct_option || ''}").`,
      });
      return;
    }
    if (
      String(row.correct_answer || '').trim().toLowerCase() !== optionValues[correctIndex].toLowerCase()
    ) {
      problems.push({
        row: rowNumber,
        code: 'KEY_MISMATCH',
        message: `Question ${id} answer text does not match option ${letter}.`,
      });
      return;
    }
    if (String(row.rationale || '').trim().length === 0) {
      problems.push({ row: rowNumber, code: 'MISSING_RATIONALE', message: `Question ${id} has no rationale.` });
      return;
    }
    const points = Number(row.points);
    if (!Number.isInteger(points) || points <= 0) {
      problems.push({ row: rowNumber, code: 'INVALID_POINTS', message: `Question ${id} points must be a positive integer.` });
      return;
    }

    questions.push({
      externalCode: id,
      topicId,
      courseId: row.course_id,
      stage: row.stage,
      objectiveId,
      stem: String(row.stem || '').trim(),
      options: optionValues.map((text, i) => ({ id: letters[i].toLowerCase(), text })),
      correctOptionId: letters[correctIndex].toLowerCase(),
      explanation: String(row.rationale || '').trim(),
      cognitive: row.cognitive_level || '',
      difficulty: row.difficulty || '',
      points,
      sourceVersion: row.version || '1.0',
      reviewNotes: row.status || 'DRAFT',
      sourceHash: stableHash({
        stem: row.stem,
        options: optionValues,
        correct: letter,
        rationale: row.rationale,
        points,
      }),
    });
  });

  const approvedPerTopic = new Map<string, number>();
  // Imported items are always drafts; this makes the publication consequence explicit.
  for (const topic of topics) approvedPerTopic.set(topic.topicId, 0);
  const shortfall = topics.filter((t) => (approvedPerTopic.get(t.topicId) ?? 0) < 20).length;
  warnings.push(
    `${questions.length} question seeds are staged as DRAFT. All ${shortfall} topics remain below the 20-approved-item publication gate until faculty review.`,
  );
  warnings.push(
    'No topic is auto-published. Media remain in their manifest production state (brief only) until captured, cleared and accessibility-reviewed.',
  );

  return {
    version: `TMFA-CURRICULUM-${pack.schema_version}`,
    sourceHash: stableHash({ pack, mediaSource, questionSource }),
    courses,
    topics,
    media,
    questions,
    rejectedQuestions: problems,
    warnings,
  };
}

export const bundledPack = {
  curriculum: curriculumJson as unknown as TmfaCurriculumPack,
  media: mediaManifestJson as unknown as TmfaMediaSource[],
  questions: questionBankJson as unknown as TmfaQuestionSource[],
  a04Markdown: (a04LessonJson as { markdown?: string }).markdown,
};

export function buildBundledImportPlan(): ImportPlan {
  return buildImportPlan(
    bundledPack.curriculum,
    bundledPack.media,
    bundledPack.questions,
    bundledPack.a04Markdown,
  );
}

export interface ImportResult {
  version: string;
  courses: { inserted: number; updated: number };
  topics: { inserted: number; updated: number; unchanged: number; returnedToReview: number };
  media: { inserted: number; refreshed: number };
  questions: {
    inserted: number;
    updated: number;
    unchanged: number;
    locked: number;
    rejected: number;
  };
  warnings: string[];
  rejectedQuestions: ImportPlanProblem[];
}

/**
 * Apply a plan. Every write is keyed by a stable ID, so retries are idempotent.
 */
export async function applyImportPlan(
  db: Db,
  plan: ImportPlan,
  actorId: string | null,
): Promise<ImportResult> {
  const result: ImportResult = {
    version: plan.version,
    courses: { inserted: 0, updated: 0 },
    topics: { inserted: 0, updated: 0, unchanged: 0, returnedToReview: 0 },
    media: { inserted: 0, refreshed: 0 },
    questions: { inserted: 0, updated: 0, unchanged: 0, locked: 0, rejected: plan.rejectedQuestions.length },
    warnings: plan.warnings,
    rejectedQuestions: plan.rejectedQuestions,
  };

  const { data: versionRow, error: versionError } = await db
    .from('film_curriculum_versions')
    .select('id')
    .eq('version', plan.version)
    .maybeSingle();

  let versionId: string;
  if (versionError) throw new Error(`Could not read curriculum version: ${versionError.message}`);
  if (versionRow) {
    versionId = (versionRow as { id: string }).id;
    await db
      .from('film_curriculum_versions')
      .update({
        source_hash: plan.sourceHash,
        course_count: plan.courses.length,
        topic_count: plan.topics.length,
      })
      .eq('id', versionId);
  } else {
    const { data, error } = await db
      .from('film_curriculum_versions')
      .insert({
        version: plan.version,
        status: 'draft',
        source_hash: plan.sourceHash,
        course_count: plan.courses.length,
        topic_count: plan.topics.length,
        created_by: actorId,
      })
      .select('id')
      .single();
    if (error || !data) throw new Error(`Could not create curriculum version: ${error?.message}`);
    versionId = (data as { id: string }).id;
  }

  for (const course of plan.courses) {
    const { data: existing } = await db
      .from('film_courses')
      .select('course_id')
      .eq('course_id', course.courseId)
      .maybeSingle();
    if (existing) {
      const { error } = await db
        .from('film_courses')
        .update({
          title: course.title,
          kind: course.kind,
          stage_label: course.stageLabel,
          stage_default: course.stageDefault,
          order_index: course.orderIndex,
          version_id: versionId,
          updated_at: new Date().toISOString(),
        })
        .eq('course_id', course.courseId);
      if (error) throw new Error(`Could not refresh course ${course.courseId}: ${error.message}`);
      result.courses.updated += 1;
    } else {
      const { error } = await db.from('film_courses').insert({
        course_id: course.courseId,
        title: course.title,
        kind: course.kind,
        stage_label: course.stageLabel,
        stage_default: course.stageDefault,
        order_index: course.orderIndex,
        status: 'draft',
        version_id: versionId,
      });
      if (error) throw new Error(`Could not insert course ${course.courseId}: ${error.message}`);
      result.courses.inserted += 1;
    }
  }

  for (const topic of plan.topics) {
    const { data: existing } = await db
      .from('film_topics')
      .select('topic_id, source_hash, content_status, published, accessible_equivalent_approved, accessible_equivalent_note')
      .eq('topic_id', topic.topicId)
      .maybeSingle();

    if (!existing) {
      const { error } = await db.from('film_topics').insert({
        topic_id: topic.topicId,
        course_id: topic.courseId,
        stage: topic.stage,
        stage_label: topic.stageLabel,
        title: topic.title,
        lesson_markdown: topic.lessonMarkdown,
        content_status: 'draft',
        quiz_minimum_percent: topic.quizMinimumPercent,
        quiz_draw_count: topic.quizDrawCount,
        quiz_time_limit_minutes: topic.quizTimeLimitMinutes,
        media_status: topic.mediaStatus,
        learning_outcomes: topic.outcomes,
        required_media: topic.requiredMedia,
        prerequisites: topic.prerequisites,
        order_index: topic.orderIndex,
        source_hash: topic.sourceHash,
        version_id: versionId,
      });
      if (error) throw new Error(`Could not insert topic ${topic.topicId}: ${error.message}`);
      result.topics.inserted += 1;
      continue;
    }

    const row = existing as {
      source_hash: string | null;
      content_status: string;
      published: boolean;
    };
    if (row.source_hash === topic.sourceHash) {
      await db
        .from('film_topics')
        .update({
          order_index: topic.orderIndex,
          prerequisites: topic.prerequisites,
          version_id: versionId,
          updated_at: new Date().toISOString(),
        })
        .eq('topic_id', topic.topicId);
      result.topics.unchanged += 1;
      continue;
    }

    const mustReReview = row.content_status === 'approved' || row.published === true;
    const { error } = await db
      .from('film_topics')
      .update({
        course_id: topic.courseId,
        stage: topic.stage,
        stage_label: topic.stageLabel,
        title: topic.title,
        lesson_markdown: topic.lessonMarkdown,
        content_status: mustReReview ? 'review' : row.content_status,
        published: mustReReview ? false : row.published,
        published_at: mustReReview ? null : undefined,
        quiz_minimum_percent: topic.quizMinimumPercent,
        quiz_draw_count: topic.quizDrawCount,
        quiz_time_limit_minutes: topic.quizTimeLimitMinutes,
        media_status: topic.mediaStatus,
        learning_outcomes: topic.outcomes,
        required_media: topic.requiredMedia,
        prerequisites: topic.prerequisites,
        order_index: topic.orderIndex,
        source_hash: topic.sourceHash,
        version_id: versionId,
        accessible_equivalent_approved: mustReReview ? false : undefined,
        accessible_equivalent_note: mustReReview ? '' : undefined,
        updated_at: new Date().toISOString(),
      })
      .eq('topic_id', topic.topicId);
    if (error) throw new Error(`Could not update topic ${topic.topicId}: ${error.message}`);
    result.topics.updated += 1;
    if (mustReReview) result.topics.returnedToReview += 1;
  }

  for (const asset of plan.media) {
    const { data: existing } = await db
      .from('film_topic_media')
      .select('asset_id')
      .eq('asset_id', asset.assetId)
      .maybeSingle();
    if (existing) {
      const { error } = await db
        .from('film_topic_media')
        .update({
          topic_id: asset.topicId,
          course_id: asset.courseId,
          media_type: asset.mediaType,
          required: asset.required,
          language: asset.language,
          instructions: asset.instructions,
          updated_at: new Date().toISOString(),
        })
        .eq('asset_id', asset.assetId);
      if (error) throw new Error(`Could not refresh media ${asset.assetId}: ${error.message}`);
      result.media.refreshed += 1;
    } else {
      const { error } = await db.from('film_topic_media').insert({
        asset_id: asset.assetId,
        topic_id: asset.topicId,
        course_id: asset.courseId,
        media_type: asset.mediaType,
        required: asset.required,
        language: asset.language,
        status: asset.productionState,
        rights_status: asset.rightsStatus,
        accessibility_status: asset.accessibilityStatus,
        production_state: asset.productionState,
        instructions: asset.instructions,
      });
      if (error) throw new Error(`Could not insert media ${asset.assetId}: ${error.message}`);
      result.media.inserted += 1;
    }
  }

  const { data: batch, error: batchError } = await db
    .from('academy_question_import_batches')
    .insert({
      filename: 'TMFA_QUESTION_BANK_DRAFT.csv',
      source_sha256: plan.sourceHash,
      total_rows: plan.questions.length + plan.rejectedQuestions.length,
      accepted: 0,
      updated: 0,
      rejected: plan.rejectedQuestions.length,
      warned: 0,
      report: {
        rejected: plan.rejectedQuestions,
        warnings: plan.warnings,
        import: 'tmfa-topic-bank',
      },
      committed: true,
      created_by: actorId,
    })
    .select('id')
    .single();
  if (batchError) throw new Error(`Could not record the question import: ${batchError.message}`);
  const batchId = (batch as { id: string }).id;

  for (const question of plan.questions) {
    const { data: existing } = await db
      .from('academy_question_items')
      .select('id, status, film_source_hash')
      .eq('external_code', question.externalCode)
      .maybeSingle();

    const payload = {
      type: 'mcq',
      stem: question.stem,
      options: question.options,
      answer: { correct: [question.correctOptionId], explanation: question.explanation },
      difficulty: 0.5,
      tags: [`topic:${question.topicId}`, `stage:${question.stage}`, question.cognitive].filter(Boolean),
      status: 'draft',
      external_code: question.externalCode,
      academy_scope: 'film',
      film_stage: question.stage,
      film_module_code: null,
      film_department: question.courseId,
      film_learning_outcome: question.objectiveId,
      film_cognitive: question.cognitive,
      film_difficulty: question.difficulty,
      film_keywords: [],
      film_points: question.points,
      source_version: question.sourceVersion,
      film_source_hash: question.sourceHash,
      import_batch_id: batchId,
      film_topic_id: question.topicId,
      film_objective_id: question.objectiveId,
      film_review_notes: question.reviewNotes,
    };

    if (!existing) {
      const { error } = await db.from('academy_question_items').insert(payload);
      if (error) throw new Error(`Could not insert question ${question.externalCode}: ${error.message}`);
      result.questions.inserted += 1;
      continue;
    }

    const row = existing as { id: string; status: string; film_source_hash: string | null };
    if (row.status !== 'draft') {
      result.questions.locked += 1;
      continue;
    }
    if (row.film_source_hash === question.sourceHash) {
      result.questions.unchanged += 1;
      continue;
    }
    const { error } = await db
      .from('academy_question_items')
      .update(payload)
      .eq('id', row.id);
    if (error) throw new Error(`Could not update question ${question.externalCode}: ${error.message}`);
    result.questions.updated += 1;
  }

  await db
    .from('academy_question_import_batches')
    .update({
      accepted: result.questions.inserted,
      updated: result.questions.updated,
      rejected: result.questions.rejected,
    })
    .eq('id', batchId);

  await db.from('film_academic_audit').insert({
    actor_id: actorId,
    actor_role: 'curriculum_import',
    action: 'TMFA_CURRICULUM_IMPORTED',
    target_type: 'film_curriculum_version',
    target_id: plan.version,
    after: {
      courses: result.courses,
      topics: result.topics,
      media: result.media,
      questions: result.questions,
    },
    reason: 'Bundled TMFA curriculum pack import',
  });

  return result;
}

export async function importBundledCurriculumPack(
  db: Db,
  actorId: string | null,
): Promise<ImportResult> {
  return applyImportPlan(db, buildBundledImportPlan(), actorId);
}
