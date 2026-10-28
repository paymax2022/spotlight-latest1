// TMFA curriculum-pack question import — header auto-detection, the shared
// stage/module convention, GATE-009 row rejections and draft-only commit.
//
// Rows here are synthetic: the real pack bank is an answer key and is NOT stored in
// this (public) repo. Point TMFA_BANK_CSV at a private copy to run the real-data case.

import { describe, it, expect, vi } from 'vitest';
import { existsSync, readFileSync } from 'node:fs';

vi.mock('@/lib/supabase/server', () => ({ createAdminClient: vi.fn() }));

import { checkHeaders, detectFormat, parseAndValidate, parseCsv } from '@/server/services/academy/assessment/csv';
import { commitDrafts } from '@/server/services/academy/assessment/bank';
import { isFilmModuleCode, isFilmStage } from '@/server/services/academy/assessment/types';

const TMFA_HEADER = [
  'question_id', 'topic_id', 'course_id', 'stage', 'objective_id', 'question_type',
  'cognitive_level', 'difficulty', 'stem', 'option_a', 'option_b', 'option_c', 'option_d',
  'correct_option', 'correct_answer', 'rationale', 'points', 'language', 'status',
  'version', 'reviewer', 'source_note',
].join(',');

type Over = Partial<Record<string, string>>;

function tmfaRow(o: Over = {}): string {
  const v: Record<string, string> = {
    question_id: 'TEST-A01-Q01', topic_id: 'A01', course_id: 'ACT', stage: 'L1',
    objective_id: 'A01-LO1', question_type: 'single_select', cognitive_level: 'Understand',
    difficulty: 'Foundation', stem: 'Which synthetic option is keyed?',
    option_a: 'Red', option_b: 'Green', option_c: 'Blue', option_d: 'Yellow',
    correct_option: 'C', correct_answer: 'Blue', rationale: 'Blue is the synthetic key.',
    points: '1', language: 'en-NG', status: 'DRAFT — SME REVIEW', version: '1.0',
    reviewer: 'UNASSIGNED', source_note: 'synthetic',
    ...o,
  };
  return TMFA_HEADER.split(',').map((h) => v[h]).join(',');
}

const tmfa = (...rows: string[]) => [TMFA_HEADER, ...rows].join('\n');

describe('TMFA format detection', () => {
  it('detects the pack by its snake_case headers and keeps legacy otherwise', () => {
    const header = parseCsv(TMFA_HEADER)[0];
    expect(detectFormat(header)).toBe('tmfa');
    expect(checkHeaders(header)).toEqual({ ok: true, missing: [], format: 'tmfa' });
    expect(detectFormat(['Question ID', 'Stage'])).toBe('legacy');
  });

  it('reports the TMFA columns that are missing', () => {
    const r = checkHeaders(['question_id', 'topic_id', 'stage']);
    expect(r.ok).toBe(false);
    expect(r.missing).toContain('rationale');
  });
});

describe('TMFA row mapping (shared convention)', () => {
  it('maps question_id / topic_id / stage verbatim and rationale to the explanation', () => {
    const r = parseAndValidate(tmfa(
      tmfaRow(),
      tmfaRow({ question_id: 'TEST-C01-T1-Q01', topic_id: 'C01-T1', course_id: 'C01', stage: 'L3' }),
      tmfaRow({ question_id: 'TEST-SRV-Q01', topic_id: 'A24', stage: 'survey', status: 'DRAFT — REWRITE BEFORE USE' }),
    ));
    expect(r.rejected).toEqual([]);
    expect(r.accepted.map((d) => [d.externalCode, d.moduleCode, d.stage])).toEqual([
      ['TEST-A01-Q01', 'A01', 'L1'],
      ['TEST-C01-T1-Q01', 'C01-T1', 'L3'],
      ['TEST-SRV-Q01', 'A24', 'survey'],
    ]);
    const d = r.accepted[0];
    expect(d.answer).toEqual({ correct: ['c'], explanation: 'Blue is the synthetic key.' });
    expect(d.department).toBe('ACT');
    expect(d.learningOutcome).toBe('A01-LO1');
    expect(d.points).toBe(1);
    expect(r.warned.some((w) => w.row === 3 && /rewrite/i.test(w.message))).toBe(true);
    expect(r.warned.some((w) => /336-row starter bank/.test(w.message))).toBe(true);
  });

  it('accepts both vocabularies in the stage/module helpers', () => {
    for (const s of ['L0', 'L1', 'L4', 'L5', 'survey']) expect(isFilmStage(s)).toBe(true);
    expect(isFilmStage('Survey')).toBe(false);
    for (const m of ['FM01', 'FM32', 'A01', 'A24', 'C01-T1', 'C12-T4']) expect(isFilmModuleCode(m)).toBe(true);
    for (const m of ['FM33', 'A25', 'C13-T1', 'C01-T5', 'C01']) expect(isFilmModuleCode(m)).toBe(false);
  });
});

describe('TMFA row rejections (GATE-009)', () => {
  const rejectOf = (o: Over) => {
    const r = parseAndValidate(tmfa(tmfaRow(o)));
    expect(r.accepted).toHaveLength(0);
    return r.rejected[0];
  };

  it('rejects an empty rationale', () => {
    const p = rejectOf({ rationale: '  ' });
    expect(p).toMatchObject({ row: 1, externalCode: 'TEST-A01-Q01' });
    expect(p.message).toMatch(/rationale is blank/);
  });

  it('rejects wrong option counts, bad keys, non-positive points and unknown types', () => {
    expect(rejectOf({ option_d: '' }).message).toMatch(/All four options/);
    expect(rejectOf({ correct_option: 'E' }).message).toMatch(/correct_option must be A, B, C or D/);
    expect(rejectOf({ correct_option: 'AB' }).message).toMatch(/correct_option must be A, B, C or D/);
    expect(rejectOf({ correct_answer: 'Red' }).message).toMatch(/correct_answer does not match/);
    expect(rejectOf({ points: '0' }).message).toMatch(/positive number/);
    expect(rejectOf({ points: '-1' }).message).toMatch(/positive number/);
    expect(rejectOf({ question_type: 'multi_select' }).message).toMatch(/question_type "multi_select"/);
    expect(rejectOf({ stage: 'L9' }).message).toMatch(/stage "L9"/);
    expect(rejectOf({ topic_id: 'A99' }).message).toMatch(/topic_id "A99"/);

    const extra = parseAndValidate(`${TMFA_HEADER},option_e\n${tmfaRow()},Purple`);
    expect(extra.rejected[0].message).toMatch(/Exactly four options/);
  });

  it('rejects a duplicate question_id with the row of the first occurrence', () => {
    const r = parseAndValidate(tmfa(tmfaRow(), tmfaRow({ stem: 'Another stem?' })));
    expect(r.accepted).toHaveLength(1);
    expect(r.rejected).toEqual([
      { row: 2, externalCode: 'TEST-A01-Q01', message: 'Duplicate question_id (also on row 1)' },
    ]);
  });
});

describe('legacy format still imports', () => {
  it('accepts a Title Case FM-coded row without a rationale', () => {
    const r = parseAndValidate(
      'Question ID,Stage,Module ID,Module,Question,Option A,Option B,Option C,Option D,Correct Option,Points\n'
      + 'TEST-L1-01,L1,FM01,Synthetic,Q?,a,b,c,d,A,1',
    );
    expect(r.rejected).toEqual([]);
    expect(r.accepted[0]).toMatchObject({ externalCode: 'TEST-L1-01', stage: 'L1', moduleCode: 'FM01' });
  });
});

// Minimal in-memory stand-in for the Supabase client: academy_question_items keyed
// by external_code, recording every insert/update payload.
function fakeDb(existing: Record<string, { id: string; status: string; film_source_hash: string | null }> = {}) {
  const writes: Array<{ op: string; payload: Record<string, unknown> }> = [];
  const from = () => {
    let code = '';
    const q = {
      select: () => q,
      eq: (col: string, v: string) => { if (col === 'external_code') code = v; return q; },
      maybeSingle: async () => ({ data: existing[code] ?? null }),
      insert: async (payload: Record<string, unknown>) => { writes.push({ op: 'insert', payload }); return { error: null }; },
      update: (payload: Record<string, unknown>) => { writes.push({ op: 'update', payload }); return q; },
      then: (resolve: (v: { error: null }) => void) => resolve({ error: null }),
    };
    return q;
  };
  return { db: { from } as unknown as Parameters<typeof commitDrafts>[0], writes };
}

describe('TMFA commit is draft-only and idempotent on external_code', () => {
  it('inserts as draft even when the CSV status claims APPROVED', async () => {
    const r = parseAndValidate(tmfa(tmfaRow({ status: 'APPROVED' })));
    expect(r.accepted).toHaveLength(1);
    const { db, writes } = fakeDb();
    const res = await commitDrafts(db, r.accepted, 'batch-1');
    expect(res.inserted).toBe(1);
    const insert = writes.find((w) => w.op === 'insert')!.payload;
    expect(insert).toMatchObject({
      status: 'draft', academy_scope: 'film', external_code: 'TEST-A01-Q01',
      film_stage: 'L1', film_module_code: 'A01', film_points: 1,
      answer: { correct: ['c'], explanation: 'Blue is the synthetic key.' },
    });
  });

  it('re-import leaves an identical draft unchanged and never touches an approved item', async () => {
    const r = parseAndValidate(tmfa(tmfaRow()));
    const first = fakeDb();
    await commitDrafts(first.db, r.accepted, 'b1');
    const hash = first.writes[0].payload.film_source_hash as string;

    const again = fakeDb({ 'TEST-A01-Q01': { id: 'q1', status: 'draft', film_source_hash: hash } });
    expect(await commitDrafts(again.db, r.accepted, 'b2')).toMatchObject({ inserted: 0, unchanged: 1 });

    const edited = parseAndValidate(tmfa(tmfaRow({ rationale: 'A corrected rationale.' })));
    const changed = fakeDb({ 'TEST-A01-Q01': { id: 'q1', status: 'draft', film_source_hash: hash } });
    expect(await commitDrafts(changed.db, edited.accepted, 'b3')).toMatchObject({ updated: 1 });

    const locked = fakeDb({ 'TEST-A01-Q01': { id: 'q1', status: 'approved', film_source_hash: 'x' } });
    expect(await commitDrafts(locked.db, edited.accepted, 'b4')).toMatchObject({ locked: 1, updated: 0 });
  });
});

const PACK = process.env.TMFA_BANK_CSV;
const maybe = PACK && existsSync(PACK) ? describe : describe.skip;

maybe('the TMFA pack bank (real data)', () => {
  it('accepts all 336 rows with zero rejections', () => {
    const r = parseAndValidate(readFileSync(PACK as string, 'utf8'));
    expect(r.totalRows).toBe(336);
    expect(r.rejected).toEqual([]);
    expect(new Set(r.accepted.map((d) => d.moduleCode)).size).toBe(72);
    expect(new Set(r.accepted.map((d) => d.stage))).toEqual(new Set(['L1', 'L2', 'L3', 'L4', 'survey']));
  });
});
