// TMFA certificate issuance — service-level invariants.
//
// The learner app disables self-issue once a credential is revoked, but the
// server is what actually refuses it. These tests pin that split against an
// in-memory fake of the Supabase query builder:
//   - eligibility is recomputed before anything is written,
//   - an active credential is returned idempotently,
//   - a learner cannot self-issue after revocation,
//   - an academy administrator can issue the replacement,
//   - a learner cannot issue against another learner's enrollment.
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
  issueCertificate,
  readCertificateForDownload,
  CertificateError,
} from '@/src/server/services/academy/topics/certificates';

type Row = Record<string, unknown>;
type CertificateDb = Parameters<typeof issueCertificate>[0];
type QueryResult = { data: unknown; error: null; count: number | null };

class FakeDb {
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
  private kind: 'select' | 'insert' = 'select';
  private payload: Row = {};
  private singleMode: 'many' | 'single' | 'maybeSingle' = 'many';
  private wantsHead = false;
  private selectAfterInsert = false;

  constructor(private readonly db: FakeDb, private readonly table: string) {}

  select(_columns?: string, options?: { count?: string; head?: boolean }): this {
    if (this.kind === 'insert') this.selectAfterInsert = true;
    else this.wantsHead = options?.head === true;
    return this;
  }

  insert(payload: Row): this {
    this.kind = 'insert';
    this.payload = payload;
    return this;
  }

  eq(column: string, value: unknown): this {
    this.filters.push([column, value]);
    return this;
  }

  order(): this { return this; }
  limit(): this { return this; }

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

  private execute(): QueryResult {
    const table = this.db.tables[this.table] ?? (this.db.tables[this.table] = []);

    if (this.kind === 'insert') {
      this.db.inserts.push({ table: this.table, payload: this.payload });
      // Columns that exist but are omitted from the insert come back as NULL,
      // not undefined, exactly as Postgres returns them.
      const defaults: Row = this.table === 'academy_certificates'
        ? { revoked_at: null, revocation_reason: null, grade: null }
        : {};
      const row = { id: this.payload.id ?? `row_${table.length + 1}`, ...defaults, ...this.payload };
      table.push(row);
      return {
        data: this.selectAfterInsert ? { ...row } : null,
        error: null,
        count: null,
      };
    }

    const matched = table.filter((row) =>
      this.filters.every(([column, value]) => row[column] === value),
    );
    if (this.wantsHead) return { data: null, error: null, count: matched.length };
    if (this.singleMode !== 'many') {
      return { data: matched[0] ? { ...matched[0] } : null, error: null, count: null };
    }
    // Supabase returns fresh objects, so a later mutation must not rewrite a
    // snapshot the service already read.
    return { data: matched.map((row) => ({ ...row })), error: null, count: matched.length };
  }
}

function asDb(db: FakeDb): CertificateDb {
  return db as unknown as CertificateDb;
}

function certificateRow(over: Row = {}): Row {
  return {
    id: 'cert-1',
    enrollment_id: 'enr-1',
    certificate_number: 'TMFA-2026-AAAA1111',
    student_name: 'Ada Obi',
    program_name: 'Spotlight Film Academy — TMFA',
    batch_name: 'Cohort 1',
    completion_date: '2026-09-30',
    grade: null,
    status: 'issued',
    qr_verification_code: 'AAAA-BBBB-CCCC',
    issued_at: '2026-09-30T10:00:00.000Z',
    revoked_at: null,
    revocation_reason: null,
    curriculum_label: 'TMFA Curriculum 1.0',
    topics_required: 2,
    topics_mastered: 2,
    created_at: '2026-09-30T10:00:00.000Z',
    ...over,
  };
}

function revokedCertificateRow(over: Row = {}): Row {
  return certificateRow({
    status: 'revoked',
    revoked_at: '2026-10-01T09:00:00.000Z',
    revocation_reason: 'Assessment integrity finding upheld on appeal.',
    ...over,
  });
}

function makeDb(over: {
  topics?: Row[];
  mastery?: Row[];
  holds?: Row[];
  certificates?: Row[];
  enrollment?: Row | null;
} = {}): FakeDb {
  return new FakeDb({
    film_topics: over.topics ?? [
      { topic_id: 'A01', published: true },
      { topic_id: 'A02', published: true },
    ],
    film_topic_mastery: over.mastery ?? [
      { id: 'm1', enrollment_id: 'enr-1', topic_id: 'A01', state: 'MASTERED' },
      { id: 'm2', enrollment_id: 'enr-1', topic_id: 'A02', state: 'MASTERED' },
    ],
    film_mastery_holds: over.holds ?? [],
    academy_certificates: over.certificates ?? [],
    academy_enrollments: over.enrollment === null
      ? []
      : [over.enrollment ?? {
          id: 'enr-1',
          user_id: 'user-1',
          academy_applications: { full_name: 'Ada Obi', email: 'ada@example.test' },
          academy_programs: { title: 'Spotlight Film Academy — TMFA' },
          academy_batches: { batch_name: 'Cohort 1' },
        }],
    film_academic_audit: [],
  });
}

const ADMIN = {
  actorId: '11111111-1111-1111-1111-111111111111',
  actorRole: 'super_admin',
};

const LEARNER = {
  actorId: 'user-1',
  actorRole: 'learner',
  userId: 'user-1',
};

async function expectCertificateError(
  promise: Promise<unknown>,
  status: number,
  code: string,
): Promise<void> {
  const error = await promise.then(
    () => null,
    (reason: unknown) => reason,
  );
  expect(error).toBeInstanceOf(CertificateError);
  expect((error as CertificateError).status).toBe(status);
  expect((error as CertificateError).code).toBe(code);
}

describe('certificate issuance', () => {
  it('returns an already-issued, unrevoked credential unchanged', async () => {
    const db = makeDb({ certificates: [certificateRow()] });

    const result = await issueCertificate(asDb(db), {
      enrollmentId: 'enr-1',
      ...LEARNER,
    });

    expect(result.created).toBe(false);
    expect(result.certificate.certificateNumber).toBe('TMFA-2026-AAAA1111');
    expect(db.insertsFor('academy_certificates')).toHaveLength(0);
    expect(db.insertsFor('film_academic_audit')).toHaveLength(0);
  });

  it('refuses a learner self-issue after revocation and writes nothing', async () => {
    const db = makeDb({ certificates: [revokedCertificateRow()] });

    await expectCertificateError(
      issueCertificate(asDb(db), { enrollmentId: 'enr-1', ...LEARNER }),
      409,
      'CERTIFICATE_REVOKED',
    );

    expect(db.insertsFor('academy_certificates')).toHaveLength(0);
    expect(db.insertsFor('film_academic_audit')).toHaveLength(0);
  });

  it('lets an academy administrator issue a replacement for a revoked credential', async () => {
    const db = makeDb({ certificates: [revokedCertificateRow()] });

    const result = await issueCertificate(asDb(db), {
      enrollmentId: 'enr-1',
      ...ADMIN,
    });

    expect(result.created).toBe(true);
    expect(result.certificate.status).toBe('issued');
    expect(result.certificate.revokedAt).toBeNull();
    expect(result.certificate.topicsRequired).toBe(2);
    expect(result.certificate.topicsMastered).toBe(2);
    expect(result.certificate.studentName).toBe('Ada Obi');

    // The revoked row stays in the record; the replacement is a new row.
    expect(db.rows('academy_certificates')).toHaveLength(2);
    const inserted = db.insertsFor('academy_certificates');
    expect(inserted).toHaveLength(1);
    expect(inserted[0]).toMatchObject({
      enrollment_id: 'enr-1',
      student_name: 'Ada Obi',
      program_name: 'Spotlight Film Academy — TMFA',
      batch_name: 'Cohort 1',
      status: 'issued',
      topics_required: 2,
      topics_mastered: 2,
    });
    expect(String(inserted[0].certificate_number)).toMatch(/^TMFA-\d{4}-[0-9A-F]{8}$/);
    expect(db.insertsFor('film_academic_audit')).toHaveLength(1);
    expect(db.insertsFor('film_academic_audit')[0]).toMatchObject({
      action: 'CERTIFICATE_ISSUED',
      target_type: 'academy_certificate',
      actor_role: 'super_admin',
    });
  });

  it('recomputes eligibility and refuses a learner who has not mastered every topic', async () => {
    const db = makeDb({
      mastery: [{ id: 'm1', enrollment_id: 'enr-1', topic_id: 'A01', state: 'MASTERED' }],
    });

    await expectCertificateError(
      issueCertificate(asDb(db), { enrollmentId: 'enr-1', ...LEARNER }),
      409,
      'CERTIFICATE_NOT_EARNED',
    );

    expect(db.insertsFor('academy_certificates')).toHaveLength(0);
    expect(db.insertsFor('film_academic_audit')).toHaveLength(0);
  });

  it('refuses to issue against another learner’s enrollment', async () => {
    const db = makeDb({
      enrollment: {
        id: 'enr-1',
        user_id: 'user-2',
        academy_applications: { full_name: 'Someone Else' },
        academy_programs: { title: 'Spotlight Film Academy — TMFA' },
        academy_batches: null,
      },
    });

    await expectCertificateError(
      issueCertificate(asDb(db), { enrollmentId: 'enr-1', ...LEARNER }),
      403,
      'NOT_YOUR_ENROLLMENT',
    );

    expect(db.insertsFor('academy_certificates')).toHaveLength(0);
  });
});

describe('certificate download', () => {
  it('returns the issued credential', async () => {
    const db = makeDb({ certificates: [certificateRow()] });

    const certificate = await readCertificateForDownload(asDb(db), 'enr-1');

    expect(certificate.certificateNumber).toBe('TMFA-2026-AAAA1111');
    expect(certificate.verificationCode).toBe('AAAA-BBBB-CCCC');
    expect(certificate.status).toBe('issued');
  });

  it('does not re-check current eligibility for an already-earned credential', async () => {
    // A later hold (or a withdrawn topic) must not erase a credential that was
    // already issued; revocation is the only mechanism that does that.
    const db = makeDb({
      certificates: [certificateRow()],
      mastery: [],
      holds: [{ id: 'h1', enrollment_id: 'enr-1', status: 'open' }],
    });

    const certificate = await readCertificateForDownload(asDb(db), 'enr-1');

    expect(certificate.certificateNumber).toBe('TMFA-2026-AAAA1111');
  });

  it('404s when the learner holds no credential', async () => {
    const db = makeDb({ certificates: [] });

    await expectCertificateError(
      readCertificateForDownload(asDb(db), 'enr-1'),
      404,
      'CERTIFICATE_NOT_FOUND',
    );
  });

  it('refuses a revoked credential', async () => {
    const db = makeDb({ certificates: [revokedCertificateRow()] });

    await expectCertificateError(
      readCertificateForDownload(asDb(db), 'enr-1'),
      409,
      'CERTIFICATE_REVOKED',
    );
  });

  it('refuses a credential that was never issued', async () => {
    const db = makeDb({ certificates: [certificateRow({ status: 'pending' })] });

    await expectCertificateError(
      readCertificateForDownload(asDb(db), 'enr-1'),
      409,
      'CERTIFICATE_NOT_ISSUED',
    );
  });

  it('refuses to render a credential with no verification code', async () => {
    const db = makeDb({ certificates: [certificateRow({ qr_verification_code: '   ' })] });

    await expectCertificateError(
      readCertificateForDownload(asDb(db), 'enr-1'),
      409,
      'VERIFICATION_CODE_MISSING',
    );
  });
});
