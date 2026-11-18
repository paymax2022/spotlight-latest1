// Shape checks for the Acting level-assessment seed.
//
// The seed is data, so the risks are structural, and they are the same four the
// TMFA curriculum seed test guards: a question lost between the instructor's
// paper and the bank, an exam that draws from the wrong pool, a pass mark that
// does not mean what the marking scheme says, and a non-idempotent insert.
//
// Two things here are specific to this bank and worth calling out:
//
//  * The draw MUST be pinned by module code. bank.ts applies the module filter
//    only when the list is non-empty, so an exam carrying just film_stage='L1'
//    would draw from every approved L1 film question in the database and would
//    not be an Acting test at all.
//  * 'delete' is a word inside one distractor (ACT-B-011), so the additive-only
//    assertion matches SQL keywords at the start of a line, not anywhere in the
//    file. A loose /\bDELETE\b/i would fail on question text.
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { meetsPassMark } from '@/src/server/services/academy/moduleGate';

const MIGRATION = join(
  __dirname, '..', '..', '..', '..',
  'supabase/migrations/20271500000000_academy_acting_level_assessment.sql',
);
const raw = readFileSync(MIGRATION, 'utf8');
const sql = raw.replace(/^\s*--.*$/gm, '');

/** One row per question, carried verbatim in the migration's $acting$ blob. */
interface SeedQuestion {
  code: string;
  level: string;
  stage: string;
  module_code: string;
  category: string;
  question: string;
  a: string;
  b: string;
  c: string;
  d: string;
  correct: string;
  rationale: string;
  points: number;
}

const blob = /\$acting\$([\s\S]*?)\$acting\$/.exec(sql);
const questions: SeedQuestion[] = blob ? JSON.parse(blob[1]) : [];

const LEVELS = [
  { level: 'Beginner', stage: 'L1', module_code: 'ACT-B', prefix: 'ACT-B' },
  { level: 'Intermediate', stage: 'L2', module_code: 'ACT-I', prefix: 'ACT-I' },
  { level: 'Advanced', stage: 'L3', module_code: 'ACT-A', prefix: 'ACT-A' },
] as const;

const QUESTIONS_PER_LEVEL = 20;
const PASS_MARK = 85;

describe('Acting level-assessment seed', () => {
  it('carries all 60 instructor questions, 20 per level, in paper order', () => {
    expect(questions).toHaveLength(60);
    for (const { prefix } of LEVELS) {
      const ids = questions.filter((q) => q.code.startsWith(`${prefix}-`)).map((q) => q.code);
      expect(ids).toEqual(
        Array.from({ length: QUESTIONS_PER_LEVEL }, (_, i) => `${prefix}-${String(i + 1).padStart(3, '0')}`),
      );
    }
  });

  it('maps each level onto the stage and draw scope the importer already uses', () => {
    for (const q of questions) {
      const expected = LEVELS.find((l) => l.level === q.level);
      expect(expected, `unknown level ${q.level} on ${q.code}`).toBeDefined();
      expect(q.stage).toBe(expected!.stage);
      expect(q.module_code).toBe(expected!.module_code);
      expect(q.code.startsWith(expected!.prefix)).toBe(true);
    }
    expect([...new Set(questions.map((q) => q.code))]).toHaveLength(60);
  });

  it('gives every question four distinct options, one valid key and one mark', () => {
    const letters = ['a', 'b', 'c', 'd'] as const;
    for (const q of questions) {
      expect(q.question.trim(), `${q.code} has no stem`).not.toBe('');
      expect(q.category.trim(), `${q.code} has no category`).not.toBe('');
      expect(q.rationale.trim(), `${q.code} has no explanation`).not.toBe('');
      const texts = letters.map((l) => q[l].trim());
      for (const text of texts) expect(text).not.toBe('');
      expect(new Set(texts).size, `${q.code} repeats an option`).toBe(4);
      expect(letters).toContain(q.correct as (typeof letters)[number]);
      expect(q.points).toBe(1);
    }
  });

  it('stores the key in answer jsonb only, the way the bank already does', () => {
    expect(sql).toMatch(/jsonb_build_object\(\s*'correct',\s*jsonb_build_array\(\s*q\.correct\s*\)/);
    expect(sql).toMatch(/'explanation',\s*q\.rationale/);
    // The answer column, not a new one: nothing here may add a column or table.
    expect(sql).toMatch(/INSERT INTO public\.academy_question_items \(\s*type, stem, options, answer,/);
    expect(sql).not.toMatch(/^\s*(ALTER|CREATE TABLE|ADD COLUMN)/im);
  });

  it('imports as approved film items scoped away from the K-12 bank', () => {
    expect(sql).toMatch(/'approved',\s*'film',\s*q\.stage,\s*q\.module_code/);
    expect(sql).toMatch(/'Acting for Camera'/);
  });

  it('seeds exactly three level exams, published, one per level', () => {
    expect(sql).toMatch(/\)\s*AS\s+lvl\(key,\s*title,\s*stage,\s*module_code,\s*scope\)/);
    for (const { stage, module_code } of LEVELS) {
      expect(sql).toMatch(new RegExp(`'${stage}',\\s*'${module_code}',`));
    }
    expect(sql.match(/^\s*\('(beginner|intermediate|advanced)',$/gm)).toHaveLength(3);
    expect(sql).toMatch(/'stage_exam'/);
    expect(sql).toMatch(/INSERT INTO public\.academy_exams/);
  });

  it('pins every exam to its own 20-question pool at 20 questions and 85%', () => {
    // kind, pass_mark, time_limit, max_attempts, is_published, then the draw scope.
    expect(sql).toMatch(/'stage_exam',\s*85,\s*\d+,\s*3,\s*true,\s*lvl\.stage,\s*ARRAY\[lvl\.module_code\],\s*20/);
    // module_id stays out of the column list so a level test never joins the
    // module-unlock gate that the six checkpoint quizzes drive.
    expect(sql).not.toMatch(/^\s*.*module_id\s*$/m);
  });

  it('makes 17 of 20 the pass and 16 of 20 the fail, on the real gate function', () => {
    expect(meetsPassMark(17, QUESTIONS_PER_LEVEL, PASS_MARK)).toBe(true);
    expect(meetsPassMark(16, QUESTIONS_PER_LEVEL, PASS_MARK)).toBe(false);
    expect(meetsPassMark(20, QUESTIONS_PER_LEVEL, PASS_MARK)).toBe(true);
    expect(meetsPassMark(0, QUESTIONS_PER_LEVEL, PASS_MARK)).toBe(false);
  });

  it('offers the exams on the programmes acting students can be enrolled in', () => {
    // is_default is how ensureEnrollment resolves a learner's programme when the
    // batch names none — which is every batch today. The acting-titled programme
    // is published but unreachable until a batch points at it; seeding it too
    // means the test is already there when that link is made.
    expect(sql).toMatch(/is_published\s+AND\s+\(\s*is_default\s+OR\s+slug\s*=\s*'screen-acting-foundations-2026'\s*\)/);
    // NOT the TMFA pathway: it is unpublished, so exams there start for nobody.
    expect(sql).not.toMatch(/tmfa-professional-filmmaker-pathway/);
  });

  it('is additive and idempotent', () => {
    // Comments are stripped above, so this reads the executable text only.
    expect(sql).not.toMatch(/^\s*(DROP|ALTER|UPDATE|DELETE|TRUNCATE|RENAME)\b/im);
    expect(sql.match(/ON CONFLICT \(id\) DO NOTHING/g)).toHaveLength(1);
    expect(sql).toMatch(/WHERE NOT EXISTS[\s\S]*i\.external_code = q\.code/);
    expect(sql).not.toMatch(/gen_random_uuid\(\)/);
    expect(sql.match(/^INSERT INTO/gm)).toHaveLength(2);
  });

  it('names the source paper so a reviewer can audit the 60 rows', () => {
    expect(raw).toContain('spotlight_acting_quiz_bank.json');
    expect(raw).toContain('spotlight_acting_instructor_key.md');
  });
});
