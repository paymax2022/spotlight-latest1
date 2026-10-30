// Topic-targeted question authoring import.
//
// The module-coded CSV import predates topic mastery and cannot attach an item
// to a topic, so its rows can never satisfy a topic's approved pool. This is the
// topic-aware counterpart:
//
//   - a row names an existing topic; an objective is optional but must belong to
//     that topic when supplied;
//   - the same double-entry check as the module bank: the letter in Correct
//     Option must agree with the text in Correct Answer;
//   - EVERY accepted row lands as DRAFT. Import never approves, retires or
//     publishes anything;
//   - approved/review/retired items are locked, as are module-coded items and
//     items already bound to a different topic; an import can never rewrite the
//     content under review or silently reassign an item;
//   - preview and commit share one preparation path, so the counts shown to the
//     operator are the counts the write produces;
//   - the answer key stays in academy_question_items.answer. Nothing returned
//     from this module carries a key.

import { createHash } from 'node:crypto';

import { createAdminClient } from '@/lib/supabase/server';
import { parseCsv } from '../assessment/csv';
import { MIN_APPROVED_ITEMS_PER_TOPIC, type TopicOutcome } from './types';

type Db = ReturnType<typeof createAdminClient>;

export const TOPIC_QUESTION_HEADERS = [
  'Question ID',
  'Topic ID',
  'Objective ID',
  'Question',
  'Option A',
  'Option B',
  'Option C',
  'Option D',
  'Correct Option',
  'Correct Answer',
  'Rationale',
  'Points',
  'Difficulty',
  'Cognitive Level',
  'Version',
] as const;

export const TOPIC_QUESTION_TEMPLATE_FILENAME = 'tmfa-topic-questions-template.csv';

const OPTION_LETTERS = ['A', 'B', 'C', 'D'] as const;
const REVIEW_NOTE = 'DRAFT — imported for SME review';

export interface TopicQuestionCounts {
  draft: number;
  review: number;
  approved: number;
  retired: number;
  total: number;
}

export interface TopicQuestionTopicContext {
  topicId: string;
  courseId: string;
  stage: string;
  title: string;
  contentStatus: string;
  published: boolean;
  drawCount: number;
  outcomes: TopicOutcome[];
  counts: TopicQuestionCounts;
}

export interface TopicQuestionPlanRow {
  row: number;
  externalCode: string;
  topicId: string;
  objectiveId: string;
  stem: string;
  options: Array<{ id: string; text: string }>;
  correctOptionId: string;
  explanation: string;
  points: number;
  difficulty: string;
  cognitive: string;
  sourceVersion: string;
}

export interface TopicQuestionProblem {
  row: number;
  externalCode?: string;
  code: string;
  message: string;
}

export interface TopicQuestionImportPlan {
  sourceHash: string;
  totalRows: number;
  accepted: TopicQuestionPlanRow[];
  rejected: TopicQuestionProblem[];
  warnings: string[];
}

export interface TopicQuestionPoolProjection {
  topicId: string;
  courseId: string;
  stage: string;
  title: string;
  contentStatus: string;
  published: boolean;
  required: number;
  approved: number;
  draft: number;
  review: number;
  retired: number;
  submitted: number;
  draftAfter: number;
  shortfall: number;
}

export interface TopicQuestionImportTotals {
  rows: number;
  accepted: number;
  rejected: number;
  wouldInsert: number;
  wouldUpdate: number;
  unchanged: number;
  locked: number;
}

export interface TopicQuestionImportPreview {
  headers: readonly string[];
  sourceHash: string;
  totals: TopicQuestionImportTotals;
  topics: TopicQuestionPoolProjection[];
  rejected: TopicQuestionProblem[];
  blocked: TopicQuestionProblem[];
  warnings: string[];
}

export interface TopicQuestionImportCommitResult {
  batchId: string;
  inserted: number;
  updated: number;
  unchanged: number;
  locked: number;
  rejected: TopicQuestionProblem[];
  blocked: TopicQuestionProblem[];
  warnings: string[];
  topics: TopicQuestionPoolProjection[];
}

export interface TopicQuestionAuthoringContext {
  headers: readonly string[];
  templateFilename: string;
  topics: TopicQuestionPoolProjection[];
}

export class TopicQuestionImportError extends Error {
  status: number;
  code: string;

  constructor(status: number, code: string, message: string) {
    super(message);
    this.name = 'TopicQuestionImportError';
    this.status = status;
    this.code = code;
  }
}

interface ExistingQuestionRow {
  id: string;
  external_code: string;
  status: string;
  stem: string;
  options: Array<{ id: string; text: string }> | null;
  answer: { correct?: string[]; explanation?: string | null } | null;
  film_points: number | string | null;
  film_topic_id: string | null;
  film_objective_id: string | null;
  film_module_code: string | null;
  film_difficulty: string | null;
  film_cognitive: string | null;
  source_version: string | null;
}

type Disposition =
  | { kind: 'insert' | 'update' | 'unchanged' }
  | { kind: 'locked'; code: string; message: string };

export function checkTopicQuestionHeaders(
  headerRow: string[] | undefined,
): { ok: boolean; missing: string[] } {
  const have = new Set((headerRow ?? []).map((h) => h.trim().toLowerCase()));
  const missing = TOPIC_QUESTION_HEADERS.filter((h) => !have.has(h.toLowerCase()));
  return { ok: missing.length === 0, missing: [...missing] };
}

function buildIndex(header: string[]): Record<string, number> {
  const idx: Record<string, number> = {};
  header.forEach((h, i) => { idx[h.trim().toLowerCase()] = i; });
  return idx;
}

function cell(row: string[], idx: Record<string, number>, name: string): string {
  const at = idx[name.trim().toLowerCase()];
  if (at === undefined) return '';
  return (row[at] ?? '').trim();
}

function normalize(value: string): string {
  return value.toLowerCase().replace(/\s+/g, ' ').trim();
}

function hashCsv(csv: string): string {
  return createHash('sha256').update(csv).digest('hex');
}

function hashRow(row: TopicQuestionPlanRow): string {
  return createHash('sha256')
    .update(JSON.stringify({
      topicId: row.topicId,
      objectiveId: row.objectiveId,
      stem: row.stem,
      options: row.options.map((o) => o.text),
      correct: row.correctOptionId,
      explanation: row.explanation,
      points: row.points,
    }))
    .digest('hex');
}

function chunk<T>(items: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}

/**
 * Pure validation. The caller supplies the topic context (including current
 * pool counts); no database is touched. Rows that cannot become a topic draft
 * are rejected individually so one bad line cannot block a 1,000-row batch.
 */
export function buildTopicQuestionImportPlan(
  csv: string,
  topics: TopicQuestionTopicContext[],
): TopicQuestionImportPlan {
  const grid = parseCsv(csv);
  const idx = buildIndex(grid[0] ?? []);
  const topicById = new Map(topics.map((t) => [t.topicId, t]));
  const accepted: TopicQuestionPlanRow[] = [];
  const rejected: TopicQuestionProblem[] = [];
  const warnings: string[] = [];
  const seenCodes = new Set<string>();
  const stemsByTopic = new Map<string, Set<string>>();
  let blankObjective = 0;
  let publishedRows = 0;

  grid.slice(1).forEach((rawRow, index) => {
    const rowNumber = index + 2; // CSV header is row 1
    if (rawRow.every((value) => !String(value ?? '').trim())) return;

    const externalCode = cell(rawRow, idx, 'Question ID');
    const topicId = cell(rawRow, idx, 'Topic ID');
    const objectiveId = cell(rawRow, idx, 'Objective ID');
    const stem = cell(rawRow, idx, 'Question');
    const optionTexts = OPTION_LETTERS.map((letter) => cell(rawRow, idx, `Option ${letter}`));
    const letter = cell(rawRow, idx, 'Correct Option').toUpperCase();
    const answerText = cell(rawRow, idx, 'Correct Answer');
    const rationale = cell(rawRow, idx, 'Rationale');
    const pointsRaw = cell(rawRow, idx, 'Points');
    const difficulty = cell(rawRow, idx, 'Difficulty');
    const cognitive = cell(rawRow, idx, 'Cognitive Level');
    const sourceVersion = cell(rawRow, idx, 'Version') || '1.0';

    const reject = (code: string, message: string) => {
      rejected.push({
        row: rowNumber,
        ...(externalCode ? { externalCode } : {}),
        code,
        message,
      });
    };

    const missing: string[] = [];
    if (!externalCode) missing.push('Question ID');
    if (!topicId) missing.push('Topic ID');
    if (!stem) missing.push('Question');
    OPTION_LETTERS.forEach((optionLetter, i) => {
      if (!optionTexts[i]) missing.push(`Option ${optionLetter}`);
    });
    if (!letter) missing.push('Correct Option');
    if (!answerText) missing.push('Correct Answer');
    if (!rationale) missing.push('Rationale');
    if (!pointsRaw) missing.push('Points');
    if (missing.length > 0) {
      reject('MISSING_FIELDS', `Missing required field(s): ${missing.join(', ')}.`);
      return;
    }

    if (seenCodes.has(externalCode.toLowerCase())) {
      reject('DUPLICATE_ID', `Question ID ${externalCode} appears more than once in this file.`);
      return;
    }

    const topic = topicById.get(topicId);
    if (!topic) {
      reject('UNKNOWN_TOPIC', `Topic ${topicId} does not exist in the imported curriculum.`);
      return;
    }
    if (objectiveId && !topic.outcomes.some((o) => o.objective_id === objectiveId)) {
      reject(
        'UNKNOWN_OBJECTIVE',
        `Objective ${objectiveId} is not declared for topic ${topicId}.`,
      );
      return;
    }
    if (new Set(optionTexts.map(normalize)).size !== 4) {
      reject('DUPLICATE_OPTION', 'The four options must be distinct.');
      return;
    }
    const correctIndex = OPTION_LETTERS.indexOf(letter as (typeof OPTION_LETTERS)[number]);
    if (correctIndex < 0) {
      reject('INVALID_KEY', `Correct Option must be A, B, C or D (received "${letter}").`);
      return;
    }
    if (normalize(answerText) !== normalize(optionTexts[correctIndex])) {
      reject(
        'KEY_MISMATCH',
        `Correct Answer does not match option ${letter} ("${optionTexts[correctIndex]}").`,
      );
      return;
    }

    const points = Number(pointsRaw);
    if (!Number.isInteger(points) || points <= 0) {
      reject('INVALID_POINTS', 'Points must be a positive whole number.');
      return;
    }

    const stemKey = normalize(stem);
    const topicStems = stemsByTopic.get(topicId) ?? new Set<string>();
    if (topicStems.has(stemKey)) {
      warnings.push(`Row ${rowNumber}: question ${externalCode} repeats another stem in ${topicId}.`);
    } else {
      topicStems.add(stemKey);
      stemsByTopic.set(topicId, topicStems);
    }

    seenCodes.add(externalCode.toLowerCase());
    if (!objectiveId) blankObjective += 1;
    if (topic.published) publishedRows += 1;

    const row: TopicQuestionPlanRow = {
      row: rowNumber,
      externalCode,
      topicId,
      objectiveId,
      stem,
      options: optionTexts.map((text, i) => ({ id: OPTION_LETTERS[i].toLowerCase(), text })),
      correctOptionId: OPTION_LETTERS[correctIndex].toLowerCase(),
      explanation: rationale,
      points,
      difficulty,
      cognitive,
      sourceVersion,
    };
    accepted.push(row);
  });

  warnings.push(
    'Import never approves a question: every accepted row lands as DRAFT and must pass SME review before it can be drawn.',
  );
  if (blankObjective > 0) {
    warnings.push(
      `${blankObjective} accepted row(s) have no objective mapping; they count toward the topic pool but not toward an outcome breakdown.`,
    );
  }
  if (publishedRows > 0) {
    warnings.push(
      `${publishedRows} accepted row(s) target published topics; they stay drafts and are not drawn until approved.`,
    );
  }
  const belowGate = topics.filter(
    (t) => t.counts.approved < Math.max(MIN_APPROVED_ITEMS_PER_TOPIC, t.drawCount),
  ).length;
  if (belowGate > 0) {
    warnings.push(
      `${belowGate} of ${topics.length} topics still have fewer than 20 approved items; SME approval is required before publication.`,
    );
  }

  return {
    sourceHash: hashCsv(csv),
    totalRows: Math.max(0, grid.length - 1),
    accepted,
    rejected,
    warnings,
  };
}

async function loadTopicQuestionContext(db: Db): Promise<TopicQuestionTopicContext[]> {
  const [{ data: topicData, error: topicError }, { data: questionData, error: questionError }] =
    await Promise.all([
      db
        .from('film_topics')
        .select('topic_id, course_id, stage, title, content_status, published, quiz_draw_count, learning_outcomes')
        .order('course_id')
        .order('order_index'),
      db
        .from('academy_question_items')
        .select('film_topic_id, status')
        .eq('academy_scope', 'film'),
    ]);

  if (topicError) throw new Error(`Could not load topics: ${topicError.message}`);
  if (questionError) throw new Error(`Could not load the question pool: ${questionError.message}`);

  const countsByTopic = new Map<string, TopicQuestionCounts>();
  for (const row of (questionData ?? []) as Array<{ film_topic_id: string | null; status: string }>) {
    if (!row.film_topic_id) continue;
    const counts = countsByTopic.get(row.film_topic_id) ?? {
      draft: 0, review: 0, approved: 0, retired: 0, total: 0,
    };
    counts.total += 1;
    if (row.status === 'draft') counts.draft += 1;
    else if (row.status === 'review') counts.review += 1;
    else if (row.status === 'approved') counts.approved += 1;
    else if (row.status === 'retired') counts.retired += 1;
    countsByTopic.set(row.film_topic_id, counts);
  }

  return ((topicData ?? []) as Array<Record<string, unknown>>).map((raw) => ({
    topicId: String(raw.topic_id ?? ''),
    courseId: String(raw.course_id ?? ''),
    stage: String(raw.stage ?? ''),
    title: String(raw.title ?? ''),
    contentStatus: String(raw.content_status ?? ''),
    published: raw.published === true,
    drawCount: Number(raw.quiz_draw_count ?? 0),
    outcomes: Array.isArray(raw.learning_outcomes)
      ? (raw.learning_outcomes as TopicOutcome[])
      : [],
    counts: countsByTopic.get(String(raw.topic_id ?? '')) ?? {
      draft: 0, review: 0, approved: 0, retired: 0, total: 0,
    },
  }));
}

async function loadExistingByCodes(
  db: Db,
  codes: string[],
): Promise<Map<string, ExistingQuestionRow>> {
  const existing = new Map<string, ExistingQuestionRow>();
  for (const batch of chunk(Array.from(new Set(codes)), 100)) {
    if (batch.length === 0) continue;
    const { data, error } = await db
      .from('academy_question_items')
      .select(
        'id, external_code, status, stem, options, answer, film_points, film_topic_id, film_objective_id, film_module_code, film_difficulty, film_cognitive, source_version',
      )
      .eq('academy_scope', 'film')
      .in('external_code', batch);
    if (error) throw new Error(`Could not check existing questions: ${error.message}`);
    for (const row of (data ?? []) as ExistingQuestionRow[]) {
      if (row.external_code) existing.set(row.external_code, row);
    }
  }
  return existing;
}

function sameAsExisting(existing: ExistingQuestionRow, row: TopicQuestionPlanRow): boolean {
  const options = existing.options ?? [];
  return (
    existing.stem === row.stem &&
    options.length === row.options.length &&
    options.every((o, i) => o.id === row.options[i].id && o.text === row.options[i].text) &&
    Array.isArray(existing.answer?.correct) &&
    existing.answer!.correct.length === 1 &&
    existing.answer!.correct[0] === row.correctOptionId &&
    String(existing.answer?.explanation ?? '') === row.explanation &&
    Number(existing.film_points) === row.points &&
    (existing.film_topic_id ?? '') === row.topicId &&
    (existing.film_objective_id ?? '') === row.objectiveId &&
    (existing.film_difficulty ?? '') === row.difficulty &&
    (existing.film_cognitive ?? '') === row.cognitive &&
    (existing.source_version ?? '') === row.sourceVersion
  );
}

function classify(existing: ExistingQuestionRow | undefined, row: TopicQuestionPlanRow): Disposition {
  if (!existing) return { kind: 'insert' };
  if (existing.status !== 'draft') {
    return {
      kind: 'locked',
      code: 'QUESTION_LOCKED',
      message: `Already ${existing.status}; imports never rewrite a reviewed item.`,
    };
  }
  if (existing.film_module_code) {
    return {
      kind: 'locked',
      code: 'MODULE_ITEM_LOCKED',
      message: `Already belongs to module ${existing.film_module_code}; a topic import cannot reassign it.`,
    };
  }
  if (existing.film_topic_id && existing.film_topic_id !== row.topicId) {
    return {
      kind: 'locked',
      code: 'TOPIC_MISMATCH',
      message: `Already belongs to topic ${existing.film_topic_id}.`,
    };
  }
  return sameAsExisting(existing, row) ? { kind: 'unchanged' } : { kind: 'update' };
}

function projectTopics(
  topics: TopicQuestionTopicContext[],
  submittedByTopic: Record<string, number>,
  insertedByTopic: Record<string, number>,
): TopicQuestionPoolProjection[] {
  return topics.map((topic) => {
    const required = Math.max(MIN_APPROVED_ITEMS_PER_TOPIC, topic.drawCount);
    const submitted = submittedByTopic[topic.topicId] ?? 0;
    return {
      topicId: topic.topicId,
      courseId: topic.courseId,
      stage: topic.stage,
      title: topic.title,
      contentStatus: topic.contentStatus,
      published: topic.published,
      required,
      approved: topic.counts.approved,
      draft: topic.counts.draft,
      review: topic.counts.review,
      retired: topic.counts.retired,
      submitted,
      draftAfter: topic.counts.draft + (insertedByTopic[topic.topicId] ?? 0),
      shortfall: Math.max(0, required - topic.counts.approved),
    };
  });
}

function countByTopic(rows: TopicQuestionPlanRow[]): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const row of rows) counts[row.topicId] = (counts[row.topicId] ?? 0) + 1;
  return counts;
}

interface PreparedImport {
  plan: TopicQuestionImportPlan;
  context: TopicQuestionTopicContext[];
  contextById: Map<string, TopicQuestionTopicContext>;
  existingByCode: Map<string, ExistingQuestionRow>;
  totals: TopicQuestionImportTotals;
  blocked: TopicQuestionProblem[];
  topics: TopicQuestionPoolProjection[];
}

async function prepareTopicQuestionImport(db: Db, csv: string): Promise<PreparedImport> {
  const grid = parseCsv(csv);
  const headerCheck = checkTopicQuestionHeaders(grid[0]);
  if (!headerCheck.ok) {
    throw new TopicQuestionImportError(
      400,
      'HEADERS_MISSING',
      `CSV is missing required columns: ${headerCheck.missing.join(', ')}.`,
    );
  }
  if (grid.length < 2) {
    throw new TopicQuestionImportError(400, 'NO_ROWS', 'The CSV has no data rows.');
  }

  const context = await loadTopicQuestionContext(db);
  const plan = buildTopicQuestionImportPlan(csv, context);
  const existingByCode = await loadExistingByCodes(
    db,
    plan.accepted.map((row) => row.externalCode),
  );

  const submittedByTopic = countByTopic(plan.accepted);
  const insertedByTopic: Record<string, number> = {};
  const blocked: TopicQuestionProblem[] = [];
  let wouldInsert = 0;
  let wouldUpdate = 0;
  let unchanged = 0;
  let locked = 0;

  for (const row of plan.accepted) {
    const disposition = classify(existingByCode.get(row.externalCode), row);
    if (disposition.kind === 'locked') {
      locked += 1;
      blocked.push({
        row: row.row,
        externalCode: row.externalCode,
        code: disposition.code,
        message: disposition.message,
      });
      continue;
    }
    if (disposition.kind === 'insert') {
      wouldInsert += 1;
      insertedByTopic[row.topicId] = (insertedByTopic[row.topicId] ?? 0) + 1;
      continue;
    }
    if (disposition.kind === 'update') wouldUpdate += 1;
    else unchanged += 1;
  }

  return {
    plan,
    context,
    contextById: new Map(context.map((topic) => [topic.topicId, topic])),
    existingByCode,
    totals: {
      rows: plan.totalRows,
      accepted: plan.accepted.length,
      rejected: plan.rejected.length,
      wouldInsert,
      wouldUpdate,
      unchanged,
      locked,
    },
    blocked,
    topics: projectTopics(context, submittedByTopic, insertedByTopic),
  };
}

/**
 * Read-only preview. It does not create an import batch, so an abandoned
 * preview leaves no rows anywhere.
 */
export async function previewTopicQuestionImport(
  db: Db,
  csv: string,
): Promise<TopicQuestionImportPreview> {
  const prepared = await prepareTopicQuestionImport(db, csv);
  return {
    headers: TOPIC_QUESTION_HEADERS,
    sourceHash: prepared.plan.sourceHash,
    totals: prepared.totals,
    topics: prepared.topics,
    rejected: prepared.plan.rejected,
    blocked: prepared.blocked,
    warnings: prepared.plan.warnings,
  };
}

/** Header + current gap for the console; no file is uploaded and nothing is written. */
export async function loadTopicQuestionAuthoringContext(
  db: Db,
): Promise<TopicQuestionAuthoringContext> {
  const context = await loadTopicQuestionContext(db);
  return {
    headers: TOPIC_QUESTION_HEADERS,
    templateFilename: TOPIC_QUESTION_TEMPLATE_FILENAME,
    topics: projectTopics(context, {}, {}),
  };
}

function insertPayload(
  row: TopicQuestionPlanRow,
  topic: TopicQuestionTopicContext,
  batchId: string,
): Record<string, unknown> {
  return {
    type: 'mcq',
    stem: row.stem,
    options: row.options,
    answer: { correct: [row.correctOptionId], explanation: row.explanation },
    difficulty: 0.5,
    tags: [`topic:${row.topicId}`, `stage:${topic.stage}`, row.cognitive].filter(Boolean),
    status: 'draft',
    external_code: row.externalCode,
    academy_scope: 'film',
    film_stage: topic.stage,
    film_module_code: null,
    film_department: topic.courseId,
    film_learning_outcome: row.objectiveId || null,
    film_cognitive: row.cognitive,
    film_difficulty: row.difficulty,
    film_keywords: [],
    film_points: row.points,
    source_version: row.sourceVersion,
    film_source_hash: hashRow(row),
    import_batch_id: batchId,
    film_topic_id: row.topicId,
    film_objective_id: row.objectiveId || null,
    film_review_notes: REVIEW_NOTE,
  };
}

function updatePayload(
  row: TopicQuestionPlanRow,
  topic: TopicQuestionTopicContext,
  batchId: string,
): Record<string, unknown> {
  const payload = insertPayload(row, topic, batchId);
  // Status is never written by an import. A draft that was submitted for review
  // after this batch was prepared is protected by the .eq('status', 'draft')
  // guard on the update itself.
  delete payload.status;
  return payload;
}

export async function applyTopicQuestionImport(
  db: Db,
  actorId: string | null,
  filename: string,
  csv: string,
): Promise<TopicQuestionImportCommitResult> {
  const prepared = await prepareTopicQuestionImport(db, csv);
  if (prepared.plan.accepted.length === 0) {
    throw new TopicQuestionImportError(
      422,
      'NO_VALID_ROWS',
      'No valid rows to import — every row was rejected.',
    );
  }

  // Declared before the batch row so a row blocked during the write loop is
  // included when the batch report is finalized below.
  const blocked = [...prepared.blocked];
  const report = {
    rejected: prepared.plan.rejected,
    blocked,
    warnings: prepared.plan.warnings,
    import: 'tmfa-topic-questions',
  };

  const { data: batch, error: batchError } = await db
    .from('academy_question_import_batches')
    .insert({
      filename: filename || 'tmfa-topic-questions.csv',
      source_sha256: prepared.plan.sourceHash,
      total_rows: prepared.plan.totalRows,
      accepted: 0,
      updated: 0,
      rejected: prepared.plan.rejected.length,
      warned: prepared.plan.warnings.length,
      report,
      committed: true,
      created_by: actorId,
    })
    .select('id')
    .single();
  if (batchError || !batch) {
    throw new Error(`Could not record the question import: ${batchError?.message ?? 'no row returned'}`);
  }
  const batchId = (batch as { id: string }).id;

  const submittedByTopic = countByTopic(prepared.plan.accepted);
  const insertedByTopic: Record<string, number> = {};
  let inserted = 0;
  let updated = 0;
  let unchanged = 0;
  let locked = prepared.totals.locked;

  for (const row of prepared.plan.accepted) {
    const existing = prepared.existingByCode.get(row.externalCode);
    const disposition = classify(existing, row);
    if (disposition.kind === 'locked') continue;
    if (disposition.kind === 'unchanged') {
      unchanged += 1;
      continue;
    }
    const topic = prepared.contextById.get(row.topicId);
    if (!topic) {
      // The plan rejected unknown topics; this is defensive only.
      locked += 1;
      blocked.push({
        row: row.row,
        externalCode: row.externalCode,
        code: 'UNKNOWN_TOPIC',
        message: `Topic ${row.topicId} disappeared before the write.`,
      });
      continue;
    }

    if (disposition.kind === 'insert') {
      const { error } = await db
        .from('academy_question_items')
        .insert(insertPayload(row, topic, batchId));
      if (error) {
        if ((error as { code?: string }).code === '23505') {
          locked += 1;
          blocked.push({
            row: row.row,
            externalCode: row.externalCode,
            code: 'QUESTION_EXISTS',
            message: 'Another import created this ID first; it was left untouched.',
          });
          continue;
        }
        throw new Error(`Could not insert question ${row.externalCode}: ${error.message}`);
      }
      inserted += 1;
      insertedByTopic[row.topicId] = (insertedByTopic[row.topicId] ?? 0) + 1;
      continue;
    }

    if (!existing) continue;
    const { data: changed, error } = await db
      .from('academy_question_items')
      .update(updatePayload(row, topic, batchId))
      .eq('id', existing.id)
      .eq('status', 'draft')
      .select('id');
    if (error) throw new Error(`Could not update question ${row.externalCode}: ${error.message}`);
    if (Array.isArray(changed) && changed.length > 0) {
      updated += 1;
    } else {
      locked += 1;
      blocked.push({
        row: row.row,
        externalCode: row.externalCode,
        code: 'QUESTION_LOCKED',
        message: 'Its status changed while the import was running; it was left untouched.',
      });
    }
  }

  await db
    .from('academy_question_import_batches')
    .update({
      accepted: inserted,
      updated,
      rejected: prepared.plan.rejected.length,
      warned: prepared.plan.warnings.length,
      report,
    })
    .eq('id', batchId);

  const topics = projectTopics(prepared.context, submittedByTopic, insertedByTopic);
  const topicsBelowGate = topics.filter((topic) => topic.shortfall > 0).length;

  await db.from('film_academic_audit').insert({
    actor_id: actorId,
    actor_role: 'curriculum_import',
    action: 'TMFA_TOPIC_QUESTIONS_IMPORTED',
    target_type: 'academy_question_import_batch',
    target_id: batchId,
    after: {
      filename,
      inserted,
      updated,
      unchanged,
      locked,
      rejected: prepared.plan.rejected.length,
      topicsBelowGate,
      import: 'tmfa-topic-questions',
    },
    reason: 'Topic-targeted question authoring import (drafts only; no approval)',
  });

  return {
    batchId,
    inserted,
    updated,
    unchanged,
    locked,
    rejected: prepared.plan.rejected,
    blocked,
    warnings: prepared.plan.warnings,
    topics,
  };
}
