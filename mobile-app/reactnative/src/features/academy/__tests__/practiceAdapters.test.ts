// Unit tests for the practice/quiz adapters (Go assessment API ↔ mobile). The
// live quiz loop grades server-side: the /practice read strips the answer key,
// submit sends the learner's selection in the grader's shape, and the result
// carries a per-question review. These pin the bridging so the practice screen
// works live without change. Run: npm run test:academy

import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  adaptPracticeItem,
  adaptPracticeItems,
  toPracticeSubmit,
  adaptPracticeResult,
  mapMasteryState,
} from '../practiceAdapters.ts';

const GO_ITEM = {
  id: 'q1',
  type: 'mcq',
  stem: 'Solve for x: x + 5 = 12',
  options: [
    { id: 'a', text: 'x = 7' },
    { id: 'b', text: 'x = 17' },
  ],
  objective_id: 'obj-1',
  subject_id: 'subj-1',
};

test('adaptPracticeItem maps the served item and never leaks an answer', () => {
  const q = adaptPracticeItem(GO_ITEM);
  assert.equal(q.id, 'q1');
  assert.equal(q.type, 'mcq');
  assert.equal(q.stem, 'Solve for x: x + 5 = 12');
  assert.deepEqual(q.options, [{ id: 'a', text: 'x = 7' }, { id: 'b', text: 'x = 17' }]);
  assert.equal(q.objectiveId, 'obj-1');
  assert.equal(q.subjectId, 'subj-1');
  assert.deepEqual(q.correct, [], 'correct is server-side only — never on the read');
  assert.equal(q.explanation, '');
});

test('adaptPracticeItem defaults unknown type → mcq and drops malformed options', () => {
  const q = adaptPracticeItem({ ...GO_ITEM, type: 'weird', options: [{ id: 'a', text: 'ok' }, { text: 'no id' }, 'junk'] });
  assert.equal(q.type, 'mcq');
  assert.deepEqual(q.options, [{ id: 'a', text: 'ok' }]);
});

test('adaptPracticeItems tolerates undefined/non-array', () => {
  assert.deepEqual(adaptPracticeItems(undefined), []);
});

test('toPracticeSubmit wraps selections in the grader shape (selected.value)', () => {
  const body = toPracticeSubmit('obj-1', [
    { questionId: 'q1', selected: ['a'] },
    { questionId: 'q2', selected: ['c'] },
  ]);
  assert.equal(body.objective_id, 'obj-1');
  assert.deepEqual(body.answers, [
    { question_item_id: 'q1', selected: { value: ['a'] } },
    { question_item_id: 'q2', selected: { value: ['c'] } },
  ]);
});

test('adaptPracticeResult maps aggregate + points + joined breakdown', () => {
  const go = {
    objective_id: 'obj-1',
    scored: 2,
    correct: 1,
    score: 0.5,
    from_state: 'not_started',
    to_state: 'in_progress',
    upgraded: true,
    breakdown: [
      { question_item_id: 'q1', stem: 'x + 5 = 12', correct: true, correct_answer: ['a'], explanation: 'Subtract 5.' },
      { question_item_id: 'q2', stem: '3x = 21', correct: false, correct_answer: ['c'], explanation: 'Divide by 3.' },
    ],
  };
  const r = adaptPracticeResult(go, [
    { questionId: 'q1', selected: ['a'] },
    { questionId: 'q2', selected: ['b'] },
  ]);
  assert.equal(r.total, 2);
  assert.equal(r.correct, 1);
  assert.equal(r.scorePct, 50);
  assert.equal(r.masteryGained, true, 'upgraded → masteryGained');
  assert.equal(r.newMastery, 'learning', 'in_progress → learning');
  assert.equal(r.pointsEarned, 1 * 10 + 20, 'correct*10 + mastery bonus');
  assert.equal(r.breakdown.length, 2);
  assert.deepEqual(r.breakdown[0], {
    questionId: 'q1', stem: 'x + 5 = 12', correct: true, selected: ['a'], correctAnswers: ['a'], explanation: 'Subtract 5.',
  });
  assert.deepEqual(r.breakdown[1].selected, ['b'], 'joins the learner selection by question id');
  assert.deepEqual(r.breakdown[1].correctAnswers, ['c']);
});

test('adaptPracticeResult: no upgrade → no mastery bonus', () => {
  const r = adaptPracticeResult(
    { objective_id: 'o', scored: 3, correct: 3, score: 1, from_state: 'in_progress', to_state: 'in_progress', upgraded: false },
    [],
  );
  assert.equal(r.masteryGained, false);
  assert.equal(r.pointsEarned, 30, 'correct*10 only');
  assert.equal(r.newMastery, 'learning');
});

test('mapMasteryState covers the full backend ladder', () => {
  assert.equal(mapMasteryState('not_started'), 'not_started');
  assert.equal(mapMasteryState('in_progress'), 'learning');
  assert.equal(mapMasteryState('practiced'), 'proficient');
  assert.equal(mapMasteryState('mastered'), 'mastered');
  assert.equal(mapMasteryState('exam_ready'), 'mastered', 'exam_ready collapses into mastered');
  assert.equal(mapMasteryState(undefined), 'not_started');
});
