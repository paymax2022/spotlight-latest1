// TMFA topic-targeted question authoring import.
//
// The module-coded bank importer cannot attach items to a topic, so this path
// is what lets SMEs close the 20-approved-per-topic gate. These tests lock the
// properties the content programme depends on:
//   - a row must name a real topic and (when supplied) a declared objective,
//   - the letter in Correct Option must agree with Correct Answer,
//   - every accepted row lands as DRAFT; imports never approve or reassign,
//   - approved/review/retired, module-coded, and differently-assigned items are
//     locked rather than overwritten,
//   - preview writes nothing, commit writes exactly the previewed counts,
//   - the readiness CSV mirrors the server-evaluated gate and is spreadsheet-safe.
//
// No database is touched; Supabase is mocked and the query builder is faked.

import { createHash } from 'node:crypto';

import { describe, it, expect, vi } from 'vitest';

vi.mock('@/lib/supabase/server', () => ({
  createAdminClient: () => {
    throw new Error('These tests use an in-memory client.');
  },
}));

import {
  TOPIC_QUESTION_HEADERS,
  TopicQuestionImportError,
  applyTopicQuestionImport,
  buildTopicQuestionImportPlan,
  checkTopicQuestionHeaders,
  loadTopicQuestionAuthoringContext,
  previewTopicQuestionImport,
  type TopicQuestionTopicContext,
} from '@/src/server/services/academy/topics/question-import';
import {
  TOPIC_READINESS_HEADERS,
  topicReadinessCsv,
} from '@/src/server/services/academy/topics/readiness';
import type { AdminTopicRow } from '@/src/server/services/academy/topics/admin';

type Row = Record<string, unknown>;
type Db = Parameters<typeof previewTopicQuestionImport>[0];
type QueryError = { message: string; code?: string };
type QueryResult = { data: unknown; error: QueryError | null; count: number | null };

class FakeDb {
  readonly inserts: Array<{ table: string; payload: Row | Row[] }> = [];
  readonly updates: Array<{
    table: string;
    patch: Row;
    matched: number;
    filters: Array<[string, unknown]>;
  }> = [];

  /** External codes that raise a unique violation (23505) on insert. */
  readonly uniqueViolationOn = new Set<string>();
  /** Simulate a status change between prepare and write, so update matches zero rows. */
  suppressUpdateSelect = false;

  private nextId = 1;

  constructor(readonly tables: Record<string, Row[]>) {}

  from(table: string): FakeQuery {
    return new FakeQuery(this, table);
  }

  rows(table: string): Row[] {
    if (!this.tables[table]) this.tables[table] = [];
    return this.tables[table];
  }

  insertsFor(table: string): Row[] {
    return this.inserts
      .filter((entry) => entry.table === table)
      .flatMap((entry) => (Array.isArray(entry.payload) ? entry.payload : [entry.payload]));
  }

  updatesFor(table: string): Array<{ patch: Row; matched: number; filters: Array<[string, unknown]> }> {
    return this.updates.filter((entry) => entry.table === table);
  }

  takeId(prefix: string): string {
    return `${prefix}_${this.nextId++}`;
  }
}

class FakeQuery implements PromiseLike<QueryResult> {
  private filters: Array<[string, unknown]> = [];
  private inFilters: Array<[string, unknown[]]> = [];
  private kind: 'select' | 'insert' | 'update' = 'select';
  private patch: Row = {};
  private payload: Row | Row[] = {};
  private selectCalled = false;
  private singleMode: 'many' | 'single' | 'maybeSingle' = 'many';

  constructor(private readonly db: FakeDb, private readonly table: string) {}

  select(_columns?: string, _options?: { count?: string; head?: boolean }): this {
    this.selectCalled = true;
    return this;
  }

  insert(payload: Row | Row[]): this {
    this.kind = 'insert';
    this.payload = payload;
    return this;
  }

  update(patch: Row): this {
    this.kind = 'update';
    this.patch = patch;
    return this;
  }

  eq(column: string, value: unknown): this {
    this.filters.push([column, value]);
    return this;
  }

  in(column: string, values: unknown[]): this {
    this.inFilters.push([column, values]);
    return this;
  }

  order(): this { return this; }
  limit(): this { return this; }

  single(): this {
    this.singleMode = 'single';
    return this;
  }

  maybeSingle(): this {
    this.singleMode = 'maybeSingle';
    return this;
  }

  then<TResult1 = QueryResult, TResult2 = never>(
    onfulfilled?: ((value: QueryResult) => TResult1 | PromiseLike<TResult1>) | null,
    onrejected?: ((reason: unknown) => TResult2 | PromiseLike<TResult2>) | null,
  ): Promise<TResult1 | TResult2> {
    return Promise.resolve(this.execute()).then(onfulfilled, onrejected);
  }

  private matches(row: Row): boolean {
    if (!this.filters.every(([column, value]) => row[column] === value)) return false;
    return this.inFilters.every(([column, values]) => values.includes(row[column]));
  }

  private execute(): QueryResult {
    const table = this.db.rows(this.table);

    if (this.kind === 'insert') {
      const payloads = Array.isArray(this.payload) ? this.payload : [this.payload];
      this.db.inserts.push({ table: this.table, payload: this.payload });
      const inserted: Row[] = [];
      for (const payload of payloads) {
        if (
          this.table === 'academy_question_items' &&
          this.db.uniqueViolationOn.has(String(payload.external_code ?? ''))
        ) {
          return {
            data: null,
            error: { message: 'duplicate key value violates unique constraint', code: '23505' },
            count: null,
          };
        }
        const row: Row = { id: payload.id ?? this.db.takeId(this.table), ...payload };
        table.push(row);
        inserted.push({ ...row });
      }
      if (this.singleMode !== 'many') {
        return { data: inserted[0] ?? null, error: null, count: null };
      }
      return { data: this.selectCalled ? inserted : null, error: null, count: null };
    }

    if (this.kind === 'update') {
      const matched = table.filter((row) => this.matches(row));
      for (const row of matched) Object.assign(row, this.patch);
      this.db.updates.push({
        table: this.table,
        patch: this.patch,
        matched: matched.length,
        filters: this.filters,
      });
      if (!this.selectCalled) return { data: null, error: null, count: null };
      return {
        data: this.db.suppressUpdateSelect ? [] : matched.map((row) => ({ ...row })),
        error: null,
        count: null,
      };
    }

    const matched = table.filter((row) => this.matches(row));
    if (this.singleMode !== 'many') {
      return { data: matched[0] ? { ...matched[0] } : null, error: null, count: null };
    }
    return { data: matched.map((row) => ({ ...row })), error: null, count: null };
  }
}

function asDb(db: FakeDb): Db {
  return db as unknown as Db;
}

// ── CSV fixtures ──────────────────────────────────────────────────────────

const BASE_ROW: Record<(typeof TOPIC_QUESTION_HEADERS)[number], string> = {
  'Question ID': 'Q-001',
  'Topic ID': 'T01',
  'Objective ID': 'OBJ-1',
  'Question': 'What is the first beat?',
  'Option A': 'Alpha',
  'Option B': 'Beta',
  'Option C': 'Gamma',
  'Option D': 'Delta',
  'Correct Option': 'A',
  'Correct Answer': 'Alpha',
  'Rationale': 'Because alpha is the opening action.',
  'Points': '10',
  'Difficulty': 'foundation',
  'Cognitive Level': 'understand',
  'Version': '1.0',
};

function quote(value: string): string {
  return /[",\r\n]/.test(value) ? `"${value.replace(/"/g, '""')}"` : value;
}

function dataRow(over: Partial<Record<(typeof TOPIC_QUESTION_HEADERS)[number], string>> = {}): string {
  const values = { ...BASE_ROW, ...over };
  return TOPIC_QUESTION_HEADERS.map((header) => quote(values[header] ?? '')).join(',');
}

function csvOf(...rows: string[]): string {
  return [TOPIC_QUESTION_HEADERS.join(','), ...rows].join('\r\n');
}

// ── Context fixtures ──────────────────────────────────────────────────────

function context(
  over: Partial<TopicQuestionTopicContext> = {},
): TopicQuestionTopicContext {
  return {
    topicId: 'T01',
    courseId: 'ACT',
    stage: 'L1',
    title: 'Acting foundations',
    contentStatus: 'draft',
    published: false,
    drawCount: 10,
    outcomes: [{ objective_id: 'OBJ-1', description: 'Describe the technique' }],
    counts: { draft: 0, review: 0, approved: 0, retired: 0, total: 0 },
    ...over,
  };
}

function topicRow(over: Row = {}): Row {
  return {
    topic_id: 'T01',
    course_id: 'ACT',
    stage: 'L1',
    title: 'Acting foundations',
    content_status: 'draft',
    published: false,
    quiz_draw_count: 10,
    learning_outcomes: [{ objective_id: 'OBJ-1', description: 'Describe the technique' }],
    order_index: 1,
    ...over,
  };
}

const EXISTING_OPTIONS = [
  { id: 'a', text: 'Alpha' },
  { id: 'b', text: 'Beta' },
  { id: 'c', text: 'Gamma' },
  { id: 'd', text: 'Delta' },
];

function existingQuestion(over: Row = {}): Row {
  return {
    id: 'Q-EXISTING',
    external_code: 'Q-001',
    academy_scope: 'film',
    status: 'draft',
    stem: 'What is the first beat?',
    options: EXISTING_OPTIONS,
    answer: { correct: ['a'], explanation: 'Because alpha is the opening action.' },
    film_points: 10,
    film_topic_id: 'T01',
    film_objective_id: 'OBJ-1',
    film_module_code: null,
    film_difficulty: 'foundation',
    film_cognitive: 'understand',
    source_version: '1.0',
    ...over,
  };
}

function makeDb(over: { questions?: Row[]; topics?: Row[] } = {}): FakeDb {
  return new FakeDb({
    film_topics: over.topics ?? [topicRow()],
    academy_question_items: over.questions ?? [],
    academy_question_import_batches: [],
    film_academic_audit: [],
  });
}

// ── Pure parser ───────────────────────────────────────────────────────────

describe('topic question CSV validation', () => {
  it('accepts a complete row and keeps the answer key server-side', () => {
    const plan = buildTopicQuestionImportPlan(csvOf(dataRow()), [context()]);

    expect(plan.rejected).toEqual([]);
    expect(plan.accepted).toHaveLength(1);
    expect(plan.totalRows).toBe(1);

    const row = plan.accepted[0];
    expect(row.row).toBe(2);
    expect(row.topicId).toBe('T01');
    expect(row.objectiveId).toBe('OBJ-1');
    expect(row.options.map((option) => option.id)).toEqual(['a', 'b', 'c', 'd']);
    expect(row.correctOptionId).toBe('a');
    expect(row.points).toBe(10);
    // Nothing in the plan names the correct answer outside the server-side row
    // shape itself; the console never receives this struct.
    expect(plan.warnings[0]).toContain('never approves');
  });

  it('hashes the source and counts data rows', () => {
    const csv = csvOf(dataRow(), dataRow({ 'Question ID': 'Q-002' }));
    const plan = buildTopicQuestionImportPlan(csv, [context()]);

    expect(plan.totalRows).toBe(2);
    expect(plan.sourceHash).toBe(createHash('sha256').update(csv).digest('hex'));
  });

  it('reports missing columns by name', () => {
    const check = checkTopicQuestionHeaders(['Question ID', 'Topic ID', 'Question']);
    expect(check.ok).toBe(false);
    expect(check.missing).toContain('Correct Answer');
    expect(check.missing).toContain('Rationale');

    expect(checkTopicQuestionHeaders([...TOPIC_QUESTION_HEADERS]).ok).toBe(true);
  });

  it('rejects a row with missing required fields and names every one', () => {
    const plan = buildTopicQuestionImportPlan(
      csvOf(dataRow({ 'Rationale': '', 'Correct Answer': '', 'Points': '' })),
      [context()],
    );

    expect(plan.accepted).toEqual([]);
    expect(plan.rejected).toHaveLength(1);
    expect(plan.rejected[0].code).toBe('MISSING_FIELDS');
    expect(plan.rejected[0].message).toContain('Rationale');
    expect(plan.rejected[0].message).toContain('Correct Answer');
    expect(plan.rejected[0].message).toContain('Points');
  });

  it('rejects an unknown topic', () => {
    const plan = buildTopicQuestionImportPlan(csvOf(dataRow({ 'Topic ID': 'T99' })), [context()]);
    expect(plan.rejected[0]).toMatchObject({ code: 'UNKNOWN_TOPIC', externalCode: 'Q-001' });
  });

  it('rejects an objective that is not declared for the topic', () => {
    const plan = buildTopicQuestionImportPlan(
      csvOf(dataRow({ 'Objective ID': 'OBJ-9' })),
      [context()],
    );
    expect(plan.rejected[0].code).toBe('UNKNOWN_OBJECTIVE');
  });

  it('rejects duplicate question IDs case-insensitively', () => {
    const plan = buildTopicQuestionImportPlan(
      csvOf(dataRow(), dataRow({ 'Question ID': 'q-001' })),
      [context()],
    );
    expect(plan.accepted).toHaveLength(1);
    expect(plan.rejected[0]).toMatchObject({ row: 3, code: 'DUPLICATE_ID' });
  });

  it('rejects four options that are not distinct after normalisation', () => {
    const plan = buildTopicQuestionImportPlan(
      csvOf(dataRow({ 'Option B': '  alpha ' })),
      [context()],
    );
    expect(plan.rejected[0].code).toBe('DUPLICATE_OPTION');
  });

  it('rejects an invalid correct-option letter', () => {
    const plan = buildTopicQuestionImportPlan(
      csvOf(dataRow({ 'Correct Option': 'E' })),
      [context()],
    );
    expect(plan.rejected[0].code).toBe('INVALID_KEY');
  });

  it('rejects a Correct Answer that does not match the selected option', () => {
    const plan = buildTopicQuestionImportPlan(
      csvOf(dataRow({ 'Correct Answer': 'Beta' })),
      [context()],
    );
    expect(plan.rejected[0].code).toBe('KEY_MISMATCH');
  });

  it('rejects non-positive and fractional points', () => {
    const zero = buildTopicQuestionImportPlan(csvOf(dataRow({ 'Points': '0' })), [context()]);
    expect(zero.rejected[0].code).toBe('INVALID_POINTS');

    const fractional = buildTopicQuestionImportPlan(csvOf(dataRow({ 'Points': '2.5' })), [context()]);
    expect(fractional.rejected[0].code).toBe('INVALID_POINTS');
  });

  it('warns about a repeated stem instead of rejecting the row', () => {
    const plan = buildTopicQuestionImportPlan(
      csvOf(dataRow(), dataRow({ 'Question ID': 'Q-002' })),
      [context()],
    );

    expect(plan.accepted).toHaveLength(2);
    expect(plan.warnings.some((warning) => warning.includes('repeats another stem'))).toBe(true);
  });

  it('warns about unmapped objectives and published topics', () => {
    const plan = buildTopicQuestionImportPlan(
      csvOf(dataRow({ 'Objective ID': '' }), dataRow({ 'Question ID': 'Q-002', 'Question': 'Second?' })),
      [context({ published: true })],
    );

    expect(plan.accepted).toHaveLength(2);
    expect(plan.accepted[0].objectiveId).toBe('');
    expect(plan.warnings.some((warning) => warning.includes('no objective mapping'))).toBe(true);
    expect(plan.warnings.some((warning) => warning.includes('target published topics'))).toBe(true);
    expect(plan.warnings.some((warning) => warning.includes('SME approval is required'))).toBe(true);
  });

  it('parses quoted commas, quotes and newlines without splitting the row', () => {
    const stem = 'When the director says "hold,"\nwhat happens next, and why?';
    const plan = buildTopicQuestionImportPlan(csvOf(dataRow({ 'Question': stem })), [context()]);

    expect(plan.rejected).toEqual([]);
    expect(plan.accepted[0].stem).toBe(stem);
  });

  it('skips blank rows without inventing rejections', () => {
    const plan = buildTopicQuestionImportPlan(csvOf(dataRow(), ',,,,,,,,,,,,,,'), [context()]);
    expect(plan.accepted).toHaveLength(1);
    expect(plan.rejected).toEqual([]);
  });
});

// ── Preview and commit ────────────────────────────────────────────────────

describe('topic question import preview', () => {
  it('writes nothing, reports the gap, and classifies locked items', async () => {
    const db = makeDb({
      questions: [
        existingQuestion({ id: 'Q-APPROVED', external_code: 'Q-APPROVED', status: 'approved' }),
        existingQuestion({
          id: 'Q-MODULE',
          external_code: 'Q-MODULE',
          film_module_code: 'M01',
          film_topic_id: null,
        }),
        existingQuestion({ id: 'Q-OTHER', external_code: 'Q-OTHER', film_topic_id: 'T99' }),
      ],
    });

    const csv = csvOf(
      dataRow(),
      dataRow({ 'Question ID': 'Q-APPROVED', 'Question': 'Approved stem?' }),
      dataRow({ 'Question ID': 'Q-MODULE', 'Question': 'Module stem?' }),
      dataRow({ 'Question ID': 'Q-OTHER', 'Question': 'Other topic stem?' }),
    );
    const preview = await previewTopicQuestionImport(asDb(db), csv);

    expect(db.inserts).toEqual([]);
    expect(db.updates).toEqual([]);
    expect(preview.totals).toMatchObject({
      rows: 4,
      accepted: 4,
      rejected: 0,
      wouldInsert: 1,
      wouldUpdate: 0,
      unchanged: 0,
      locked: 3,
    });
    expect(preview.blocked.map((problem) => problem.code).sort()).toEqual([
      'MODULE_ITEM_LOCKED',
      'QUESTION_LOCKED',
      'TOPIC_MISMATCH',
    ]);
    expect(preview.topics[0]).toMatchObject({
      topicId: 'T01',
      required: 20,
      approved: 1,
      // Only the approved row is bound to T01; the module-coded and T99 rows
      // belong to other pools and only the new Q-001 would land here.
      draft: 0,
      submitted: 4,
      draftAfter: 1,
      shortfall: 19,
    });
  });

  it('classifies an identical draft as unchanged and a changed draft as update', async () => {
    const db = makeDb({
      questions: [
        existingQuestion(),
        existingQuestion({
          id: 'Q-B',
          external_code: 'Q-002',
          stem: 'An older stem?',
        }),
      ],
    });
    const preview = await previewTopicQuestionImport(
      asDb(db),
      csvOf(dataRow(), dataRow({ 'Question ID': 'Q-002' })),
    );

    expect(preview.totals).toMatchObject({ wouldInsert: 0, wouldUpdate: 1, unchanged: 1, locked: 0 });
    expect(db.updates).toEqual([]);
  });

  it('rejects a CSV with missing headers before touching the database', async () => {
    const db = makeDb();
    await expect(
      previewTopicQuestionImport(asDb(db), 'Question ID,Topic ID\r\nQ-1,T01'),
    ).rejects.toMatchObject({ status: 400, code: 'HEADERS_MISSING' });
    expect(db.inserts).toEqual([]);
  });

  it('rejects a header-only CSV', async () => {
    const db = makeDb();
    await expect(
      previewTopicQuestionImport(asDb(db), TOPIC_QUESTION_HEADERS.join(',')),
    ).rejects.toMatchObject({ status: 400, code: 'NO_ROWS' });
  });

  it('serves the authoring context without creating a batch', async () => {
    const db = makeDb({ questions: [existingQuestion({ status: 'approved' })] });
    const contextResult = await loadTopicQuestionAuthoringContext(asDb(db));

    expect(contextResult.headers).toEqual(TOPIC_QUESTION_HEADERS);
    expect(contextResult.templateFilename).toBe('tmfa-topic-questions-template.csv');
    expect(contextResult.topics[0]).toMatchObject({ approved: 1, submitted: 0, shortfall: 19 });
    expect(db.inserts).toEqual([]);
  });
});

describe('topic question import commit', () => {
  it('inserts a topic-bound draft, records the batch, and audits it', async () => {
    const db = makeDb();
    const result = await applyTopicQuestionImport(asDb(db), 'admin-1', 'sme-batch.csv', csvOf(dataRow()));

    expect(result).toMatchObject({ inserted: 1, updated: 0, unchanged: 0, locked: 0 });
    expect(result.rejected).toEqual([]);
    expect(result.topics[0]).toMatchObject({ draftAfter: 1, submitted: 1, approved: 0 });

    const items = db.insertsFor('academy_question_items');
    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({
      status: 'draft',
      external_code: 'Q-001',
      academy_scope: 'film',
      film_topic_id: 'T01',
      film_objective_id: 'OBJ-1',
      film_module_code: null,
      film_department: 'ACT',
      film_stage: 'L1',
      film_points: 10,
      film_review_notes: 'DRAFT — imported for SME review',
      answer: { correct: ['a'], explanation: 'Because alpha is the opening action.' },
    });
    expect(items[0].import_batch_id).toBe(result.batchId);

    const batches = db.insertsFor('academy_question_import_batches');
    expect(batches).toHaveLength(1);
    expect(batches[0]).toMatchObject({
      filename: 'sme-batch.csv',
      committed: true,
      created_by: 'admin-1',
      total_rows: 1,
    });
    expect(String(batches[0].source_sha256)).toHaveLength(64);

    const audit = db.insertsFor('film_academic_audit');
    expect(audit).toHaveLength(1);
    expect(audit[0]).toMatchObject({
      actor_id: 'admin-1',
      action: 'TMFA_TOPIC_QUESTIONS_IMPORTED',
      target_id: result.batchId,
    });

    const batchUpdates = db.updatesFor('academy_question_import_batches');
    expect(batchUpdates).toHaveLength(1);
    expect(batchUpdates[0].patch).toMatchObject({ accepted: 1, updated: 0 });
  });

  it('does not write an identical draft and reports it as unchanged', async () => {
    const db = makeDb({ questions: [existingQuestion()] });
    const result = await applyTopicQuestionImport(asDb(db), null, 'same.csv', csvOf(dataRow()));

    expect(result).toMatchObject({ inserted: 0, updated: 0, unchanged: 1, locked: 0 });
    expect(db.insertsFor('academy_question_items')).toEqual([]);
    expect(db.updatesFor('academy_question_items')).toEqual([]);
  });

  it('updates a draft whose difficulty, cognitive level or version changed', async () => {
    const db = makeDb({
      questions: [existingQuestion({ film_cognitive: 'apply', source_version: '0.9' })],
    });
    const result = await applyTopicQuestionImport(asDb(db), null, 'meta.csv', csvOf(dataRow()));

    expect(result).toMatchObject({ inserted: 0, updated: 1, unchanged: 0, locked: 0 });
    expect(db.updatesFor('academy_question_items')[0].patch).toMatchObject({
      film_cognitive: 'understand',
      film_difficulty: 'foundation',
      source_version: '1.0',
    });
  });

  it('updates only the fields of a draft and never writes status', async () => {
    const db = makeDb({
      questions: [existingQuestion({ stem: 'An older stem?', film_points: 5 })],
    });
    const result = await applyTopicQuestionImport(asDb(db), null, 'fix.csv', csvOf(dataRow()));

    expect(result).toMatchObject({ inserted: 0, updated: 1, unchanged: 0, locked: 0 });
    const updates = db.updatesFor('academy_question_items');
    expect(updates).toHaveLength(1);
    expect(updates[0].patch).not.toHaveProperty('status');
    expect(updates[0].patch).toMatchObject({
      stem: 'What is the first beat?',
      film_points: 10,
      film_topic_id: 'T01',
    });
    expect(updates[0].filters).toContainEqual(['status', 'draft']);
    expect(updates[0].matched).toBe(1);
  });

  it('locks an approved item and writes nothing', async () => {
    const db = makeDb({
      questions: [existingQuestion({ status: 'approved', stem: 'Approved stem?' })],
    });
    const result = await applyTopicQuestionImport(asDb(db), null, 'x.csv', csvOf(dataRow()));

    expect(result).toMatchObject({ inserted: 0, updated: 0, locked: 1 });
    expect(result.blocked[0]).toMatchObject({ code: 'QUESTION_LOCKED', externalCode: 'Q-001' });
    expect(db.insertsFor('academy_question_items')).toEqual([]);
    expect(db.updatesFor('academy_question_items')).toEqual([]);
  });

  it('locks a module-coded item so a topic import cannot reassign it', async () => {
    const db = makeDb({
      questions: [existingQuestion({ film_module_code: 'M01', film_topic_id: null })],
    });
    const result = await applyTopicQuestionImport(asDb(db), null, 'x.csv', csvOf(dataRow()));

    expect(result.blocked[0].code).toBe('MODULE_ITEM_LOCKED');
    expect(db.updatesFor('academy_question_items')).toEqual([]);
  });

  it('locks an item already bound to a different topic', async () => {
    const db = makeDb({ questions: [existingQuestion({ film_topic_id: 'T99' })] });
    const result = await applyTopicQuestionImport(asDb(db), null, 'x.csv', csvOf(dataRow()));

    expect(result.blocked[0].code).toBe('TOPIC_MISMATCH');
    expect(db.updatesFor('academy_question_items')).toEqual([]);
  });

  it('turns a unique violation into a locked row instead of failing the batch', async () => {
    const db = makeDb();
    db.uniqueViolationOn.add('Q-001');

    const result = await applyTopicQuestionImport(asDb(db), null, 'race.csv', csvOf(dataRow()));
    expect(result).toMatchObject({ inserted: 0, locked: 1 });
    expect(result.blocked[0]).toMatchObject({ code: 'QUESTION_EXISTS', externalCode: 'Q-001' });

    // The stored batch report includes the row that was blocked during the
    // write loop, not just the ones known at prepare time.
    const batchReport = db.updatesFor('academy_question_import_batches')[0].patch.report as {
      blocked: Array<{ code: string }>;
    };
    expect(batchReport.blocked.some((problem) => problem.code === 'QUESTION_EXISTS')).toBe(true);
  });

  it('reports a draft that changed status mid-import as locked, not updated', async () => {
    const db = makeDb({ questions: [existingQuestion({ stem: 'An older stem?' })] });
    db.suppressUpdateSelect = true;

    const result = await applyTopicQuestionImport(asDb(db), null, 'race.csv', csvOf(dataRow()));
    expect(result).toMatchObject({ inserted: 0, updated: 0, locked: 1 });
    expect(result.blocked[0].code).toBe('QUESTION_LOCKED');
  });

  it('refuses a batch where every row was rejected, before creating a batch', async () => {
    const db = makeDb();
    const csv = csvOf(dataRow({ 'Correct Answer': 'Beta' }));

    await expect(applyTopicQuestionImport(asDb(db), null, 'bad.csv', csv)).rejects.toMatchObject({
      status: 422,
      code: 'NO_VALID_ROWS',
    });
    expect(db.insertsFor('academy_question_import_batches')).toEqual([]);
    expect(db.insertsFor('academy_question_items')).toEqual([]);
  });

  it('imports valid rows while reporting invalid ones', async () => {
    const db = makeDb();
    const csv = csvOf(dataRow(), dataRow({ 'Question ID': 'Q-BAD', 'Points': '-3' }));
    const result = await applyTopicQuestionImport(asDb(db), null, 'mixed.csv', csv);

    expect(result.inserted).toBe(1);
    expect(result.rejected).toHaveLength(1);
    expect(result.rejected[0]).toMatchObject({ code: 'INVALID_POINTS', externalCode: 'Q-BAD' });
  });

  it('throws a typed error, not a bare Error, for invalid input', () => {
    expect(new TopicQuestionImportError(400, 'X', 'message')).toMatchObject({
      name: 'TopicQuestionImportError',
      status: 400,
      code: 'X',
    });
  });
});

// ── Readiness export ──────────────────────────────────────────────────────

function adminRow(over: Partial<AdminTopicRow> = {}): AdminTopicRow {
  return {
    topicId: 'T01',
    courseId: 'ACT',
    courseTitle: 'Acting',
    stage: 'L1',
    stageLabel: 'Level 1',
    title: 'Acting foundations',
    contentStatus: 'draft',
    published: false,
    quizMinimumPercent: 85,
    drawCount: 10,
    timeLimitMinutes: 20,
    approvedQuestions: 12,
    questionCounts: { draft: 5, review: 2, approved: 12, retired: 1, total: 20 },
    media: { total: 3, required: 2, published: 1, missingFile: 1 },
    article: {
      words: 1200,
      sections: 5,
      hasPractical: true,
      hasSelfCheck: true,
      meetsDepthStandard: true,
    },
    waiverSigned: false,
    ready: false,
    blockers: [{ code: 'QUESTIONS_SHORT', message: 'Only 12 approved; needs 20.' }],
    updatedAt: '2026-01-01T00:00:00.000Z',
    ...over,
  };
}

function parseCsvLine(line: string): string[] {
  const out: string[] = [];
  let field = '';
  let quoted = false;
  for (let i = 0; i < line.length; i += 1) {
    const char = line[i];
    if (quoted) {
      if (char === '"' && line[i + 1] === '"') { field += '"'; i += 1; continue; }
      if (char === '"') { quoted = false; continue; }
      field += char;
      continue;
    }
    if (char === '"') { quoted = true; continue; }
    if (char === ',') { out.push(field); field = ''; continue; }
    field += char;
  }
  out.push(field);
  return out;
}

describe('topic readiness CSV', () => {
  it('starts with the declared header and mirrors the server-evaluated gate', () => {
    const csv = topicReadinessCsv([adminRow()]);
    const lines = csv.split('\r\n');
    expect(lines[0]).toBe(TOPIC_READINESS_HEADERS.join(','));
    expect(lines).toHaveLength(3); // header, one row, terminal newline

    const values = parseCsvLine(lines[1]);
    const byHeader = Object.fromEntries(
      TOPIC_READINESS_HEADERS.map((header, index) => [header, values[index]]),
    );
    expect(byHeader).toMatchObject({
      topic_id: 'T01',
      course_id: 'ACT',
      course: 'Acting',
      stage: 'L1',
      title: 'Acting foundations',
      content_status: 'draft',
      published: 'no',
      article_words: '1200',
      article_sections: '5',
      article_has_practical: 'yes',
      article_has_self_check: 'yes',
      article_meets_depth: 'yes',
      draw_count: '10',
      approved_questions: '12',
      draft_questions: '5',
      review_questions: '2',
      required_questions: '20',
      question_shortfall: '8',
      media_required: '2',
      media_published: '1',
      media_missing_file: '1',
      waiver_signed: 'no',
      ready: 'no',
      blocker_codes: 'QUESTIONS_SHORT',
      blockers: 'Only 12 approved; needs 20.',
    });
  });

  it('raises the requirement when the draw count exceeds 20', () => {
    const csv = topicReadinessCsv([adminRow({ drawCount: 30, approvedQuestions: 12 })]);
    const values = parseCsvLine(csv.split('\r\n')[1]);
    const byHeader = Object.fromEntries(
      TOPIC_READINESS_HEADERS.map((header, index) => [header, values[index]]),
    );
    expect(byHeader.required_questions).toBe('30');
    expect(byHeader.question_shortfall).toBe('18');
  });

  it('quotes commas, quotes and newlines', () => {
    const csv = topicReadinessCsv([
      adminRow({
        title: 'Acting, voice and "presence"',
        blockers: [{ code: 'ARTICLE_DEPTH', message: 'Needs more work.\nThen re-review.' }],
      }),
    ]);
    const values = parseCsvLine(csv.split('\r\n')[1]);
    const byHeader = Object.fromEntries(
      TOPIC_READINESS_HEADERS.map((header, index) => [header, values[index]]),
    );
    expect(byHeader.title).toBe('Acting, voice and "presence"');
    expect(byHeader.blockers).toBe('Needs more work.\nThen re-review.');
  });

  it('prefixes spreadsheet formula triggers', () => {
    const csv = topicReadinessCsv([adminRow({ title: '=HYPERLINK("http://x")' })]);
    const values = parseCsvLine(csv.split('\r\n')[1]);
    const byHeader = Object.fromEntries(
      TOPIC_READINESS_HEADERS.map((header, index) => [header, values[index]]),
    );
    expect(byHeader.title).toBe('\'=HYPERLINK("http://x")');
  });

  it('joins multiple blocker codes with a pipe', () => {
    const csv = topicReadinessCsv([
      adminRow({
        blockers: [
          { code: 'ARTICLE_NOT_APPROVED', message: 'Approve the article.' },
          { code: 'MEDIA_MISSING', message: 'Produce the video.' },
        ],
      }),
    ]);
    const values = parseCsvLine(csv.split('\r\n')[1]);
    expect(values[TOPIC_READINESS_HEADERS.indexOf('blocker_codes')]).toBe(
      'ARTICLE_NOT_APPROVED|MEDIA_MISSING',
    );
  });
});
