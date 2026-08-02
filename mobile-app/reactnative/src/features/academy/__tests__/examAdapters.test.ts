// Unit tests for the CBT exam adapters (Go exam API ↔ mobile). The live exam
// grades server-side: questions are served without the answer key, the client
// submits selections in the grader's shape, and the scored attempt maps to the
// results screen. Run: npm run test:academy

import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  adaptStartedAttempt,
  toExamSubmit,
  adaptExamResult,
  examPoints,
  adaptArena,
  adaptArenas,
  adaptBlueprint,
  adaptBlueprints,
} from '../examAdapters.ts';

const QUESTIONS = [
  { id: 'q1', type: 'mcq' as const, stem: 'A', options: [{ id: 'a', text: '1' }], correct: [], explanation: '', subjectId: 'sub-mth' },
  { id: 'q2', type: 'mcq' as const, stem: 'B', options: [{ id: 'a', text: '1' }], correct: [], explanation: '', subjectId: 'sub-eng' },
];

test('adaptStartedAttempt composes the client attempt + server-derived timer', () => {
  const go = {
    id: 'att1', arena_id: 'arena1', blueprint_id: 'bp1', state: 'started',
    started_at: '2026-08-02T10:00:00Z', server_deadline: '2026-08-02T10:20:00Z', offline_origin: false,
  };
  const a = adaptStartedAttempt(go, QUESTIONS);
  assert.equal(a.id, 'att1');
  assert.equal(a.arenaId, 'arena1');
  assert.equal(a.blueprintId, 'bp1');
  assert.equal(a.status, 'in_progress');
  assert.equal(a.durationSec, 1200, '20 minutes between started_at and server_deadline');
  assert.equal(a.remainingSec, 1200);
  assert.equal(a.questions.length, 2);
  assert.deepEqual(a.answers, {});
  assert.equal(a.calculatorAllowed, true, 'defaults true');
  assert.equal(a.offlineOrigin, false);
});

test('adaptStartedAttempt tolerates missing timestamps (duration 0)', () => {
  const a = adaptStartedAttempt({ id: 'x', blueprint_id: 'bp', state: 'started' }, []);
  assert.equal(a.durationSec, 0);
  assert.equal(a.arenaId, '');
});

test('toExamSubmit wraps selections in grader shape, keeps flags, includes unanswered', () => {
  const body = toExamSubmit({ questions: QUESTIONS, answers: { q1: ['b'] }, flagged: ['q2'] });
  assert.deepEqual(body.responses, [
    { question_item_id: 'q1', selected: { value: ['b'] }, flagged: false },
    { question_item_id: 'q2', selected: { value: [] }, flagged: true },
  ]);
  assert.deepEqual(body.integrity, {});
});

test('adaptExamResult maps the scored attempt → results screen', () => {
  const score = {
    overall: 88,
    grade: 'A1',
    subjects: [
      { subject: 'sub-mth', raw: 3, total: 4, scaled: 75, grade: 'A1' },
      { subject: 'sub-eng', raw: 3, total: 3, scaled: 100, grade: 'A1' },
    ],
  };
  const r = adaptExamResult('att1', score, 0.857, { questions: QUESTIONS, answers: { q1: ['b'], q2: ['a'] }, durationSec: 1200, remainingSec: 900 });
  assert.equal(r.attemptId, 'att1');
  assert.equal(r.scorePct, 88);
  assert.equal(r.correct, 6, 'sum of subject raws');
  assert.equal(r.totalQuestions, 7, 'server subject totals drive totalQuestions, not the local array');
  assert.equal(r.unanswered, 5, '7 total − 2 answered locally');
  assert.equal(r.timeSpentSec, 300, 'durationSec - remainingSec');
  assert.equal(r.subjects.length, 2);
  assert.deepEqual(r.subjects[0], { subjectId: 'sub-mth', subjectName: 'sub-mth', correct: 3, total: 4, scorePct: 75 });
  assert.equal(r.pointsEarned, examPoints(88));
});

test('adaptExamResult resolves subject names when a map is supplied + counts unanswered', () => {
  const score = { overall: 50, subjects: [{ subject: 'sub-mth', raw: 1, total: 2, scaled: 50 }] };
  const names = new Map([['sub-mth', 'Mathematics']]);
  const r = adaptExamResult('a', score, 0.5, { questions: QUESTIONS, answers: { q1: ['a'] }, durationSec: 600, remainingSec: 600 }, names);
  assert.equal(r.subjects[0].subjectName, 'Mathematics');
  assert.equal(r.unanswered, 1, 'q2 unanswered');
  assert.equal(r.readinessDelta, 3, 'scorePct >= 50');
});

test('adaptArena unwraps a Go arena row → ExamArena (slug from code)', () => {
  const go = { id: 'ar1', code: 'NABTEB', name: 'NABTEB (Technical & Business)', subject_set: ['a', 'b', 'c'], countdown_at: '2026-11-01T00:00:00Z', status: 'active' };
  const a = adaptArena(go);
  assert.equal(a.id, 'ar1');
  assert.equal(a.slug, 'nabteb', 'code lower-cased into a valid ExamSlug');
  assert.equal(a.name, 'NABTEB (Technical & Business)');
  assert.equal(a.nextSittingDate, '2026-11-01T00:00:00Z');
  assert.equal(a.subjectsRequired, 3, 'from subject_set length');
  assert.equal(a.isCbt, true);
});

test('adaptArena: unknown code → safe slug, missing subject_set → 0', () => {
  const a = adaptArena({ id: 'x', code: 'ZZZ', name: 'Mystery' });
  assert.equal(a.slug, 'nabteb', 'unknown code falls back to a valid slug');
  assert.equal(a.subjectsRequired, 0);
  assert.equal(a.nextSittingDate, '');
});

test('adaptArenas maps a list and tolerates undefined', () => {
  assert.equal(adaptArenas(undefined).length, 0);
  assert.equal(adaptArenas([{ id: '1', code: 'utme', name: 'UTME' }])[0].slug, 'utme');
});

test('adaptBlueprint derives subjects from sections + duration/tools', () => {
  const go = {
    id: 'bp1', arena_id: 'ar1', name: 'Numeracy & Grammar Mock (CBT)', variant: 'full',
    sections: [{ subject_id: 'sub-mth', count: 4 }, { subject_id: 'sub-eng', count: 3 }],
    total_items: 7, total_seconds: 1200, tools: { calculator: true }, status: 'active',
  };
  const b = adaptBlueprint(go);
  assert.equal(b.id, 'bp1');
  assert.equal(b.arenaId, 'ar1');
  assert.equal(b.label, 'Numeracy & Grammar Mock (CBT)');
  assert.equal(b.durationMin, 20, '1200s → 20min');
  assert.equal(b.totalQuestions, 7);
  assert.equal(b.calculatorAllowed, true);
  assert.deepEqual(b.subjects, [
    { subjectId: 'sub-mth', subjectName: 'sub-mth', questionCount: 4 },
    { subjectId: 'sub-eng', subjectName: 'sub-eng', questionCount: 3 },
  ]);
  assert.equal(b.offlineItemCount, 0);
});

test('adaptBlueprint: no sections/tools → empty subjects, total from total_items', () => {
  const b = adaptBlueprint({ id: 'b', arena_id: 'a', name: 'Empty', total_items: 0, total_seconds: 600 });
  assert.deepEqual(b.subjects, []);
  assert.equal(b.calculatorAllowed, false);
  assert.equal(b.totalQuestions, 0);
  assert.equal(adaptBlueprints(undefined).length, 0);
});

test('adaptExamResult prefers server subject_name over the map and over the raw id', () => {
  const score = {
    overall: 50,
    subjects: [
      { subject: 'sub-mth', subject_name: 'Mathematics', raw: 1, total: 2, scaled: 50 },
      { subject: 'sub-eng', raw: 1, total: 2, scaled: 50 }, // no server name → map fallback
      { subject: 'sub-phy', raw: 0, total: 1, scaled: 0 }, // no server name, not in map → id fallback
    ],
  };
  const names = new Map([
    ['sub-mth', 'IGNORED — server name wins'],
    ['sub-eng', 'English'],
  ]);
  const r = adaptExamResult('a', score, 0.5, { questions: QUESTIONS, answers: {}, durationSec: 600, remainingSec: 600 }, names);
  assert.equal(r.subjects[0].subjectName, 'Mathematics', 'server subject_name takes precedence over the supplied map');
  assert.equal(r.subjects[1].subjectName, 'English', 'falls back to the map when the server omits a name');
  assert.equal(r.subjects[2].subjectName, 'sub-phy', 'falls back to the raw id when neither server nor map has a name');
});

test('examPoints mirrors the mock scale (100% → 300) and clamps', () => {
  assert.equal(examPoints(100), 300);
  assert.equal(examPoints(0), 0);
  assert.equal(examPoints(50), 150);
  assert.equal(examPoints(150), 300, 'clamped at 100%');
});
