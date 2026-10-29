// TMFA topic administration — service-level release gates.
//
// These exercise mutateAdminTopic and updateAdminMedia against an in-memory
// fake of the Supabase query builder. They lock what the admin console relies
// on:
//   - content edits are validated and diverge from the bundled pack hash,
//   - editing approved/published content returns it to review and unpublishes,
//   - approval and publication are separate transitions, and publication
//     re-evaluates every gate from persisted rows,
//   - an accessible-equivalent waiver needs approved content and a rationale,
//   - a mandatory media regression unpublishes the topic.
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
  asActorId,
  mutateAdminTopic,
  updateAdminMedia,
  TopicAdminError,
} from '@/src/server/services/academy/topics/admin';

type Row = Record<string, unknown>;
type MutationDb = Parameters<typeof mutateAdminTopic>[0];
type QueryResult = { data: unknown; error: null; count: number | null };

interface UpdateRecord {
  table: string;
  patch: Row;
  matched: number;
  filters: Array<[string, unknown]>;
}

class FakeDb {
  readonly updates: UpdateRecord[] = [];
  readonly inserts: Array<{ table: string; payload: Row | Row[] }> = [];

  constructor(readonly tables: Record<string, Row[]>) {}

  from(table: string): FakeQuery {
    return new FakeQuery(this, table);
  }

  rows(table: string): Row[] {
    return this.tables[table] ?? [];
  }

  insertsFor(table: string): Row[] {
    return this.inserts
      .filter((entry) => entry.table === table)
      .flatMap((entry) => (Array.isArray(entry.payload) ? entry.payload : [entry.payload]));
  }
}

class FakeQuery implements PromiseLike<QueryResult> {
  private filters: Array<[string, unknown]> = [];
  private kind: 'select' | 'update' | 'insert' = 'select';
  private patch: Row = {};
  private payload: Row | Row[] = {};
  private singleMode: 'many' | 'single' | 'maybeSingle' = 'many';
  private wantsHead = false;
  private rangeStart: number | null = null;
  private rangeEnd: number | null = null;

  constructor(private readonly db: FakeDb, private readonly table: string) {}

  select(_columns?: string, options?: { count?: string; head?: boolean }): this {
    if (this.kind === 'select') this.wantsHead = options?.head === true;
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

  order(): this { return this; }
  limit(): this { return this; }

  range(start: number, end: number): this {
    this.rangeStart = start;
    this.rangeEnd = end;
    return this;
  }

  maybeSingle(): this {
    this.singleMode = 'maybeSingle';
    return this;
  }

  single(): this {
    this.singleMode = 'single';
    return this;
  }

  then<TResult1 = QueryResult, TResult2 = never>(
    onfulfilled?: ((value: QueryResult) => TResult1 | PromiseLike<TResult1>) | null,
    onrejected?: ((reason: unknown) => TResult2 | PromiseLike<TResult2>) | null,
  ): Promise<TResult1 | TResult2> {
    return Promise.resolve(this.execute()).then(onfulfilled, onrejected);
  }

  private matches(row: Row): boolean {
    return this.filters.every(([column, value]) => row[column] === value);
  }

  private execute(): QueryResult {
    const table = this.db.tables[this.table] ?? (this.db.tables[this.table] = []);

    if (this.kind === 'insert') {
      this.db.inserts.push({ table: this.table, payload: this.payload });
      const rows = Array.isArray(this.payload) ? this.payload : [this.payload];
      for (const row of rows) table.push({ id: row.id ?? `row_${table.length + 1}`, ...row });
      return { data: null, error: null, count: null };
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
      return { data: null, error: null, count: null };
    }

    const matched = table.filter((row) => this.matches(row));
    if (this.wantsHead) return { data: null, error: null, count: matched.length };
    if (this.singleMode !== 'many') {
      return { data: matched[0] ? { ...matched[0] } : null, error: null, count: null };
    }
    const sliced = this.rangeStart === null
      ? matched
      : matched.slice(this.rangeStart, (this.rangeEnd ?? matched.length - 1) + 1);
    // Supabase returns fresh objects, so a mutation of the table must not
    // rewrite a snapshot the service already read.
    return { data: sliced.map((row) => ({ ...row })), error: null, count: sliced.length };
  }
}

function asDb(db: FakeDb): MutationDb {
  return db as unknown as MutationDb;
}

/**
 * Synthetic article that clears the mechanical depth floor. It is not
 * curriculum content; it exists so workflow tests isolate the gate under test.
 */
const ARTICLE = [
  '# Synthetic article for the acting topic',
  '## Foundations',
  'A complete teachable sentence for the acting topic. '.repeat(35),
  '## Worked example',
  'A complete teachable sentence for the acting topic. '.repeat(30),
  '## Practical exercise',
  'A complete teachable sentence for the acting topic. '.repeat(30),
  '## Self-check before the quiz',
  'A complete teachable sentence for the acting topic. '.repeat(30),
].join('\n\n');

function topic(over: Row = {}): Row {
  return {
    topic_id: 'T01',
    course_id: 'ACT',
    stage: 'L1',
    stage_label: 'Level 1',
    title: 'Acting foundations',
    lesson_markdown: ARTICLE,
    content_status: 'draft',
    quiz_minimum_percent: 85,
    quiz_draw_count: 10,
    quiz_time_limit_minutes: 20,
    media_status: 'TO PRODUCE',
    learning_outcomes: [{ objective_id: 'OBJ-1', description: 'Describe the technique' }],
    required_media: [],
    prerequisites: [],
    order_index: 1,
    published: false,
    published_at: null,
    accessible_equivalent_approved: false,
    accessible_equivalent_note: '',
    source_hash: 'pack-hash',
    updated_at: '2026-01-01T00:00:00.000Z',
    ...over,
  };
}

function approvedQuestions(count: number, topicId = 'T01'): Row[] {
  return Array.from({ length: count }, (_, index) => ({
    id: `Q${index + 1}`,
    academy_scope: 'film',
    film_topic_id: topicId,
    status: 'approved',
  }));
}

function makeDb(over: {
  topic?: Row;
  media?: Row[];
  questions?: Row[];
  course?: Row[];
} = {}): FakeDb {
  return new FakeDb({
    film_topics: [over.topic ?? topic()],
    film_topic_media: over.media ?? [],
    academy_question_items: over.questions ?? approvedQuestions(20),
    film_courses: over.course ?? [{ course_id: 'ACT', title: 'Acting' }],
    film_academic_audit: [],
    film_topic_mastery: [],
    film_topic_attempts: [],
    film_mastery_holds: [],
  });
}

describe('topic content saves', () => {
  it('edits a draft, normalises its inputs and clears the pack hash', async () => {
    const db = makeDb();
    const result = await mutateAdminTopic(asDb(db), 'admin-1', 'T01', {
      action: 'save',
      title: '  Acting foundations v2  ',
      stage: 'L2',
      stageLabel: 'Level 2',
      lessonMarkdown: `Updated. ${ARTICLE}`,
      learningOutcomes: [{ objective_id: ' OBJ-1 ', description: ' Do the thing ' }],
      requiredMedia: ['teaching_video', 'teaching_video', ' transcript '],
      prerequisites: ['A01'],
      quizMinimumPercent: 90,
      quizDrawCount: 20,
      quizTimeLimitMinutes: 30,
    });

    expect(result).toMatchObject({
      action: 'save',
      returnedToReview: false,
      contentStatus: 'draft',
      published: false,
    });
    expect(db.rows('film_topics')[0]).toMatchObject({
      title: 'Acting foundations v2',
      stage: 'L2',
      stage_label: 'Level 2',
      lesson_markdown: `Updated. ${ARTICLE}`,
      learning_outcomes: [{ objective_id: 'OBJ-1', description: 'Do the thing' }],
      required_media: ['teaching_video', 'transcript'],
      prerequisites: ['A01'],
      quiz_minimum_percent: 90,
      quiz_draw_count: 20,
      quiz_time_limit_minutes: 30,
      source_hash: null,
    });
    expect(db.insertsFor('film_academic_audit')[0]).toMatchObject({
      action: 'TOPIC_EDITED',
      target_id: 'T01',
      actor_id: 'admin-1',
    });
  });

  it('returns approved and published content to review, unpublishes it and clears the waiver', async () => {
    const db = makeDb({
      topic: topic({
        content_status: 'approved',
        published: true,
        published_at: '2026-01-02T00:00:00.000Z',
        accessible_equivalent_approved: true,
        accessible_equivalent_note: 'Faculty-approved transcript is the accessible equivalent.',
      }),
    });
    const result = await mutateAdminTopic(asDb(db), null, 'T01', {
      action: 'save',
      lessonMarkdown: `${ARTICLE}\n\nA newly added paragraph.`,
    });

    expect(result).toMatchObject({ returnedToReview: true, contentStatus: 'review', published: false });
    expect(result.message).toContain('returned to review');
    expect(db.rows('film_topics')[0]).toMatchObject({
      content_status: 'review',
      published: false,
      published_at: null,
      accessible_equivalent_approved: false,
      accessible_equivalent_note: '',
      source_hash: null,
    });
    expect(db.insertsFor('film_academic_audit')[0]).toMatchObject({
      action: 'TOPIC_EDITED',
      before: { contentStatus: 'approved', published: true },
    });
  });

  it('refuses a pass mark below the 85% policy floor without writing anything', async () => {
    const db = makeDb();
    await expect(mutateAdminTopic(asDb(db), null, 'T01', {
      action: 'save',
      quizMinimumPercent: 84,
    })).rejects.toMatchObject({ status: 400, code: 'INVALID_INPUT' });

    expect(db.updates).toHaveLength(0);
    expect(db.insertsFor('film_academic_audit')).toHaveLength(0);
  });

  it('rejects a blank title and duplicate outcome IDs', async () => {
    const blank = makeDb();
    await expect(mutateAdminTopic(asDb(blank), null, 'T01', {
      action: 'save',
      title: '   ',
    })).rejects.toBeInstanceOf(TopicAdminError);

    const duplicate = makeDb();
    await expect(mutateAdminTopic(asDb(duplicate), null, 'T01', {
      action: 'save',
      learningOutcomes: [
        { objective_id: 'OBJ-1', description: 'First' },
        { objective_id: 'OBJ-1', description: 'Second' },
      ],
    })).rejects.toMatchObject({ status: 400, code: 'INVALID_INPUT' });

    expect(blank.updates).toHaveLength(0);
    expect(duplicate.updates).toHaveLength(0);
  });
});

describe('review and publication transitions', () => {
  it('submits a teachable draft for review but refuses a brief', async () => {
    const db = makeDb();
    const result = await mutateAdminTopic(asDb(db), 'admin-1', 'T01', { action: 'submit_review' });
    expect(result).toMatchObject({ action: 'submit_review', contentStatus: 'review' });
    expect(db.rows('film_topics')[0].content_status).toBe('review');
    expect(db.insertsFor('film_academic_audit')[0]).toMatchObject({
      action: 'TOPIC_SUBMITTED_FOR_REVIEW',
    });

    const brief = makeDb({ topic: topic({ lesson_markdown: 'Too short.' }) });
    await expect(mutateAdminTopic(asDb(brief), null, 'T01', { action: 'submit_review' }))
      .rejects.toMatchObject({ status: 422, code: 'ARTICLE_NOT_TEACHABLE' });
    expect(brief.updates).toHaveLength(0);
  });

  it('refuses a 200+ character brief that fails the depth standard', async () => {
    const shallow = 'A short brief. '.repeat(20);
    expect(shallow.trim().length).toBeGreaterThan(200);

    const draft = makeDb({ topic: topic({ lesson_markdown: shallow }) });
    await expect(mutateAdminTopic(asDb(draft), null, 'T01', { action: 'submit_review' }))
      .rejects.toMatchObject({ status: 422, code: 'ARTICLE_TOO_SHORT' });
    expect(draft.updates).toHaveLength(0);

    const review = makeDb({ topic: topic({ content_status: 'review', lesson_markdown: shallow }) });
    await expect(mutateAdminTopic(asDb(review), null, 'T01', { action: 'approve' }))
      .rejects.toMatchObject({ status: 422, code: 'ARTICLE_TOO_SHORT' });
    expect(review.updates).toHaveLength(0);

    const approved = makeDb({ topic: topic({ content_status: 'approved', lesson_markdown: shallow }) });
    await expect(mutateAdminTopic(asDb(approved), null, 'T01', { action: 'publish' }))
      .rejects.toMatchObject({ status: 422, code: 'PUBLICATION_BLOCKED' });
    expect(approved.rows('film_topics')[0].published).toBe(false);
  });

  it('approves only a topic that is actually in review', async () => {
    const draft = makeDb();
    await expect(mutateAdminTopic(asDb(draft), null, 'T01', { action: 'approve' }))
      .rejects.toMatchObject({ status: 409, code: 'INVALID_STATE' });

    const review = makeDb({ topic: topic({ content_status: 'review' }) });
    const result = await mutateAdminTopic(asDb(review), 'admin-1', 'T01', { action: 'approve' });
    expect(result).toMatchObject({ action: 'approve', contentStatus: 'approved', published: false });
    expect(review.rows('film_topics')[0].content_status).toBe('approved');
  });

  it('re-evaluates every gate on publish instead of trusting the workflow state', async () => {
    const blocked = makeDb({
      topic: topic({ content_status: 'approved' }),
      questions: approvedQuestions(19),
    });
    await expect(mutateAdminTopic(asDb(blocked), 'admin-1', 'T01', { action: 'publish' }))
      .rejects.toMatchObject({ status: 422, code: 'PUBLICATION_BLOCKED' });
    expect(blocked.rows('film_topics')[0].published).toBe(false);

    const ready = makeDb({
      topic: topic({ content_status: 'approved' }),
      questions: approvedQuestions(20),
    });
    const result = await mutateAdminTopic(asDb(ready), 'admin-1', 'T01', { action: 'publish' });
    expect(result).toMatchObject({ action: 'publish', published: true, contentStatus: 'approved' });
    expect(ready.rows('film_topics')[0]).toMatchObject({ published: true, published_by: 'admin-1' });
    expect(ready.insertsFor('film_academic_audit')[0]).toMatchObject({ action: 'TOPIC_PUBLISHED' });
  });

  it('signs a waiver only on approved content and only with a written rationale', async () => {
    const draft = makeDb();
    await expect(mutateAdminTopic(asDb(draft), null, 'T01', {
      action: 'set_accessible_equivalent',
      accessibleEquivalentApproved: true,
      accessibleEquivalentNote: 'Faculty-approved transcript is the accessible equivalent.',
    })).rejects.toMatchObject({ status: 409, code: 'INVALID_STATE' });

    const approved = makeDb({ topic: topic({ content_status: 'approved' }) });
    await expect(mutateAdminTopic(asDb(approved), null, 'T01', {
      action: 'set_accessible_equivalent',
      accessibleEquivalentApproved: true,
      accessibleEquivalentNote: 'too short',
    })).rejects.toMatchObject({ status: 400, code: 'NOTE_REQUIRED' });

    const result = await mutateAdminTopic(asDb(approved), 'admin-1', 'T01', {
      action: 'set_accessible_equivalent',
      accessibleEquivalentApproved: true,
      accessibleEquivalentNote: 'Faculty-approved transcript is the accessible equivalent.',
    });
    expect(result.message).toContain('recorded');
    expect(approved.rows('film_topics')[0]).toMatchObject({
      accessible_equivalent_approved: true,
      accessible_equivalent_note: 'Faculty-approved transcript is the accessible equivalent.',
    });
  });
});

function medium(over: Row = {}): Row {
  return {
    asset_id: 'M1',
    topic_id: 'T01',
    course_id: 'ACT',
    media_type: 'teaching_video',
    required: true,
    language: 'en-NG',
    production_state: 'EDITED',
    rights_status: 'CLEARED',
    accessibility_status: 'PASSED',
    instructions: '',
    owner: '',
    media_url: 'https://cdn.example.test/lesson.mp4',
    thumbnail_url: '',
    captions_url: '',
    transcript: 'A full transcript of the lesson.',
    alt_text: '',
    expires_at: null,
    replacement_asset_id: null,
    updated_at: '2026-01-01T00:00:00.000Z',
    ...over,
  };
}

describe('teaching-media updates', () => {
  it('refuses to publish an audiovisual asset with no file URL', async () => {
    const db = makeDb({ media: [medium({ media_url: '' })] });
    await expect(updateAdminMedia(asDb(db), 'admin-1', 'M1', { productionState: 'PUBLISHED' }))
      .rejects.toMatchObject({ status: 422, code: 'MEDIA_NOT_PUBLISHABLE' });
    expect(db.updates).toHaveLength(0);
  });

  it('unpublishes a live topic when publishing one asset leaves another mandatory asset unready', async () => {
    const db = makeDb({
      topic: topic({ content_status: 'approved', published: true }),
      media: [
        medium({ production_state: 'EDITED' }),
        medium({ asset_id: 'M2', production_state: 'PLANNED', media_url: '' }),
      ],
    });
    const result = await updateAdminMedia(asDb(db), 'admin-1', 'M1', {
      productionState: 'PUBLISHED',
    });

    expect(result).toMatchObject({ published: true, topicUnpublished: true });
    expect(db.rows('film_topics')[0].published).toBe(false);
    expect(db.insertsFor('film_academic_audit').map((entry) => entry.action))
      .toContain('TOPIC_AUTO_UNPUBLISHED');
  });
});

describe('actor ids', () => {
  it('persists null for the synthetic API-key actor and keeps a real uuid', () => {
    expect(asActorId('api-key')).toBeNull();
    expect(asActorId('6a1c0f3e-4a52-4f9f-9d2a-8b7e6c5d4e3f'))
      .toBe('6a1c0f3e-4a52-4f9f-9d2a-8b7e6c5d4e3f');
  });
});
