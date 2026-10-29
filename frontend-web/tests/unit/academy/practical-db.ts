// In-memory fake of the Supabase query builder for practical-assessment tests.
//
// It deliberately implements only the chain shapes the practical services use:
// select with exact counts and head-only counts, insert/update with RETURNING,
// upsert with an on-conflict key, `in`, `not(... is null)`, ordering and range
// paging. Nothing here touches a database.

import type {
  PracticalAssessmentInput,
  PracticalRubricCriterion,
} from '@/src/server/services/academy/topics/practical';
import type { createAdminClient } from '@/lib/supabase/server';

export type Row = Record<string, unknown>;

export interface UpdateRecord {
  table: string;
  patch: Row;
  matched: number;
}

export interface WriteRecord {
  table: string;
  payload: Row | Row[];
  options?: { onConflict?: string; ignoreDuplicates?: boolean };
}

type Filter =
  | { kind: 'eq'; column: string; value: unknown }
  | { kind: 'in'; column: string; values: unknown[] }
  | { kind: 'notNull'; column: string };

export interface QueryResult {
  data: unknown;
  error: { code?: string; message?: string } | null;
  count: number | null;
}

export class FakeDb {
  readonly updates: UpdateRecord[] = [];
  readonly inserts: WriteRecord[] = [];
  readonly upserts: WriteRecord[] = [];

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

  updatesFor(table: string): UpdateRecord[] {
    return this.updates.filter((entry) => entry.table === table);
  }

  upsertsFor(table: string): WriteRecord[] {
    return this.upserts.filter((entry) => entry.table === table);
  }
}

function clone(row: Row): Row {
  return { ...row };
}

class FakeQuery implements PromiseLike<QueryResult> {
  private filters: Filter[] = [];
  private kind: 'select' | 'update' | 'insert' | 'upsert' = 'select';
  private patch: Row = {};
  private payload: Row | Row[] = {};
  private upsertOptions?: { onConflict?: string; ignoreDuplicates?: boolean };
  private singleMode: 'many' | 'single' | 'maybeSingle' = 'many';
  private wantsHead = false;
  private wantsCount = false;
  private returnsRows = false;
  private orderBy: { column: string; ascending: boolean } | null = null;
  private rangeStart: number | null = null;
  private rangeEnd: number | null = null;

  constructor(private readonly db: FakeDb, private readonly table: string) {}

  select(_columns?: string, options?: { count?: string; head?: boolean }): this {
    if (this.kind === 'select') {
      this.wantsHead = options?.head === true;
      this.wantsCount = options?.count === 'exact' && !this.wantsHead;
    } else {
      this.returnsRows = true;
    }
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

  upsert(
    payload: Row | Row[],
    options?: { onConflict?: string; ignoreDuplicates?: boolean },
  ): this {
    this.kind = 'upsert';
    this.payload = payload;
    this.upsertOptions = options;
    return this;
  }

  eq(column: string, value: unknown): this {
    this.filters.push({ kind: 'eq', column, value });
    return this;
  }

  in(column: string, values: unknown[]): this {
    this.filters.push({ kind: 'in', column, values });
    return this;
  }

  not(column: string, operator: string, value: unknown): this {
    if (operator !== 'is' || value !== null) {
      throw new Error(`The practical fake does not support not(${column}, ${operator}, ${String(value)}).`);
    }
    this.filters.push({ kind: 'notNull', column });
    return this;
  }

  order(column?: string, options?: { ascending?: boolean }): this {
    if (column) this.orderBy = { column, ascending: options?.ascending !== false };
    return this;
  }

  limit(count: number): this {
    this.rangeStart = 0;
    this.rangeEnd = count - 1;
    return this;
  }

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
    return this.filters.every((filter) => {
      if (filter.kind === 'eq') return row[filter.column] === filter.value;
      if (filter.kind === 'in') return filter.values.includes(row[filter.column]);
      return row[filter.column] !== null && row[filter.column] !== undefined;
    });
  }

  private shape(rows: Row[], count: number | null): QueryResult {
    const copies = rows.map(clone);
    if (this.singleMode === 'single' || this.singleMode === 'maybeSingle') {
      return { data: copies[0] ?? null, error: null, count: null };
    }
    return { data: copies, error: null, count };
  }

  private execute(): QueryResult {
    const table = this.db.tables[this.table] ?? (this.db.tables[this.table] = []);

    if (this.kind === 'insert') {
      this.db.inserts.push({ table: this.table, payload: this.payload });
      const payload = Array.isArray(this.payload) ? this.payload : [this.payload];
      const inserted = payload.map((row) => ({
        id: row.id ?? `${this.table}_${table.length + 1}_${Math.random().toString(36).slice(2, 8)}`,
        ...row,
      }));
      table.push(...inserted);
      return this.returnsRows ? this.shape(inserted, null) : { data: null, error: null, count: null };
    }

    if (this.kind === 'upsert') {
      this.db.upserts.push({
        table: this.table,
        payload: this.payload,
        options: this.upsertOptions,
      });
      const payload = Array.isArray(this.payload) ? this.payload : [this.payload];
      const conflict = this.upsertOptions?.onConflict;
      for (const row of payload) {
        const existing = conflict
          ? table.find((candidate) => candidate[conflict] === row[conflict])
          : undefined;
        if (existing) {
          if (!this.upsertOptions?.ignoreDuplicates) Object.assign(existing, row);
          continue;
        }
        table.push({
          id: row.id ?? `${this.table}_${table.length + 1}_${Math.random().toString(36).slice(2, 8)}`,
          ...row,
        });
      }
      return { data: null, error: null, count: null };
    }

    if (this.kind === 'update') {
      const matched = table.filter((row) => this.matches(row));
      for (const row of matched) Object.assign(row, this.patch);
      this.db.updates.push({ table: this.table, patch: this.patch, matched: matched.length });
      return this.returnsRows ? this.shape(matched, null) : { data: null, error: null, count: null };
    }

    const matched = table.filter((row) => this.matches(row));
    const ordered = this.orderBy
      ? [...matched].sort((left, right) => {
          const a = left[this.orderBy!.column];
          const b = right[this.orderBy!.column];
          let result = 0;
          if (a === b) result = 0;
          else if (a === null || a === undefined) result = 1;
          else if (b === null || b === undefined) result = -1;
          else result = a < b ? -1 : 1;
          return this.orderBy!.ascending ? result : -result;
        })
      : matched;
    const count = matched.length;
    if (this.wantsHead) return { data: null, error: null, count };
    const sliced =
      this.rangeStart === null
        ? ordered
        : ordered.slice(this.rangeStart, (this.rangeEnd ?? ordered.length - 1) + 1);
    return this.shape(sliced, this.wantsCount ? count : null);
  }
}

// ── fixtures ────────────────────────────────────────────────────────────────

export const RUBRIC: PracticalRubricCriterion[] = [
  {
    id: 'story',
    label: 'Story structure',
    description: 'The scene has a clear beginning, turn and resolution.',
    maxPoints: 40,
  },
  {
    id: 'craft',
    label: 'Production craft',
    description: 'Framing, lighting and continuity serve the scene.',
    maxPoints: 30,
  },
  {
    id: 'sound',
    label: 'Sound design',
    description: 'Dialogue and ambience are intelligible and intentional.',
    maxPoints: 30,
  },
];

export function assessmentRow(over: Row = {}): Row {
  return {
    id: 'pa-1',
    topic_id: 'A01',
    title: 'Direct a one-minute scene',
    brief_markdown: 'Produce a one-minute scene that demonstrates blocking, continuity and sound.',
    submission_instructions: 'Upload a viewable link and describe your role in the production.',
    rubric: RUBRIC,
    pass_percent: 85,
    max_attempts: 3,
    active: true,
    created_at: '2026-10-01T09:00:00.000Z',
    updated_at: '2026-10-01T09:00:00.000Z',
    ...over,
  };
}

export function submissionRow(over: Row = {}): Row {
  return {
    id: 'ps-1',
    assessment_id: 'pa-1',
    enrollment_id: 'enr-1',
    user_id: 'user-1',
    topic_id: 'A01',
    attempt_number: 1,
    status: 'submitted',
    submission_text: 'I directed the scene and operated the camera.',
    media_url: 'https://example.test/scene.mp4',
    media_note: 'One-minute cut, no external footage.',
    rubric_snapshot: RUBRIC,
    pass_threshold: 85,
    submitted_at: '2026-10-20T10:00:00.000Z',
    graded_at: null,
    graded_by: null,
    earned_points: null,
    possible_points: null,
    percentage: null,
    passed: null,
    rubric_scores: [],
    feedback: '',
    created_at: '2026-10-20T10:00:00.000Z',
    ...over,
  };
}

export function assessmentInput(over: Partial<PracticalAssessmentInput> = {}): PracticalAssessmentInput {
  return {
    title: 'Direct a one-minute scene',
    briefMarkdown: 'Produce a one-minute scene that demonstrates blocking, continuity and sound.',
    submissionInstructions: 'Upload a viewable link and describe your role in the production.',
    rubric: RUBRIC,
    passPercent: 85,
    maxAttempts: 3,
    active: true,
    ...over,
  };
}

export function makeDb(over: {
  topic?: Row;
  assessments?: Row[];
  submissions?: Row[];
  holds?: Row[];
  mastery?: Row[];
  enrollments?: Row[];
} = {}): FakeDb {
  return new FakeDb({
    film_topics: [
      over.topic ?? {
        topic_id: 'A01',
        title: 'Directing fundamentals',
        published: true,
        prerequisites: [],
      },
    ],
    film_practical_assessments: over.assessments ?? [assessmentRow()],
    film_practical_submissions: over.submissions ?? [],
    film_mastery_holds: over.holds ?? [],
    film_topic_mastery:
      over.mastery ?? [
        {
          id: 'm1',
          enrollment_id: 'enr-1',
          user_id: 'user-1',
          topic_id: 'A01',
          state: 'MASTERED',
          passed_at: '2026-10-10T10:00:00.000Z',
          mastered_at: '2026-10-10T10:00:00.000Z',
        },
      ],
    film_mastery_events: [],
    film_academic_audit: [],
    academy_enrollments:
      over.enrollments ?? [
        {
          id: 'enr-1',
          academy_applications: { full_name: 'Ada Obi', email: 'ada@example.test' },
        },
      ],
  });
}

export const LEARNER = { enrollmentId: 'enr-1', userId: 'user-1' };

export type PracticalDb = ReturnType<typeof createAdminClient>;

export function asDb(db: FakeDb): PracticalDb {
  return db as unknown as PracticalDb;
}
