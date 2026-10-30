// Shape checks for the TMFA curriculum seed migration. The seed is data, so the
// risks are structural: a topic dropped from the JSON, a publish flag left on, a
// checkpoint that does not draw from its own topic, or a non-idempotent insert.
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const MIGRATION = join(
  __dirname, '..', '..', '..', '..',
  'supabase/migrations/20271400000200_academy_tmfa_curriculum.sql',
);
const raw = readFileSync(MIGRATION, 'utf8');
const sql = raw.replace(/^\s*--.*$/gm, '');

type Topic = { ord: number; topic_id: string; stage: string; lesson: string; outcomes: string[] };
const topics: Topic[] = JSON.parse(/\$tmfa\$([\s\S]*?)\$tmfa\$/.exec(sql)![1]);

const EXPECTED_IDS = [
  ...Array.from({ length: 24 }, (_, i) => `A${String(i + 1).padStart(2, '0')}`),
  ...Array.from({ length: 12 }, (_, c) =>
    [1, 2, 3, 4].map((t) => `C${String(c + 1).padStart(2, '0')}-T${t}`)).flat(),
];

describe('TMFA curriculum seed', () => {
  it('covers all 72 pack topics, in pack order, with contiguous order_index', () => {
    expect(topics.map((t) => t.topic_id)).toEqual(EXPECTED_IDS);
    expect(topics.map((t) => t.ord)).toEqual(EXPECTED_IDS.map((_, i) => i));
  });

  it('maps stages to the shared importer convention (L1..L4 for ACT, survey for C01..C12)', () => {
    for (const t of topics) {
      expect(t.stage).toBe(t.topic_id.startsWith('A') ? expectedActStage(t.topic_id) : 'survey');
      expect(t.lesson.trim()).not.toBe('');
      expect(t.outcomes.length).toBeGreaterThan(0);
    }
  });

  it('publishes nothing', () => {
    expect(sql).toMatch(/is_published, is_default\s*\)\s*VALUES[\s\S]*?24, false, false/);
    expect(sql).not.toMatch(/\bis_published\s*=\s*true\b/i);
    // Modules, lessons and exams each insert a literal false into is_published.
    expect(sql.match(/t\.ord, false/g)).toHaveLength(1);
    expect(sql).toMatch(/true, false\s*FROM jsonb_to_recordset/);
    expect(sql).toMatch(/'checkpoint', 85, 15, 3, false,/);
  });

  it('gives every module an 85% checkpoint drawing 10 items from its own topic and stage', () => {
    expect(sql).toMatch(/t\.stage, ARRAY\[t\.topic_id\], 10/);
  });

  it('keeps the faculty-review marker visible and uses the full A04 sample lesson', () => {
    expect(sql).toContain('DRAFT — FACULTY REVIEW BRIEF ONLY');
    expect(sql).toMatch(/\$a04\$# A04 — [\s\S]*## Your practical assignment[\s\S]*\$a04\$/);
  });

  it('is additive and idempotent', () => {
    expect(sql.match(/ON CONFLICT (\(id\) )?DO NOTHING/g)).toHaveLength(4);
    expect(sql).not.toMatch(/\b(DROP|RENAME|UPDATE|DELETE|TRUNCATE)\b/i);
    expect(sql).not.toMatch(/gen_random_uuid\(\)/);
  });
});

function expectedActStage(id: string): string {
  const n = Number(id.slice(1));
  return n <= 8 ? 'L1' : n <= 16 ? 'L2' : n <= 20 ? 'L3' : 'L4';
}
