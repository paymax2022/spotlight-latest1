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

test('examPoints mirrors the mock scale (100% → 300) and clamps', () => {
  assert.equal(examPoints(100), 300);
  assert.equal(examPoints(0), 0);
  assert.equal(examPoints(50), 150);
  assert.equal(examPoints(150), 300, 'clamped at 100%');
});
