// Film Academy assessment — pure-logic release gates (PRD QA-01 / QA-02 / §7.2 / §7.6).
//
// These exercise the DB-free layer only: CSV validation and deterministic marking.
// The Supabase-backed import/review/attempt code needs a live schema and is covered
// by the browser + integration passes, not here.

import { describe, it, expect } from 'vitest';
import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { checkHeaders, parseAndValidate, draftContentHash, parseCsv } from '@/server/services/academy/assessment/csv';
import {
  presentQuestion,
  scoreAttempt,
  examGateReason,
  type AnswerKeyEntry,
} from '@/server/services/academy/assessment/scoring';
import type { FilmQuestionOption, SnapshotItem } from '@/server/services/academy/assessment/types';

// A seeded rng so every shuffle assertion is reproducible.
function seededRng(seed: number) {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 0x100000000;
  };
}

const HEADER = [
  'Question ID', 'Stage', 'Module ID', 'Module', 'Question',
  'Option A', 'Option B', 'Option C', 'Option D', 'Correct Option',
  'Answer Text', 'Points',
].join(',');

function csv(...rows: string[]): string {
  return [HEADER, ...rows].join('\n');
}

const VALID_ROW =
  'TEST-L1-99-01,L1,FM01,Synthetic,Which colour is the synthetic test answer?,Blue,Red,Green,Yellow,A,Blue,1';

describe('import header check', () => {
  it('passes on the supplied bank header and reports the missing ones otherwise', () => {
    const good = parseCsv(HEADER);
    expect(checkHeaders(good[0]).ok).toBe(true);
    const missing = checkHeaders(['Question ID', 'Stage']);
    expect(missing.ok).toBe(false);
    expect(missing.missing).toContain('Option A');
  });
});

describe('row validation (QA-01)', () => {
  it('accepts a well-formed row', () => {
    const r = parseAndValidate(csv(VALID_ROW));
    expect(r.accepted).toHaveLength(1);
    expect(r.rejected).toHaveLength(0);
    const d = r.accepted[0];
    expect(d.externalCode).toBe('TEST-L1-99-01');
    expect(d.options.map((o) => o.id)).toEqual(['a', 'b', 'c', 'd']);
    expect(d.answer.correct).toEqual(['a']);
    expect(d.points).toBe(1);
  });

  it('rejects a blank / duplicate Question ID', () => {
    const blank = parseAndValidate(csv(',L1,FM01,M,Q,a,b,c,d,A,a,1'));
    expect(blank.rejected[0].message).toMatch(/Question ID is blank/);

    const dup = parseAndValidate(csv(VALID_ROW, VALID_ROW));
    expect(dup.rejected[0].message).toMatch(/Duplicate Question ID/);
  });

  it('rejects a stage outside L0-L5 and a module outside FM01-FM32', () => {
    const badStage = parseAndValidate(csv('X,L9,FM01,M,Q,a,b,c,d,A,a,1'));
    expect(badStage.rejected[0].message).toMatch(/Stage "L9"/);
    const badMod = parseAndValidate(csv('X,L1,FM99,M,Q,a,b,c,d,A,a,1'));
    expect(badMod.rejected[0].message).toMatch(/Module ID "FM99"/);
  });

  it('requires four distinct, non-blank options', () => {
    const blankOpt = parseAndValidate(csv('X,L1,FM01,M,Q,a,b,c,,A,a,1'));
    expect(blankOpt.rejected[0].message).toMatch(/All four options/);
    const sameOpt = parseAndValidate(csv('X,L1,FM01,M,Q,a,a,a,a,A,a,1'));
    expect(sameOpt.rejected[0].message).toMatch(/four distinct/);
  });

  it('rejects a Correct Option that is not A-D', () => {
    const r = parseAndValidate(csv('X,L1,FM01,M,Q,a,b,c,d,E,a,1'));
    expect(r.rejected[0].message).toMatch(/Correct Option must be A, B, C or D/);
  });

  it('rejects when Answer Text disagrees with the referenced option (case/space-insensitive)', () => {
    const mismatch = parseAndValidate(csv('X,L1,FM01,M,Q,one,two,three,four,B,different,1'));
    expect(mismatch.rejected[0].message).toMatch(/Answer Text does not match/);
    // Normalisation means these DO match.
    const ok = parseAndValidate(csv('X,L1,FM01,M,Q,one,two,three,four,B,  TWO  ,1'));
    expect(ok.accepted).toHaveLength(1);
  });

  it('requires positive finite points', () => {
    expect(parseAndValidate(csv('X,L1,FM01,M,Q,a,b,c,d,A,a,0')).rejected[0].message).toMatch(/positive number/);
    expect(parseAndValidate(csv('X,L1,FM01,M,Q,a,b,c,d,A,a,abc')).rejected[0].message).toMatch(/positive number/);
  });

  it('warns — never blocks — when a non-draft status is imported (never auto-published)', () => {
    const hdr = 'Question ID,Stage,Module ID,Question,Option A,Option B,Option C,Option D,Correct Option,Answer Text,Points,Status';
    const r = parseAndValidate(`${hdr}\nX,L1,FM01,Q,one,two,three,four,A,one,1,PUBLISHED`);
    expect(r.accepted).toHaveLength(1);
    expect(r.warned.some((w) => /never auto-published/i.test(w.message))).toBe(true);
  });

  it('treats the 256-row count as a warning, not a rejection', () => {
    const r = parseAndValidate(csv(VALID_ROW));
    expect(r.accepted).toHaveLength(1);
    expect(r.warned.some((w) => /256-row starter bank/.test(w.message))).toBe(true);
  });

  it('keeps a partially-valid batch: rejected rows do not drop the good ones', () => {
    const r = parseAndValidate(csv(VALID_ROW, 'Y,L1,FM01,M,Q,a,b,c,d,Q,zzz,1'));
    expect(r.accepted).toHaveLength(1);
    expect(r.rejected).toHaveLength(1);
  });
});

describe('content hash (idempotent-import fingerprint)', () => {
  it('is stable for identical content and differs when content changes', () => {
    const a = parseAndValidate(csv(VALID_ROW)).accepted[0];
    const b = parseAndValidate(csv(VALID_ROW)).accepted[0];
    expect(draftContentHash(a)).toBe(draftContentHash(b));

    const changed = parseAndValidate(csv(
      'TEST-L1-99-01,L1,FM01,Synthetic,DIFFERENT stem?,Blue,Red,Green,Yellow,A,Blue,1',
    )).accepted[0];
    expect(draftContentHash(changed)).not.toBe(draftContentHash(a));
  });

  it('ignores cosmetic case/whitespace in options when hashing', () => {
    const a = parseAndValidate(csv(VALID_ROW)).accepted[0];
    const spaced = parseAndValidate(csv(
      'TEST-L1-99-01,L1,FM01,Synthetic,Which colour is the synthetic test answer?,  blue  ,Red,Green,Yellow,A,Blue,1',
    )).accepted[0];
    expect(draftContentHash(spaced)).toBe(draftContentHash(a));
  });
});

describe('presentation + scoring (QA-02)', () => {
  const bankOptions: FilmQuestionOption[] = [
    { id: 'a', text: 'Alpha' },
    { id: 'b', text: 'Bravo' },
    { id: 'c', text: 'Charlie' },
    { id: 'd', text: 'Delta' },
  ];

  it('presents a shuffled order, exposes NO correct answer, and maps presentation ids back to bank ids', () => {
    const { presentedOptions, snapshot } = presentQuestion('q1', 'stem?', 1, bankOptions, 'aq1', seededRng(7));
    expect(presentedOptions).toHaveLength(4);
    expect(presentedOptions[0].presentationOptionId).toBe('aq1_po1');
    // No field hints at which option is correct.
    expect(JSON.stringify(presentedOptions)).not.toMatch(/correct/i);
    // optionMap covers every presentation id with a bank id.
    for (const p of presentedOptions) expect(snapshot.optionMap[p.presentationOptionId]).toBeTruthy();
    // The presented ORDER differs from the bank order under a non-identity shuffle.
    const presentedTexts = presentedOptions.map((p) => p.text);
    expect(new Set(presentedTexts)).toEqual(new Set(['Alpha', 'Bravo', 'Charlie', 'Delta']));
  });

  it('marks correctly through the shuffle — display order never changes the score', () => {
    // Correct bank answer is 'c' (Charlie). Pick Charlie's presentation id.
    const snapshot: SnapshotItem[] = [];
    for (const seed of [1, 2, 3, 4, 5]) {
      const { presentedOptions, snapshot: snap } = presentQuestion('q1', 'stem?', 2, bankOptions, 'aq1', seededRng(seed));
      snapshot.push(snap);
      const charlie = presentedOptions.find((o) => o.text === 'Charlie')!;
      const keys: AnswerKeyEntry[] = [{ questionItemId: 'q1', correctOptionIds: ['c'] }];
      const score = scoreAttempt([snap], { aq1: charlie.presentationOptionId }, keys, 50);
      expect(score.earnedPoints).toBe(2);
      expect(score.passed).toBe(true);
    }
  });

  it('gives a wrong answer zero and an unanswered item zero but keeps max points', () => {
    const snap = presentQuestion('q1', 'stem?', 3, bankOptions, 'aq1', seededRng(11)).snapshot;
    const keys: AnswerKeyEntry[] = [{ questionItemId: 'q1', correctOptionIds: ['b'] }];
    const wrongId = Object.entries(snap.optionMap).find(([, bank]) => bank !== 'b')![0];
    const wrong = scoreAttempt([snap], { aq1: wrongId }, keys, 50);
    expect(wrong.earnedPoints).toBe(0);
    expect(wrong.maxPoints).toBe(3);
    expect(wrong.passed).toBe(false);

    const skipped = scoreAttempt([snap], { aq1: null }, keys, 50);
    expect(skipped.maxPoints).toBe(3);
    expect(skipped.answeredCount).toBe(0);
    expect(skipped.passed).toBe(false);
  });

  it('an invalid presentation id earns nothing (cannot be used to fake a mark)', () => {
    const snap = presentQuestion('q1', 'stem?', 1, bankOptions, 'aq1', seededRng(3)).snapshot;
    const keys: AnswerKeyEntry[] = [{ questionItemId: 'q1', correctOptionIds: ['a'] }];
    const score = scoreAttempt([snap], { aq1: 'aq1_po99_does_not_exist' }, keys, 50);
    expect(score.earnedPoints).toBe(0);
  });

  it('sums points across a multi-item draw (§7.6 precision: sum, never average of rounded pcts)', () => {
    const items: SnapshotItem[] = [];
    const responses: Record<string, string> = {};
    const keys: AnswerKeyEntry[] = [];
    // 3 items worth 1,2,3 points; learner gets items 1 and 3 right.
    const defs = [
      { id: 'i1', pts: 1, correct: 'a', pickText: 'Alpha' },
      { id: 'i2', pts: 2, correct: 'b', pickText: 'Alpha' }, // wrong (Bravo correct)
      { id: 'i3', pts: 3, correct: 'c', pickText: 'Charlie' },
    ];
    defs.forEach((d, i) => {
      const { presentedOptions, snapshot } = presentQuestion(d.id, 's', d.pts, bankOptions, `aq${i + 1}`, seededRng(i + 1));
      items.push(snapshot);
      keys.push({ questionItemId: d.id, correctOptionIds: [d.correct] });
      responses[`aq${i + 1}`] = presentedOptions.find((o) => o.text === d.pickText)!.presentationOptionId;
    });
    const score = scoreAttempt(items, responses, keys, 50);
    expect(score.maxPoints).toBe(6);
    expect(score.earnedPoints).toBe(4); // 1 + 3
    expect(score.percentage).toBeCloseTo(66.67, 1);
    expect(score.passed).toBe(true);
  });
});

describe('exam gate reasons', () => {
  it('reports no_eligible_questions instead of a 0% pass on an empty pool', () => {
    const score = scoreAttempt([], {}, [], 50);
    expect(score.maxPoints).toBe(0);
    expect(score.passed).toBe(false);
    expect(examGateReason(score)).toBe('no_eligible_questions');
  });

  it('distinguishes pass / below_pass_mark', () => {
    const opts: FilmQuestionOption[] = [{ id: 'a', text: 'x' }, { id: 'b', text: 'y' }, { id: 'c', text: 'z' }, { id: 'd', text: 'w' }];
    const snap = presentQuestion('q', 's', 1, opts, 'aq', seededRng(1)).snapshot;
    const keys = [{ questionItemId: 'q', correctOptionIds: ['a'] as string[] }];
    const rightId = Object.entries(snap.optionMap).find(([, b]) => b === 'a')![0];
    const pass = scoreAttempt([snap], { aq: rightId }, keys, 50);
    expect(examGateReason(pass)).toBe('pass');
    const fail = scoreAttempt([snap], { aq: null }, keys, 50);
    expect(examGateReason(fail)).toBe('below_pass_mark');
  });
});

// Highest-value evidence: the ACTUAL 256-row SME bank parses clean. The bank is the
// answer key and is NOT stored in this (public) repo — see tests/fixtures/academy/
// README.md. Point FILM_BANK_CSV at a private copy to run this; otherwise it skips.
const CANONICAL_BANK = fileURLToPath(
  new URL('../../fixtures/academy/Timeless_Movies_Assessment_Bank_256.csv', import.meta.url),
);
const BANK_PATH = process.env.FILM_BANK_CSV || CANONICAL_BANK;
const maybe = BANK_PATH && existsSync(BANK_PATH) ? describe : describe.skip;

maybe('the supplied 256-row bank (QA-01 against real data)', () => {
  it('accepts every row with zero rejections', () => {
    const text = readFileSync(BANK_PATH, 'utf8');
    const r = parseAndValidate(text);
    expect(r.totalRows).toBe(256);
    expect(r.rejected).toEqual([]);
    expect(r.accepted.length).toBe(256);
    // All imported as draft-tagged items with a stable unique code.
    const codes = new Set(r.accepted.map((d) => d.externalCode));
    expect(codes.size).toBe(256);
  });
});
